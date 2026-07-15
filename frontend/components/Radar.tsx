"use client";

import { useEffect, useRef } from "react";

// Animated threat radar (canvas). Shared by the landing hero and the dashboard.
export default function Radar() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx) return;
    let frame = 0;
    let id = 0;
    const paint = () => {
      const s = node.clientWidth;
      const scale = devicePixelRatio;
      node.width = s * scale;
      node.height = s * scale;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const c = s / 2;
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = "rgba(34,211,238,.35)";
      [s * .17, s * .33, s * .49].forEach(r => { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(0, c); ctx.lineTo(s, c); ctx.moveTo(c, 0); ctx.lineTo(c, s); ctx.stroke();
      const gradient = ctx.createConicGradient(frame * .018, c, c);
      gradient.addColorStop(0, "rgba(34,211,238,.37)");
      gradient.addColorStop(.16, "rgba(34,211,238,0)");
      gradient.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(c, c, s * .49, 0, Math.PI * 2); ctx.fill();
      ([[.67, .32, "#fb7185"], [.29, .61, "#facc15"], [.69, .76, "#22d3ee"]] as const).forEach(([x, y, color]) => {
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(s * x, s * y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      });
      frame++;
      id = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(id);
  }, []);
  return <canvas ref={canvas} className="radar-canvas" aria-label="Animated threat radar" />;
}
