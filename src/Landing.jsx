import { useRef, useEffect, useState } from "react";

// =====================================================================
// GUARDIAN MESH - landing page
// Scroll-driven, cinematic. A living gravity-grid canvas sits behind
// everything and reacts to scroll + cursor; sections reveal on scroll;
// a Launch Simulator CTA drops the visitor into the playable build.
// =====================================================================

const VIOLET = [150, 130, 255], TEAL = [70, 230, 170], AMBER = [240, 200, 100], CYAN = [110, 200, 255];

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
        { bx: 0.74, by: 0.32, mass: 1.0, col: TEAL },
        { bx: 0.68, by: 0.7, mass: 1.2, col: AMBER },
        { bx: 0.3, by: 0.72, mass: 0.9, col: CYAN },
        { bx: 0.85, by: 0.55, mass: 0.8, col: TEAL },
        { bx: 0.15, by: 0.55, mass: 0.8, col: AMBER },
      ];
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
      const w = S.w, h = S.h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#05060b"; ctx.fillRect(0, 0, w, h);

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
            const pull = wl.mass * 40 / (dd + 150);
            pX += nx * pull / dd; pY += ny * pull / dd;
            const tw = wl.mass / (dd * 0.006 + 1);
            tR += wl.col[0] * tw; tG += wl.col[1] * tw; tB += wl.col[2] * tw; tW += tw;
          }
          const cxw = S.mouse.x - bx, cyw = S.mouse.y - by, cd = Math.hypot(cxw, cyw);
          if (cd > 1 && cd < 320) { const cp = 26 / (cd + 120); pX += cxw * cp; pY += cyw * cp; }
          const flow = Math.sin(S.time * 0.5 + gx * 0.35 + gy * 0.3) * 1.6;
          pX += flow; pY += Math.cos(S.time * 0.45 + gx * 0.3) * 1.6;
          const hue = (baseHue + gx * 0.4 + gy * 0.4) % 360;
          let [dr, dg, db] = hsv(hue, 0.2, 0.42);
          if (tW > 0.01) { const amt = Math.min(tW * 0.022, 0.75); dr = dr + (tR / tW - dr) * amt; dg = dg + (tG / tW - dg) * amt; db = db + (tB / tW - db) * amt; }
          const pd = Math.hypot(pX, pY), alpha = Math.min(0.82, 0.22 + pd * 0.045);
          const sz = Math.min(2.6, 1.0 + pd * 0.04);
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

      // vignette
      const vg = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; window.removeEventListener("resize", resize); window.removeEventListener("mousemove", onMove); window.removeEventListener("scroll", onScroll); };
  }, []);

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
        <button onClick={launch} style={{ background: "rgba(154,123,255,0.12)", border: "1px solid rgba(154,123,255,0.4)", color: "#c9bcff", padding: "8px 18px", borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: mono, letterSpacing: 1 }}>LAUNCH ↗</button>
      </nav>

      {/* HERO */}
      <section style={{ position: "relative", zIndex: 10, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 24px" }}>
        <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: 6, color: "#7d8db4", marginBottom: 28, animation: "fadeUp 1.2s ease both" }}>WHEN THE TOWERS FALL</div>
        <h1 style={{ fontSize: "clamp(44px, 9vw, 128px)", fontWeight: 800, lineHeight: 0.95, letterSpacing: -2, margin: 0, background: "linear-gradient(180deg,#ffffff,#9fb0d6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "fadeUp 1.2s .1s ease both" }}>
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
        html { scroll-behavior: smooth; }
        body { margin:0; }
        ::selection { background: rgba(154,123,255,0.3); }
      `}</style>
    </div>
  );
}
