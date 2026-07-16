"use client";

import { cn } from "@/lib/utils";

/** Aceternity "Meteors" — streaking lights across a container. Deterministic
 *  offsets (no Math.random at module load) so SSR/export output is stable. */
export function Meteors({ number = 16, className }: { number?: number; className?: string }) {
  const meteors = Array.from({ length: number }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {meteors.map((i) => {
        const left = (i / number) * 120 - 10; // spread across (and past) the edges
        const delay = (i % 5) * 0.9 + (i % 3) * 0.4;
        const duration = 4 + (i % 4);
        return (
          <span
            key={i}
            className={cn(
              "absolute top-1/2 left-1/2 h-0.5 w-0.5 rotate-[215deg] rounded-full bg-slate-300 shadow-[0_0_0_1px_#ffffff10] animate-meteor",
              "before:absolute before:top-1/2 before:h-px before:w-[52px] before:-translate-y-1/2 before:bg-gradient-to-r before:from-slate-400 before:to-transparent",
              className,
            )}
            style={{ left: `${left}%`, animationDelay: `${delay}s`, animationDuration: `${duration}s` }}
          />
        );
      })}
    </div>
  );
}
