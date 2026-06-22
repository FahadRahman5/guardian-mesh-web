import { useEffect, useRef, useState } from "react";

// Guardian Mesh
// A darker, stranger, more deliberate landing page. The canvas is still
// procedural and beat-reactive, but the page now has stronger narrative pacing.

const VIOLET = [154, 123, 255];
const TEAL = [70, 230, 170];
const CYAN = [110, 200, 255];
const AMBER = [240, 200, 100];
const ROSE = [255, 96, 160];
const LIME = [164, 255, 120];

const LAUD = {
  ctx: null,
  master: null,
  analyser: null,
  data: null,
  el: null,
  src: null,
  wired: false,
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  beat: 0,
  beatHold: 0,
  bassAvg: 0,
  nodes: [],
};

function lInit() {
  if (LAUD.ctx) {
    if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();
    return;
  }

  try {
    LAUD.ctx = new (window.AudioContext || window.webkitAudioContext)();
    LAUD.master = LAUD.ctx.createGain();
    LAUD.master.gain.value = 0.78;
    LAUD.master.connect(LAUD.ctx.destination);
    LAUD.analyser = LAUD.ctx.createAnalyser();
    LAUD.analyser.fftSize = 256;
    LAUD.analyser.smoothingTimeConstant = 0.78;
    LAUD.data = new Uint8Array(LAUD.analyser.frequencyBinCount);
    if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();
  } catch (e) {}
}

function lWire() {
  if (LAUD.analyser && LAUD.master && !LAUD.wired) {
    LAUD.analyser.connect(LAUD.master);
    LAUD.wired = true;
  }
}

function lStopProc() {
  for (const n of LAUD.nodes) {
    try {
      if (n.stop) n.stop();
      else if (n.disconnect) n.disconnect();
    } catch (e) {}
  }
  LAUD.nodes = [];
}

function lLoadFile(file, onName) {
  lInit();
  lStopProc();

  if (LAUD.el) {
    try {
      LAUD.el.pause();
    } catch (e) {}
  }

  LAUD.el = new Audio(URL.createObjectURL(file));
  LAUD.el.loop = true;

  try {
    if (!LAUD.src || LAUD.src._el !== LAUD.el) {
      LAUD.src = LAUD.ctx.createMediaElementSource(LAUD.el);
      LAUD.src._el = LAUD.el;
      LAUD.src.connect(LAUD.analyser);
      lWire();
    }
  } catch (e) {}

  if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();
  LAUD.el
    .play()
    .then(() => onName(file.name.replace(/\.[^.]+$/, ""), true))
    .catch(() => onName(file.name.replace(/\.[^.]+$/, ""), false));
}

function lPreset(id, onName) {
  lInit();
  lStopProc();

  if (LAUD.el) {
    try {
      LAUD.el.pause();
    } catch (e) {}
  }

  if (LAUD.ctx.state === "suspended") LAUD.ctx.resume();

  const t = LAUD.ctx.currentTime;
  const out = LAUD.ctx.createGain();
  out.gain.value = 0.28;
  out.connect(LAUD.analyser);
  lWire();
  LAUD.nodes.push(out);

  const osc = (f, type, volume, detune = 0) => {
    const o = LAUD.ctx.createOscillator();
    const g = LAUD.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    g.gain.value = volume;
    o.connect(g);
    g.connect(out);
    o.start(t);
    LAUD.nodes.push(o, g);
    return { o, g };
  };

  const lfo = (target, rate, amount) => {
    const l = LAUD.ctx.createOscillator();
    const g = LAUD.ctx.createGain();
    l.type = "sine";
    l.frequency.value = rate;
    g.gain.value = amount;
    l.connect(g);
    g.connect(target);
    l.start(t);
    LAUD.nodes.push(l, g);
  };

  if (id === "pulse") {
    const low = osc(65, "sawtooth", 0.16);
    lfo(low.g.gain, 2, 0.14);
    osc(130, "square", 0.07);
    const upper = osc(260, "triangle", 0.1);
    lfo(upper.g.gain, 0.5, 0.08);
    osc(392, "sine", 0.04);
  } else if (id === "deep") {
    const low = osc(55, "sine", 0.34);
    lfo(low.g.gain, 0.08, 0.12);
    osc(82.5, "sine", 0.22, 3);
    const upper = osc(220, "sine", 0.08);
    lfo(upper.g.gain, 0.12, 0.06);
  } else {
    const low = osc(45, "sawtooth", 0.2);
    lfo(low.g.gain, 1, 0.1);
    osc(67.5, "sine", 0.18, 7);
    osc(180, "square", 0.04, -12);
  }

  onName(id === "pulse" ? "Neon Pulse" : id === "deep" ? "Deep Space" : "Dark Matter", true);
}

function lAnalyse(dt) {
  const A = LAUD;

  if (A.analyser && A.data) {
    A.analyser.getByteFrequencyData(A.data);
    const N = A.data.length;
    const bE = Math.max(1, Math.floor(N * 0.08));
    const mE = Math.max(bE + 1, Math.floor(N * 0.4));
    let bS = 0;
    let mS = 0;
    let tS = 0;
    let all = 0;

    for (let i = 0; i < N; i++) {
      const value = A.data[i];
      all += value;
      if (i < bE) bS += value;
      else if (i < mE) mS += value;
      else tS += value;
    }

    A.bass += (bS / (bE * 255) - A.bass) * 0.4;
    A.mid += (mS / ((mE - bE) * 255) - A.mid) * 0.4;
    A.treble += (tS / ((N - mE) * 255) - A.treble) * 0.4;
    A.level += (all / (N * 255) - A.level) * 0.3;
    A.bassAvg += (A.bass - A.bassAvg) * 0.04;

    if (A.bass > A.bassAvg * 1.35 && A.bass > 0.18 && A.beatHold <= 0) {
      A.beat = 1;
      A.beatHold = 0.18;
    }

    A.beatHold -= dt;
    A.beat = Math.max(0, A.beat - dt * 4.5);
  } else {
    A.bass *= 0.92;
    A.mid *= 0.92;
    A.treble *= 0.92;
    A.level *= 0.92;
    A.beat = Math.max(0, A.beat - dt * 4.5);
  }
}

function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShown(true);
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return [ref, shown];
}

function Reveal({ children, delay = 0, className = "" }) {
  const [ref, shown] = useReveal();
  return (
    <div
      ref={ref}
      className={`${className} ${shown ? "gm-reveal gm-reveal-on" : "gm-reveal"}`}
      style={{ transitionDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

const metrics = [
  ["000", "central servers"],
  ["010", "TTL ceiling"],
  ["003", "retry pulses"],
  ["E2E", "message envelope"],
];

const protocolRows = [
  {
    n: "01",
    k: "Range is not a wall.",
    d: "When a node cannot reach the base, the mesh treats distance as a solvable equation and inserts relays until the path closes.",
    v: "relay_auto_deploy()",
    c: TEAL,
  },
  {
    n: "02",
    k: "The cry must return as proof.",
    d: "An SOS is not complete when it leaves. It is complete when the acknowledgment survives the road back.",
    v: "SOS -> hop[n] -> ACK",
    c: CYAN,
  },
  {
    n: "03",
    k: "Noise has a metabolism.",
    d: "Rate limits, clearance checks, and encrypted envelopes make the network shed false traffic before it starves the real signal.",
    v: "drop_spoofed_packets",
    c: AMBER,
  },
  {
    n: "04",
    k: "The map is a field, not a diagram.",
    d: "Every device bends the background. The emergency base is the heaviest body. The cursor is a small gravity event.",
    v: "mass(node) => routing_bias",
    c: VIOLET,
  },
];

const consoleLines = [
  "boot: guardian-mesh / disaster-mode",
  "scan: towers absent / server absent / grid uncertain",
  "node[03]: victim_phone / clearance: civilian",
  "path: 03 -> 06 -> 01 -> base",
  "encrypt: envelope sealed",
  "flood: 431 spoof packets rejected",
  "ack: route reversed / sender heard",
];

export default function Landing() {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const [musicName, setMusicName] = useState("");
  const [musicOn, setMusicOn] = useState(false);
  const [showMusic, setShowMusic] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const stateRef = useRef({
    scroll: 0,
    mouse: { x: -1000, y: -1000 },
    time: 0,
    w: 0,
    h: 0,
    wells: [],
    stars: [],
    glyphs: [],
    dust: [],
    packets: [],
    comets: [],
    shocks: [],
    cometTimer: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    const S = stateRef.current;
    let running = true;
    let last = performance.now();

    const hsv = (h, s, v) => {
      h = ((h % 360) + 360) % 360;
      const c = v * s;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = v - c;
      let r = 0;
      let g = 0;
      let b = 0;

      if (h < 60) {
        r = c;
        g = x;
      } else if (h < 120) {
        r = x;
        g = c;
      } else if (h < 180) {
        g = c;
        b = x;
      } else if (h < 240) {
        g = x;
        b = c;
      } else if (h < 300) {
        r = x;
        b = c;
      } else {
        r = c;
        b = x;
      }

      return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      S.w = window.innerWidth;
      S.h = window.innerHeight;
      canvas.width = S.w * dpr;
      canvas.height = S.h * dpr;
      canvas.style.width = `${S.w}px`;
      canvas.style.height = `${S.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      S.wells = [
        { bx: 0.5, by: 0.5, mass: 2.7, col: VIOLET },
        { bx: 0.2, by: 0.26, mass: 0.92, col: TEAL },
        { bx: 0.78, by: 0.28, mass: 1.05, col: ROSE },
        { bx: 0.72, by: 0.72, mass: 1.1, col: AMBER },
        { bx: 0.32, by: 0.74, mass: 0.88, col: CYAN },
        { bx: 0.9, by: 0.54, mass: 0.7, col: LIME },
        { bx: 0.1, by: 0.58, mass: 0.78, col: [255, 140, 90] },
      ];

      const area = S.w * S.h;
      const starCount = Math.max(110, Math.min(260, Math.floor(area / 5600)));
      const glyphs = ["ACK", "SOS", "TTL=10", "0xA7", "dx/dt", "lambda", "pi", "sum", "phi", "root", "mesh", "hash", "node++"];

      S.stars = Array.from({ length: starCount }, () => ({
        x: Math.random() * S.w,
        y: Math.random() * S.h,
        z: 0.2 + Math.random() * 0.8,
        tw: Math.random() * 6.283,
        hue: Math.random() * 360,
      }));

      S.dust = Array.from({ length: 86 }, () => ({
        x: Math.random() * S.w,
        y: Math.random() * S.h,
        r: 18 + Math.random() * 90,
        phase: Math.random() * 6.283,
        speed: 0.02 + Math.random() * 0.04,
        col: [40 + Math.random() * 90, 16 + Math.random() * 70, 100 + Math.random() * 120],
      }));

      S.glyphs = Array.from({ length: S.w < 760 ? 16 : 28 }, () => ({
        text: glyphs[Math.floor(Math.random() * glyphs.length)],
        x: Math.random() * S.w,
        y: Math.random() * S.h,
        vx: -10 + Math.random() * 20,
        vy: -4 + Math.random() * 10,
        size: 10 + Math.random() * 14,
        alpha: 0.035 + Math.random() * 0.075,
      }));

      S.packets = Array.from({ length: 12 }, (_, i) => ({
        from: i % 7,
        to: (i * 3 + 2) % 7,
        t: Math.random(),
        speed: 0.08 + Math.random() * 0.18,
        hue: Math.random() * 360,
      }));

      S.comets = [];
      S.shocks = [];
      S.cometTimer = 0.8;
    };

    const onMove = (e) => {
      S.mouse = { x: e.clientX, y: e.clientY };
    };

    const onScroll = () => {
      const max = document.body.scrollHeight - window.innerHeight;
      S.scroll = max > 0 ? window.scrollY / max : 0;
      setScrollPct(S.scroll);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const loop = (now) => {
      if (!running) return;

      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      S.time += dt;
      lAnalyse(dt);

      const w = S.w;
      const h = S.h;
      const beatAmp = 1 + LAUD.bass * 1.9 + LAUD.beat * 1.15;

      ctx.clearRect(0, 0, w, h);

      const back = ctx.createRadialGradient(w * 0.5, h * 0.48, 1, w * 0.5, h * 0.5, Math.max(w, h));
      back.addColorStop(0, "#111426");
      back.addColorStop(0.42, "#060813");
      back.addColorStop(1, "#010207");
      ctx.fillStyle = back;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      for (const d of S.dust) {
        d.phase += d.speed * dt;
        const x = d.x + Math.cos(S.time * 0.05 + d.phase) * 24;
        const y = d.y + Math.sin(S.time * 0.04 + d.phase) * 18;
        const alpha = 0.022 + 0.02 * Math.sin(S.time * 0.32 + d.phase) + LAUD.mid * 0.035;
        const g = ctx.createRadialGradient(x, y, 0, x, y, d.r * (1 + LAUD.bass * 0.5));
        g.addColorStop(0, `rgba(${d.col[0] | 0},${d.col[1] | 0},${d.col[2] | 0},${Math.max(0, alpha)})`);
        g.addColorStop(1, `rgba(${d.col[0] | 0},${d.col[1] | 0},${d.col[2] | 0},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, d.r * 1.2, 0, 6.283);
        ctx.fill();
      }

      for (const st of S.stars) {
        st.tw += dt * (0.8 + st.z);
        st.x -= dt * (4 + 12 * st.z + S.scroll * 24);
        if (st.x < -8) st.x += w + 16;

        const tw = 0.35 + 0.65 * Math.abs(Math.sin(st.tw));
        const [sr, sg, sb] = hsv(st.hue + S.time * 8 + st.z * 90, 0.28 + LAUD.treble * 0.35, 1);
        ctx.fillStyle = `rgba(${sr | 0},${sg | 0},${sb | 0},${tw * st.z * 0.82})`;
        ctx.fillRect(st.x, st.y, 0.8 + st.z * 1.8, 0.8 + st.z * 1.8);
      }
      ctx.globalCompositeOperation = "source-over";

      const spread = 1 + S.scroll * 0.56;
      const wells = S.wells.map((wl, i) => {
        const ang = S.time * (0.035 + i * 0.009) + i * 0.9;
        const orbit = i === 0 ? 0 : 24 + i * 6;
        const cx = (wl.bx - 0.5) * spread + 0.5;
        const cy = (wl.by - 0.5) * spread + 0.5;
        return {
          x: cx * w + Math.cos(ang) * orbit,
          y: cy * h + Math.sin(ang) * orbit,
          mass: wl.mass,
          col: wl.col,
        };
      });

      const cx = w / 2;
      const cy = h / 2;
      ctx.globalCompositeOperation = "lighter";
      for (let ring = 0; ring < 8; ring++) {
        const radius = (58 + ring * 28 + Math.sin(S.time * 0.4 + ring) * 8) * (1 + LAUD.bass * 0.18);
        const start = S.time * (0.08 + ring * 0.006) + ring;
        ctx.strokeStyle = `rgba(154,123,255,${0.03 + ring * 0.006 + LAUD.beat * 0.035})`;
        ctx.lineWidth = ring % 3 === 0 ? 1.4 : 0.65;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + Math.PI * (1.15 + ring * 0.08));
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      const spacing = w < 760 ? 28 : 22;
      const cols = Math.ceil(w / spacing) + 1;
      const rows = Math.ceil(h / spacing) + 1;
      const baseHue = (S.time * 7 + S.scroll * 140) % 360;

      for (let gx = 0; gx < cols; gx++) {
        for (let gy = 0; gy < rows; gy++) {
          const bx = gx * spacing;
          const by = gy * spacing;
          let pX = 0;
          let pY = 0;
          let tR = 0;
          let tG = 0;
          let tB = 0;
          let tW = 0;

          for (const wl of wells) {
            const nx = wl.x - bx;
            const ny = wl.y - by;
            const dd = Math.hypot(nx, ny);
            if (dd < 1) continue;
            const pull = (wl.mass * 42 * beatAmp) / (dd + 168);
            pX += (nx * pull) / dd;
            pY += (ny * pull) / dd;
            const tintWeight = wl.mass / (dd * 0.0058 + 1);
            tR += wl.col[0] * tintWeight;
            tG += wl.col[1] * tintWeight;
            tB += wl.col[2] * tintWeight;
            tW += tintWeight;
          }

          const mx = S.mouse.x - bx;
          const my = S.mouse.y - by;
          const md = Math.hypot(mx, my);
          if (md > 1 && md < 340) {
            const cursorPull = 28 / (md + 118);
            pX += mx * cursorPull;
            pY += my * cursorPull;
          }

          pX += Math.sin(S.time * 0.62 + gx * 0.33 + gy * 0.2) * 1.75;
          pY += Math.cos(S.time * 0.5 + gx * 0.16 + gy * 0.31) * 1.55;

          const hue = baseHue + gx * 0.52 + gy * 0.35;
          let [dr, dg, db] = hsv(hue, 0.25 + LAUD.treble * 0.42, 0.42 + LAUD.treble * 0.42 + LAUD.beat * 0.2);
          if (tW > 0.01) {
            const amount = Math.min(tW * 0.02, 0.76);
            dr += (tR / tW - dr) * amount;
            dg += (tG / tW - dg) * amount;
            db += (tB / tW - db) * amount;
          }

          const pd = Math.hypot(pX, pY);
          const alpha = Math.min(0.82, 0.18 + pd * 0.045);
          const size = Math.min(3.2, 1 + pd * 0.04);
          ctx.fillStyle = `rgba(${dr | 0},${dg | 0},${db | 0},${alpha})`;
          ctx.fillRect(bx + pX - size / 2, by + pY - size / 2, size, size);
        }
      }

      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < wells.length; i++) {
        for (let j = i + 1; j < wells.length; j++) {
          const a = wells[i];
          const b = wells[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < w * 0.4) {
            const alpha = 0.07 * (1 - d / (w * 0.4)) + LAUD.beat * 0.05;
            const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            grad.addColorStop(0, `rgba(${a.col[0]},${a.col[1]},${a.col[2]},${alpha})`);
            grad.addColorStop(1, `rgba(${b.col[0]},${b.col[1]},${b.col[2]},${alpha})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const pkt of S.packets) {
        pkt.t = (pkt.t + dt * pkt.speed * (1 + LAUD.mid * 1.8)) % 1;
        const a = wells[pkt.from % wells.length];
        const b = wells[pkt.to % wells.length];
        const bend = Math.sin(pkt.t * Math.PI) * (26 + 20 * LAUD.bass);
        const nx = b.y - a.y;
        const ny = a.x - b.x;
        const nd = Math.max(1, Math.hypot(nx, ny));
        const x = a.x + (b.x - a.x) * pkt.t + (nx / nd) * bend;
        const y = a.y + (b.y - a.y) * pkt.t + (ny / nd) * bend;
        const [pr, pg, pb] = hsv(pkt.hue + S.time * 40, 0.68, 1);
        const tail = 1 - pkt.t;
        ctx.strokeStyle = `rgba(${pr | 0},${pg | 0},${pb | 0},0.16)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2 + (nx / nd) * bend, (a.y + b.y) / 2 + (ny / nd) * bend, x, y);
        ctx.stroke();
        ctx.fillStyle = `rgba(${pr | 0},${pg | 0},${pb | 0},${0.45 + LAUD.beat * 0.28})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4 + tail * 1.4 + LAUD.beat * 1.8, 0, 6.283);
        ctx.fill();
      }

      for (const wl of wells) {
        const halo = ctx.createRadialGradient(wl.x, wl.y, 0, wl.x, wl.y, 62 * wl.mass * (1 + LAUD.beat * 0.12));
        halo.addColorStop(0, `rgba(${wl.col[0]},${wl.col[1]},${wl.col[2]},0.2)`);
        halo.addColorStop(1, `rgba(${wl.col[0]},${wl.col[1]},${wl.col[2]},0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(wl.x, wl.y, 62 * wl.mass, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = `rgba(${wl.col[0]},${wl.col[1]},${wl.col[2]},0.75)`;
        ctx.beginPath();
        ctx.arc(wl.x, wl.y, 1.8 + wl.mass * 0.6, 0, 6.283);
        ctx.fill();
      }

      ctx.font = "700 13px 'SF Mono','Fira Code','JetBrains Mono','Courier New',monospace";
      for (const g of S.glyphs) {
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        if (g.x < -90) g.x = w + 90;
        if (g.x > w + 90) g.x = -90;
        if (g.y < -40) g.y = h + 40;
        if (g.y > h + 40) g.y = -40;
        const alpha = Math.max(0, g.alpha + Math.sin(S.time * 0.62 + g.x * 0.01) * 0.02 + LAUD.treble * 0.04);
        ctx.fillStyle = `rgba(180,205,255,${alpha})`;
        ctx.fillText(g.text, g.x, g.y);
      }

      S.cometTimer -= dt;
      if ((LAUD.beat > 0.62 && Math.random() < 0.5) || S.cometTimer <= 0) {
        S.cometTimer = 1.2 + Math.random() * 2.4;
        const edge = Math.random() < 0.5;
        const sx = edge ? -40 : Math.random() * w;
        const sy = edge ? Math.random() * h * 0.7 : -40;
        const ang = Math.atan2(h * 0.55 - sy, w * 0.52 - sx) + (Math.random() - 0.5) * 0.72;
        const spd = 220 + Math.random() * 320;
        S.comets.push({
          x: sx,
          y: sy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0,
          max: 2.3,
          hue: Math.random() * 360,
          trail: [],
        });
      }

      S.comets = S.comets.filter((cm) => {
        cm.life += dt;
        cm.x += cm.vx * dt;
        cm.y += cm.vy * dt;
        cm.trail.push({ x: cm.x, y: cm.y });
        if (cm.trail.length > 18) cm.trail.shift();

        const [cr, cg, cb] = hsv(cm.hue + S.time * 36, 0.72, 1);
        for (let i = 0; i < cm.trail.length; i++) {
          const t = cm.trail[i];
          const a = (i / cm.trail.length) * 0.58 * Math.min(1, cm.life * 2);
          const size = (i / cm.trail.length) * 3.2;
          ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a})`;
          ctx.beginPath();
          ctx.arc(t.x, t.y, size, 0, 6.283);
          ctx.fill();
        }

        const head = ctx.createRadialGradient(cm.x, cm.y, 0, cm.x, cm.y, 16);
        head.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},0.75)`);
        head.addColorStop(1, `rgba(${cr | 0},${cg | 0},${cb | 0},0)`);
        ctx.fillStyle = head;
        ctx.beginPath();
        ctx.arc(cm.x, cm.y, 16, 0, 6.283);
        ctx.fill();

        return cm.x > -80 && cm.x < w + 80 && cm.y > -80 && cm.y < h + 80 && cm.life < cm.max;
      });

      if (LAUD.beat > 0.68 && (!S._lastBeat || S.time - S._lastBeat > 0.2)) {
        S._lastBeat = S.time;
        S.shocks.push({ age: 0, life: 1.05, hue: S.time * 44 });
      }

      S.shocks = S.shocks.filter((sh) => {
        sh.age += dt;
        const t = sh.age / sh.life;
        const r = t * Math.hypot(w, h) * 0.58;
        const [sr, sg, sb] = hsv(sh.hue, 0.62, 1);
        ctx.strokeStyle = `rgba(${sr | 0},${sg | 0},${sb | 0},${0.36 * (1 - t)})`;
        ctx.lineWidth = 2.4 * (1 - t) + 0.4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 6.283);
        ctx.stroke();
        return sh.age < sh.life;
      });

      ctx.globalCompositeOperation = "source-over";
      const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, Math.max(w, h) * 0.72);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(0.72, "rgba(0,0,0,0.22)");
      vg.addColorStop(1, "rgba(0,0,0,0.76)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);

    return () => {
      running = false;
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const onName = (name, playing) => {
    setMusicName(name);
    setMusicOn(playing);
    setShowMusic(false);
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    if (file) lLoadFile(file, onName);
  };

  const toggleMusicMenu = () => {
    lInit();

    if (LAUD.el && !LAUD.el.paused) {
      LAUD.el.pause();
      setMusicOn(false);
      return;
    }

    if (LAUD.el && LAUD.el.paused && musicName) {
      LAUD.el.play();
      setMusicOn(true);
      return;
    }

    if (LAUD.nodes.length && musicOn) {
      lStopProc();
      setMusicOn(false);
      return;
    }

    setShowMusic((v) => !v);
  };

  const launch = () => {
    if (window.__gmNavigate) window.__gmNavigate("simulator");
    else window.location.hash = "#/simulator";
  };

  const magnet = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${dx * 0.16}px, ${dy * 0.16}px)`;
  };

  const demagnet = (e) => {
    e.currentTarget.style.transform = "translate(0,0)";
  };

  return (
    <main className="gm-shell">
      <canvas ref={canvasRef} className="gm-canvas" />
      <div className="gm-grain" />
      <div className="gm-scan" />
      <div className="gm-progress" style={{ width: `${scrollPct * 100}%` }} />

      <nav className="gm-nav">
        <a className="gm-brand" href="#top" aria-label="Guardian Mesh home">
          <span>GUARDIAN</span>
          <b>//</b>
          <span>MESH</span>
        </a>
        <div className="gm-nav-actions">
          <input ref={fileRef} type="file" accept="audio/*" onChange={pickFile} className="gm-hidden-input" />
          {showMusic && (
            <div className="gm-music-menu">
              <p>BEAT INPUT</p>
              {[
                ["pulse", "Neon Pulse"],
                ["deep", "Deep Space"],
                ["dark", "Dark Matter"],
              ].map(([id, label]) => (
                <button key={id} type="button" onClick={() => lPreset(id, onName)}>
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => fileRef.current?.click()}>
                Load local track
              </button>
            </div>
          )}
          <button className="gm-icon-btn" type="button" onClick={toggleMusicMenu} aria-label="Music controls">
            <span>{musicOn ? "PAUSE" : "AUDIO"}</span>
            <small>{musicName || "OFF"}</small>
          </button>
          <button className="gm-nav-launch" type="button" onClick={launch}>
            LAUNCH
          </button>
        </div>
      </nav>

      <section id="top" className="gm-hero">
        <div className="gm-hero-inner">
          <p className="gm-kicker">DISASTER ROUTING / ZERO INFRASTRUCTURE / LIVE FIELD</p>
          <h1 className="gm-title">
            Guardian
            <span>Mesh</span>
          </h1>
          <p className="gm-subtitle">
            Emergency messages moving phone-to-phone after the towers go dark, the servers disappear, and the only thing
            still alive is proximity.
          </p>
          <div className="gm-hero-actions">
            <button type="button" className="gm-primary" onClick={launch} onMouseMove={magnet} onMouseLeave={demagnet}>
              Enter Simulator
            </button>
            <a className="gm-secondary" href="https://github.com/FahadRahman5/Guardian_Mesh_OOPS_Project" target="_blank" rel="noreferrer">
              Read Code
            </a>
          </div>
        </div>

        <div className="gm-hero-metrics" aria-label="Guardian Mesh metrics">
          {metrics.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="gm-section gm-manifesto">
        <Reveal>
          <p>
            A rescue network for the first impossible minutes, when official systems have not returned and silence begins
            pretending to be fate.
          </p>
        </Reveal>
      </section>

      <section className="gm-section gm-protocol">
        <div className="gm-section-head">
          <p>FIELD PROTOCOL</p>
          <h2>Four rules for a network that has to stay alive.</h2>
        </div>
        {protocolRows.map((row, i) => (
          <Reveal key={row.n} delay={i * 0.04}>
            <article className="gm-protocol-row">
              <div className="gm-row-num" style={{ color: `rgb(${row.c[0]},${row.c[1]},${row.c[2]})` }}>
                {row.n}
              </div>
              <div>
                <h3>{row.k}</h3>
                <p>{row.d}</p>
              </div>
              <code>{row.v}</code>
            </article>
          </Reveal>
        ))}
      </section>

      <section className="gm-section gm-slab">
        <Reveal className="gm-slab-copy">
          <p>Not a map of devices. A temporary nervous system.</p>
        </Reveal>
        <Reveal className="gm-terminal-wrap" delay={0.08}>
          <div className="gm-terminal">
            <div className="gm-terminal-top">
              <span />
              <span />
              <span />
              <b>mesh_trace.log</b>
            </div>
            <ol>
              {consoleLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        </Reveal>
      </section>

      <section className="gm-section gm-numbers">
        <Reveal>
          <h2>Every message has a little mortality.</h2>
        </Reveal>
        <div className="gm-number-grid">
          {[
            ["TTL", "10", "A signal gets ten chances before the universe is allowed to forget it."],
            ["ACK", "1", "A rescue call is only real when the proof returns."],
            ["ROOT", "0", "No master server. No throne. The base is important, not divine."],
            ["FLOOD", "-431", "Attack traffic becomes subtraction."],
          ].map(([name, value, copy], i) => (
            <Reveal key={name} delay={i * 0.05}>
              <article>
                <span>{name}</span>
                <strong>{value}</strong>
                <p>{copy}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="gm-section gm-origin">
        <Reveal>
          <p className="gm-kicker">ORIGIN STORY</p>
          <h2>It began as an OOP assignment. Then it started asking better questions.</h2>
          <p>
            What if the simulation did not just pass the rubric? What if the packet had fear in it? What if encryption,
            overload, distance, failure, and acknowledgment were all visible enough that a visitor could feel the problem
            before reading the implementation?
          </p>
          <p>
            That is the landing page this wants: not a brochure, not a dashboard, but a threshold. You arrive, the field
            bends, and the simulator feels inevitable.
          </p>
        </Reveal>
      </section>

      <section className="gm-final">
        <Reveal>
          <p className="gm-kicker">READY STATE</p>
          <h2>Make the cry cross the dark.</h2>
          <button type="button" className="gm-primary" onClick={launch} onMouseMove={magnet} onMouseLeave={demagnet}>
            Launch Guardian Mesh
          </button>
        </Reveal>
      </section>

      <footer className="gm-footer">
        <span>GUARDIAN//MESH</span>
        <span>C++ / SFML / React Canvas</span>
        <a href="https://github.com/FahadRahman5/Guardian_Mesh_OOPS_Project" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>

      <style>{`
        html {
          scroll-behavior: smooth;
        }

        body {
          margin: 0;
          background: #010207;
        }

        .gm-shell {
          position: relative;
          min-height: 100vh;
          overflow-x: hidden;
          background: #010207;
          color: #eef4ff;
          font-family: Inter, "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .gm-shell * {
          box-sizing: border-box;
        }

        .gm-canvas,
        .gm-grain,
        .gm-scan {
          position: fixed;
          inset: 0;
          pointer-events: none;
        }

        .gm-canvas {
          z-index: 0;
        }

        .gm-grain {
          z-index: 1;
          opacity: 0.055;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.86' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.9'/%3E%3C/svg%3E");
        }

        .gm-scan {
          z-index: 2;
          opacity: 0.14;
          background: repeating-linear-gradient(to bottom, rgba(255,255,255,0.04), rgba(255,255,255,0.04) 1px, transparent 1px, transparent 7px);
          mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 82%, transparent);
        }

        .gm-progress {
          position: fixed;
          z-index: 80;
          top: 0;
          left: 0;
          height: 2px;
          background: linear-gradient(90deg, #46e6aa, #9a7bff, #ff60a0, #f0c864);
          box-shadow: 0 0 24px rgba(154, 123, 255, 0.55);
          transition: width 120ms linear;
        }

        .gm-nav {
          position: fixed;
          z-index: 70;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 18px 24px;
          color: #dce6ff;
          background: linear-gradient(to bottom, rgba(1,2,7,0.7), rgba(1,2,7,0.1));
          backdrop-filter: blur(10px);
        }

        .gm-brand,
        .gm-footer,
        .gm-kicker,
        .gm-icon-btn,
        .gm-nav-launch,
        .gm-row-num,
        .gm-terminal,
        .gm-number-grid span,
        .gm-hero-metrics {
          font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Courier New", monospace;
        }

        .gm-brand {
          display: inline-flex;
          gap: 8px;
          align-items: center;
          color: #eef4ff;
          text-decoration: none;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.24em;
        }

        .gm-brand b {
          color: #46e6aa;
          font-weight: 900;
          letter-spacing: 0;
        }

        .gm-nav-actions {
          position: relative;
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .gm-hidden-input {
          display: none;
        }

        .gm-icon-btn,
        .gm-nav-launch,
        .gm-primary,
        .gm-secondary,
        .gm-music-menu button {
          appearance: none;
          border: 0;
          cursor: pointer;
          text-decoration: none;
        }

        .gm-icon-btn,
        .gm-nav-launch {
          min-height: 38px;
          border-radius: 999px;
          border: 1px solid rgba(180, 205, 255, 0.18);
          background: rgba(7, 10, 22, 0.62);
          color: #eaf0ff;
        }

        .gm-icon-btn {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 7px 12px;
        }

        .gm-icon-btn span {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .gm-icon-btn small {
          max-width: 120px;
          overflow: hidden;
          color: #8fa0c8;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .gm-nav-launch {
          padding: 0 15px;
          color: #c8bcff;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .gm-music-menu {
          position: absolute;
          top: 47px;
          right: 88px;
          width: 214px;
          padding: 8px;
          border: 1px solid rgba(180, 205, 255, 0.18);
          border-radius: 8px;
          background: rgba(4, 6, 15, 0.96);
          box-shadow: 0 20px 70px rgba(0,0,0,0.5);
        }

        .gm-music-menu p {
          margin: 2px 8px 8px;
          color: #7f8db2;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        .gm-music-menu button {
          width: 100%;
          padding: 9px 10px;
          border-radius: 6px;
          background: transparent;
          color: #cbd6f2;
          text-align: left;
          font-weight: 700;
        }

        .gm-music-menu button:hover {
          background: rgba(154, 123, 255, 0.14);
        }

        .gm-hero,
        .gm-section,
        .gm-final,
        .gm-footer {
          position: relative;
          z-index: 10;
        }

        .gm-hero {
          min-height: 100svh;
          display: grid;
          align-items: center;
          padding: 120px 24px 150px;
        }

        .gm-hero-inner {
          width: min(1160px, 100%);
          margin: 0 auto;
        }

        .gm-kicker {
          margin: 0 0 24px;
          color: #8fa0c8;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.28em;
        }

        .gm-title {
          max-width: 940px;
          margin: 0;
          color: #ffffff;
          font-size: 112px;
          font-weight: 900;
          line-height: 0.88;
          letter-spacing: 0;
          text-transform: uppercase;
          text-shadow: 0 0 44px rgba(154,123,255,0.34), 0 0 84px rgba(70,230,170,0.16);
        }

        .gm-title span {
          display: block;
          width: max-content;
          max-width: 100%;
          background: linear-gradient(90deg, #46e6aa, #8fd4ff, #9a7bff, #ff60a0, #f0c864);
          background-size: 260% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: gm-hue 9s linear infinite;
        }

        .gm-subtitle {
          max-width: 650px;
          margin: 34px 0 0;
          color: #b7c2dc;
          font-size: 20px;
          line-height: 1.65;
        }

        .gm-hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          margin-top: 42px;
        }

        .gm-primary,
        .gm-secondary {
          display: inline-flex;
          min-height: 52px;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 0 28px;
          font-size: 15px;
          font-weight: 850;
          transition: transform 150ms ease, border-color 150ms ease, background 150ms ease;
        }

        .gm-primary {
          background: linear-gradient(135deg, #46e6aa, #6677ff 48%, #ff60a0);
          color: #ffffff;
          box-shadow: 0 16px 56px rgba(102,119,255,0.34), inset 0 1px 0 rgba(255,255,255,0.42);
        }

        .gm-secondary {
          border: 1px solid rgba(180,205,255,0.2);
          background: rgba(255,255,255,0.055);
          color: #e2e9fb;
        }

        .gm-secondary:hover {
          border-color: rgba(180,205,255,0.44);
          background: rgba(255,255,255,0.095);
        }

        .gm-hero-metrics {
          position: absolute;
          right: 24px;
          bottom: 30px;
          left: 24px;
          display: grid;
          width: min(1160px, calc(100% - 48px));
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          margin: 0 auto;
          border: 1px solid rgba(180,205,255,0.12);
          background: rgba(180,205,255,0.08);
        }

        .gm-hero-metrics div {
          min-height: 82px;
          padding: 16px 18px;
          background: rgba(1,2,7,0.5);
        }

        .gm-hero-metrics strong {
          display: block;
          color: #f5f8ff;
          font-size: 30px;
          line-height: 1;
        }

        .gm-hero-metrics span {
          display: block;
          margin-top: 10px;
          color: #8290b4;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .gm-section {
          width: min(1100px, calc(100% - 48px));
          margin: 0 auto;
          padding: 120px 0;
        }

        .gm-manifesto p {
          max-width: 980px;
          margin: 0;
          color: #eef4ff;
          font-size: 48px;
          font-weight: 820;
          line-height: 1.16;
          letter-spacing: 0;
        }

        .gm-section-head {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 34px;
          margin-bottom: 36px;
          border-top: 1px solid rgba(180,205,255,0.14);
          padding-top: 22px;
        }

        .gm-section-head p {
          margin: 0;
          color: #46e6aa;
          font-family: "SF Mono", "Fira Code", monospace;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.2em;
        }

        .gm-section-head h2 {
          max-width: 700px;
          margin: 0;
          color: #dfe8ff;
          font-size: 34px;
          line-height: 1.15;
          letter-spacing: 0;
        }

        .gm-protocol-row {
          display: grid;
          grid-template-columns: 72px minmax(0, 1fr) minmax(240px, 310px);
          gap: 30px;
          align-items: start;
          padding: 42px 0;
          border-top: 1px solid rgba(180,205,255,0.12);
        }

        .gm-row-num {
          font-size: 15px;
          font-weight: 900;
        }

        .gm-protocol-row h3 {
          margin: 0;
          color: #ffffff;
          font-size: 30px;
          line-height: 1.1;
          letter-spacing: 0;
        }

        .gm-protocol-row p {
          max-width: 610px;
          margin: 14px 0 0;
          color: #aab7d5;
          font-size: 17px;
          line-height: 1.7;
        }

        .gm-protocol-row code {
          width: 100%;
          overflow-wrap: anywhere;
          border: 1px solid rgba(180,205,255,0.13);
          border-radius: 8px;
          padding: 16px;
          background: rgba(4,6,15,0.62);
          color: #9ee7ff;
          font-size: 13px;
          line-height: 1.5;
        }

        .gm-slab {
          display: grid;
          grid-template-columns: 0.9fr 1fr;
          gap: 34px;
          align-items: center;
        }

        .gm-slab-copy p {
          margin: 0;
          color: #fff;
          font-size: 56px;
          font-weight: 900;
          line-height: 1.02;
          letter-spacing: 0;
        }

        .gm-terminal {
          overflow: hidden;
          border: 1px solid rgba(180,205,255,0.16);
          border-radius: 8px;
          background: rgba(2,4,12,0.78);
          box-shadow: 0 28px 90px rgba(0,0,0,0.38);
        }

        .gm-terminal-top {
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid rgba(180,205,255,0.1);
          padding: 12px 14px;
          color: #7f8db2;
          font-size: 11px;
        }

        .gm-terminal-top span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #46e6aa;
        }

        .gm-terminal-top span:nth-child(2) {
          background: #f0c864;
        }

        .gm-terminal-top span:nth-child(3) {
          background: #ff60a0;
          margin-right: 8px;
        }

        .gm-terminal ol {
          margin: 0;
          padding: 20px 24px 24px 54px;
          color: #aebada;
          font-size: 13px;
          line-height: 1.95;
        }

        .gm-terminal li::marker {
          color: #46506d;
        }

        .gm-numbers h2 {
          max-width: 760px;
          margin: 0 0 42px;
          color: #eef4ff;
          font-size: 54px;
          line-height: 1.06;
          letter-spacing: 0;
        }

        .gm-number-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          border: 1px solid rgba(180,205,255,0.12);
          background: rgba(180,205,255,0.08);
        }

        .gm-number-grid article {
          min-height: 260px;
          padding: 24px;
          background: rgba(1,2,7,0.54);
        }

        .gm-number-grid span {
          color: #7f8db2;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        .gm-number-grid strong {
          display: block;
          margin-top: 32px;
          color: #ffffff;
          font-size: 64px;
          line-height: 0.9;
          letter-spacing: 0;
        }

        .gm-number-grid p {
          margin: 34px 0 0;
          color: #aab7d5;
          font-size: 15px;
          line-height: 1.55;
        }

        .gm-origin {
          max-width: 820px;
        }

        .gm-origin h2 {
          margin: 0;
          color: #ffffff;
          font-size: 48px;
          line-height: 1.12;
          letter-spacing: 0;
        }

        .gm-origin p:not(.gm-kicker) {
          margin: 24px 0 0;
          color: #b4c0da;
          font-size: 19px;
          line-height: 1.74;
        }

        .gm-final {
          min-height: 76svh;
          display: grid;
          place-items: center;
          padding: 110px 24px;
          text-align: center;
        }

        .gm-final h2 {
          max-width: 920px;
          margin: 0 auto 34px;
          color: #ffffff;
          font-size: 76px;
          line-height: 0.96;
          letter-spacing: 0;
          text-shadow: 0 0 56px rgba(154,123,255,0.36);
        }

        .gm-final .gm-primary {
          margin: 0 auto;
        }

        .gm-footer {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 14px;
          padding: 28px 24px 34px;
          border-top: 1px solid rgba(180,205,255,0.12);
          color: #7180a2;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
        }

        .gm-footer a {
          color: #9ee7ff;
          text-decoration: none;
        }

        .gm-reveal {
          opacity: 0;
          transform: translateY(34px);
          transition: opacity 900ms cubic-bezier(.2,.7,.2,1), transform 980ms cubic-bezier(.2,.7,.2,1);
        }

        .gm-reveal-on {
          opacity: 1;
          transform: translateY(0);
        }

        ::selection {
          background: rgba(70,230,170,0.28);
        }

        @keyframes gm-hue {
          0% { background-position: 0% 50%; }
          100% { background-position: 260% 50%; }
        }

        @media (max-width: 920px) {
          .gm-title {
            font-size: 78px;
          }

          .gm-manifesto p,
          .gm-slab-copy p,
          .gm-numbers h2,
          .gm-origin h2 {
            font-size: 38px;
          }

          .gm-section-head,
          .gm-protocol-row,
          .gm-slab {
            grid-template-columns: 1fr;
          }

          .gm-protocol-row {
            gap: 18px;
          }

          .gm-number-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 680px) {
          .gm-nav {
            align-items: flex-start;
            padding: 14px;
          }

          .gm-brand {
            max-width: 160px;
            flex-wrap: wrap;
            gap: 4px 8px;
            font-size: 11px;
          }

          .gm-icon-btn small {
            display: none;
          }

          .gm-nav-launch {
            display: none;
          }

          .gm-music-menu {
            right: 0;
          }

          .gm-hero {
            min-height: 100svh;
            padding: 104px 18px 260px;
          }

          .gm-title {
            font-size: 54px;
          }

          .gm-subtitle {
            font-size: 17px;
          }

          .gm-hero-actions {
            align-items: stretch;
            flex-direction: column;
          }

          .gm-primary,
          .gm-secondary {
            width: 100%;
          }

          .gm-hero-metrics {
            width: calc(100% - 36px);
            right: 18px;
            bottom: 22px;
            left: 18px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .gm-hero-metrics div {
            min-height: 74px;
            padding: 13px;
          }

          .gm-hero-metrics strong {
            font-size: 24px;
          }

          .gm-section {
            width: calc(100% - 36px);
            padding: 84px 0;
          }

          .gm-kicker {
            font-size: 10px;
            line-height: 1.6;
          }

          .gm-section-head h2,
          .gm-protocol-row h3 {
            font-size: 27px;
          }

          .gm-manifesto p,
          .gm-slab-copy p,
          .gm-numbers h2,
          .gm-origin h2 {
            font-size: 32px;
          }

          .gm-number-grid {
            grid-template-columns: 1fr;
          }

          .gm-number-grid article {
            min-height: 210px;
          }

          .gm-final h2 {
            font-size: 44px;
          }
        }
      `}</style>
    </main>
  );
}
