"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** The eclipse. Umbra's single background system — a luminous corona ring over a
 *  deep umbra core, sitting on a faint operational grid. Deliberately replaces
 *  the old Aurora + BackgroundBeams + Spotlight + Meteors stack: one intentional
 *  atmosphere instead of four competing effects. Fixed/absolute behind content,
 *  pointer-events-none, and reduced-motion aware (the breathe stops, ring stays). */
export function Corona({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {/* Faint operational grid — reads as a telemetry surface, not decoration. */}
      <div className="absolute inset-0 grid-bg opacity-[0.035]" />

      {/* Low ambient bloom so the ring sits in atmosphere, not on flat black. */}
      <div
        className="absolute left-1/2 top-[-12%] h-[62vh] w-[82vh] -translate-x-1/2 rounded-full blur-[130px]"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.06), transparent 62%)", willChange: "transform" }}
      />

      {/* Umbra core — the total-shadow center deepens the page toward black.
          Dark-mode only: on a cream page a near-black core reads as a grey blob,
          so it's hidden in light mode (see globals.css .corona-core), leaving the
          clean cream + a whisper of the ring. */}
      <div
        className="corona-core absolute left-1/2 top-[-26%] h-[96vh] w-[96vh] -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(2,3,7,0.92) 34%, rgba(2,3,7,0.35) 46%, transparent 60%)" }}
      />

      {/* The corona ring — a thin band of light at the eclipse's edge, gently
          breathing. Cyan bleeding into violet = "live" bleeding into "reasoning". */}
      <motion.div
        className="absolute left-1/2 top-[-26%] h-[96vh] w-[96vh] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, transparent 44%, rgba(34,211,238,0.05) 46.5%, rgba(34,211,238,0.16) 48.8%, rgba(167,139,250,0.07) 51%, transparent 58%)",
          willChange: "transform, opacity",
        }}
        animate={reduce ? undefined : { opacity: [0.72, 1, 0.72], scale: [1, 1.014, 1] }}
        transition={reduce ? undefined : { duration: 13, ease: "easeInOut", repeat: Infinity }}
      />
    </div>
  );
}
