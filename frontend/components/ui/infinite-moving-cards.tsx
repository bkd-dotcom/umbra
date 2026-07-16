"use client";

import { cn } from "@/lib/utils";

/** Aceternity "Infinite Moving Cards" — an endlessly looping marquee row. The
 *  track is duplicated so the -50% translate loops seamlessly. Pauses on hover. */
export function InfiniteMovingCards({ items, className }: { items: React.ReactNode[]; className?: string }) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]",
        className,
      )}
    >
      <div className="flex w-max gap-4 animate-marquee group-hover:[animation-play-state:paused]">
        {[...items, ...items].map((item, i) => (
          <div key={i} className="shrink-0">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
