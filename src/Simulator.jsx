import { useState, useRef, useEffect, useCallback } from "react";

// =====================================================================
// GUARDIAN MESH - web build (faithful mechanics + immersive upgrades)
// =====================================================================

const WORLD_W = 1000, WORLD_H = 800;
const RANGE = { EmergencyBase: 500, StaticRelay: 380, StudentNode: 200 };
const BATT_MAX = { EmergencyBase: 999, StaticRelay: 80, StudentNode: 100 };
const MASS = { EmergencyBase: 2.4, StaticRelay: 1.2, StudentNode: 0.8 };
const DRAIN = 5, SAFE_HOP = 185, MAX_AUTO_RELAYS = 3, MAX_HOPS = 10;
const PKT_SPEED = 240, ACK_SPEED = 320, MAX_RETRIES = 3, RETRY_DELAY = 1.4;
const TOK_MAX = 8, TOK_REFILL = 3.5;
const KILL_BLAST = 220; // shockwave radius (world units) that knocks out nodes

const CLR = { Civilian: 0, Government: 1, Sos: 2 };
const CLR_NAME = ["Civilian", "Government", "SOS"];

const NC = {
  EmergencyBase: [180, 140, 255], StudentNode: [70, 230, 170], StaticRelay: [240, 200, 100],
  ack: [150, 235, 210], ping: [120, 150, 190], sweep: [140, 215, 255], beacon: [255, 205, 120],
};
const TYPE_COL = { SOS: [235, 80, 70], SupplyRequest: [90, 200, 210], StatusUpdate: [120, 170, 255] };
const TYPE_LABEL = { SOS: "SOS", SupplyRequest: "Supply", StatusUpdate: "Status" };

const PILL_COLORS = {
  add: [70,210,160], del: [225,120,130], kill: [235,90,70], clear: [150,160,195],
  load: [110,165,235], sweep: [100,200,230], beacon: [245,195,120], drain: [210,180,110],
  flood: [195,120,215], tap: [160,150,215], fx: [140,130,235],
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rgba = (c, a = 1) => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;

function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, gg = 0, b = 0;
  if (h < 60) { r = c; gg = x; } else if (h < 120) { r = x; gg = c; }
  else if (h < 180) { gg = c; b = x; } else if (h < 240) { gg = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [(r + m) * 255, (gg + m) * 255, (b + m) * 255];
}

// crypto mirror
function fnv(id) { let h = 2166136261 >>> 0; for (let i = 0; i < id.length; i++) { h = (h ^ id.charCodeAt(i)) >>> 0; h = Math.imul(h, 16777619) >>> 0; } return h || 1; }
function pairKey(masters, a, b) { const ka = masters[a] || 1, kb = masters[b] || 1; let k = (Math.imul(ka, 2654435761) ^ ((kb + 0x9e3779b9 + (ka << 6) + (ka >>> 2)) >>> 0)) >>> 0; return k || 1; }
function cipher(input, key) { let s = key >>> 0, out = ""; for (let i = 0; i < input.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; out += String.fromCharCode(input.charCodeAt(i) ^ ((s >>> 16) & 0xff)); } return out; }
function cipherSnippet(c) { let s = ""; for (let i = 0; i < Math.min(6, c.length); i++) s += (c.charCodeAt(i) & 0xff).toString(16).padStart(2, "0"); return s || "--"; }
function clearanceForType(t) { if (t === "SOS") return CLR.Sos; if (t === "StatusUpdate") return CLR.Government; return CLR.Civilian; }
function canRead(nodeClr, msgClr) { if (msgClr === CLR.Civilian || msgClr === CLR.Sos) return true; return nodeClr === CLR.Government; }

function connectNeighbors(nodes) {
  for (const n of nodes) n.neighbors = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (!a.working || !b.working) continue;
      const d = dist(a, b);
      if (d <= RANGE[a.type] && d <= RANGE[b.type]) { a.neighbors.push(b.id); b.neighbors.push(a.id); }
    }
}
function calculateRoute(nodes, startId, endId) {
  const map = {}; for (const n of nodes) map[n.id] = n;
  const cameFrom = { [startId]: null }; const frontier = [startId];
  while (frontier.length) {
    const cur = frontier.shift();
    if (cur === endId) break;
    const node = map[cur]; if (!node) continue;
    if (node.type === "EmergencyBase") continue;
    for (const nid of node.neighbors) { const nb = map[nid]; if (nb && nb.working && !(nid in cameFrom)) { cameFrom[nid] = cur; frontier.push(nid); } }
  }
  if (!(endId in cameFrom)) return [];
  const path = []; let cur = endId;
  while (cur !== null && cur !== undefined) { path.push(cur); cur = cameFrom[cur]; }
  path.reverse(); return path;
}
function reachableFromBase(nodes) {
  const base = nodes.find(n => n.type === "EmergencyBase" && n.working);
  const set = new Set(); if (!base) return set;
  const map = {}; for (const n of nodes) map[n.id] = n;
  const stack = [base.id]; set.add(base.id);
  while (stack.length) { const n = map[stack.pop()]; if (!n) continue; for (const nid of n.neighbors) if (!set.has(nid) && map[nid]?.working) { set.add(nid); stack.push(nid); } }
  return set;
}

// ---------- audio: rich per-action synthesis + music analyser ----------
let actx = null, masterGain = null, analyser = null, freqData = null, musicSource = null, musicEl = null, analyserWired = false;
function wireAnalyser() { if (analyser && masterGain && !analyserWired) { analyser.connect(masterGain); analyserWired = true; } }
function initAudio() {
  if (actx) { if (actx.state === "suspended") actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain(); masterGain.gain.value = 0.9; masterGain.connect(actx.destination);
    analyser = actx.createAnalyser(); analyser.fftSize = 64; freqData = new Uint8Array(analyser.frequencyBinCount);
    if (actx.state === "suspended") actx.resume();
  } catch (e) {}
}
function env(o, g, t0, dur, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function blip(freq, dur, peak, type, slideTo) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || "sine"; o.frequency.setValueAtTime(freq, actx.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), actx.currentTime + dur);
  o.connect(g); g.connect(masterGain); env(o, g, actx.currentTime, dur, peak);
}
function noiseBurst(dur, peak, lp) {
  if (!actx) return;
  const n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp || 1800;
  const g = actx.createGain(); g.gain.setValueAtTime(peak, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(masterGain); src.start(); src.stop(actx.currentTime + dur);
}
// Each action gets a distinct sonic identity
const SFX = {
  place:   () => { blip(523, 0.08, 0.18, "triangle"); setTimeout(() => blip(784, 0.1, 0.16, "triangle"), 55); },
  relay:   () => { blip(440, 0.07, 0.12, "sine", 660); },
  delete:  () => { noiseBurst(0.18, 0.25, 1200); blip(330, 0.22, 0.16, "sawtooth", 90); },   // burst then dying fall
  kill:    () => { noiseBurst(0.5, 0.5, 600); blip(90, 0.5, 0.4, "sawtooth", 30); setTimeout(() => noiseBurst(0.3, 0.25, 400), 80); },
  clear:   () => { blip(400, 0.3, 0.18, "sine", 120); noiseBurst(0.25, 0.12, 900); },
  load:    () => { blip(392, 0.09, 0.14, "triangle"); setTimeout(() => blip(523, 0.09, 0.14, "triangle"), 70); setTimeout(() => blip(659, 0.12, 0.16, "triangle"), 140); },
  sweep:   () => { blip(420, 0.35, 0.18, "sine", 880); setTimeout(() => blip(880, 0.2, 0.12, "triangle", 1100), 160); },
  beacon:  () => { blip(294, 0.6, 0.16, "sine", 392); setTimeout(() => blip(392, 0.5, 0.12, "sine", 494), 180); setTimeout(() => blip(494, 0.4, 0.1, "sine"), 360); },
  drain:   () => { blip(260, 0.5, 0.2, "sawtooth", 70); },
  flood:   () => { for (let i = 0; i < 6; i++) setTimeout(() => { noiseBurst(0.1, 0.14, 2200); blip(120 + i * 25, 0.12, 0.12, "sawtooth"); }, i * 70); },
  tap:     () => { blip(1400, 0.05, 0.12, "square"); setTimeout(() => blip(900, 0.05, 0.1, "square"), 60); setTimeout(() => blip(1100, 0.04, 0.08, "square"), 110); },
  send:    () => { blip(740, 0.08, 0.16, "triangle", 980); },
  deliver: () => { blip(880, 0.1, 0.18, "sine"); setTimeout(() => blip(1175, 0.16, 0.16, "sine", 1320), 70); },
  ack:     () => { blip(659, 0.1, 0.12, "triangle"); setTimeout(() => blip(988, 0.22, 0.12, "triangle", 1200), 70); },
  drop:    () => { blip(180, 0.16, 0.2, "sawtooth", 60); noiseBurst(0.1, 0.12, 700); },
  fx:      () => { blip(600, 0.06, 0.1, "square", 900); },
  click:   () => { blip(820, 0.03, 0.07, "sine"); },
};

// ---------- procedural ambient tracks (feed the analyser) ----------
const TRACKS = [
  { id: "deep-space", name: "Deep Space", desc: "Low drones, slow drift" },
  { id: "neon-pulse", name: "Neon Pulse", desc: "Rhythmic, filtered energy" },
  { id: "quiet-signal", name: "Quiet Signal", desc: "Soft pads, contemplative" },
  { id: "dark-matter", name: "Dark Matter", desc: "Eerie, tense, deep" },
];
let activeTrackNodes = [];
function stopProceduralTrack() {
  for (const n of activeTrackNodes) { try { if (n.stop) n.stop(); else if (n.disconnect) n.disconnect(); } catch (e) {} }
  activeTrackNodes = [];
}
function playProceduralTrack(id) {
  if (!actx) return;
  stopProceduralTrack();
  const t = actx.currentTime;
  const out = actx.createGain(); out.gain.value = 0.28; out.connect(analyser); wireAnalyser();
  activeTrackNodes.push(out);

  const osc = (freq, type, vol, detune = 0) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.value = vol; o.connect(g); g.connect(out); o.start(t);
    activeTrackNodes.push(o, g); return { o, g };
  };
  const lfo = (target, rate, amount) => {
    const l = actx.createOscillator(), lg = actx.createGain();
    l.type = "sine"; l.frequency.value = rate; lg.gain.value = amount;
    l.connect(lg); lg.connect(target); l.start(t);
    activeTrackNodes.push(l, lg);
  };
  const noise = (vol, lpFreq) => {
    const n = Math.floor(actx.sampleRate * 4), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lpFreq;
    const g = actx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(out); src.start(t);
    activeTrackNodes.push(src, f, g); return { src, f, g };
  };

  if (id === "deep-space") {
    const d1 = osc(55, "sine", 0.35); lfo(d1.g.gain, 0.08, 0.12);
    const d2 = osc(82.5, "sine", 0.25, 3); lfo(d2.g.gain, 0.06, 0.1);
    const p1 = osc(220, "sine", 0.08); lfo(p1.g.gain, 0.12, 0.06);
    const p2 = osc(330, "triangle", 0.06); lfo(p2.g.gain, 0.1, 0.04);
    noise(0.04, 400);
  } else if (id === "neon-pulse") {
    const d1 = osc(65, "sawtooth", 0.15); lfo(d1.g.gain, 2.2, 0.12);
    const d2 = osc(130, "square", 0.08); lfo(d2.g.gain, 2.2, 0.06);
    const p1 = osc(260, "triangle", 0.1); lfo(p1.g.gain, 0.5, 0.08);
    const n1 = noise(0.08, 1400); lfo(n1.f.frequency, 0.8, 800);
    osc(392, "sine", 0.04);
  } else if (id === "quiet-signal") {
    const p1 = osc(440, "sine", 0.1); lfo(p1.g.gain, 0.15, 0.06);
    const p2 = osc(554, "sine", 0.07); lfo(p2.g.gain, 0.12, 0.04);
    const p3 = osc(659, "triangle", 0.05); lfo(p3.g.gain, 0.1, 0.03);
    osc(110, "sine", 0.15);
    noise(0.02, 300);
  } else if (id === "dark-matter") {
    const d1 = osc(45, "sawtooth", 0.2); lfo(d1.g.gain, 0.04, 0.1);
    const d2 = osc(67.5, "sine", 0.2, 7);
    lfo(d2.o.frequency, 0.07, 4);
    osc(180, "square", 0.04, -12); lfo(osc(270, "sine", 0.05).g.gain, 0.3, 0.04);
    const n1 = noise(0.06, 600); lfo(n1.f.frequency, 0.15, 350);
  }
}
function drawStar(ctx, x, y, r) { const inner = r * 0.42; ctx.beginPath(); for (let i = 0; i < 10; i++) { const rad = i % 2 === 0 ? r : inner, a = i * Math.PI / 5 - Math.PI / 2; const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad; i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.closePath(); }
function drawDiamond(ctx, x, y, r) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.72, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.72, y); ctx.closePath(); }
function drawScramble(ctx, text, cx, y, size, progress, time, alpha = 1) {
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@*+=?";
  ctx.font = `bold ${size}px 'SF Mono','Fira Code','Courier New',monospace`;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const totalW = ctx.measureText(text).width; let x = cx - totalW / 2; const charW = totalW / text.length;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " ") { x += charW; continue; }
    const cp = clamp(progress * (text.length + 5) - i, 0, 1.6);
    const resolved = cp >= 1; let ch = text[i], jit = 0;
    if (!resolved) { const r = Math.abs((Math.floor(time * 24) * 131 + i * 92821) ^ 0x9e3779b9); ch = glyphs[r % glyphs.length]; jit = (((r >> 9) % 100) / 100) * 4 - 2; }
    const a = (resolved ? 1 : clamp(cp + 0.25, 0, 0.85)) * alpha;
    const col = resolved ? "230,240,255" : "120,235,205";
    if (resolved) { ctx.shadowColor = `rgba(${col},${0.4 * alpha})`; ctx.shadowBlur = 12; }
    ctx.fillStyle = `rgba(${col},${a})`; ctx.fillText(ch, x, y + jit); ctx.shadowBlur = 0; x += charW;
  }
}

export default function Simulator() {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [phase, setPhase] = useState("intro");
  const [mode, setMode] = useState("idle");
  const [sender, setSender] = useState(null);
  const [receiver, setReceiver] = useState(null);
  const [msgType, setMsgType] = useState(null);
  const [typedMsg, setTypedMsg] = useState("");
  const [fxOn, setFxOn] = useState(true);
  const [musicName, setMusicName] = useState("");
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [showMusic, setShowMusic] = useState(false);
  const [, tick] = useState(0);
  const inputRef = useRef(null);

  const g = useRef({
    nodes: [], packets: [], retries: [], rings: [], bursts: [], shocks: [], events: [],
    masters: {}, clr: {}, tok: {},
    time: 0, mouse: { x: -1e3, y: -1e3 }, worldMouse: { x: -1e3, y: -1e3 },
    hovered: null, cw: 800, ch: 600,
    camX: WORLD_W / 2, camY: WORLD_H / 2, zoom: 1, targetZoom: 1,
    introAge: 0, hint: "", hintAge: 0,
    flash: null, // {color:[r,g,b], age, life}
    panning: false, panStart: null, camStart: null,
    audioLevel: 0,
  });

  const phaseR = useRef(phase), modeR = useRef(mode), senderR = useRef(sender);
  const receiverR = useRef(receiver), msgTypeR = useRef(msgType), fxR = useRef(fxOn);
  useEffect(() => { phaseR.current = phase; }, [phase]);
  useEffect(() => { modeR.current = mode; }, [mode]);
  useEffect(() => { senderR.current = sender; }, [sender]);
  useEffect(() => { receiverR.current = receiver; }, [receiver]);
  useEffect(() => { msgTypeR.current = msgType; }, [msgType]);
  useEffect(() => { fxR.current = fxOn; }, [fxOn]);

  // ---- world->screen transforms (camera) ----
  const w2s = (wx, wy) => { const G = g.current; const s = G.zoom * Math.min(G.cw / WORLD_W, G.ch / WORLD_H); return { x: (wx - G.camX) * s + G.cw / 2, y: (wy - G.camY) * s + G.ch / 2, s }; };
  const s2w = (sx, sy) => { const G = g.current; const s = G.zoom * Math.min(G.cw / WORLD_W, G.ch / WORLD_H); return { x: (sx - G.cw / 2) / s + G.camX, y: (sy - G.ch / 2) / s + G.camY }; };

  const flash = useCallback((color) => { g.current.flash = { color, age: 0, life: 0.55 }; }, []);
  const addEvent = useCallback((text, color = [200, 210, 230]) => { const G = g.current; G.events.push({ text, color, age: 0 }); if (G.events.length > 14) G.events.shift(); }, []);
  const burst = useCallback((x, y, color, n = 24, spd = 200) => { const G = g.current; for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = spd * (0.4 + Math.random() * 0.8); G.bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.5 + Math.random() * 0.5, color, size: 1.5 + Math.random() * 2.5 }); } }, []);
  const ring = useCallback((x, y, color, life, maxR, thick = 2.5) => { g.current.rings.push({ x, y, age: 0, life, maxR, color, thick }); }, []);

  const enroll = useCallback((id, type) => { const G = g.current; if (id in G.masters) return; G.masters[id] = fnv(id); G.clr[id] = type === "EmergencyBase" ? CLR.Government : CLR.Civilian; G.tok[id] = TOK_MAX; }, []);
  const makeNode = useCallback((id, x, y, type) => { const n = { id, x, y, type, battery: BATT_MAX[type], working: true, neighbors: [], range: RANGE[type], mass: MASS[type], spawnAge: 0 }; enroll(id, type); return n; }, [enroll]);
  const nextFreeId = useCallback((prefix) => { const G = g.current; for (let n = 1; ; n++) { const c = prefix + n; if (!G.nodes.some(d => d.id === c)) return c; } }, []);

  const resetToBase = useCallback(() => { const G = g.current; G.nodes = [makeNode("B1", WORLD_W / 2, WORLD_H / 2, "EmergencyBase")]; G.packets = []; G.retries = []; connectNeighbors(G.nodes); }, [makeNode]);
  const loadSample = useCallback(() => {
    const G = g.current;
    G.nodes = [makeNode("B1", 500, 400, "EmergencyBase"), makeNode("R1", 350, 400, "StaticRelay"), makeNode("R2", 650, 400, "StaticRelay"),
      makeNode("S1", 200, 320, "StudentNode"), makeNode("S2", 200, 480, "StudentNode"), makeNode("S3", 800, 320, "StudentNode"), makeNode("S4", 800, 480, "StudentNode")];
    G.packets = []; G.retries = []; connectNeighbors(G.nodes);
  }, [makeNode]);

  const nearestWorking = useCallback((p, exceptId) => { const G = g.current; let best = null, bestD = Infinity; for (const d of G.nodes) { if (d.id === exceptId || !d.working) continue; const dd = dist(d, p); if (dd < bestD) { bestD = dd; best = d; } } return best; }, []);

  const addStudent = useCallback((x, y) => {
    const G = g.current;
    const anchor = nearestWorking({ x, y }, null);
    const sid = nextFreeId("S");
    if (anchor) {
      const gap = dist(anchor, { x, y });
      if (gap > 200) {
        const segments = Math.ceil(gap / SAFE_HOP), relays = segments - 1;
        if (relays <= MAX_AUTO_RELAYS) {
          for (let i = 1; i <= relays; i++) { const t = i / segments; const rid = nextFreeId("R"); const rx = lerp(anchor.x, x, t), ry = lerp(anchor.y, y, t); G.nodes.push(makeNode(rid, rx, ry, "StaticRelay")); ring(rx, ry, NC.StaticRelay, 0.6, 80); SFX.relay(); addEvent(`[AUTO-RELAY] ${rid} deployed to bridge the gap.`, NC.StaticRelay); }
        } else addEvent(`[DEAD ZONE] ${sid} is too far - placed stranded.`, [235, 115, 95]);
      }
    }
    G.nodes.push(makeNode(sid, x, y, "StudentNode"));
    connectNeighbors(G.nodes);
    burst(x, y, NC.StudentNode, 20, 170); ring(x, y, NC.StudentNode, 0.7, 110);
    addEvent(`[PLACED] ${sid} joined the mesh.`, NC.StudentNode);
    SFX.place(); flash(NC.StudentNode);
  }, [nearestWorking, nextFreeId, makeNode, addEvent, burst, ring, flash]);

  const spawnPacket = useCallback((fromId, toId, type, content, label, attempts = 0) => {
    const G = g.current;
    const map = {}; for (const n of G.nodes) map[n.id] = n;
    const from = map[fromId], to = map[toId];
    if (!from || !to || !from.working) { addEvent(`[${label} FAILED] Sender unavailable.`, [235, 90, 80]); return false; }
    let route = calculateRoute(G.nodes, fromId, toId);
    if (route.length < 2) { addEvent(`[${label} FAILED] "${content}" - DEAD ZONE, no path to target!`, [235, 90, 80]); SFX.drop(); return false; }
    let willExpire = false;
    if (route.length - 1 > MAX_HOPS) { route = route.slice(0, MAX_HOPS + 1); willExpire = true; }
    const clearance = clearanceForType(type), sealed = cipher(content, pairKey(G.masters, fromId, toId));
    const pkt = { route, from: fromId, to: toId, msgType: type, clearance, color: TYPE_COL[type], content: sealed, willExpire,
      waypoints: route.map(id => ({ x: map[id].x, y: map[id].y })), currentWP: 1, segT: 0, pos: { x: map[route[0]].x, y: map[route[0]].y }, trail: [], isAck: false, active: true, attempts, speed: PKT_SPEED };
    if (from.type !== "EmergencyBase") { from.battery = Math.max(0, from.battery - DRAIN); if (from.battery <= 0) { from.working = false; connectNeighbors(G.nodes); } }
    G.packets.push(pkt);
    const hops = route.length - 1;
    if (label === "RETRY") addEvent(`[RETRY] Resent ${fromId}'s ${TYPE_LABEL[type]} via new path (attempt ${attempts}).`, [240, 200, 100]);
    else { addEvent(`[SENT - sealed ${CLR_NAME[clearance]}] ${TYPE_LABEL[type]} "${content}" (${hops} hop${hops > 1 ? "s" : ""})${willExpire ? " [TTL]" : ""}`, [190, 195, 205]); SFX.send(); }
    return true;
  }, [addEvent]);

  // arc helper: lift the path over a node (the base) so packets jump over it
  function arcPoint(a, b, t, lift) {
    const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t);
    const bump = Math.sin(t * Math.PI) * lift;
    // perpendicular offset
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return { x: x + (-dy / len) * bump, y: y + (dx / len) * bump };
  }

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let running = true, last = performance.now();
    const resize = () => { const dpr = window.devicePixelRatio || 1; const rect = canvas.parentElement.getBoundingClientRect(); canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; canvas.style.width = rect.width + "px"; canvas.style.height = rect.height + "px"; const G = g.current; G.cw = rect.width; G.ch = rect.height; };
    resize(); resetToBase(); window.addEventListener("resize", resize);

    const loop = (now) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const G = g.current; G.time += dt; G.introAge += dt;
      const dpr = window.devicePixelRatio || 1;

      // music analyser level
      if (analyser && freqData) { analyser.getByteFrequencyData(freqData); let sum = 0; for (let i = 0; i < freqData.length; i++) sum += freqData[i]; G.audioLevel = lerp(G.audioLevel, (sum / freqData.length) / 255, 0.3); }
      else G.audioLevel *= 0.92;

      // zoom easing
      G.zoom += (G.targetZoom - G.zoom) * Math.min(1, dt * 8);

      for (const id in G.tok) G.tok[id] = Math.min(TOK_MAX, G.tok[id] + TOK_REFILL * dt);
      for (const e of G.events) e.age += dt; G.events = G.events.filter(e => e.age < 9);
      if (G.hint) G.hintAge += dt;
      for (const n of G.nodes) n.spawnAge += dt;
      G.rings = G.rings.filter(r => { r.age += dt; return r.age < r.life; });
      G.bursts = G.bursts.filter(b => { b.age += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.94; b.vy *= 0.94; return b.age < b.life; });
      G.shocks = G.shocks.filter(s => { s.age += dt; return s.age < s.life; });
      if (G.flash) { G.flash.age += dt; if (G.flash.age >= G.flash.life) G.flash = null; }

      const map = {}; for (const n of G.nodes) map[n.id] = n;
      const pendingAcks = [];

      for (const pkt of G.packets) {
        if (!pkt.active) continue;
        const nextNode = map[pkt.route[pkt.currentWP]];
        if (nextNode && !nextNode.working) {
          pkt.active = false;
          if (!pkt.isAck && pkt.attempts < MAX_RETRIES) { G.retries.push({ from: pkt.from, to: pkt.to, content: cipher(pkt.content, pairKey(G.masters, pkt.from, pkt.to)), type: pkt.msgType, attempts: pkt.attempts + 1, timer: RETRY_DELAY }); addEvent(`[RETRY] route broke at ${nextNode.id} - recomputing (attempt ${pkt.attempts + 1}).`, [240, 200, 100]); }
          else if (!pkt.isAck) addEvent(`[LOST] a sealed ${TYPE_LABEL[pkt.msgType]} - no path survived ${MAX_RETRIES} tries.`, [235, 90, 80]);
          burst(pkt.pos.x, pkt.pos.y, [235, 90, 80], 14, 130); SFX.drop(); continue;
        }
        const a = pkt.waypoints[pkt.currentWP - 1], b = pkt.waypoints[pkt.currentWP];
        if (!b) { pkt.active = false; continue; }
        // does this segment pass near the base? if so arc over it
        const base = G.nodes.find(n => n.type === "EmergencyBase");
        let lift = 0;
        if (base && b.x === base.x && b.y === base.y) lift = 0; // arriving AT base: straight in
        else if (base) { // lift if the straight line passes close to base mid-span
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (Math.hypot(mx - base.x, my - base.y) < 60) lift = 70;
        }
        const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        pkt.segT += (pkt.speed * dt) / segLen;
        if (pkt.segT >= 1) {
          pkt.segT = 0;
          const isFinal = pkt.currentWP === pkt.waypoints.length - 1;
          if (isFinal) {
            if (pkt.willExpire) { addEvent(`[DROPPED] sealed ${TYPE_LABEL[pkt.msgType]} - TTL exceeded before arrival.`, [235, 90, 80]); burst(b.x, b.y, [235, 90, 80], 12, 110); SFX.drop(); }
            else if (pkt.isAck) { const home = map[pkt.to]; if (home && home.working && home.type === "StudentNode") home.battery = Math.min(100, home.battery + 1); addEvent(`[ANSWERED] ${pkt.to} heard back - help is on the way.`, [120, 230, 170]); burst(b.x, b.y, NC.ack, 22, 150); ring(b.x, b.y, NC.ack, 0.7, 90); SFX.ack(); }
            else {
              const toID = pkt.route[pkt.route.length - 1], fromID = pkt.route[0];
              const plain = cipher(pkt.content, pairKey(G.masters, fromID, toID));
              const authorized = canRead(G.clr[toID] ?? CLR.Civilian, pkt.clearance);
              if (authorized) addEvent(`[DELIVERED - DECRYPTED] "${plain}" reached ${toID} (${CLR_NAME[pkt.clearance]}).`, [120, 230, 170]);
              else addEvent(`[DELIVERED - ACCESS DENIED] ${toID} lacks clearance for ${CLR_NAME[pkt.clearance]} - payload sealed.`, [240, 200, 100]);
              burst(b.x, b.y, pkt.color, 26, 190); ring(b.x, b.y, pkt.color, 0.6, 80); SFX.deliver();
              if (pkt.route.length >= 2) { const back = [...pkt.route].reverse(); pendingAcks.push({ route: back, from: back[0], to: back[back.length - 1], isAck: true, color: NC.ack, msgType: pkt.msgType, clearance: pkt.clearance, content: "ACK", willExpire: false, waypoints: back.map(id => ({ x: map[id].x, y: map[id].y })), currentWP: 1, segT: 0, pos: { x: map[back[0]].x, y: map[back[0]].y }, trail: [], active: true, attempts: 0, speed: ACK_SPEED }); }
            }
            pkt.active = false;
          } else {
            if (!pkt.isAck) {
              const fwd = map[pkt.route[pkt.currentWP]]; const isSOS = pkt.msgType === "SOS";
              if (fwd && fwd.type !== "EmergencyBase") {
                if (!isSOS && fwd.battery < 15) { addEvent(`[REFUSED] ${fwd.id} is low on power - forwards SOS only.`, [240, 200, 100]); burst(fwd.x, fwd.y, [240, 200, 100], 10, 90); SFX.drop(); pkt.active = false; }
                else if (!isSOS && G.tok[fwd.id] < 1) { addEvent(`[FLOOD DROP] ${fwd.id} saturated - non-SOS shed to stay alive.`, [235, 90, 80]); burst(fwd.x, fwd.y, [235, 90, 80], 10, 90); SFX.drop(); pkt.active = false; }
                else { if (G.tok[fwd.id] >= 1) G.tok[fwd.id] -= 1; const before = fwd.battery; fwd.battery = Math.max(0, fwd.battery - DRAIN); if (before > 0 && fwd.battery <= 0) { fwd.working = false; connectNeighbors(G.nodes); burst(fwd.x, fwd.y, [120, 120, 140], 16, 120); addEvent(`[BATTERY] ${fwd.id} ran out of power.`, [240, 200, 100]); SFX.delete(); } }
              }
            }
            if (pkt.active) pkt.currentWP++;
          }
        }
        // compute display pos (arc-aware)
        const pos = lift > 0 ? arcPoint(a, b, pkt.segT, lift) : { x: lerp(a.x, b.x, pkt.segT), y: lerp(a.y, b.y, pkt.segT) };
        pkt.pos = pos;
        pkt.trail.push({ x: pos.x, y: pos.y }); if (pkt.trail.length > 24) pkt.trail.shift();
      }
      for (const a of pendingAcks) G.packets.push(a);

      if (G.retries.length) {
        const requeue = [];
        for (const r of G.retries) { r.timer -= dt; if (r.timer > 0) { requeue.push(r); continue; } connectNeighbors(G.nodes); const from = G.nodes.find(n => n.id === r.from), to = G.nodes.find(n => n.id === r.to); if (from && to && from.working) { const ok = spawnPacket(r.from, r.to, r.type, r.content, "RETRY", r.attempts); if (ok) G.packets[G.packets.length - 1].attempts = r.attempts; else if (r.attempts < MAX_RETRIES) { r.timer = RETRY_DELAY; requeue.push(r); } else addEvent(`[LOST] ${r.from}'s message could not reach ${r.to} - network too broken.`, [235, 90, 80]); } }
        G.retries = requeue;
      }
      G.packets = G.packets.filter(p => p.active);

      // ===== RENDER =====
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, G.cw, G.ch); ctx.fillStyle = "rgb(5,6,11)"; ctx.fillRect(0, 0, G.cw, G.ch);

      const tf = w2s(0, 0); const S = tf.s;
      ctx.save();
      ctx.translate(G.cw / 2, G.ch / 2); ctx.scale(S, S); ctx.translate(-G.camX, -G.camY);

      const nodes = G.nodes, wm = G.worldMouse;
      const beat = 1 + G.audioLevel * 1.6;   // music drives intensity

      // ---- gravity dot grid (stronger, flowing, music-reactive) ----
      const spacing = 16, baseHue = (G.time * 10) % 360;
      const cols = Math.ceil(WORLD_W / spacing) + 1, rows = Math.ceil(WORLD_H / spacing) + 1;
      for (let gx = 0; gx < cols; gx++) {
        for (let gy = 0; gy < rows; gy++) {
          const bx = gx * spacing, by = gy * spacing;
          let pX = 0, pY = 0, tR = 0, tG = 0, tB = 0, tW = 0;
          for (const n of nodes) {
            if (!n.working) continue;
            const nx = n.x - bx, ny = n.y - by, dd = Math.hypot(nx, ny); if (dd < 1) continue;
            const hm = ((G.hovered === n.id) ? n.mass * 1.9 : n.mass) * beat;
            const pull = hm * 34 / (dd + 130);
            pX += nx * pull / dd; pY += ny * pull / dd;
            const col = NC[n.type], tw = hm / (dd * 0.006 + 1);
            tR += col[0] * tw; tG += col[1] * tw; tB += col[2] * tw; tW += tw;
          }
          const cxw = wm.x - bx, cyw = wm.y - by, cd = Math.hypot(cxw, cyw);
          if (cd > 1) { pX += cxw * 0.6 * 20 / (cd + 120); pY += cyw * 0.6 * 20 / (cd + 120); }
          // flowing drift
          const flow = Math.sin(G.time * 0.6 + gx * 0.4 + gy * 0.3) * 1.4;
          pX += flow; pY += Math.cos(G.time * 0.5 + gx * 0.3) * 1.4;
          const hue = (baseHue + gx * 0.4 + gy * 0.4) % 360;
          let [dr, dg, db] = hsv2rgb(hue, 0.22, 0.52 + G.audioLevel * 0.35);
          if (tW > 0.01) { const amt = Math.min(tW * 0.025, 0.75); dr = lerp(dr, tR / tW, amt); dg = lerp(dg, tG / tW, amt); db = lerp(db, tB / tW, amt); }
          const pd = Math.hypot(pX, pY), alpha = clamp(0.32 + pd * 0.05, 0.2, 0.85);
          const sz = clamp(1.0 + pd * 0.04, 1.0, 2.6);
          ctx.fillStyle = `rgba(${dr|0},${dg|0},${db|0},${alpha})`;
          ctx.fillRect(bx + pX - sz / 2, by + pY - sz / 2, sz, sz);
        }
      }

      ctx.globalCompositeOperation = "lighter";

      // shockwaves (kill chain)
      for (const sh of G.shocks) {
        const t = sh.age / sh.life, r = t * sh.maxR, a = (1 - t) * 0.8;
        ctx.strokeStyle = rgba(sh.color, a); ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(sh.x, sh.y, r, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = rgba([255, 220, 200], a * 0.6); ctx.lineWidth = 2 * (1 - t);
        ctx.beginPath(); ctx.arc(sh.x, sh.y, r * 0.92, 0, 6.283); ctx.stroke();
      }

      // links + pulses
      for (const n of nodes) {
        if (!n.working) continue;
        for (const nid of n.neighbors) { if (nid <= n.id) continue; const nb = map[nid]; if (!nb) continue;
          ctx.strokeStyle = rgba(NC.StudentNode, 0.07 + G.audioLevel * 0.06); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
          const pt = (G.time * 0.4) % 1;
          for (let p = 0; p < 2; p++) { const t = (pt + p * 0.5) % 1, px = lerp(n.x, nb.x, t), py = lerp(n.y, nb.y, t); ctx.fillStyle = rgba(NC.StudentNode, 0.3 * (1 - Math.abs(t - 0.5) * 2)); ctx.beginPath(); ctx.arc(px, py, 1.3, 0, 6.283); ctx.fill(); }
        }
      }

      // searching pings
      const reach = reachableFromBase(nodes); const PERIOD = 2.8;
      for (let di = 0; di < nodes.length; di++) { const n = nodes[di]; if (!n.working || n.type === "EmergencyBase" || reach.has(n.id)) continue; const maxR = n.range * 0.85; for (let k = 0; k < 2; k++) { const t = ((G.time + di * 0.7 + k * PERIOD * 0.5) % PERIOD) / PERIOD; const radius = 9 + t * maxR, a = (1 - t) * (1 - t); ctx.strokeStyle = rgba(NC.ping, 0.45 * a); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(n.x, n.y, radius, 0, 6.283); ctx.stroke(); } }

      // rings (sweep/beacon/spawn)
      for (const rg of G.rings) { const t = rg.age / rg.life, r = t * rg.maxR, a = 0.6 * (1 - t); ctx.strokeStyle = rgba(rg.color, a); ctx.lineWidth = rg.thick; ctx.beginPath(); ctx.arc(rg.x, rg.y, r, 0, 6.283); ctx.stroke(); if (t > 0.16) { ctx.strokeStyle = rgba(rg.color, a * 0.5); ctx.beginPath(); ctx.arc(rg.x, rg.y, r * 0.84, 0, 6.283); ctx.stroke(); } }

      // nodes
      for (const n of nodes) {
        const col = NC[n.type], isHov = G.hovered === n.id;
        const baseR = n.type === "EmergencyBase" ? 24 : n.type === "StaticRelay" ? 11 : 13;
        const pop = n.spawnAge < 0.5 ? 1 + (0.5 - n.spawnAge) * 1.4 : 1;
        const r = baseR * pop;
        if (fxR.current && n.working) { const glowR = r * (isHov ? 4.2 : 3) * (1 + G.audioLevel * 0.5), breathe = 0.6 + 0.4 * Math.sin(G.time * 1.8 + n.x * 0.01) + G.audioLevel * 0.5; const grad = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, glowR); grad.addColorStop(0, rgba(col, 0.32 * breathe)); grad.addColorStop(1, rgba(col, 0)); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, 6.283); ctx.fill(); }
        ctx.globalCompositeOperation = "source-over";
        if (!n.working) { ctx.fillStyle = rgba([80, 80, 90], 0.5); ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.7, 0, 6.283); ctx.fill(); }
        else { const dk = [col[0] * 0.3, col[1] * 0.3, col[2] * 0.3];
          if (n.type === "EmergencyBase") { const orbR = r * 1.6 + Math.sin(G.time * 0.8) * 3; ctx.strokeStyle = rgba(col, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, orbR, 0, 6.283); ctx.stroke(); drawStar(ctx, n.x, n.y, r); ctx.fillStyle = rgba(dk, 0.95); ctx.fill(); ctx.strokeStyle = rgba(col, 0.85); ctx.lineWidth = 2; ctx.stroke(); }
          else if (n.type === "StaticRelay") { drawDiamond(ctx, n.x, n.y, r); ctx.fillStyle = rgba(dk, 0.9); ctx.fill(); ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 1.5; ctx.stroke(); }
          else { ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.283); ctx.fillStyle = rgba(dk, 0.9); ctx.fill(); ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 1.5; ctx.stroke(); }
        }
        ctx.fillStyle = rgba(n.working ? col : [140, 140, 160], 0.75); ctx.font = "11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(n.id, n.x, n.y + baseR + 4);
        if (n.type !== "EmergencyBase") { const bw = 24, bh = 3, bx = n.x - bw / 2, by = n.y + baseR + 18, pct = clamp(n.battery / BATT_MAX[n.type], 0, 1); ctx.fillStyle = rgba([40, 45, 60], 0.6); ctx.fillRect(bx, by, bw, bh); const bc = pct > 0.4 ? col : pct > 0.15 ? [240, 200, 100] : [235, 90, 80]; ctx.fillStyle = rgba(bc, 0.75); ctx.fillRect(bx, by, bw * pct, bh); }
        ctx.globalCompositeOperation = "lighter";
      }

      // bursts (particles)
      for (const bp of G.bursts) { const a = (1 - bp.age / bp.life); ctx.fillStyle = rgba(bp.color, a * 0.9); ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.size * a, 0, 6.283); ctx.fill(); }

      // packets
      for (const pkt of G.packets) { if (!pkt.active) continue; const col = pkt.isAck ? NC.ack : pkt.color;
        for (let i = 0; i < pkt.trail.length; i++) { const t = pkt.trail[i], a = (i / pkt.trail.length) * 0.5, sz = (i / pkt.trail.length) * 2.8; if (a <= 0.02) continue; ctx.fillStyle = rgba(col, a); ctx.beginPath(); ctx.arc(t.x, t.y, sz, 0, 6.283); ctx.fill(); }
        if (fxR.current) { const grad = ctx.createRadialGradient(pkt.pos.x, pkt.pos.y, 2, pkt.pos.x, pkt.pos.y, 18); grad.addColorStop(0, rgba(col, 0.55)); grad.addColorStop(1, rgba(col, 0)); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(pkt.pos.x, pkt.pos.y, 18, 0, 6.283); ctx.fill(); }
        ctx.fillStyle = rgba(col, 0.95); ctx.beginPath(); ctx.arc(pkt.pos.x, pkt.pos.y, 4.2, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // inspector
      if (G.hovered) { const n = map[G.hovered]; if (n) { const col = NC[n.type]; const tName = n.type === "EmergencyBase" ? "Emergency Base" : n.type === "StaticRelay" ? "Static Relay" : "Student"; const lines = [`${n.id} - ${tName}`, n.working ? `Battery: ${Math.round(n.battery)}%` : "OFFLINE", `Range: ${n.range}`, `Links: ${n.neighbors.length}`]; const pw = 168, ph = lines.length * 18 + 14; let tx = n.x + 22, ty = n.y - ph / 2; if (tx + pw > WORLD_W + 200) tx = n.x - pw - 22; ctx.fillStyle = rgba([12, 14, 22], 0.92); ctx.strokeStyle = rgba(col, 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(tx, ty, pw, ph, 6); ctx.fill(); ctx.stroke(); ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "12px system-ui"; for (let i = 0; i < lines.length; i++) { ctx.fillStyle = i === 0 ? rgba(col, 0.9) : rgba([180, 190, 210], 0.8); ctx.fillText(lines[i], tx + 10, ty + 8 + i * 18); } } }

      ctx.restore();

      // ----- screen-space overlays -----
      // hue flash
      if (G.flash) { const t = G.flash.age / G.flash.life, a = Math.sin((1 - t) * Math.PI) * 0.3; const grad = ctx.createRadialGradient(G.cw / 2, G.ch / 2, G.cw * 0.2, G.cw / 2, G.ch / 2, G.cw * 0.75); grad.addColorStop(0, rgba(G.flash.color, 0)); grad.addColorStop(1, rgba(G.flash.color, a)); ctx.fillStyle = grad; ctx.fillRect(0, 0, G.cw, G.ch); }

      // event log
      ctx.font = "12px 'SF Mono','Fira Code','Courier New',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      let ey = G.ch - 16; const vis = G.events.slice(-8);
      for (let i = vis.length - 1; i >= 0; i--) { const ev = vis[i]; const a = clamp(ev.age * 4, 0, 1) * (ev.age > 7 ? clamp((9 - ev.age) / 2, 0, 1) : 1); const tw = ctx.measureText(ev.text).width; ctx.fillStyle = `rgba(10,12,20,${0.72 * a})`; ctx.beginPath(); ctx.roundRect(14, ey - 15, tw + 18, 21, 10); ctx.fill(); ctx.fillStyle = rgba(ev.color, 0.88 * a); ctx.fillText(ev.text, 23, ey); ey -= 25; }

      if (G.hint) { const ha = clamp(G.hintAge * 3, 0, 1) * clamp(1 - (G.hintAge - 6) / 2, 0, 1); if (ha > 0) { ctx.font = "14px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = rgba([180, 195, 220], 0.75 * ha); ctx.fillText(G.hint, G.cw / 2, G.ch - 18); } else if (G.hintAge > 8) { G.hint = ""; G.hintAge = 0; } }

      if (phaseR.current === "intro") { const age = G.introAge; const da = age < 1 ? 0.72 : clamp(0.72 - (age - 3) * 0.2, 0.12, 0.72); ctx.fillStyle = `rgba(5,6,11,${da})`; ctx.fillRect(0, 0, G.cw, G.ch); drawScramble(ctx, "GUARDIAN MESH", G.cw / 2, G.ch * 0.34, 46, clamp(age / 2.2, 0, 1), G.time); if (age > 1.6) { const sa = clamp((age - 1.6) / 1, 0, 1); ctx.font = "15px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = rgba([140, 165, 200], 0.7 * sa); ctx.fillText("A decentralized emergency network simulator", G.cw / 2, G.ch * 0.44); } if (age > 2.8) { ctx.font = "15px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = rgba([200, 215, 240], 0.4 + 0.3 * Math.sin(G.time * 2.5)); ctx.fillText("Click anywhere to begin", G.cw / 2, G.ch * 0.56); } }

      if (fxR.current) { const vg = ctx.createRadialGradient(G.cw / 2, G.ch / 2, G.cw * 0.25, G.cw / 2, G.ch / 2, G.cw * 0.72); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.42)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, G.cw, G.ch); }

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; window.removeEventListener("resize", resize); };
  }, [resetToBase, addEvent, spawnPacket, burst, ring]);

  // ---- input ----
  const onMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const G = g.current; const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    G.mouse = { x: mx, y: my }; G.worldMouse = s2w(mx, my);
    if (G.panning && G.panStart) { const s = G.zoom * Math.min(G.cw / WORLD_W, G.ch / WORLD_H); G.camX = G.camStart.x - (mx - G.panStart.x) / s; G.camY = G.camStart.y - (my - G.panStart.y) / s; return; }
    let hov = null; for (const n of G.nodes) { const r = n.type === "EmergencyBase" ? 24 : 14; if (dist(G.worldMouse, n) < r + 6) { hov = n.id; break; } } G.hovered = hov;
  }, []);

  const onWheel = useCallback((e) => { const G = g.current; if (e.ctrlKey) { G.targetZoom = clamp(G.targetZoom * (1 - e.deltaY * 0.01), 0.4, 3); } else { const s = G.zoom * Math.min(G.cw / WORLD_W, G.ch / WORLD_H); G.camX += e.deltaX / s; G.camY += e.deltaY / s; } }, []);
  const onDown = useCallback((e) => { const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return; const G = g.current; if (e.button === 2 || e.button === 1 || modeR.current === "idle" && e.shiftKey) { G.panning = true; G.panStart = { x: e.clientX - rect.left, y: e.clientY - rect.top }; G.camStart = { x: G.camX, y: G.camY }; } }, []);
  const onUp = useCallback(() => { g.current.panning = false; }, []);

  const targetSweep = useCallback((node) => {
    const G = g.current; const best = nearestWorking(node, node.id);
    ring(node.x, node.y, NC.sweep, 1.15, 360); burst(node.x, node.y, NC.sweep, 18, 160);
    if (!best) { addEvent(`[SWEEP] ${node.id} swept - but no infrastructure exists to reach.`, [235, 90, 80]); SFX.sweep(); flash(NC.sweep); return; }
    const linkD = Math.min(node.range, best.range) * 0.92; let dx = node.x - best.x, dy = node.y - best.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    node.x = best.x + dx * Math.min(linkD, d); node.y = best.y + dy * Math.min(linkD, d); connectNeighbors(G.nodes);
    ring(best.x, best.y, [255, 220, 150], 1.0, 120); burst(best.x, best.y, [255, 220, 150], 14, 110);
    addEvent(`[SWEEP] ${node.id} locked onto ${best.id} and pulled into range.`, NC.sweep); SFX.sweep(); flash(NC.sweep);
  }, [nearestWorking, addEvent, ring, burst, flash]);

  const killNode = useCallback((node) => {
    const G = g.current;
    // shockwave that knocks out everything in blast radius (chain chaos)
    G.shocks.push({ x: node.x, y: node.y, age: 0, life: 0.8, maxR: KILL_BLAST, color: [235, 90, 70] });
    burst(node.x, node.y, [255, 130, 90], 40, 320); flash(PILL_COLORS.kill);
    SFX.kill();
    let downed = 0;
    for (const n of G.nodes) { if (!n.working || n.type === "EmergencyBase") continue; if (dist(n, node) <= KILL_BLAST) { n.working = false; n.battery = 0; downed++; setTimeout(() => burst(n.x, n.y, [255, 110, 80], 18, 160), 60); } }
    connectNeighbors(G.nodes);
    addEvent(`[KILL] EMP detonated - ${downed} node${downed !== 1 ? "s" : ""} knocked offline.`, [235, 90, 70]);
  }, [burst, flash, addEvent]);

  const onClick = useCallback((e) => {
    initAudio();
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const G = g.current; if (G.panning) return;
    const w = s2w(e.clientX - rect.left, e.clientY - rect.top);
    if (phaseR.current === "intro") { if (G.introAge > 2) { setPhase("play"); G.hint = "Load a sample network, or Add to build your own. Trackpad scroll to pan, Ctrl+scroll or +/- to zoom."; G.hintAge = 0; } return; }
    let clicked = null; for (const n of G.nodes) { const r = n.type === "EmergencyBase" ? 26 : 16; if (dist(w, n) < r) { clicked = n; break; } }
    const m = modeR.current;
    if (m === "add") { if (!clicked) { addStudent(w.x, w.y); tick(t => t + 1); } return; }
    if (m === "delete") { if (clicked && clicked.type !== "EmergencyBase") { burst(clicked.x, clicked.y, PILL_COLORS.del, 26, 220); ring(clicked.x, clicked.y, PILL_COLORS.del, 0.5, 70); G.nodes = G.nodes.filter(n => n.id !== clicked.id); connectNeighbors(G.nodes); addEvent(`[REMOVED] ${clicked.id} deleted.`, PILL_COLORS.del); SFX.delete(); flash(PILL_COLORS.del); tick(t => t + 1); } return; }
    if (m === "kill") { if (clicked && clicked.type !== "EmergencyBase") { killNode(clicked); tick(t => t + 1); } return; }
    if (m === "idle") { if (!clicked) return; if (clicked.type !== "StudentNode") { addEvent("[CMD ERROR] Only Students can originate messages.", [235, 90, 80]); return; } if (!clicked.working) return; const linked = clicked.neighbors.some(nid => G.nodes.find(n => n.id === nid)?.working); setSender(clicked.id); if (!linked) { setReceiver(null); setMode("stranded"); addEvent(`[CMD] ${clicked.id} is STRANDED - Target Sweep available.`, [240, 200, 100]); } else { setMode("awaitTarget"); addEvent(`[CMD] Sender locked: ${clicked.id}. Choose a target.`, [190, 195, 205]); } SFX.click(); return; }
    if (m === "awaitTarget") { if (!clicked) { setMode("idle"); setSender(null); return; } if (clicked.id === senderR.current) { addEvent("[CMD ERROR] Cannot target yourself.", [235, 90, 80]); return; } if (!clicked.working) return; setReceiver(clicked.id); setMode("chooseType"); SFX.click(); return; }
  }, [addStudent, addEvent, killNode, burst, ring, flash]);

  const chooseType = useCallback((t) => { setMsgType(t); setMode("compose"); setTypedMsg(""); SFX.click(); setTimeout(() => inputRef.current?.focus(), 40); }, []);
  const doSweep = useCallback(() => { const G = g.current; const s = G.nodes.find(n => n.id === senderR.current); if (s) targetSweep(s); setMode("idle"); setSender(null); tick(t => t + 1); }, [targetSweep]);
  const send = useCallback(() => { if (!typedMsg.trim()) return; const G = g.current; connectNeighbors(G.nodes); const ok = spawnPacket(senderR.current, receiverR.current, msgTypeR.current, typedMsg, "CMD"); if (!ok) { const s = G.nodes.find(n => n.id === senderR.current), r = G.nodes.find(n => n.id === receiverR.current); const hasLink = (n) => !n || n.neighbors.some(nid => G.nodes.find(d => d.id === nid)?.working); const iso = (s && !hasLink(s)) ? s : (r && !hasLink(r)) ? r : r; addEvent("[NO TARGET] No one is in range to receive - auto-establishing a link...", [240, 200, 110]); if (iso) targetSweep(iso); } G.hint = ""; setMode("idle"); setSender(null); setReceiver(null); setMsgType(null); setTypedMsg(""); tick(t => t + 1); }, [typedMsg, spawnPacket, addEvent, targetSweep]);
  const cancel = useCallback(() => { setMode("idle"); setSender(null); setReceiver(null); setMsgType(null); setTypedMsg(""); }, []);

  const runCmd = useCallback((cmd) => {
    initAudio(); const G = g.current; cancel();
    switch (cmd) {
      case "add": setMode(m => m === "add" ? "idle" : "add"); SFX.click(); break;
      case "del": setMode(m => m === "delete" ? "idle" : "delete"); SFX.click(); break;
      case "kill": setMode(m => m === "kill" ? "idle" : "kill"); SFX.click(); break;
      case "clear": resetToBase(); addEvent("[CLEAR] Network reset to base only.", PILL_COLORS.clear); ring(WORLD_W / 2, WORLD_H / 2, PILL_COLORS.clear, 0.8, 500); SFX.clear(); flash(PILL_COLORS.clear); tick(t => t + 1); break;
      case "load": loadSample(); addEvent("[RELOAD] Sample network loaded.", PILL_COLORS.load); for (const n of g.current.nodes) ring(n.x, n.y, NC[n.type], 0.6, 90); SFX.load(); flash(PILL_COLORS.load); tick(t => t + 1); break;
      case "sweep": { let count = 0; for (const n of G.nodes) { if (!n.working || n.type === "EmergencyBase") continue; const linked = n.neighbors.some(nid => G.nodes.find(d => d.id === nid)?.working); if (!linked) { targetSweep(n); count++; } } if (count === 0) { addEvent("[SWEEP] Every node already has a link.", NC.sweep); SFX.sweep(); flash(NC.sweep); } tick(t => t + 1); break; }
      case "beacon": { const base = G.nodes.find(n => n.type === "EmergencyBase" && n.working); if (base) { ring(base.x, base.y, NC.beacon, 1.7, 700, 3); burst(base.x, base.y, NC.beacon, 30, 150); addEvent("[BEACON] Command is online - hold on, help is coming.", NC.beacon); SFX.beacon(); flash(NC.beacon); } break; }
      case "drain": for (const n of G.nodes) if (n.type !== "EmergencyBase") { n.battery = Math.max(0, n.battery - 15); if (n.battery <= 0) n.working = false; } connectNeighbors(G.nodes); addEvent("[DRAIN] Batteries drained. Mesh recalculated.", PILL_COLORS.drain); for (const n of G.nodes) if (n.type !== "EmergencyBase") ring(n.x, n.y, PILL_COLORS.drain, 0.6, 60); SFX.drain(); flash(PILL_COLORS.drain); tick(t => t + 1); break;
      case "flood": { const students = G.nodes.filter(n => n.working && n.type === "StudentNode"); const base = G.nodes.find(n => n.type === "EmergencyBase" && n.working); if (students.length && base) { for (let i = 0; i < 12; i++) { const s = students[Math.floor(Math.random() * students.length)]; spawnPacket(s.id, base.id, i % 2 ? "SupplyRequest" : "StatusUpdate", "flood" + i, "ATTACK", 0); } addEvent("[ATTACK] Inbound flood - 12 spoofed packets. Relays shedding non-SOS load.", PILL_COLORS.flood); SFX.flood(); flash(PILL_COLORS.flood); } break; }
      case "tap": { const p = G.packets.find(x => x.active && !x.isAck); if (p) addEvent(`[INTERCEPT] Relay tapped the wire - ciphertext only: ${cipherSnippet(p.content)} (sealed ${CLR_NAME[p.clearance]})`, PILL_COLORS.tap); else addEvent("[INTERCEPT] Wire tapped - no traffic in flight to capture.", PILL_COLORS.tap); SFX.tap(); flash(PILL_COLORS.tap); break; }
      case "fx": setFxOn(f => !f); SFX.fx(); break;
      default: break;
    }
  }, [cancel, resetToBase, loadSample, targetSweep, addEvent, spawnPacket, ring, burst, flash]);

  // ---- music ----
  const onMusicFile = useCallback((e) => {
    const file = e.target.files?.[0]; if (!file) return;
    initAudio();
    stopProceduralTrack();
    if (musicEl) { try { musicEl.pause(); } catch (x) {} }
    const url = URL.createObjectURL(file);
    musicEl = new Audio(url); musicEl.loop = true;
    try {
      if (!musicSource || musicSource._el !== musicEl) {
        musicSource = actx.createMediaElementSource(musicEl); musicSource._el = musicEl;
        musicSource.connect(analyser); wireAnalyser();
      }
    } catch (x) {}
    if (actx.state === "suspended") actx.resume();
    musicEl.play().then(() => setMusicPlaying(true)).catch(() => { addEvent("[MUSIC] Tap the canvas once, then press play.", [240, 200, 100]); });
    setMusicName(file.name.replace(/\.[^.]+$/, "")); setShowMusic(false);
    addEvent(`[MUSIC] Loaded: ${file.name}`, [180, 140, 255]);
  }, [addEvent]);

  const playPreset = useCallback((track) => {
    initAudio();
    if (musicEl) { try { musicEl.pause(); } catch (x) {} setMusicPlaying(false); }
    if (actx.state === "suspended") actx.resume();
    playProceduralTrack(track.id);
    setMusicName(track.name); setMusicPlaying(true); setShowMusic(false);
    addEvent(`[MUSIC] Now playing: ${track.name}`, [180, 140, 255]);
  }, [addEvent]);

  const toggleMusic = useCallback(() => {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (musicEl && !musicEl.paused) { musicEl.pause(); setMusicPlaying(false); return; }
    if (musicEl && musicEl.paused && musicName) { musicEl.play().then(() => setMusicPlaying(true)).catch(() => {}); return; }
    if (activeTrackNodes.length && musicPlaying) { stopProceduralTrack(); setMusicPlaying(false); return; }
    setShowMusic(s => !s);
  }, [musicName, musicPlaying]);

  const zoomBy = useCallback((f) => { const G = g.current; G.targetZoom = clamp(G.targetZoom * f, 0.4, 3); }, []);
  const recenter = useCallback(() => { const G = g.current; G.camX = WORLD_W / 2; G.camY = WORLD_H / 2; G.targetZoom = 1; }, []);

  const pills = [
    { id: "add", label: "Add" }, { id: "del", label: "Del" }, { id: "kill", label: "Kill" },
    { id: "clear", label: "Clr" }, { id: "load", label: "Load" }, { id: "sweep", label: "Sweep" },
    { id: "beacon", label: "Beacon" }, { id: "drain", label: "Drain" }, { id: "flood", label: "Flood" },
    { id: "tap", label: "Tap" }, { id: "fx", label: "FX" },
  ];
  const activeOf = (id) => (id === "add" && mode === "add") || (id === "del" && mode === "delete") || (id === "kill" && mode === "kill") || (id === "fx" && fxOn);
  const inMode = mode === "add" || mode === "delete" || mode === "kill";

  const types = [
    { t: "SOS", c: "rgb(235,80,70)", d: "Emergency distress - top priority" },
    { t: "SupplyRequest", c: "rgb(90,200,210)", d: "Request for resources" },
    { t: "StatusUpdate", c: "rgb(120,170,255)", d: "Government-only situation report" },
  ];
  const btn = (extra) => ({ background: "rgba(15,17,25,0.9)", color: "rgba(200,210,230,0.85)", border: "1px solid rgba(120,140,180,0.25)", borderRadius: 12, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", ...extra });

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#05060b", position: "relative", overflow: "hidden", fontFamily: "system-ui,sans-serif", userSelect: "none" }}>
      <canvas ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor: phase === "intro" ? "pointer" : g.current.panning ? "grabbing" : mode === "add" ? "crosshair" : "default" }}
        onMouseMove={onMove} onClick={onClick} onWheel={onWheel} onMouseDown={onDown} onMouseUp={onUp} onMouseLeave={onUp} onContextMenu={(e) => e.preventDefault()} />

      <input ref={fileRef} type="file" accept="audio/*" onChange={onMusicFile} style={{ display: "none" }} />

      {phase === "play" && (
        <>
          {/* command pills */}
          <div style={{ position: "absolute", top: 10, left: 12, display: "flex", gap: 5, flexWrap: "wrap", zIndex: 10, maxWidth: "70%" }}>
            {pills.map(p => { const col = PILL_COLORS[p.id], on = activeOf(p.id);
              const bg = on ? `rgba(${col[0]},${col[1]},${col[2]},0.32)` : "rgba(15,17,25,0.88)";
              const bd = on ? `rgba(${col[0]},${col[1]},${col[2]},0.6)` : `rgba(${col[0]},${col[1]},${col[2]},0.2)`;
              const tc = on ? `rgb(${Math.min(255,col[0]+80)},${Math.min(255,col[1]+80)},${Math.min(255,col[2]+80)})` : `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
              return <button key={p.id} onClick={(e) => { e.stopPropagation(); runCmd(p.id); }} style={{ background: bg, color: tc, border: `1px solid ${bd}`, borderRadius: 14, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .2s", boxShadow: on ? `0 0 12px rgba(${col[0]},${col[1]},${col[2]},0.3)` : "none" }}>{p.label}</button>; })}
          </div>

          {/* exit mode (only while in a mode) */}
          {inMode && (
            <button onClick={(e) => { e.stopPropagation(); cancel(); }}
              style={{ position: "absolute", top: 48, right: 12, zIndex: 12, background: "rgba(60,20,24,0.9)", color: "rgb(255,180,180)", border: "1px solid rgba(235,120,120,0.5)", borderRadius: 14, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 0 12px rgba(235,90,80,0.25)" }}>
              ✕ Exit {mode === "add" ? "Add" : mode === "delete" ? "Delete" : "Kill"}
            </button>
          )}

          {/* zoom + camera cluster */}
          <div style={{ position: "absolute", right: 12, bottom: 14, display: "flex", flexDirection: "column", gap: 6, zIndex: 10 }}>
            <button onClick={(e) => { e.stopPropagation(); zoomBy(1.25); }} style={btn({ width: 38, height: 38, fontSize: 20, borderRadius: 10 })}>+</button>
            <button onClick={(e) => { e.stopPropagation(); zoomBy(0.8); }} style={btn({ width: 38, height: 38, fontSize: 20, borderRadius: 10 })}>−</button>
            <button onClick={(e) => { e.stopPropagation(); recenter(); }} style={btn({ width: 38, height: 38, fontSize: 11, borderRadius: 10 })}>⌖</button>
          </div>

          {/* music control */}
          <div style={{ position: "absolute", left: 12, bottom: 14, zIndex: 10, display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ position: "relative" }}>
              {showMusic && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", bottom: 44, left: 0, background: "rgba(12,11,22,0.97)", border: "1px solid rgba(160,130,235,0.3)", borderRadius: 12, padding: 8, width: 230, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
                  <div style={{ color: "rgba(180,160,220,0.7)", fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "4px 8px 8px" }}>AMBIENT TRACKS</div>
                  {TRACKS.map(tr => (
                    <button key={tr.id} onClick={(e) => { e.stopPropagation(); playPreset(tr); }} style={{ display: "block", width: "100%", textAlign: "left", background: musicName === tr.name ? "rgba(160,130,235,0.18)" : "transparent", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "rgb(210,195,245)", fontSize: 13, fontWeight: 600 }}>
                      {tr.name}<div style={{ color: "rgba(160,150,190,0.6)", fontSize: 10, fontWeight: 400 }}>{tr.desc}</div>
                    </button>
                  ))}
                  <div style={{ height: 1, background: "rgba(160,130,235,0.15)", margin: "6px 4px" }} />
                  <button onClick={(e) => { e.stopPropagation(); initAudio(); fileRef.current?.click(); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "rgb(150,210,255)", fontSize: 13, fontWeight: 600 }}>
                    ⬆ Load your own track…<div style={{ color: "rgba(150,170,200,0.6)", fontSize: 10, fontWeight: 400 }}>any audio file from your device</div>
                  </button>
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); initAudio(); toggleMusic(); }} style={btn({ background: "rgba(20,16,32,0.9)", color: "rgb(200,170,255)", border: "1px solid rgba(160,130,235,0.35)", display: "flex", alignItems: "center", gap: 7 })}>
                <span style={{ fontSize: 14 }}>{musicPlaying ? "❚❚" : "♪"}</span>
                {musicName ? (musicPlaying ? "Playing" : "Paused") : "Music"}
              </button>
            </div>
            {musicName && <span style={{ color: "rgba(180,160,220,0.7)", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingBottom: 6 }}>{musicName}</span>}
          </div>
        </>
      )}

      {phase === "play" && inMode && (
        <div style={{ position: "absolute", top: 48, left: "50%", transform: "translateX(-50%)", background: "rgba(10,12,20,0.85)", borderRadius: 10, padding: "6px 20px", fontSize: 13, fontWeight: 600, border: "1px solid rgba(100,120,160,0.2)", pointerEvents: "none", color: mode === "add" ? rgba(NC.StudentNode) : mode === "delete" ? "rgb(225,120,130)" : "rgb(235,115,95)" }}>
          {mode === "add" && "ADD MODE - click empty space to place a student"}
          {mode === "delete" && "DELETE MODE - click a node to remove it"}
          {mode === "kill" && "KILL MODE - click a node to detonate an EMP"}
        </div>
      )}
      {phase === "play" && mode === "awaitTarget" && (
        <div style={{ position: "absolute", top: 48, left: "50%", transform: "translateX(-50%)", background: "rgba(10,12,20,0.85)", borderRadius: 10, padding: "6px 20px", fontSize: 13, fontWeight: 600, border: "1px solid rgba(100,120,160,0.2)", color: "rgb(120,200,230)", display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ pointerEvents: "none" }}>{`SENDING FROM ${sender} - click any node as the target`}</span>
          <span onClick={(e) => { e.stopPropagation(); cancel(); }} style={{ cursor: "pointer", color: "rgb(255,170,170)" }}>✕</span>
        </div>
      )}

      {mode === "stranded" && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(10,12,22,0.95)", border: "1px solid rgba(240,200,100,0.45)", borderRadius: 14, padding: "22px 26px", textAlign: "center", zIndex: 20, minWidth: 280 }}>
          <div style={{ color: "rgb(240,200,100)", fontSize: 14, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>{sender} - STRANDED</div>
          <div style={{ color: "rgba(180,190,210,0.7)", fontSize: 12, marginBottom: 16 }}>No working neighbor in range to receive.</div>
          <button onClick={(e) => { e.stopPropagation(); doSweep(); }} style={{ background: "rgba(100,200,230,0.18)", color: "rgb(140,215,255)", border: "1px solid rgba(100,200,230,0.5)", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>TARGET SWEEP - find a link</button>
          <div onClick={(e) => { e.stopPropagation(); cancel(); }} style={{ color: "rgba(160,170,190,0.6)", fontSize: 11, marginTop: 12, cursor: "pointer" }}>✕ cancel</div>
        </div>
      )}

      {mode === "chooseType" && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", display: "flex", gap: 12, zIndex: 20, alignItems: "stretch" }}>
          {types.map(o => (
            <button key={o.t} onClick={(e) => { e.stopPropagation(); chooseType(o.t); }} style={{ background: "rgba(10,12,22,0.94)", border: `1px solid ${o.c}`, borderRadius: 12, padding: "18px 20px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 140 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: `radial-gradient(circle, ${o.c}, transparent)` }} />
              <div style={{ color: o.c, fontSize: 14, fontWeight: 700 }}>{TYPE_LABEL[o.t]}</div>
              <div style={{ color: "rgba(180,190,210,0.7)", fontSize: 11, textAlign: "center" }}>{o.d}</div>
            </button>
          ))}
          <button onClick={(e) => { e.stopPropagation(); cancel(); }} style={{ background: "rgba(40,16,18,0.9)", border: "1px solid rgba(235,120,120,0.4)", borderRadius: 12, padding: "0 16px", cursor: "pointer", color: "rgb(255,170,170)", fontSize: 16, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {mode === "compose" && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(10,12,22,0.96)", border: `1px solid ${TYPE_COL[msgType] ? rgba(TYPE_COL[msgType], 0.45) : "rgba(100,120,160,0.4)"}`, borderRadius: 14, padding: "22px 26px", minWidth: 340, zIndex: 20 }}>
          <div style={{ color: rgba(TYPE_COL[msgType] || [200, 200, 200]), fontSize: 13, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>{TYPE_LABEL[msgType]} - {sender} → {receiver}</div>
          <input ref={inputRef} type="text" value={typedMsg} maxLength={80} onChange={e => setTypedMsg(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); if (e.key === "Escape") cancel(); }} placeholder="Type your message..." style={{ width: "100%", boxSizing: "border-box", background: "rgba(20,24,35,0.9)", border: "1px solid rgba(100,120,160,0.3)", borderRadius: 8, padding: "10px 14px", color: "rgba(220,230,245,0.95)", fontSize: 14, fontFamily: "'SF Mono','Fira Code',monospace", outline: "none" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, color: "rgba(140,155,180,0.6)", fontSize: 11 }}><span>{typedMsg.length}/80</span><span>ENTER send · ESC cancel</span></div>
        </div>
      )}

      {phase === "play" && (
        <button onClick={(e) => { e.stopPropagation(); if (window.__gmNavigate) window.__gmNavigate("landing"); else window.location.hash = "#/"; }}
          style={{ position: "absolute", top: 10, right: 12, zIndex: 12, background: "rgba(15,17,25,0.85)", color: "rgba(190,200,225,0.85)", border: "1px solid rgba(120,140,180,0.25)", borderRadius: 100, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          ← Home
        </button>
      )}
      {phase === "play" && <div style={{ position: "absolute", bottom: 8, right: 60, color: "rgba(100,115,140,0.35)", fontSize: 10, pointerEvents: "none" }}>Guardian Mesh - CS112L</div>}
    </div>
  );
}
