import { useRef, useEffect } from "react";

// Animated "AI connecting the dots" network — nodes drift and links form/dissolve.
export function ThinkingCanvas({ active }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf, W, H, cx, cy, R, nodes;

    const setup = () => {
      const size = Math.min(canvas.clientWidth, canvas.clientHeight) || 480;
      W = canvas.width = size * dpr;
      H = canvas.height = size * dpr;
      cx = W / 2; cy = H / 2; R = (size * dpr) * 0.46;
      const N = 44;
      nodes = Array.from({ length: N }, () => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        return {
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          vx: (Math.random() - 0.5) * 0.4 * dpr,
          vy: (Math.random() - 0.5) * 0.4 * dpr,
          rad: (Math.random() * 1.4 + 1.1) * dpr,
          red: Math.random() < 0.6,
          pulse: Math.random() * Math.PI * 2,
        };
      });
    };
    setup();

    const maxDist = 115 * dpr;
    const RED = "230,57,70";
    const INK = "30,30,38";

    const frame = () => {
      ctx.clearRect(0, 0, W, H);

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
        if (d > R) { n.vx -= (dx / d) * 0.03 * dpr; n.vy -= (dy / d) * 0.03 * dpr; }
        n.vx = Math.max(-0.8 * dpr, Math.min(0.8 * dpr, n.vx));
        n.vy = Math.max(-0.8 * dpr, Math.min(0.8 * dpr, n.vy));
        n.pulse += 0.045;
      }

      // connecting lines
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.45;
            ctx.strokeStyle = `rgba(${RED},${alpha})`;
            ctx.lineWidth = 0.7 * dpr;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // nodes with soft glow
      for (const n of nodes) {
        const glow = 0.55 + 0.45 * Math.sin(n.pulse);
        const rr = n.rad * (0.85 + 0.35 * Math.sin(n.pulse));
        const col = n.red ? RED : INK;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr * 3.5);
        g.addColorStop(0, `rgba(${col},${0.85 * glow})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr * 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${col},${Math.min(1, glow + 0.2)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };
    frame();

    const onResize = () => setup();
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [active]);

  return <canvas ref={ref} className="w-full h-full" data-testid="thinking-canvas" />;
}
