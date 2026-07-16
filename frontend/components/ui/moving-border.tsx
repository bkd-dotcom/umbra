"use client";

import { cn } from "@/lib/utils";

/** A card whose border has a light travelling around it (Aceternity "Moving
 *  Border"), implemented with a masked conic-gradient so it stays cheap. */
export function MovingBorderCard({
  children,
  className,
  containerClassName,
  duration = 6,
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  duration?: number;
}) {
  return (
    <div className={cn("relative rounded-2xl p-px", containerClassName)}>
      <span
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-70"
        style={{
          background:
            "conic-gradient(from var(--angle), transparent 0%, transparent 70%, #22d3ee 82%, #a78bfa 92%, transparent 100%)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "1px",
          animation: `mb-spin ${duration}s linear infinite`,
        }}
      />
      <div className={cn("relative rounded-2xl border border-[color:var(--surface-border)] bg-ink-2/80 backdrop-blur-xl", className)}>
        {children}
      </div>
      <style>{`@property --angle{syntax:'<angle>';inherits:false;initial-value:0deg}@keyframes mb-spin{to{--angle:360deg}}`}</style>
    </div>
  );
}
