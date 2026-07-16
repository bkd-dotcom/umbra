"use client";

import { useEffect, useRef } from "react";

export type Blip = { x: number; y: number; color: string };

// Deterministic demo blips for the landing hero.
const DEMO_BLIPS: Blip[] = [
  { x: 0.67, y: 0.32, color: "#fb7185" },
  { x: 0.29, y: 0.61, color: "#facc15" },
  { x: 0.69, y: 0.76, color: "#22d3ee" },
];

// Animated threat radar (canvas). Shared by the landing hero and the dashboard;
// the dashboard passes real blips derived from the scan's severity mix.
export default function Radar({ blips = DEMO_BLIPS, className = "h-[194px] w-[194px]" }: { blips?: Blip[]; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const blipsRef = useRef(blips);
  blipsRef.current = blips;

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
      [s * 0.17, s * 0.33, s * 0.49].forEach((r) => { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(0, c); ctx.lineTo(s, c); ctx.moveTo(c, 0); ctx.lineTo(c, s); ctx.stroke();
      const gradient = ctx.createConicGradient(frame * 0.018, c, c);
      gradient.addColorStop(0, "rgba(34,211,238,.37)");
      gradient.addColorStop(0.16, "rgba(34,211,238,0)");
      gradient.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(c, c, s * 0.49, 0, Math.PI * 2); ctx.fill();
      blipsRef.current.forEach(({ x, y, color }) => {
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(s * x, s * y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      });
      frame++;
      id = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(id);
  }, []);
  return <canvas ref={canvas} className={className} aria-label="Animated threat radar" />;
}
