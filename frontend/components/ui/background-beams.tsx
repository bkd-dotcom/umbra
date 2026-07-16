"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * BackgroundBeams — Aceternity "Background Beams".
 *
 * A fan of curved SVG rails with bright gradient bands that travel along them.
 * Deterministic (no Math.random) so the static export prerender and the client
 * hydration match, and reduced-motion aware: when the user prefers reduced
 * motion, only the faint static rails render (no travelling light).
 *
 * Meant to sit in a `fixed inset-0 -z-10 pointer-events-none` wrapper behind the
 * page content; `preserveAspectRatio="none"` lets it stretch to any viewport.
 */

const COLORS = ["#22d3ee", "#a78bfa", "#5eead4"];

const BEAMS = Array.from({ length: 18 }, (_, i) => {
  const startX = 30 + i * 55;
  const c1x = startX + ((i % 5) - 2) * 70;
  const c2x = startX + ((i % 3) - 1) * 90;
  const endX = startX + ((i % 7) - 3) * 55;
  return {
    id: `beam-${i}`,
    d: `M ${startX} -120 C ${c1x} 260, ${c2x} 560, ${endX} 1120`,
    duration: 6 + (i % 5) * 1.7,
    delay: (i % 9) * 0.8,
    color: COLORS[i % COLORS.length],
  };
});

export function BackgroundBeams({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden>
      <svg
        className="h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 1000 1000"
        fill="none"
        preserveAspectRatio="none"
      >
        {/* Faint static rails — always visible. */}
        {BEAMS.map((b) => (
          <path key={`${b.id}-rail`} d={b.d} stroke="var(--surface-border)" strokeOpacity="0.35" strokeWidth="1" />
        ))}
        {/* Travelling light bands. The paths always render (so SSR and client DOM
            match); under reduced-motion the gradient simply stays parked off-screen
            above the viewBox, leaving the band invisible instead of animating. */}
        {BEAMS.map((b) => (
          <path key={b.id} d={b.d} stroke={`url(#${b.id})`} strokeWidth="1.6" strokeLinecap="round" />
        ))}
        <defs>
          {BEAMS.map((b) => (
            <motion.linearGradient
              key={b.id}
              id={b.id}
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="0"
              initial={{ y1: -320, y2: -160 }}
              animate={reduce ? undefined : { y1: [-320, 1300], y2: [-160, 1460] }}
              transition={{ duration: b.duration, delay: b.delay, repeat: Infinity, ease: "easeInOut", repeatDelay: b.duration * 0.5 }}
            >
              <stop stopColor={b.color} stopOpacity="0" />
              <stop offset="0.45" stopColor={b.color} />
              <stop offset="0.55" stopColor={b.color} />
              <stop offset="1" stopColor={b.color} stopOpacity="0" />
            </motion.linearGradient>
          ))}
        </defs>
      </svg>
    </div>
  );
}
