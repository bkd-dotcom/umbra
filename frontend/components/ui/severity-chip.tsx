import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  critical: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  high: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  medium: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  low: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  unknown: "border-white/15 bg-white/5 text-fog",
};

export function SeverityChip({ severity }: { severity?: string }) {
  const key = (severity ?? "unknown").toLowerCase();
  return (
    <span className={cn("rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em]", TONE[key] ?? TONE.unknown)}>
      {key}
    </span>
  );
}
