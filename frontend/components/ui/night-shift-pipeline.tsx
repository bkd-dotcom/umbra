"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PROOF_SCAN, PROOF_REPO } from "@/lib/proof-scan";
import {
  ArtifactShell,
  CREW,
  providerStatus,
  StatusPill,
  statusFor,
  toneColor,
  type AgentRun,
  type Mode,
  type ScanResult,
  type Status,
} from "@/components/ui/shift-primitives";
import { SeverityChip } from "@/components/ui/severity-chip";
import { ScoreDial } from "@/components/ui/score-dial";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";

/* -----------------------------------------------------------------------------
   Night Shift Pipeline — a sticky, scroll-driven replay of Umbra's six-stage
   night shift, driven ENTIRELY by a real captured scan (PROOF_SCAN by default).

   A numbered left rail tracks the active stage with a scroll-linked progress beam
   that warms cyan → violet → amber (02:00 → 06:00). A single persistent "Umbra
   console" on the right cross-swaps its body per stage:
     01 Scan · 02 Triage · 03 Root cause · 04 Draft fix · 05 Evidence · 06 Gate

   HONESTY: every number, advisory, provider label and diff line comes from the
   real result. Provider pills are labelled by the single-sourced statusFor /
   providerStatus (LIVE / CACHE / SAMPLE) — a stage the crew didn't actually run
   (e.g. Detective git-blame in the captured shift) is chipped SAMPLE, never LIVE.

   PERF/A11Y: transform + opacity + colour only (no layout/filter thrash, no
   filter:blur on text). Under reduced-motion OR below lg, the whole pinned path
   is replaced by <StaticStack/> — all six stages rendered as plain DOM so the
   global reduced-motion transform-kill can never hide content.
----------------------------------------------------------------------------- */

type Line = { kind: "ctx" | "del" | "add"; text: string };

/** Pick the most human-readable file in a unified diff so the Draft-fix stage
 *  never falls back to empty on a live fix: prefer a known manifest, else the
 *  first non-lockfile, else the first file present. */
function pickDiffFile(diff: string): string {
  const files: string[] = [];
  for (const raw of (diff ?? "").split("\n")) {
    const m = raw.match(/^diff --git a\/.+ b\/(.+)$/);
    if (m) files.push(m[1]);
  }
  if (!files.length) return "";
  const isLock = (f: string) => /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|Gemfile\.lock|go\.sum)$/.test(f);
  const isManifest = (f: string) => /(package\.json|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|build\.gradle|pom\.xml|composer\.json)$/.test(f);
  return files.find(isManifest) ?? files.find((f) => !isLock(f)) ?? files[0];
}

/** Extract one file's hunk from a unified diff into typed lines (no external lib). */
function parseDiffHunk(diff: string, file: string): Line[] {
  const out: Line[] = [];
  let inFile = false;
  let inHunk = false;
  for (const raw of (diff ?? "").split("\n")) {
    if (raw.startsWith("diff --git")) {
      inFile = file ? raw.includes(` b/${file}`) : false;
      inHunk = false;
      continue;
    }
    if (!inFile) continue;
    if (raw.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk) continue; // skip index / --- / +++ headers (they precede @@)
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1) });
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1) });
    else out.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw });
  }
  // Diffs end with a trailing newline → drop any trailing blank context rows.
  while (out.length && out[out.length - 1].kind === "ctx" && out[out.length - 1].text.trim() === "") out.pop();
  return out;
}

type Derived = {
  deps: { name: string; version: string; vulnerable?: boolean }[];
  flagged?: string; // "next@14.2.5"
  flaggedCount: number;
  vulnCount: number;
  mediumCount: number;
  highCount: number;
  criticalCount: number;
  lowCount: number;
  topVuln?: { cve: string; summary?: string; severity: string };
  diffLines: Line[];
  diffFile: string;
  reviewerRisk?: number;
  reviewerRec?: string;
  score: number;
  runId?: string;
  autonomyLabel: string;
  autonomyLevel: number;
  verification: { text: string; ok: boolean }[];
  detectiveRan: boolean;
  osvStatus: Status;
  codexStatus: Status;
  reviewerStatus: Status;
};

function deriveScan(scan: ScanResult, mode: Mode): Derived {
  const runs = new Map((scan.agent_results ?? []).map((r) => [r.agent, r] as const));
  const watchman = runs.get("watchman");
  const reviewer = runs.get("reviewer");
  const vulns = scan.vulnerabilities ?? [];
  const sev = (s: string) => (s ?? "").toLowerCase();
  const deps = (scan.dependencies ?? []).map((d) => ({ name: d.name ?? "—", version: d.version ?? "", vulnerable: d.vulnerable }));
  const flaggedDep = deps.find((d) => d.vulnerable);
  const top =
    vulns.find((v) => sev(v.severity) === "critical") ??
    vulns.find((v) => sev(v.severity) === "high") ??
    vulns[0];
  const reviewerFinding = (reviewer?.findings?.[0] ?? {}) as { risk_score?: number; recommendation?: string };
  const verification = (scan.reasoning_summary ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("- `"))
    .map((l) => {
      const text = l.trim().replace(/^-\s*/, "").replace(/`/g, "");
      const ok = !/blocked|could not|couldn.t|failed|error/i.test(text);
      return { text, ok };
    });
  const wp = watchman?.replay?.providers ?? {};
  const diffStr = watchman?.replay?.codex_diff ?? "";
  const diffFile = pickDiffFile(diffStr);
  return {
    deps,
    flagged: flaggedDep ? `${flaggedDep.name}@${flaggedDep.version}` : undefined,
    flaggedCount: deps.filter((d) => d.vulnerable).length,
    vulnCount: vulns.length,
    mediumCount: vulns.filter((v) => sev(v.severity) === "medium").length,
    highCount: vulns.filter((v) => sev(v.severity) === "high").length,
    criticalCount: vulns.filter((v) => sev(v.severity) === "critical").length,
    lowCount: vulns.filter((v) => sev(v.severity) === "low").length,
    topVuln: top ? { cve: top.cve, summary: top.summary, severity: top.severity } : undefined,
    diffLines: parseDiffHunk(diffStr, diffFile),
    diffFile,
    reviewerRisk: reviewerFinding.risk_score,
    reviewerRec: reviewerFinding.recommendation,
    score: scan.umbra_score ?? 0,
    runId: scan.run_id,
    autonomyLabel: scan.autonomy?.label ?? "Prepare diff",
    autonomyLevel: scan.autonomy?.level ?? 1,
    verification,
    detectiveRan: (scan.live_agents ?? []).includes("detective") || runs.has("detective"),
    osvStatus: providerStatus(wp.vulnerabilities, mode),
    codexStatus: providerStatus(wp.engineering, mode),
    reviewerStatus: statusFor(CREW[1], reviewer, mode, false),
  };
}

type Stage = { n: number; rail: string; desc: string; time: string; accent: string };
const STAGES: Stage[] = [
  { n: 1, rail: "Scan", desc: "Watchman reads the resolved lockfile against OSV.dev", time: "02:00", accent: "#22d3ee" },
  { n: 2, rail: "Triage", desc: "Scored, grouped by package, ranked by severity", time: "02:45", accent: "#a78bfa" },
  { n: 3, rail: "Root cause", desc: "Detective traces how it got in — git blame", time: "03:30", accent: "#fbbf24" },
  { n: 4, rail: "Draft fix", desc: "Codex proposes a branch-only diff", time: "04:10", accent: "#5eead4" },
  { n: 5, rail: "Evidence", desc: "Provider ledger + hashable evidence pack", time: "04:45", accent: "#5eead4" },
  { n: 6, rail: "Human gate", desc: "Reviewer assesses — you merge, never Umbra", time: "05:15", accent: "#5eead4" },
];

// Semantic scenes — ONE dominant station per scene, so a desktop viewport never
// shows two equal-weight station panels at once. No copy is duplicated (each
// station's card appears in exactly one scene). Kept in station order; the intro
// rides on scene 0. All six single-station scenes fit one viewport comfortably.
// `monitor` labels the Operations Monitor top bar per scene (evidence type +
// honesty tone) — a visual container only, never fake controls.
export const PIPELINE_SCENES: {
  key: string; label: string; stages: number[]; fit?: boolean;
  monitor: { context: string; tone: "scan" | "captured" | "sample" | "diff" | "receipt" | "gate" };
}[] = [
  { key: "pipeline-scan", label: "Scan", stages: [0], fit: true, monitor: { context: "operator log · watchman", tone: "scan" } },
  { key: "pipeline-triage", label: "Triage", stages: [1], fit: true, monitor: { context: "osv.dev advisories · captured", tone: "captured" } },
  { key: "pipeline-rootcause", label: "Root cause", stages: [2], fit: true, monitor: { context: "git history · blame", tone: "sample" } },
  { key: "pipeline-draft", label: "Draft fix", stages: [3], fit: true, monitor: { context: "codex diff · branch-only", tone: "diff" } },
  { key: "pipeline-evidence", label: "Evidence", stages: [4], fit: true, monitor: { context: "provider ledger · receipt", tone: "receipt" } },
  { key: "pipeline-gate", label: "Human gate", stages: [5], fit: true, monitor: { context: "authority decision · human gate", tone: "gate" } },
];

export function NightShiftPipeline({
  result,
  mode = "captured",
  className,
  scene,
}: {
  result?: ScanResult;
  mode?: Mode;
  className?: string;
  /** When set, render only one semantic scene (natural document flow, no pinned
   *  scroll track). The landing uses this to compose viewport-sized chapters that
   *  scroll continuously under Lenis. The intro rides on scene 0. */
  scene?: number;
}) {
  const scan = useMemo(() => result ?? (PROOF_SCAN as unknown as ScanResult), [result]);
  const D = useMemo(() => deriveScan(scan, mode), [scan, mode]);

  // Scene mode: a single narrative beat rendered as a natural, non-pinned stack.
  // A left timeline column gives editorial "where in the night shift am I" context
  // (time · NN/06 · a restrained 6-dot vertical line marking the current station).
  // Purely informational — it never controls scroll.
  if (typeof scene === "number") {
    const def = PIPELINE_SCENES[scene];
    if (!def) return null;
    const i = def.stages[0];
    const stage = STAGES[i];
    return (
      <div className={cn("relative", className)}>
        {scene === 0 && <Intro mode={mode} />}
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)] lg:grid-cols-[168px_minmax(0,1fr)] lg:gap-8">
          {/* Editorial shift timeline — time, position, and a static 6-station line.
              The active station is emphasized by color/opacity only (no motion). */}
          <ShiftTimeline current={i} accent={stage.accent} />
          {/* The one dominant station for this scene, framed as an Operations
              Monitor: a restrained dark surface with a thin top bar (status dot +
              repo/context label). Container only — no clickable controls, no nav. */}
          <div className="flex flex-col gap-5">
            {def.stages.map((s) => (
              <OperationsMonitor key={STAGES[s].n} accent={STAGES[s].accent} context={def.monitor.context} tone={def.monitor.tone} clock={STAGES[s].time}>
                <div className="mb-3 flex items-baseline gap-3">
                  <span className="font-serif text-2xl leading-none" style={{ color: STAGES[s].accent }}>{String(STAGES[s].n).padStart(2, "0")}</span>
                  <div>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cloud">{STAGES[s].rail}</div>
                    <div className="font-mono text-[11px] text-fog">{STAGES[s].desc}</div>
                  </div>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-fog/70">{STAGES[s].time}</span>
                </div>
                <StagePanel index={s} D={D} mode={mode} still />
              </OperationsMonitor>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Full mode (unused by the landing now): a natural static stack of all stations.
  // The old pinned h-[560vh] scroll-transform track was removed — it fought Lenis
  // and forced a multi-viewport chapter. This keeps a single honest fallback.
  return (
    <div className={cn("relative", className)}>
      <Intro mode={mode} />
      <StaticStack D={D} mode={mode} />
    </div>
  );
}

function Intro({ mode }: { mode: Mode }) {
  return (
    <div className="mb-8 max-w-[64rem]">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> The night shift · six stations
        {mode === "captured" && (
          <span className="ml-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[9px] tracking-[0.14em] text-amber">captured · calhacks-12</span>
        )}
        {mode === "sample" && (
          <span className="ml-1 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[9px] tracking-[0.14em] text-fog/80">sample</span>
        )}
      </p>
      <h2 className="mt-3 max-w-[20ch] font-serif text-[clamp(30px,4.6vw,56px)] leading-[1.0] tracking-[-0.03em] text-cloud">
        One night, start to sunrise.
      </h2>
      <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-fog">
        Scroll a single real shift end to end — from the first OSV lookup to the diff Codex left for review.
        Nothing here is staged: every advisory, provider label and diff line is replayed from a genuine captured run.
      </p>
    </div>
  );
}

/* --------------------------- Shift timeline (editorial) -------------------- */
/* Static, informational per-scene context: the simulated clock, the station's
   position in the six-station shift (NN / 06), the station name, and a restrained
   vertical line with one dot per station. The current station's timestamp + dot
   are emphasized by color/opacity only — no motion, no scroll coupling. On mobile
   it sits above the card in normal flow; nothing is pinned or height-forced. */
function ShiftTimeline({ current, accent }: { current: number; accent: string }) {
  return (
    <div className="lg:self-start">
      <div className="flex items-baseline gap-2.5 lg:flex-col lg:items-start lg:gap-1">
        <span className="font-mono text-[26px] leading-none tabular-nums tracking-[-0.02em] text-cloud">{STAGES[current].time}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
          <span style={{ color: accent }}>{String(current + 1).padStart(2, "0")}</span> / 06 · {STAGES[current].rail}
        </span>
      </div>
      {/* Six-station vertical line. Past = dim filled, current = accent, future = hollow. */}
      <ol className="mt-4 hidden lg:block" aria-label="Night shift progress">
        {STAGES.map((s, i) => {
          const state = i < current ? "past" : i === current ? "current" : "future";
          return (
            <li key={s.n} className="relative flex items-center gap-3 pb-3 last:pb-0">
              {/* connector line segment (not after the last dot) */}
              {i < STAGES.length - 1 && (
                <span aria-hidden className="absolute left-[5px] top-3 h-full w-px" style={{ background: "var(--surface-2)" }} />
              )}
              <span
                aria-hidden
                className="relative z-10 h-[11px] w-[11px] shrink-0 rounded-full border"
                style={{
                  background: state === "current" ? accent : state === "past" ? "var(--surface-2)" : "transparent",
                  borderColor: state === "current" ? accent : "var(--surface-border)",
                  boxShadow: state === "current" ? `0 0 8px ${accent}` : "none",
                }}
              />
              <span
                className={`font-mono text-[10px] tabular-nums ${state === "current" ? "text-cloud" : "text-fog/70"}`}
              >
                <span className="tabular-nums">{s.time}</span>
                <span className={state === "current" ? "" : "opacity-70"}> · {s.rail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------- Operations Monitor frame ------------------------ */
/* A restrained "operator screen" container: dark surface, thin border, a subtle
   top bar with a tiny status dot, the real repository target, and a per-scene
   context label. It is a VISUAL CONTAINER ONLY — no navigation, no clickable
   controls, no fake browser chrome or laptop illustration. Real product evidence
   (the existing StagePanel) renders inside. Scales cleanly; no forced height. */
const _MONITOR_TONE: Record<string, { dot: string; chip: string; text: string }> = {
  scan:     { dot: "#22d3ee", chip: "scan-start", text: "text-cyan" },
  captured: { dot: "#fbbf24", chip: "captured · calhacks-12", text: "text-amber" },
  sample:   { dot: "#8b90a6", chip: "sample", text: "text-fog" },
  diff:     { dot: "#5eead4", chip: "branch-only", text: "text-teal" },
  receipt:  { dot: "#5eead4", chip: "signed receipt", text: "text-teal" },
  gate:     { dot: "#a78bfa", chip: "human gate", text: "text-violet" },
};

function OperationsMonitor({
  accent, context, tone, clock, children,
}: {
  accent: string; context: string; tone: keyof typeof _MONITOR_TONE; clock: string; children: React.ReactNode;
}) {
  const t = _MONITOR_TONE[tone];
  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-[var(--shadow-card)]"
      style={{ borderColor: "var(--surface-border)", background: "var(--color-ink-2)" }}
    >
      {/* Top bar — status dot · repo target · context label · clock. Not interactive. */}
      <div
        className="flex items-center gap-2.5 border-b px-4 py-2.5"
        style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.dot, boxShadow: `0 0 8px ${t.dot}` }} aria-hidden />
        <span className="truncate font-mono text-[11px] text-cloud" translate="no">{PROOF_REPO}</span>
        <span className="hidden truncate font-mono text-[10px] text-fog sm:inline">· {context}</span>
        <span className={cn("ml-auto shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]", t.text)} style={{ borderColor: "var(--surface-border)", background: "var(--color-ink)" }}>
          {t.chip}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-fog/70">{clock}</span>
      </div>
      {/* Body — real product evidence. */}
      <div className="p-5" style={{ borderTop: `1px solid ${accent}22` }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ Stage panels ------------------------------- */
function StagePanel({ index, D, mode, still = false }: { index: number; D: Derived; mode: Mode; still?: boolean }) {
  switch (index) {
    case 0: return <ScanPanel D={D} still={still} />;
    case 1: return <TriagePanel D={D} still={still} />;
    case 2: return <RootCausePanel D={D} mode={mode} still={still} />;
    case 3: return <DiffPanel D={D} still={still} />;
    case 4: return <EvidencePanel D={D} mode={mode} still={still} />;
    default: return <GatePanel D={D} still={still} />;
  }
}

function ScanPanel({ D, still }: { D: Derived; still: boolean }) {
  return (
    <div>
      <ArtifactShell label="Dependency manifest · OSV.dev" status={D.osvStatus} accent="#22d3ee" still={still}>
        <div className="relative overflow-hidden">
          {!still && D.deps.length > 0 && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 will-change-transform"
              style={{ background: "linear-gradient(180deg, transparent, #22d3ee22, transparent)" }}
              initial={{ y: -64 }}
              animate={{ y: 240 }}
              transition={{ duration: 2.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.2 }}
            />
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 font-mono text-[12px] sm:grid-cols-2">
            {D.deps.map((d) => (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <span className={cn("truncate", d.vulnerable ? "text-cloud" : "text-fog")}>{d.name}@{d.version}</span>
                {d.vulnerable ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: "#fb7185" }}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", !still && "animate-pulse-glow")} style={{ background: "#fb7185" }} /> flagged
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-fog/55">✓ clear</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </ArtifactShell>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px]">
        <span className="text-cloud">{D.vulnCount} advisories</span>
        {D.highCount + D.criticalCount > 0 && (
          <span className="text-fog">· top severity <span style={{ color: "#fb923c" }}>{D.criticalCount > 0 ? "CRITICAL" : "HIGH"}</span></span>
        )}
        <span className="ml-auto text-fog/70">{D.flaggedCount} of {D.deps.length} dependencies flagged</span>
      </div>
    </div>
  );
}

function TriagePanel({ D, still }: { D: Derived; still: boolean }) {
  const total = Math.max(1, D.vulnCount);
  const seg = [
    { n: D.criticalCount, c: "#fb7185", label: "critical" },
    { n: D.highCount, c: "#fb923c", label: "high" },
    { n: D.mediumCount, c: "#fbbf24", label: "medium" },
    { n: D.lowCount, c: "#38bdf8", label: "low" },
  ].filter((s) => s.n > 0);
  return (
    <div>
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--surface-border)", background: "var(--input-bg)" }}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[13px] text-cloud">{D.flagged ?? "—"}</span>
          <span className="rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fog" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
            {D.vulnCount} advisories
          </span>
        </div>
        {/* severity distribution */}
        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
          {seg.map((s, i) => (
            <motion.span
              key={s.label}
              className="h-full origin-left"
              style={{ background: s.c, width: `${(s.n / total) * 100}%` }}
              initial={still ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.15 + i * 0.08 }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-fog">
          {seg.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.c }} /> {s.n} {s.label}
            </span>
          ))}
        </div>
      </div>

      {D.topVuln && (
        <div className="mt-3 flex items-start gap-3 rounded-xl border p-3.5" style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}>
          <SeverityChip severity={D.topVuln.severity} />
          <div className="min-w-0">
            <div className="font-mono text-[11.5px] text-cloud">{D.topVuln.cve}</div>
            {D.topVuln.summary && <p className="mt-0.5 text-[12px] leading-snug text-fog">{D.topVuln.summary}</p>}
          </div>
        </div>
      )}

      {D.score > 0 ? (
        <div className="mt-4"><ScoreDial value={D.score} /></div>
      ) : (
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-fog/80">
          {D.vulnCount} advisories collapsed to <span className="text-cloud">one package row</span> — one review, not {D.vulnCount} separate PRs.
        </p>
      )}
    </div>
  );
}

function BlameBar({ still }: { still: boolean }) {
  return (
    <motion.div
      className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5"
      style={{ borderColor: "var(--surface-border)", background: "var(--input-bg)", borderLeft: "2px solid #fbbf24" }}
      initial={still ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <span className="flex items-center gap-2 font-mono text-[11.5px]">
        <span className="text-amber">⌁ DETECTIVE</span>
        <span className="text-fog">introduced in commit <span className="text-cloud">a3f9c</span> · <span className="text-cloud">@dev</span> · 14 months ago</span>
      </span>
      <span className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-fog/80" style={{ borderColor: "var(--surface-border)" }}>
        sample
      </span>
    </motion.div>
  );
}

function RootCausePanel({ D, mode, still }: { D: Derived; mode: Mode; still: boolean }) {
  const showSample = !D.detectiveRan || mode === "sample";
  const idx = D.deps.findIndex((d) => d.vulnerable);
  const depsWindow = idx >= 0 ? D.deps.slice(Math.max(0, idx - 1), idx + 2) : D.deps.slice(0, 3);
  return (
    <div>
      {showSample ? <BlameBar still={still} /> : null}
      <div className="mt-3 rounded-xl border" style={{ borderColor: "var(--surface-border)", background: "var(--input-bg)" }}>
        <div className="border-b px-4 py-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog" style={{ borderColor: "var(--surface-border)" }}>
          resolved dependencies · the flagged pin
        </div>
        <div className="p-4 font-mono text-[12.5px]">
          {depsWindow.map((d) =>
            d.vulnerable ? (
              <div key={d.name} className="rounded" style={{ background: "#fb71851a", borderLeft: "2px solid #fb7185aa", paddingLeft: 6 }}>
                <span style={{ color: "#fb7185" }}>&quot;{d.name}&quot;: &quot;{d.version}&quot;,</span>
                {D.topVuln?.cve && <span className="ml-2 text-fog/60">← flagged: {D.topVuln.cve}</span>}
              </div>
            ) : (
              <div key={d.name} className="text-fog" style={{ paddingLeft: 6 }}>&quot;{d.name}&quot;: &quot;{d.version}&quot;,</div>
            ),
          )}
        </div>
      </div>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-fog/80">
        {showSample ? (
          <>When Detective is on station it reads real <span className="text-cloud">git history</span> to name the introducing commit. This shift ran Watchman + Janitor — the blame above is a <span className="text-cloud">sample</span>.</>
        ) : (
          <>Detective read real <span className="text-cloud">git history</span> to name the commit that introduced the vulnerable pin — grounded in commits, not guessed.</>
        )}
      </p>
    </div>
  );
}

function DiffRow({ line, i, still }: { line: Line; i: number; still: boolean }) {
  const bg = line.kind === "del" ? "#fb71851a" : line.kind === "add" ? "#5eead41f" : "transparent";
  const border = line.kind === "del" ? "#fb7185aa" : line.kind === "add" ? "#5eead4aa" : "transparent";
  const glyph = line.kind === "del" ? "−" : line.kind === "add" ? "+" : "";
  const codeColor = line.kind === "del" ? "#fb7185" : line.kind === "add" ? "var(--color-teal)" : "var(--color-fog)";
  const delay = line.kind === "add" ? 0.5 : line.kind === "del" ? 0.28 : 0.12 + i * 0.02;
  return (
    <motion.div
      className="grid grid-cols-[22px_1fr] items-center"
      style={{ background: bg, borderLeft: `2px solid ${border}` }}
      initial={still ? false : { opacity: 0, x: line.kind === "add" ? -8 : 0, y: line.kind === "ctx" ? 4 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.34, ease: EASE, delay }}
    >
      <span className="select-none text-center font-mono text-[12px]" style={{ color: line.kind === "ctx" ? "var(--color-fog)" : codeColor, opacity: line.kind === "ctx" ? 0.4 : 1 }}>{glyph}</span>
      <span className="whitespace-pre font-mono text-[12.5px]" style={{ color: codeColor }}>{line.text || " "}</span>
    </motion.div>
  );
}

function DiffPanel({ D, still }: { D: Derived; still: boolean }) {
  const lines = D.diffLines.length ? D.diffLines : [{ kind: "ctx" as const, text: "no diff captured" }];
  const added = D.diffLines.find((l) => l.kind === "add");
  const patched = added?.text.match(/:\s*"([^"]+)"/)?.[1];
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="truncate font-mono text-[12.5px] text-cloud">{D.diffFile || "package.json"}</span>
        <span className="rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fog" style={{ borderColor: "var(--surface-border)" }}>diff</span>
        <span className="ml-auto shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-teal" style={{ borderColor: "color-mix(in oklab, var(--color-teal) 35%, transparent)", background: "color-mix(in oklab, var(--color-teal) 8%, transparent)" }}>
          branch-only · never auto-merged
        </span>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border py-1.5" style={{ borderColor: "var(--surface-border)", background: "var(--input-bg)" }}>
        {lines.map((l, i) => <DiffRow key={i} line={l} i={i} still={still} />)}
      </div>
      <p className="mt-2.5 font-mono text-[11px] text-fog/80">
        Codex swapped the pin{patched ? (<> to <span className="text-teal">{patched}</span></>) : null} and stopped at a branch — you review and merge, never Umbra.
      </p>
    </div>
  );
}

function LedgerRow({ label, sub, status, i, still }: { label: string; sub: string; status: Status; i: number; still: boolean }) {
  const c = toneColor(status.tone, "#22d3ee");
  return (
    <motion.div
      className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
      style={{ borderColor: "var(--surface-border)" }}
      initial={still ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE, delay: 0.1 + i * 0.09 }}
    >
      <div className="min-w-0">
        <div className="font-mono text-[12px] text-cloud">{label}</div>
        <div className="font-mono text-[10.5px] text-fog">{sub}</div>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em]" style={{ borderColor: `${c}44`, color: c, background: `${c}12` }}>
        <span className={cn("h-1.5 w-1.5 rounded-full", status.tone === "live" && !still && "animate-pulse-glow")} style={{ background: c, boxShadow: status.tone === "idle" ? "none" : `0 0 8px ${c}` }} />
        {status.label}
      </span>
    </motion.div>
  );
}

function EvidencePanel({ D, mode, still }: { D: Derived; mode: Mode; still: boolean }) {
  const blameStatus: Status = { label: "SAMPLE", tone: "idle" };
  const rows: { label: string; sub: string; status: Status }[] = [
    { label: "OSV.dev", sub: "advisory database", status: D.osvStatus },
    { label: "git blame", sub: "root-cause commit", status: D.detectiveRan && mode !== "sample" ? providerStatus("local-git", mode) : blameStatus },
    { label: "Codex", sub: "patch diff", status: D.codexStatus },
    { label: "Reviewer", sub: "deterministic risk", status: D.reviewerStatus },
  ];
  return (
    <div>
      <div className="rounded-xl border px-4 py-2" style={{ borderColor: "var(--surface-border)", background: "var(--input-bg)" }}>
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog">Provider ledger · what actually ran</div>
        {rows.map((r, i) => <LedgerRow key={r.label} label={r.label} sub={r.sub} status={r.status} i={i} still={still} />)}
      </div>

      {D.verification.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {D.verification.map((v, i) => (
            <motion.div
              key={i}
              className="flex items-start gap-2 font-mono text-[11.5px]"
              initial={still ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.4 + i * 0.08 }}
            >
              <span className="shrink-0" style={{ color: v.ok ? "var(--color-teal)" : "#fbbf24" }}>{v.ok ? "✓" : "⚠"}</span>
              <span className={v.ok ? "text-fog" : "text-amber"}>{v.text}</span>
            </motion.div>
          ))}
        </div>
      )}

      {D.runId && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--surface-border)", background: "var(--surface-2)" }}>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-fog">run</span>
          <span className="truncate font-mono text-[10.5px] text-cloud">{D.runId}</span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-teal">hashable · exportable</span>
        </div>
      )}
      {/* Honest distinction: the Evidence Pack carries a recomputable integrity
          hash; the Remediation Receipt is the tamper-evident signed artifact. */}
      <div className="mt-2 flex flex-col gap-1 font-mono text-[10.5px] leading-snug">
        <span className="text-fog">Evidence Pack · <span className="text-cloud">SHA-256 integrity hash</span> (recomputable)</span>
        <span className="text-fog">Remediation Receipt · <span className="text-teal">Ed25519-signed</span> · signature-verifiable</span>
      </div>
    </div>
  );
}

function AutoMergeToggle({ still }: { still: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-6 w-11 rounded-full" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <motion.span
          className="absolute top-[3px] left-[3px] grid h-[16px] w-[16px] place-items-center rounded-full will-change-transform"
          style={{ background: "var(--color-fog)" }}
          initial={still ? false : { x: 0 }}
          animate={still ? { x: 0 } : { x: [0, 18, 18, 0] }}
          transition={still ? undefined : { duration: 1.3, times: [0, 0.32, 0.6, 0.9], ease: EASE, delay: 0.4 }}
        >
          <span className="text-[9px] leading-none" style={{ color: "var(--color-ink)" }}>🔒</span>
        </motion.span>
      </div>
      <span className="font-mono text-[11.5px] text-fog">auto-merge <span className="text-cloud">off</span> · human review required</span>
    </div>
  );
}

function GatePanel({ D, still }: { D: Derived; still: boolean }) {
  const hasRisk = typeof D.reviewerRisk === "number";
  const risk = D.reviewerRisk ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--surface-border)", background: "var(--input-bg)" }}>
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-fog">Autonomy</div>
          <div className="font-mono text-[13px] text-cloud">Level {D.autonomyLevel} — {D.autonomyLabel}</div>
        </div>
        <AutoMergeToggle still={still} />
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}>
        <div className="flex items-center justify-between gap-2 font-mono text-[12px]">
          <span className="flex items-center gap-2 text-cloud">Reviewer · blast-radius risk <StatusPill status={D.reviewerStatus} accent="#a78bfa" /></span>
          <span className="shrink-0 text-fog">{hasRisk ? `${risk}/100` : "— / 100"} · {D.reviewerRec ?? "human review required"}</span>
        </div>
        {hasRisk && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
            <motion.div
              className="h-full origin-left rounded-full"
              style={{ background: "#a78bfa", width: `${Math.min(100, risk)}%` }}
              initial={still ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
            />
          </div>
        )}
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-fog/80">
          The Reviewer scores the exact diff — it never approves and never merges. The branch waits for you.
        </p>
      </div>

      <HoverBorderGradient href="/dashboard?proof=calhacks" className="self-start px-5 py-3 text-sm font-semibold">
        Open the captured shift <span className="text-teal">→</span>
      </HoverBorderGradient>
    </div>
  );
}

/* --------------------- Static fallback (mobile + reduced-motion) ------------ */
function StaticStack({ D, mode }: { D: Derived; mode: Mode }) {
  return (
    <div className="mt-2 flex flex-col gap-5">
      {STAGES.map((s, i) => (
        <article key={s.n} className="rounded-2xl border p-5 shadow-[var(--shadow-card)]" style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}>
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-serif text-2xl leading-none" style={{ color: s.accent }}>{String(s.n).padStart(2, "0")}</span>
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cloud">{s.rail}</div>
              <div className="font-mono text-[11px] text-fog">{s.desc}</div>
            </div>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-fog/70">{s.time}</span>
          </div>
          <StagePanel index={i} D={D} mode={mode} still />
        </article>
      ))}
    </div>
  );
}
