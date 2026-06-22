import { useRef, useEffect, useState } from "react";

// =====================================================================
// GUARDIAN MESH - landing page
// Scroll-driven, cinematic. A living gravity-grid canvas sits behind
// everything and reacts to scroll + cursor; sections reveal on scroll;
// a Launch Simulator CTA drops the visitor into the playable build.
// =====================================================================

const VIOLET = [150, 130, 255], TEAL = [70, 230, 170], AMBER = [240, 200, 100], CYAN = [110, 200, 255];

// ---- self-contained beat-reactive audio for the landing page ----
const LAUD = { ctx: null, master: null, analyser: null, data: null, el: null, src: null, wired: false,
  bass: 0, mid: 0, treble: 0, level: 0, beat: 0, beatHold: 0, bassAvg: 0, nodes: [] };
function lInit() {
  if (LAUD.ctx) { if (LAUD.ctx.state === "suspended") LAUD.ctx.resume(); return; }
  try {
    LAUD.ctx = new (window.AudioContext || window.webkitAudioContext)();
    LAUD.master = LAUD.ctx.createGain(); LAUD.master.gain.value = 0.85; LAUD.master.connect(LAUD.ctx.destination);
    LAUD.analyser = LAUD.ctx.createAnalyser(); LAUD.analyser.fftSize = 256; LAUD.analyser.smoothingTimeConstant = 0.75;
    LAUD.data = new Uint8Array(LAUD.analyser.frequencyBinCount);
    if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();
  } catch (e) {}
}
function lWire() { if (LAUD.analyser && LAUD.master && !LAUD.wired) { LAUD.analyser.connect(LAUD.master); LAUD.wired = true; } }
function lStopProc() { for (const n of LAUD.nodes) { try { if (n.stop) n.stop(); else if (n.disconnect) n.disconnect(); } catch (e) {} } LAUD.nodes = []; }
function lLoadFile(file, onName) {
  lInit(); lStopProc();
  if (LAUD.el) { try { LAUD.el.pause(); } catch (e) {} }
  LAUD.el = new Audio(URL.createObjectURL(file)); LAUD.el.loop = true;
  try { if (!LAUD.src || LAUD.src._el !== LAUD.el) { LAUD.src = LAUD.ctx.createMediaElementSource(LAUD.el); LAUD.src._el = LAUD.el; LAUD.src.connect(LAUD.analyser); lWire(); } } catch (e) {}
  if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();
  LAUD.el.play().then(() => onName(file.name.replace(/\.[^.]+$/, ""), true)).catch(() => onName(file.name.replace(/\.[^.]+$/, ""), false));
}
function lPreset(id, onName) {
  lInit(); lStopProc();
  if (LAUD.el) { try { LAUD.el.pause(); } catch (e) {} }
  if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();
  const t = LAUD.ctx.currentTime, out = LAUD.ctx.createGain(); out.gain.value = 0.3; out.connect(LAUD.analyser); lWire(); LAUD.nodes.push(out);
  const osc = (f, ty, v, det = 0) => { const o = LAUD.ctx.createOscillator(), gg = LAUD.ctx.createGain(); o.type = ty; o.frequency.value = f; o.detune.value = det; gg.gain.value = v; o.connect(gg); gg.connect(out); o.start(t); LAUD.nodes.push(o, gg); return { o, g: gg }; };
  const lfo = (tg, rate, amt) => { const l = LAUD.ctx.createOscillator(), lg = LAUD.ctx.createGain(); l.type = "sine"; l.frequency.value = rate; lg.gain.value = amt; l.connect(lg); lg.connect(tg); l.start(t); LAUD.nodes.push(l, lg); };
  if (id === "pulse") { const d = osc(65, "sawtooth", 0.16); lfo(d.g.gain, 2.0, 0.14); osc(130, "square", 0.07); const p = osc(260, "triangle", 0.1); lfo(p.g.gain, 0.5, 0.08); osc(392, "sine", 0.04); }
  else if (id === "deep") { const d = osc(55, "sine", 0.34); lfo(d.g.gain, 0.08, 0.12); osc(82.5, "sine", 0.22, 3); const p = osc(220, "sine", 0.08); lfo(p.g.gain, 0.12, 0.06); }
  else { const d = osc(45, "sawtooth", 0.2); lfo(d.g.gain, 1.0, 0.1); osc(67.5, "sine", 0.18, 7); osc(180, "square", 0.04, -12); }
  onName(id === "pulse" ? "Neon Pulse" : id === "deep" ? "Deep Space" : "Dark Matter", true);
}
function lAnalyse(dt) {
  const A = LAUD;
  if (A.analyser && A.data) {
    A.analyser.getByteFrequencyData(A.data); const N = A.data.length;
    let bS = 0, mS = 0, tS = 0, all = 0; const bE = Math.floor(N * 0.08), mE = Math.floor(N * 0.4);
    for (let i = 0; i < N; i++) { const v = A.data[i]; all += v; if (i < bE) bS += v; else if (i < mE) mS += v; else tS += v; }
    A.bass += (bS / (bE * 255) - A.bass) * 0.4; A.mid += (mS / ((mE - bE) * 255) - A.mid) * 0.4;
    A.treble += (tS / ((N - mE) * 255) - A.treble) * 0.4; A.level += (all / (N * 255) - A.level) * 0.3;
    A.bassAvg += (A.bass - A.bassAvg) * 0.04;
    if (A.bass > A.bassAvg * 1.35 && A.bass > 0.18 && A.beatHold <= 0) { A.beat = 1; A.beatHold = 0.18; }
    A.beatHold -= dt; A.beat = Math.max(0, A.beat - dt * 4.5);
  } else { A.bass *= 0.92; A.mid *= 0.92; A.treble *= 0.92; A.level *= 0.92; A.beat = Math.max(0, A.beat - dt * 4.5); }
}

function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setShown(true); }, { threshold: 0.18 });
    obs.observe(el); return () => obs.disconnect();
  }, []);
  return [ref, shown];
}

function Reveal({ children, delay = 0, y = 40 }) {
  const [ref, shown] = useReveal();
  return (
    <div ref={ref} style={{
      opacity: shown ? 1 : 0,
      transform: shown ? "translateY(0)" : `translateY(${y}px)`,
      transition: `opacity 1s cubic-bezier(.2,.7,.2,1) ${delay}s, transform 1.1s cubic-bezier(.2,.7,.2,1) ${delay}s`,
    }}>{children}</div>
  );
}

export default function Landing() {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [musicName, setMusicName] = useState("");
  const [musicOn, setMusicOn] = useState(false);
  const [showMusic, setShowMusic] = useState(false);
  const stateRef = useRef({ scroll: 0, mouse: { x: -1e3, y: -1e3 }, time: 0, w: 0, h: 0, wells: [] });
  const [scrollPct, setScrollPct] = useState(0);

  // background gravity grid
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let running = true, last = performance.now();
    const S = stateRef.current;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      S.w = window.innerWidth; S.h = window.innerHeight;
      canvas.width = S.w * dpr; canvas.height = S.h * dpr;
      canvas.style.width = S.w + "px"; canvas.style.height = S.h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // wells: a base in the center + orbiting nodes; their layout drifts with scroll
      S.wells = [
        { bx: 0.5, by: 0.5, mass: 2.6, col: VIOLET },
        { bx: 0.28, by: 0.36, mass: 1.0, col: TEAL },
        { bx: 0.74, by: 0.32, mass: 1.0, col: [255, 100, 180] },
        { bx: 0.68, by: 0.7, mass: 1.2, col: AMBER },
        { bx: 0.3, by: 0.72, mass: 0.9, col: CYAN },
        { bx: 0.85, by: 0.55, mass: 0.8, col: [120, 255, 140] },
        { bx: 0.15, by: 0.55, mass: 0.8, col: [255, 140, 90] },
      ];
      S.stars = Array.from({ length: 90 }, () => ({ x: Math.random() * S.w, y: Math.random() * S.h, z: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28, hue: Math.random() * 360 }));
      S.comets = []; S.shocks = []; S.cometTimer = 0;
    };
    resize();
    window.addEventListener("resize", resize);
    const onMove = (e) => { S.mouse = { x: e.clientX, y: e.clientY }; };
    const onScroll = () => { const max = document.body.scrollHeight - window.innerHeight; S.scroll = max > 0 ? window.scrollY / max : 0; setScrollPct(S.scroll); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const hsv = (h, s, v) => {
      h = ((h % 360) + 360) % 360;
      const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
      return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
    };

    const loop = (now) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05); last = now; S.time += dt;
      lAnalyse(dt);
      const beatAmp = 1 + LAUD.bass * 1.8 + LAUD.beat * 1.0;
      const w = S.w, h = S.h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#05060b"; ctx.fillRect(0, 0, w, h);

      const beatNow = LAUD.beat, bassNow = LAUD.bass;
      ctx.globalCompositeOperation = "lighter";

      // drifting aurora nebula clouds (multi-color, slow, alive)
      const auroraCols = [[150, 80, 255], [40, 200, 180], [255, 120, 90], [80, 140, 255], [240, 100, 200]];
      for (let i = 0; i < auroraCols.length; i++) {
        const c = auroraCols[i];
        const ax = w * (0.5 + 0.42 * Math.sin(S.time * 0.06 + i * 1.7));
        const ay = h * (0.5 + 0.36 * Math.cos(S.time * 0.05 + i * 2.1));
        const rad = (w * 0.22) * (1 + 0.25 * Math.sin(S.time * 0.3 + i)) * (1 + bassNow * 0.6);
        const gr = ctx.createRadialGradient(ax, ay, 0, ax, ay, rad);
        const al = 0.05 + 0.05 * Math.sin(S.time * 0.4 + i) + beatNow * 0.04;
        gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, al)})`);
        gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ax, ay, rad, 0, 6.283); ctx.fill();
      }

      // twinkling parallax stars
      for (const st of S.stars) {
        st.tw += dt * (1 + st.z); st.x -= dt * 6 * st.z; if (st.x < 0) st.x += w;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(st.tw));
        const [sr, sg, sb] = hsv((st.hue + S.time * 20) % 360, 0.3, 1);
        ctx.fillStyle = `rgba(${sr|0},${sg|0},${sb|0},${tw * st.z * 0.8})`;
        ctx.fillRect(st.x, st.y, st.z * 1.6, st.z * 1.6);
      }
      ctx.globalCompositeOperation = "source-over";

      // wells animate: orbit slowly + spread as you scroll down
      const spread = 1 + S.scroll * 0.5;
      const wells = S.wells.map((wl, i) => {
        const ang = S.time * (0.05 + i * 0.01) + i;
        const orbit = i === 0 ? 0 : 30 + i * 6;
        const cx = (wl.bx - 0.5) * spread + 0.5;
        const cy = (wl.by - 0.5) * spread + 0.5;
        return { x: cx * w + Math.cos(ang) * orbit, y: cy * h + Math.sin(ang) * orbit, mass: wl.mass, col: wl.col };
      });

      const spacing = 22, baseHue = (S.time * 8 + S.scroll * 120) % 360;
      const cols = Math.ceil(w / spacing) + 1, rows = Math.ceil(h / spacing) + 1;
      for (let gx = 0; gx < cols; gx++) {
        for (let gy = 0; gy < rows; gy++) {
          const bx = gx * spacing, by = gy * spacing;
          let pX = 0, pY = 0, tR = 0, tG = 0, tB = 0, tW = 0;
          for (const wl of wells) {
            const nx = wl.x - bx, ny = wl.y - by, dd = Math.hypot(nx, ny); if (dd < 1) continue;
            const pull = wl.mass * 40 * beatAmp / (dd + 150);
            pX += nx * pull / dd; pY += ny * pull / dd;
            const tw = wl.mass / (dd * 0.006 + 1);
            tR += wl.col[0] * tw; tG += wl.col[1] * tw; tB += wl.col[2] * tw; tW += tw;
          }
          const cxw = S.mouse.x - bx, cyw = S.mouse.y - by, cd = Math.hypot(cxw, cyw);
          if (cd > 1 && cd < 320) { const cp = 26 / (cd + 120); pX += cxw * cp; pY += cyw * cp; }
          const flow = Math.sin(S.time * 0.5 + gx * 0.35 + gy * 0.3) * 1.6;
          pX += flow; pY += Math.cos(S.time * 0.45 + gx * 0.3) * 1.6;
          const hue = (baseHue + gx * 0.4 + gy * 0.4) % 360;
          let [dr, dg, db] = hsv(hue, 0.2 + LAUD.treble * 0.4, 0.42 + LAUD.treble * 0.4 + LAUD.beat * 0.2);
          if (tW > 0.01) { const amt = Math.min(tW * 0.022, 0.75); dr = dr + (tR / tW - dr) * amt; dg = dg + (tG / tW - dg) * amt; db = db + (tB / tW - db) * amt; }
          const pd = Math.hypot(pX, pY), alpha = Math.min(0.85, 0.22 + pd * 0.045);
          const sz = Math.min(3.0, 1.0 + pd * 0.04);
          ctx.fillStyle = `rgba(${dr|0},${dg|0},${db|0},${alpha})`;
          ctx.fillRect(bx + pX - sz / 2, by + pY - sz / 2, sz, sz);
        }
      }

      // faint links between near wells
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < wells.length; i++)
        for (let j = i + 1; j < wells.length; j++) {
          const a = wells[i], b = wells[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < w * 0.34) { ctx.strokeStyle = `rgba(150,170,230,${0.06 * (1 - d / (w * 0.34))})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      // well cores
      for (const wl of wells) {
        const grad = ctx.createRadialGradient(wl.x, wl.y, 1, wl.x, wl.y, 60 * wl.mass);
        grad.addColorStop(0, `rgba(${wl.col[0]},${wl.col[1]},${wl.col[2]},0.16)`);
        grad.addColorStop(1, `rgba(${wl.col[0]},${wl.col[1]},${wl.col[2]},0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(wl.x, wl.y, 60 * wl.mass, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // comets streak across — spawn on beats and on a timer
      S.cometTimer -= dt;
      if ((beatNow > 0.6 && Math.random() < 0.5) || S.cometTimer <= 0) {
        S.cometTimer = 1.4 + Math.random() * 2.5;
        const edge = Math.random() < 0.5;
        const sx = edge ? -40 : Math.random() * w, sy = edge ? Math.random() * h * 0.7 : -40;
        const ang = Math.atan2(h * 0.5 - sy, w * 0.5 - sx) + (Math.random() - 0.5) * 0.8;
        const spd = 240 + Math.random() * 260;
        S.comets.push({ x: sx, y: sy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0, max: 2.4, hue: Math.random() * 360, trail: [] });
      }
      ctx.globalCompositeOperation = "lighter";
      S.comets = S.comets.filter(cm => {
        cm.life += dt; cm.x += cm.vx * dt; cm.y += cm.vy * dt;
        cm.trail.push({ x: cm.x, y: cm.y }); if (cm.trail.length > 18) cm.trail.shift();
        const [cr, cg, cb] = hsv((cm.hue + S.time * 40) % 360, 0.7, 1);
        for (let i = 0; i < cm.trail.length; i++) { const t = cm.trail[i], a = (i / cm.trail.length) * 0.6 * Math.min(1, cm.life * 2); const sz = (i / cm.trail.length) * 3; ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`; ctx.beginPath(); ctx.arc(t.x, t.y, sz, 0, 6.283); ctx.fill(); }
        const hg = ctx.createRadialGradient(cm.x, cm.y, 0, cm.x, cm.y, 16); hg.addColorStop(0, `rgba(${cr},${cg},${cb},0.7)`); hg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cm.x, cm.y, 16, 0, 6.283); ctx.fill();
        return cm.x > -60 && cm.x < w + 60 && cm.y > -60 && cm.y < h + 60 && cm.life < cm.max;
      });

      // beat shockwave rings from screen center
      if (beatNow > 0.7 && (!S._lastBeat || S.time - S._lastBeat > 0.18)) { S._lastBeat = S.time; const hue = (S.time * 60) % 360; S.shocks.push({ age: 0, life: 1.1, hue }); }
      S.shocks = S.shocks.filter(sh => { sh.age += dt; const t = sh.age / sh.life; const r = t * Math.hypot(w, h) * 0.55; const [sr, sg, sb] = hsv(sh.hue, 0.6, 1); ctx.strokeStyle = `rgba(${sr|0},${sg|0},${sb|0},${0.4 * (1 - t)})`; ctx.lineWidth = 2.5 * (1 - t) + 0.5; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, 6.283); ctx.stroke(); return sh.age < sh.life; });
      ctx.globalCompositeOperation = "source-over";

      // vignette
      const vg = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; window.removeEventListener("resize", resize); window.removeEventListener("mousemove", onMove); window.removeEventListener("scroll", onScroll); };
  }, []);

  const onName = (n, playing) => { setMusicName(n); setMusicOn(playing); setShowMusic(false); };
  const pickFile = (e) => { const f = e.target.files?.[0]; if (f) lLoadFile(f, onName); };
  const toggleMusicMenu = () => { lInit(); if (LAUD.el && !LAUD.el.paused) { LAUD.el.pause(); setMusicOn(false); return; } if (LAUD.el && LAUD.el.paused && musicName) { LAUD.el.play(); setMusicOn(true); return; } if (LAUD.nodes.length && musicOn) { lStopProc(); setMusicOn(false); return; } setShowMusic(s => !s); };

  const launch = () => {
    if (window.__gmNavigate) window.__gmNavigate("simulator");
    else window.location.hash = "#/simulator";
  };

  // magnetic button: nudges toward the cursor when near
  const magnet = (e) => {
    const el = e.currentTarget, r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.18}px)`;
  };
  const demagnet = (e) => { e.currentTarget.style.transform = "translate(0,0)"; };

  const mono = "'SF Mono','Fira Code','JetBrains Mono','Courier New',monospace";
  const sans = "'Inter','SF Pro Display',system-ui,sans-serif";

  return (
    <div style={{ background: "#05060b", color: "#e7ecf5", fontFamily: sans, position: "relative", overflowX: "hidden" }}>
      {/* fixed living background */}
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />

      {/* film grain overlay for cinematic texture */}
      <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", opacity: 0.05, mixBlendMode: "overlay",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      {/* scroll progress bar */}
      <div style={{ position: "fixed", top: 0, left: 0, height: 2, width: `${scrollPct * 100}%`, background: "linear-gradient(90deg,#9a7bff,#46e6aa)", zIndex: 50, transition: "width .1s linear" }} />

      {/* top nav */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 40, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px", backdropFilter: "blur(6px)" }}>
        <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: "#cdd6ea", fontWeight: 700 }}>GUARDIAN<span style={{ color: "#9a7bff" }}>·</span>MESH</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", position: "relative" }}>
          <input ref={fileRef} type="file" accept="audio/*" onChange={pickFile} style={{ display: "none" }} />
          {showMusic && (
            <div style={{ position: "absolute", top: 46, right: 110, background: "rgba(12,11,22,0.97)", border: "1px solid rgba(160,130,235,0.3)", borderRadius: 12, padding: 8, width: 210, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
              <div style={{ color: "rgba(180,160,220,0.7)", fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "4px 8px 8px" }}>BEAT-REACTIVE AUDIO</div>
              {[["pulse", "Neon Pulse"], ["deep", "Deep Space"], ["dark", "Dark Matter"]].map(([id, nm]) => (
                <button key={id} onClick={() => lPreset(id, onName)} style={{ display: "block", width: "100%", textAlign: "left", background: musicName === nm ? "rgba(160,130,235,0.18)" : "transparent", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "rgb(210,195,245)", fontSize: 13, fontWeight: 600 }}>{nm}</button>
              ))}
              <div style={{ height: 1, background: "rgba(160,130,235,0.15)", margin: "6px 4px" }} />
              <button onClick={() => { lInit(); fileRef.current?.click(); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "rgb(150,210,255)", fontSize: 13, fontWeight: 600 }}>⬆ Load your own track…</button>
            </div>
          )}
          <button onClick={toggleMusicMenu} style={{ background: "rgba(20,16,32,0.6)", border: "1px solid rgba(160,130,235,0.3)", color: "#c9bcff", padding: "8px 14px", borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: mono }}>{musicOn ? "❚❚" : "♪"} {musicName || "Music"}</button>
          <button onClick={launch} style={{ background: "rgba(154,123,255,0.12)", border: "1px solid rgba(154,123,255,0.4)", color: "#c9bcff", padding: "8px 18px", borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: mono, letterSpacing: 1 }}>LAUNCH ↗</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ position: "relative", zIndex: 10, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 24px" }}>
        <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: 6, color: "#7d8db4", marginBottom: 28, animation: "fadeUp 1.2s ease both" }}>WHEN THE TOWERS FALL</div>
        <h1 style={{ fontSize: "clamp(44px, 9vw, 128px)", fontWeight: 800, lineHeight: 0.95, letterSpacing: -2, margin: 0, backgroundImage: "linear-gradient(110deg,#fff,#b6a8ff,#7fe9c8,#ffd28a,#ff9ecb,#fff)", backgroundSize: "300% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", animation: "fadeUp 1.2s .1s ease both, hueflow 9s linear infinite, titlebreathe 4s ease-in-out infinite", filter: "drop-shadow(0 0 30px rgba(154,123,255,0.35))" }}>
          The network is<br />the survivors.
        </h1>
        <p style={{ maxWidth: 600, fontSize: "clamp(15px,2vw,19px)", color: "#9aa7c4", lineHeight: 1.6, marginTop: 30, animation: "fadeUp 1.2s .25s ease both" }}>
          A decentralized emergency mesh that routes a cry for help phone-to-phone when every cell tower is gone. Built in C++, reborn as something you can feel.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 42, flexWrap: "wrap", justifyContent: "center", animation: "fadeUp 1.2s .4s ease both" }}>
          <button onClick={launch} onMouseMove={magnet} onMouseLeave={demagnet} style={{ background: "linear-gradient(135deg,#9a7bff,#6d5cff)", border: "none", color: "#fff", padding: "15px 34px", borderRadius: 100, fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 40px rgba(120,90,255,0.4)", letterSpacing: 0.5, transition: "transform .15s ease" }}>Launch the Simulator →</button>
          <a href="https://github.com/FahadRahman5/Guardian_Mesh_OOPS_Project" target="_blank" rel="noreferrer" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "#cdd6ea", padding: "15px 30px", borderRadius: 100, fontSize: 15, fontWeight: 600, cursor: "pointer", textDecoration: "none" }}>View the Code</a>
        </div>
        <div style={{ position: "absolute", bottom: 30, fontFamily: mono, fontSize: 11, letterSpacing: 3, color: "#5a6684", animation: "pulse 2.2s ease infinite" }}>SCROLL ↓</div>
      </section>

      {/* MANIFESTO */}
      <section style={{ position: "relative", zIndex: 10, padding: "14vh 24px", maxWidth: 900, margin: "0 auto" }}>
        <Reveal>
          <p style={{ fontSize: "clamp(24px,4vw,46px)", fontWeight: 600, lineHeight: 1.35, letterSpacing: -0.5 }}>
            When a disaster hits, the first thing that dies is the infrastructure everyone depends on.{" "}
            <span style={{ color: "#6b7798" }}>Cell towers. Servers. The grid.</span>{" "}
            <span style={{ background: "linear-gradient(90deg,#9a7bff,#46e6aa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Guardian Mesh assumes all of it is already gone.</span>
          </p>
        </Reveal>
      </section>

      {/* FEATURE ROWS */}
      <section style={{ position: "relative", zIndex: 10, padding: "6vh 24px 14vh", maxWidth: 1000, margin: "0 auto" }}>
        {[
          { n: "01", c: TEAL, t: "The mesh wires itself", d: "Drop a node anywhere. If it's out of range, relays auto-deploy to bridge the gap. The network heals around damage instead of failing at it." },
          { n: "02", c: CYAN, t: "Watch a message survive", d: "Send an SOS and follow the packet hopping across the map in real time. When it lands, an acknowledgment travels all the way back — so the sender knows they were heard." },
          { n: "03", c: AMBER, t: "It defends itself", d: "End-to-end encryption, clearance levels, and rate-limiting. Flood it with spoofed traffic and watch SOS cut through while the junk gets shed." },
          { n: "04", c: VIOLET, t: "A universe with weight", d: "Every node warps the space around it. The Emergency Base has the heaviest pull — it's the anchor. Even your cursor disturbs the field." },
        ].map((f, i) => (
          <Reveal key={f.n} delay={0.05}>
            <div style={{ display: "flex", gap: "clamp(20px,4vw,60px)", alignItems: "flex-start", padding: "44px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontFamily: mono, fontSize: 14, color: `rgb(${f.c[0]},${f.c[1]},${f.c[2]})`, fontWeight: 700, minWidth: 40, paddingTop: 6 }}>{f.n}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "clamp(24px,3.4vw,40px)", fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>{f.t}</h3>
                <p style={{ fontSize: "clamp(15px,1.8vw,18px)", color: "#9aa7c4", lineHeight: 1.6, marginTop: 14, maxWidth: 620 }}>{f.d}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </section>

      {/* STAT STRIP */}
      <section style={{ position: "relative", zIndex: 10, padding: "8vh 24px", borderTop: "1px solid rgba(255,255,255,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 30, textAlign: "center" }}>
          {[["3", "device classes"], ["10", "max hops before TTL"], ["3", "retries on failure"], ["0", "central servers"]].map(([k, v], i) => (
            <Reveal key={i} delay={i * 0.08}>
              <div>
                <div style={{ fontSize: "clamp(40px,6vw,68px)", fontWeight: 800, background: "linear-gradient(180deg,#fff,#8fa0c8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{k}</div>
                <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: 1, color: "#7d8db4", marginTop: 6 }}>{v}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* STORY */}
      <section style={{ position: "relative", zIndex: 10, padding: "14vh 24px", maxWidth: 760, margin: "0 auto" }}>
        <Reveal>
          <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: 3, color: "#9a7bff", marginBottom: 22 }}>THE STORY</div>
          <p style={{ fontSize: "clamp(18px,2.4vw,24px)", lineHeight: 1.65, color: "#c4cde0", fontWeight: 400 }}>
            It started as a command-line assignment for a second-semester OOP course. It worked — it met the rubric. Then a professor asked where the security was: anyone on the network could read every message, or flood it and bring it down.
            <br /><br />
            <span style={{ color: "#fff", fontWeight: 600 }}>So it kept going.</span> The terminal became a living simulator. The security became real. And the whole thing turned into something worth showing, not just submitting.
          </p>
        </Reveal>
      </section>

      {/* FINAL CTA */}
      <section style={{ position: "relative", zIndex: 10, minHeight: "70vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 24px" }}>
        <Reveal>
          <h2 style={{ fontSize: "clamp(34px,6vw,80px)", fontWeight: 800, letterSpacing: -2, lineHeight: 1, margin: 0, background: "linear-gradient(180deg,#fff,#9fb0d6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Build the network.<br />Break it. Watch it heal.
          </h2>
          <p style={{ color: "#9aa7c4", fontSize: 17, marginTop: 24 }}>No download. Works on any device, one click away.</p>
          <button onClick={launch} onMouseMove={magnet} onMouseLeave={demagnet} style={{ marginTop: 38, background: "linear-gradient(135deg,#9a7bff,#6d5cff)", border: "none", color: "#fff", padding: "18px 46px", borderRadius: 100, fontSize: 17, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 50px rgba(120,90,255,0.45)", transition: "transform .15s ease" }}>Launch the Simulator →</button>
        </Reveal>
      </section>

      {/* footer */}
      <footer style={{ position: "relative", zIndex: 10, padding: "40px 28px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, fontFamily: mono, fontSize: 12, color: "#6b7798" }}>
        <span>GUARDIAN·MESH — CS112L</span>
        <span>Built in C++ / SFML · Web build with React + Canvas</span>
        <a href="https://github.com/FahadRahman5/Guardian_Mesh_OOPS_Project" target="_blank" rel="noreferrer" style={{ color: "#9a7bff", textDecoration: "none" }}>GitHub ↗</a>
      </footer>

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(30px);} to { opacity:1; transform:translateY(0);} }
        @keyframes pulse { 0%,100%{opacity:.3;} 50%{opacity:.8;} }
        @keyframes hueflow { 0%{background-position:0% 50%;} 100%{background-position:300% 50%;} }
        @keyframes titlebreathe { 0%,100%{ filter: drop-shadow(0 0 24px rgba(154,123,255,0.3)); } 50%{ filter: drop-shadow(0 0 48px rgba(127,233,200,0.45)); } }
        html { scroll-behavior: smooth; }
        body { margin:0; }
        ::selection { background: rgba(154,123,255,0.3); }
      `}</style>
    </div>
  );
}
