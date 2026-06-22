import { useState, useEffect, useRef, useCallback } from "react";
import Landing from "./Landing";
import Simulator from "./Simulator";

// =====================================================================
// App shell: hash-routed (GitHub Pages safe) with a "warp into the mesh"
// transition that plays when moving between the landing page and the sim.
// =====================================================================

function routeFromHash() {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h.startsWith("simulator") ? "simulator" : "landing";
}

// Warp overlay: dots streak toward / away from center during a transition.
function Warp({ dir, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2, cy = H / 2;
    const N = 320;
    const stars = Array.from({ length: N }, () => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * Math.hypot(W, H) * 0.5;
      return { a, r, baseR: r, speed: 0.6 + Math.random() * 1.4, hue: 200 + Math.random() * 120 };
    });
    let t0 = performance.now(), raf;
    const DUR = 850;
    const loop = (now) => {
      const t = Math.min(1, (now - t0) / DUR);
      const ease = t * t * (3 - 2 * t);
      ctx.clearRect(0, 0, W, H);
      // grow a dark veil
      const veil = dir === "in" ? ease : 1 - ease;
      ctx.fillStyle = `rgba(5,6,11,${0.2 + veil * 0.8})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        // "in": dots accelerate outward (diving in). "out": settle back.
        const k = dir === "in" ? ease : 1 - ease;
        const r = s.baseR * (1 - k) + (Math.hypot(W, H) * 0.7) * k * s.speed * 0.2 + s.baseR * k * s.speed;
        const x = cx + Math.cos(s.a) * r, y = cy + Math.sin(s.a) * r;
        const len = 4 + k * 26 * s.speed;
        const x2 = cx + Math.cos(s.a) * (r - len), y2 = cy + Math.sin(s.a) * (r - len);
        const [cr, cg, cb] = hsv(s.hue, 0.5, 1);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.5 * (dir === "in" ? ease : 1 - ease)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      }
      // central flash
      const fa = Math.sin(ease * Math.PI) * (dir === "in" ? 0.9 : 0.4);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.4);
      g.addColorStop(0, `rgba(160,140,255,${fa})`); g.addColorStop(1, "rgba(160,140,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      if (t < 1) raf = requestAnimationFrame(loop);
      else onDone && onDone();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dir, onDone]);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none" }} />;
}
function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0];
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash());
  const [warp, setWarp] = useState(null); // null | "in" | "out"
  const pendingRoute = useRef(null);

  // navigate with a warp: "in" when entering the sim, "out" when leaving it
  const navigate = useCallback((target) => {
    if (target === route) return;
    pendingRoute.current = target;
    setWarp(target === "simulator" ? "in" : "out");
  }, [route]);

  // at warp midpoint, swap the route under the overlay
  const onWarpHalf = useCallback(() => {
    const tgt = pendingRoute.current;
    if (tgt) { window.location.hash = tgt === "simulator" ? "#/simulator" : "#/"; setRoute(tgt); }
  }, []);

  // expose navigate to children via window (simple + dependency-free)
  useEffect(() => {
    window.__gmNavigate = navigate;
    const onHash = () => { const r = routeFromHash(); if (r !== route && !pendingRoute.current) setRoute(r); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [navigate, route]);

  return (
    <>
      {route === "landing" ? <Landing /> : <Simulator />}
      {warp && (
        <WarpController dir={warp} onHalf={onWarpHalf} onEnd={() => { setWarp(null); pendingRoute.current = null; }} />
      )}
    </>
  );
}

// Plays warp "in" then immediately "out" so the new page resolves cleanly.
function WarpController({ dir, onHalf, onEnd }) {
  const [stage, setStage] = useState(dir); // first half
  const swapped = useRef(false);
  return (
    <Warp
      dir={stage}
      onDone={() => {
        if (!swapped.current) {
          swapped.current = true;
          onHalf();
          // second half: reverse the warp to reveal the new page
          setStage(s => (s === "in" ? "out" : "in"));
        } else {
          onEnd();
        }
      }}
    />
  );
}
