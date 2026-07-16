"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";

/**
 * SegmentedTabs — Aceternity animated "Tabs".
 *
 * A segmented control whose active-state pill slides between options with a
 * shared-layout animation (motion `layoutId`) instead of hard-swapping colors.
 * Each independent group must pass a unique `layoutId` so the highlight animates
 * only within its own group.
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] p-0.5 text-[12px]",
        className,
      )}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="relative rounded-md px-3 py-1.5 font-mono outline-none"
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={spring}
                className="absolute inset-0 rounded-md border border-cyan/30 bg-cyan/15 shadow-[0_0_18px_-6px_var(--color-cyan)]"
              />
            )}
            <span className={cn("relative z-10 transition-colors", active ? "text-cyan" : "text-fog hover:text-cloud")}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
