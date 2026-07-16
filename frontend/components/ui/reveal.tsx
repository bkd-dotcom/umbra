"use client";

import { motion, type Variants } from "motion/react";
import { fadeUp, revealOnce, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Reveal a block as it scrolls into view, using the shared motion tokens so the
 *  whole site animates as one system. */
export function Reveal({
  children,
  className,
  variants = fadeUp,
  as = "div",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  variants?: Variants;
  as?: "div" | "section" | "article" | "li" | "span";
  delay?: number;
}) {
  const Comp = motion[as];
  return (
    <Comp className={className} variants={variants} {...revealOnce} transition={{ delay }}>
      {children}
    </Comp>
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
