import { cn } from "@/lib/utils";

// Text color is a theme-aware CSS var (bright on dark, dark on cream) so HIGH/
// CRITICAL stay legible in light mode; the low-opacity border/bg tints read fine
// in both themes and stay as-is.
const TONE: Record<string, string> = {
  critical: "border-rose-400/40 bg-rose-400/10 text-[color:var(--sev-critical)]",
  high: "border-orange-400/40 bg-orange-400/10 text-[color:var(--sev-high)]",
  medium: "border-amber-400/40 bg-amber-400/10 text-[color:var(--sev-medium)]",
  low: "border-sky-400/40 bg-sky-400/10 text-[color:var(--sev-low)]",
  unknown: "border-[color:var(--surface-border)] bg-[color:var(--surface-2)] text-fog",
};

export function SeverityChip({ severity }: { severity?: string }) {
  const key = (severity ?? "unknown").toLowerCase();
  return (
    <span className={cn("rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em]", TONE[key] ?? TONE.unknown)}>
      {key}
    </span>
  );
}
