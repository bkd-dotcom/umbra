"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";

type Item = { title: string; sub: string; accent: string };

/* Aceternity-style hero parallax: two rows of artifact tiles drift in opposite
   directions as the section scrolls, under a header that lifts and un-tilts.
   Translate-only (cheap on the compositor). Reduced-motion → static rows. */
export function HeroParallax({ items, heading, sub }: { items: Item[]; heading: React.ReactNode; sub?: React.ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const xL = useTransform(scrollYProgress, [0, 1], [40, -160]);
  const xR = useTransform(scrollYProgress, [0, 1], [-160, 40]);
  const headRotate = useTransform(scrollYProgress, [0, 0.35], [10, 0]);
  const headY = useTransform(scrollYProgress, [0, 0.35], [40, 0]);
  const headOpacity = useTransform(scrollYProgress, [0, 0.3], [0.2, 1]);

  const half = Math.ceil(items.length / 2);
  const rows = [items.slice(0, half), items.slice(half)];
  const xFor = [xL, xR];

  return (
    <div ref={ref} className="overflow-hidden" style={{ perspective: "1000px" }}>
      <motion.div style={reduce ? undefined : { rotateX: headRotate, y: headY, opacity: headOpacity }} className="mb-8 max-w-[52ch]">
        {heading}
        {sub && <div className="mt-3 text-[15px] leading-relaxed text-fog">{sub}</div>}
      </motion.div>
      <div className="flex flex-col gap-4">
        {rows.map((row, i) => (
          <motion.div key={i} style={reduce ? undefined : { x: xFor[i] }} className="flex gap-4">
            {row.map((it) => (
              <div key={it.title} className="w-[240px] shrink-0 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 backdrop-blur-md">
                <span className="inline-flex h-2 w-2 rounded-full" style={{ background: it.accent, boxShadow: `0 0 10px ${it.accent}` }} />
                <div className="mt-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-cloud">{it.title}</div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-fog">{it.sub}</div>
              </div>
            ))}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
