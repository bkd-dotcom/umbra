"use client";

import { useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/* Aceternity-style "comet" card: mouse-tracked 3D tilt with a light sheen that
   trails the cursor. Wraps any content; theme-agnostic. Under reduced-motion it
   is a plain static container (no transform, no listeners doing work). */
export function CometCard({
  children,
  className,
  intensity = 9,
}: {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ rx: 0, ry: 0, mx: 50, my: 50 });
  const [hovered, setHovered] = useState(false);

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setT({ ry: (px - 0.5) * intensity * 2, rx: -(py - 0.5) * intensity * 2, mx: px * 100, my: py * 100 });
  };
  const reset = () => { setHovered(false); setT({ rx: 0, ry: 0, mx: 50, my: 50 }); };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={reset}
      style={{ perspective: 900 }}
      className={cn("h-full", className)}
    >
      <div
        className="relative h-full w-full rounded-2xl transition-transform duration-150 ease-out will-change-transform"
        style={reduce ? undefined : { transform: `rotateX(${t.rx}deg) rotateY(${t.ry}deg)`, transformStyle: "preserve-3d" }}
      >
        {children}
        {!reduce && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-200"
            style={{
              opacity: hovered ? 1 : 0,
              background: `radial-gradient(420px circle at ${t.mx}% ${t.my}%, rgba(120,200,255,0.14), transparent 42%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}
