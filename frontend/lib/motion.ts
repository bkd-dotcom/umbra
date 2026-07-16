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

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.6, ease: EASE } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: EASE } },
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
