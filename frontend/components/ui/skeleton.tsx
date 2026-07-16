import { cn } from "@/lib/utils";

/** Shimmer placeholder shown while real data is in flight — so nothing ever
 *  displays a stale/fake value. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-white/[0.04]",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[skeleton_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent",
        className,
      )}
    >
      <style>{`@keyframes skeleton{100%{transform:translateX(100%)}}`}</style>
    </div>
  );
}
