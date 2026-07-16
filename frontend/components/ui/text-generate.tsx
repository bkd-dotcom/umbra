"use client";

import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Aceternity "Text Generate" — words fade + de-blur in, one after another. */
export function TextGenerate({ words, className, delay = 0 }: { words: string; className?: string; delay?: number }) {
  const tokens = words.split(" ");
  return (
    <span className={cn("inline", className)}>
      {tokens.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className="inline-block opacity-0"
          initial={{ opacity: 0, filter: "blur(8px)", y: 8 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: delay + i * 0.06 }}
        >
          {word}
          {i < tokens.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </span>
  );
}
