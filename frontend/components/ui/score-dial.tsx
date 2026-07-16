"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView } from "motion/react";

/** Animated radial score dial. The ring fills and the number counts up to the
 *  real value when it enters view / when the value changes — so the user sees
 *  the score become real rather than reading a static number. */
export function ScoreDial({ value, label = "UMBRA SCORE" }: { value: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(0);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(100, value));

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, target, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, target]);

  const band = target >= 80 ? "RESILIENT" : target >= 55 ? "GUARDED" : target >= 30 ? "EXPOSED" : "CRITICAL";
  const color = target >= 80 ? "#5eead4" : target >= 55 ? "#22d3ee" : target >= 30 ? "#fbbf24" : "#fb7185";

  return (
    <div ref={ref} className="flex items-center gap-5">
      <div className="relative h-[132px] w-[132px]">
        <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
          <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
          <motion.circle
            cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: inView ? circ - (circ * display) / 100 : circ }}
            style={{ filter: `drop-shadow(0 0 8px ${color}88)` }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-serif text-4xl leading-none">{display}</div>
            <div className="mt-0.5 text-[9px] text-fog">/ 100</div>
          </div>
        </div>
      </div>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">{label}</p>
        <p className="mt-1 font-mono text-sm font-semibold tracking-[0.12em]" style={{ color }}>{band}</p>
      </div>
    </div>
  );
}
