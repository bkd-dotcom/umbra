"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence, useScroll, useTransform, useReducedMotion } from "motion/react";

type Item = { title: string; sub: string; accent: string };

/* Aceternity-style hero parallax: two rows of artifact tiles drift in opposite
   directions as the section scrolls, under a header that lifts and un-tilts.
   Translate-only (cheap on the compositor). Reduced-motion → static rows. */
export function HeroParallax({ items, heading, sub }: { items: Item[]; heading: React.ReactNode; sub?: React.ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Subtle, clamped drift only. The old ±160px range pushed the first/last real
  // card out of the overflow-hidden container (Watchman was cropped). ±36px reads
  // as parallax without ever moving a card outside the readable area; combined with
  // the row's horizontal padding, no specialist card is ever clipped at any width.
  const xL = useTransform(scrollYProgress, [0, 1], [36, -36]);
  const xR = useTransform(scrollYProgress, [0, 1], [-36, 36]);
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
      {/* At phone/tablet widths the parallax rows would clip; show a self-advancing
          carousel that cycles one specialist at a time (fade + subtle settle), so
          the roster is presented automatically without manual clicking. */}
      <div className="lg:hidden">
        <SpecialistCarousel items={items} reduce={!!reduce} />
      </div>

      {/* Desktop rows scroll horizontally within their own bounds; px-10 keeps the
          first and last card fully readable even at the drift extremes, and the
          rows themselves can scroll internally on the rare narrow-desktop case
          rather than cropping a real card. */}
      <div className="hidden flex-col gap-4 px-10 lg:flex">
        {rows.map((row, i) => (
          <motion.div key={i} style={reduce ? undefined : { x: xFor[i] }} className="flex gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

/* Self-advancing specialist carousel (mobile/tablet). Auto-cycles every 3.4s with
   a fade + subtle vertical settle in a css-grid shell (both slides share one cell
   so nothing is clipped and the frame is never blank). Pauses on hover/focus,
   stops under reduced-motion, and exposes dots for direct, accessible selection. */
function SpecialistCarousel({ items, reduce }: { items: Item[]; reduce: boolean }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = items.length;

  useEffect(() => {
    if (reduce || paused || total <= 1) return;
    const t = setTimeout(() => setActive((p) => (p + 1) % total), 2500);
    return () => clearTimeout(t);
  }, [active, paused, reduce, total]);

  if (total === 0) return null;
  const it = items[active];

  return (
    <div
      className="w-full min-w-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      role="group"
      aria-roledescription="carousel"
      aria-label="Night crew specialists"
    >
      {/* Eyebrow — matches the section-label pattern used elsewhere (dot + label). */}
      <p className="mb-3 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
        <span className="h-1.5 w-1.5 rounded-full bg-violet shadow-[0_0_8px_#a78bfa]" /> Specialists on shift
      </p>
      {/* Fixed height so the window never expands/jumps between specialists. */}
      <div className="grid h-[176px] overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]">
        <AnimatePresence initial={false}>
          <motion.div
            key={it.title}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col p-5 [grid-area:1/1]"
          >
            <span className="inline-flex h-2 w-2 rounded-full" style={{ background: it.accent, boxShadow: `0 0 10px ${it.accent}` }} />
            <div className="mt-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-cloud">{it.title}</div>
            <div className="mt-2 text-[14px] leading-relaxed text-fog">{it.sub}</div>
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite">Specialist {active + 1} of {total}: {it.title}</p>

      {/* Segmented progress + direct selection dots. */}
      <div className="mt-4 flex items-center justify-center gap-2" role="tablist" aria-label="Select a specialist">
        {items.map((s, i) => {
          const on = i === active;
          return (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={s.title}
              onClick={() => setActive(i)}
              className="h-1.5 rounded-full transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
              style={{ width: on ? 26 : 10, background: on ? s.accent : "var(--surface-border)", boxShadow: on ? `0 0 8px ${s.accent}` : "none" }}
            />
          );
        })}
      </div>
    </div>
  );
}
