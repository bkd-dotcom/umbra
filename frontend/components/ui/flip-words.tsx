"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Aceternity "Flip Words" — cycles phrases cleanly. The widest word reserves
 *  width and a fixed box reserves height so the surrounding line never reflows.
 *  Uses AnimatePresence mode="wait": the outgoing phrase fully leaves (quick
 *  blur + fade + small rise) BEFORE the next arrives, so two phrases are never
 *  on screen at once. Overlapping them looked garbled because the phrases have
 *  very different widths ("reviews PRs" vs "answers your codebase"); sequencing
 *  the exit/enter keeps it a smooth dissolve without a hard "on/off" pop. */
export function FlipWords({ words, className, interval = 3000 }: { words: string[]; className?: string; interval?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  // Reserve space for the longest word so the surrounding line never reflows.
  const widest = useMemo(() => words.reduce((a, b) => (b.length > a.length ? b : a), ""), [words]);

  return (
    <span className={cn("relative inline-grid align-baseline", className)}>
      {/* invisible sizer holds the box at the widest word */}
      <span className="invisible col-start-1 row-start-1 whitespace-nowrap">{widest}</span>
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={words[i]}
          initial={{ opacity: 0, y: "0.4em", filter: "blur(5px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.35, ease: EASE } }}
          exit={{ opacity: 0, y: "-0.4em", filter: "blur(5px)", transition: { duration: 0.25, ease: EASE } }}
          className="col-start-1 row-start-1 inline-block whitespace-nowrap"
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
