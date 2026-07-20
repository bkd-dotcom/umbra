import type { Transition, Variants } from "motion/react";

/**
 * One shared motion system so the whole site feels like a single tuned product,
 * not per-component guesses. Import these everywhere instead of hand-writing
 * durations/easings. `prefers-reduced-motion` is respected globally in the
 * SmoothScroll provider (which disables Lenis) and via CSS in globals.css.
 */

// A calm, high-end easing curve (gentle overshoot-free ease-out).
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const spring: Transition = { type: "spring", stiffness: 220, damping: 30, mass: 0.9 };

// NOTE: no `filter: blur()` here. A blur filter on text — even blur(0px) at rest —
// creates a filter surface that renders large serif headings soft on some GPUs,
// and reads as "blurry headings". Opacity + translate only: crisp at every frame.
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.6, ease: EASE } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: EASE } },
};

// Directional + focus variants so each section can enter with its own character.
export const slideLeft: Variants = {
  hidden: { opacity: 0, x: -48 },
  show: { opacity: 1, x: 0, transition: { duration: 0.75, ease: EASE } },
};

export const slideRight: Variants = {
  hidden: { opacity: 0, x: 48 },
  show: { opacity: 1, x: 0, transition: { duration: 0.75, ease: EASE } },
};

// A stronger rise (kept name for callers). No blur, for the same reason as fadeUp.
export const blurRise: Variants = {
  hidden: { opacity: 0, y: 44 },
  show: { opacity: 1, y: 0, transition: { duration: 0.85, ease: EASE } },
};

/** Parent wrapper that staggers its children into view. */
export const stagger = (delayChildren = 0.05, stagger = 0.08): Variants => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren: stagger } },
});

/** Standard "reveal as it scrolls into view" props for a motion element. */
export const revealOnce = {
  initial: "hidden" as const,
  whileInView: "show" as const,
  viewport: { once: true, amount: 0.2 },
};
