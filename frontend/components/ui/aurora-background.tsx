"use client";

import { cn } from "@/lib/utils";

/** Soft, slowly-drifting "southern lights" glow. Layer it behind a section as an
 *  absolute-positioned backdrop. */
export function Aurora({ className, intensity = 0.5 }: { className?: string; intensity?: number }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {/* willChange:transform promotes each blob to its own GPU layer so the huge
          blur rasterizes once and the drift is a cheap composite (no per-frame
          re-raster) — keeps scrolling smooth. */}
      <div
        className="absolute -left-[10%] -top-[20%] h-[55vh] w-[55vh] rounded-full blur-[120px] animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(124,58,237,0.55), transparent 62%)", opacity: intensity, willChange: "transform" }}
      />
      <div
        className="absolute right-[-8%] top-[6%] h-[48vh] w-[48vh] rounded-full blur-[120px] animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(14,116,144,0.5), transparent 62%)", opacity: intensity, animationDelay: "-8s", animationDirection: "alternate-reverse", willChange: "transform" }}
      />
      <div
        className="absolute left-[30%] top-[38%] h-[42vh] w-[42vh] rounded-full blur-[130px] animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.30), transparent 60%)", opacity: intensity * 0.8, animationDelay: "-15s", willChange: "transform" }}
      />
    </div>
  );
}
