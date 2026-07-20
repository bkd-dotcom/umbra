"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "motion/react";
import { fadeUp, revealOnce, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Reveal a block as it scrolls into view (opacity + small rise).
 *
 *  Parallax is OFF by default. A scroll-linked translateY leaves the block at a
 *  fractional pixel offset on a `will-change: transform` GPU layer, which renders
 *  text — especially large serif headings — persistently soft/"blurry" while the
 *  page moves. Crisp text beats a subtle drift. Opt a decorative (non-text) block
 *  back in with `parallax={24}` if you want it. */
export function Reveal({
  children,
  className,
  variants = fadeUp,
  as = "div",
  delay = 0,
  parallax = 0,
}: {
  children: React.ReactNode;
  className?: string;
  variants?: Variants;
  as?: "div" | "section" | "article" | "li" | "span";
  delay?: number;
  parallax?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [parallax, -parallax]);
  const Comp = motion[as];

  const inner = (
    <Comp className={className} variants={variants} {...revealOnce} transition={{ delay }}>
      {children}
    </Comp>
  );

  if (reduce || !parallax) return inner;
  return (
    <motion.div ref={ref} style={{ y }} className="will-change-transform">
      {inner}
    </motion.div>
  );
}

/** Parent that staggers its `<Reveal>` / motion children into view. */
export function RevealGroup({
  children,
  className,
  delayChildren = 0.05,
  gap = 0.09,
}: {
  children: React.ReactNode;
  className?: string;
  delayChildren?: number;
  gap?: number;
}) {
  return (
    <motion.div className={cn(className)} variants={stagger(delayChildren, gap)} {...revealOnce}>
      {children}
    </motion.div>
  );
}
