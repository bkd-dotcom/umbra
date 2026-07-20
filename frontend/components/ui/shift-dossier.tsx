"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "@/lib/motion";
import { GlowCard } from "@/components/ui/glow-card";
import {
  CREW,
  statusFor,
  toneColor,
  StatusPill,
  ArtifactShell,
  groundRefs,
  type Meta,
  type Mode,
  type Status,
  type AgentRun,
  type Replay,
  type ScanResult,
} from "@/components/ui/shift-primitives";

/* -----------------------------------------------------------------------------
   Shift Dossier — the live-data version of the landing CrewDossier.

   Same "classified operations file" language (monogram, unit, status, an
   operational artifact), but every card is driven by the REAL scan result and
   every status pill is honest: it reflects what actually ran for that agent
   (LIVE / CACHE / GATED / UNAVAILABLE), derived from `replay.providers` — never
   a generic "live" when a provider didn't run. Sample data reads SAMPLE.

   Hybrid layout: one full-width focused HERO card + a compact grid of the other
   agents; clicking a grid card promotes it to the hero.
----------------------------------------------------------------------------- */

// Crew identity, honest provider labelling (statusFor/primaryProvider/StatusPill),
// and the ArtifactShell chrome now live in shift-primitives.tsx — single-sourced
// so the dossier and the landing NightShiftPipeline label providers identically.

export function ShiftDossier({ result, mode, founder = false, onOpenReplay, onGotoOperations }: {
  result: ScanResult;
  mode: Mode;
  founder?: boolean;
  onOpenReplay?: (replay: Replay) => void;
  onGotoOperations?: () => void;
}) {
  const reduce = useReducedMotion();
  const runs = useMemo(() => new Map((result.agent_results ?? []).map((r) => [r.agent, r] as const)), [result]);

  const views = useMemo(
    () => CREW.map((meta) => {
      const run = runs.get(meta.key);
      return { meta, run, status: statusFor(meta, run, mode, founder) };
    }),
    [runs, mode, founder],
  );

  // Default focus: the first agent that actually filed this shift (else the first).
  const defaultIdx = Math.max(0, views.findIndex((v) => !!v.run && !v.meta.tool));
  const [active, setActive] = useState(defaultIdx === -1 ? 0 : defaultIdx);
  const focused = views[active] ?? views[0];
  const others = views.filter((_, i) => i !== active);

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fog/70">
        <span className="h-px w-6" style={{ background: "var(--surface-border)" }} /> The crew · operations floor
        {mode === "sample" && <span className="ml-1 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[9px] tracking-[0.14em] text-fog/80">sample</span>}
        {mode === "captured" && <span className="ml-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[9px] tracking-[0.14em] text-amber">captured</span>}
      </div>

      {/* HERO — the focused agent's full dossier. */}
      <HeroCard key={focused.meta.key} view={focused} result={result} reduce={!!reduce} onOpenReplay={onOpenReplay} onGotoOperations={onGotoOperations} />

      {/* GRID — the rest of the crew; click to promote to hero. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {others.map((v) => {
          const i = views.indexOf(v);
          return <GridCard key={v.meta.key} view={v} result={result} onClick={() => setActive(i)} />;
        })}
      </div>
    </div>
  );
}

function HeroCard({ view, result, reduce, onOpenReplay, onGotoOperations }: {
  view: { meta: Meta; run?: AgentRun; status: Status };
  result: ScanResult;
  reduce: boolean;
  onOpenReplay?: (replay: Replay) => void;
  onGotoOperations?: () => void;
}) {
  const { meta, run, status } = view;
  const unit = String(CREW.findIndex((m) => m.key === meta.key) + 1).padStart(2, "0");
  const hasReplay = !!run?.replay && !!(run.replay.codex_diff || run.replay.reasoning || run.replay.prompt || run.replay.tests);
  return (
    <GlowCard glow={`${meta.color}22`} className="relative overflow-hidden">
      {!reduce && (
        <motion.span
          key={`beam-${meta.key}`}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-20 h-[2px]"
          style={{ background: `linear-gradient(90deg, ${meta.color}, transparent)`, boxShadow: `0 0 12px ${meta.color}` }}
          initial={{ width: "0%", opacity: 0.9 }}
          animate={{ width: "100%", opacity: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        />
      )}
      <div className="flex flex-col p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border font-mono text-xl font-semibold" style={{ color: meta.color, borderColor: `${meta.color}55`, background: `${meta.color}12`, boxShadow: `0 0 30px -12px ${meta.color}` }}>
              {meta.letter}
            </span>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog">Night shift · Unit {unit}</div>
              <div className="font-serif text-[clamp(24px,3vw,34px)] leading-none tracking-[-0.02em] text-cloud">{meta.name}</div>
              <div className="mt-1.5 font-mono text-[11px] tracking-[0.06em] text-fog">{meta.role}</div>
            </div>
          </div>
          <StatusPill status={status} accent={meta.color} />
        </div>

        {run?.summary && <p className="mt-5 max-w-[60ch] font-mono text-[12.5px] leading-relaxed text-fog">{groundRefs(run.summary)}</p>}

        <div className="mt-5">
          <Artifact meta={meta} run={run} status={status} result={result} reduce={reduce} onGotoOperations={onGotoOperations} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--surface-border)] pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Specialty</span>
          {meta.specialty.map((s) => (
            <span key={s} className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-2 py-0.5 font-mono text-[10px] text-fog">{s}</span>
          ))}
          {hasReplay && onOpenReplay && (
            <button onClick={() => onOpenReplay(run!.replay)} className="ml-auto rounded-full border border-[color:var(--surface-border)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">
              replay ↗
            </button>
          )}
        </div>
      </div>
    </GlowCard>
  );
}

function GridCard({ view, result, onClick }: { view: { meta: Meta; run?: AgentRun; status: Status }; result: ScanResult; onClick: () => void }) {
  const { meta, run, status } = view;
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 text-left transition-all duration-300 hover:-translate-y-px"
      style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}
    >
      <span className="absolute inset-y-3 left-0 w-0.5 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: meta.color }} />
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border font-mono text-[12px] font-semibold" style={{ color: meta.color, borderColor: `${meta.color}55`, background: `${meta.color}12` }}>
          {meta.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-cloud">{meta.name}</div>
          <div className="truncate font-mono text-[9.5px] tracking-[0.05em] text-fog">{meta.role}</div>
        </div>
        <StatusPill status={status} accent={meta.color} />
      </div>
      <p className="font-mono text-[11px] leading-snug text-fog">{previewLine(meta, run, result)}</p>
    </button>
  );
}

/* --- Preview lines (compact grid cards) ----------------------------------- */
function previewLine(meta: Meta, run: AgentRun | undefined, result: ScanResult): string {
  const vulns = result.vulnerabilities ?? [];
  switch (meta.key) {
    case "watchman": {
      const n = vulns.length;
      const pkg = vulns[0]?.package;
      return n ? `${n} ${n === 1 ? "advisory" : "advisories"}${pkg ? ` · ${pkg}` : ""}` : "0 advisories · clear";
    }
    case "reviewer": {
      const f = (run?.findings?.[0] ?? {}) as { risk_score?: number; recommendation?: string };
      if (typeof f.risk_score === "number") return `risk ${f.risk_score}/100 · ${f.recommendation ?? "assessed"}`;
      return run ? "no open PR · deterministic baseline" : "waiting on a PR to review";
    }
    case "janitor": {
      const n = run?.findings?.length ?? 0;
      const f = (run?.findings?.[0] ?? {}) as { file?: string };
      return run ? `${n || 1} change(s)${f.file ? ` · ${f.file}` : ""}` : "no cleanup this shift";
    }
    case "detective":
      return run?.summary ? run.summary : "trace an incident in Operations ↓";
    default:
      return run?.summary ? run.summary : "ask a grounded question in Operations ↓";
  }
}

/* --- Operational artifacts (data-driven) ----------------------------------- */
function Artifact({ meta, run, status, result, reduce, onGotoOperations }: {
  meta: Meta; run?: AgentRun; status: Status; result: ScanResult; reduce: boolean; onGotoOperations?: () => void;
}) {
  switch (meta.key) {
    case "watchman": return <WatchmanArt run={run} status={status} accent={meta.color} result={result} reduce={reduce} />;
    case "reviewer": return <ReviewerArt run={run} status={status} accent={meta.color} reduce={reduce} />;
    case "janitor": return <JanitorArt run={run} status={status} accent={meta.color} reduce={reduce} />;
    default: return <ToolArt meta={meta} run={run} status={status} onGotoOperations={onGotoOperations} />;
  }
}

function WatchmanArt({ run, status, accent, result, reduce }: { run?: AgentRun; status: Status; accent: string; result: ScanResult; reduce: boolean }) {
  const vulns = result.vulnerabilities ?? [];
  const deps = (result.dependencies ?? []).slice().sort((a, b) => Number(!!b.vulnerable) - Number(!!a.vulnerable)).slice(0, 4);
  const worst = vulns.some((v) => (v.severity ?? "").toLowerCase() === "high" || (v.severity ?? "").toLowerCase() === "critical") ? "HIGH" : vulns.length ? "MEDIUM" : null;
  const patched = !!run?.replay?.codex_diff;
  const c = toneColor(status.tone, accent);
  return (
    <ArtifactShell label="Dependency scan · OSV" status={status} accent={accent}>
      <div className="relative">
        {!reduce && deps.length > 0 && (
          <motion.div
            aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-9"
            style={{ background: `linear-gradient(180deg, transparent, ${accent}14, transparent)` }}
            initial={{ top: "-25%" }} animate={{ top: "125%" }} transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.4 }}
          />
        )}
        {deps.length > 0 ? (
          <div className="flex flex-col gap-2 font-mono text-[12px]">
            {deps.map((d) => (
              <div key={d.name} className="flex items-center justify-between">
                <span className={d.vulnerable ? "text-cloud" : "text-fog"}>{d.name}@{d.version}</span>
                {d.vulnerable
                  ? <span className="flex items-center gap-1.5 text-[11px] text-[color:var(--sev-critical)]"><span className="h-1.5 w-1.5 rounded-full bg-[color:var(--sev-critical)]" /> flagged</span>
                  : <span className="text-[11px] text-fog/75">✓ clear</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[12px] text-fog">Checked every resolved dependency against OSV — nothing known.</p>
        )}
      </div>
      {vulns.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--surface-border)] pt-3 font-mono text-[11px]">
          <span className="text-cloud">{vulns.length} {vulns.length === 1 ? "advisory" : "advisories"}</span>
          {worst && <span className="text-fog">· top severity <span className="text-[color:var(--sev-critical)]">{worst}</span></span>}
          {patched && <span className="ml-auto" style={{ color: c }}>→ patch prepared</span>}
        </div>
      )}
    </ArtifactShell>
  );
}

function ReviewerArt({ run, status, accent, reduce }: { run?: AgentRun; status: Status; accent: string; reduce: boolean }) {
  const f = (run?.findings?.[0] ?? {}) as { risk_score?: number; severity?: string; blast_radius?: string; recommendation?: string };
  const hasScore = typeof f.risk_score === "number";
  const c = toneColor(status.tone, accent);
  return (
    <ArtifactShell label="Pull request · risk" status={status} accent={accent}>
      {hasScore ? (
        <div className="font-mono text-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-cloud">blast-radius risk</span>
            <span className="text-fog">{f.risk_score}/100 · {f.severity ?? "—"}</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]">
            <motion.div className="h-full rounded-full" style={{ background: accent }} initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.min(100, f.risk_score ?? 0)}%` }} transition={{ duration: 0.9, ease: EASE, delay: 0.2 }} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px]"><span className="text-fog">verdict:</span><span style={{ color: c }}>{f.recommendation ?? "assessed"}</span></div>
        </div>
      ) : (
        <p className="font-mono text-[12px] leading-relaxed text-fog">
          No open pull request to review this shift. Reviewer scores blast-radius and merge risk deterministically the moment a PR appears — and annotates any PR Umbra opens before you confirm it.
        </p>
      )}
    </ArtifactShell>
  );
}

function JanitorArt({ run, status, accent, reduce }: { run?: AgentRun; status: Status; accent: string; reduce: boolean }) {
  const findings = (run?.findings ?? []) as { file?: string; symbol?: string | null; kind?: string }[];
  const c = toneColor(status.tone, accent);
  const drafted = !!run?.replay?.codex_diff;
  return (
    <ArtifactShell label="Dead code · sweep" status={status} accent={accent}>
      {findings.length > 0 ? (
        <div className="font-mono text-[12px]">
          <div className="flex flex-col gap-1.5">
            {findings.slice(0, 4).map((l, i) => (
              <motion.div key={`${l.file}-${i}`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 * i, duration: 0.4 }} className="flex items-center justify-between gap-2">
                <span className="truncate text-cloud">{l.file ?? "—"}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-fog">{(l.kind ?? "cleanup").replace(/_/g, " ")}</span>
              </motion.div>
            ))}
          </div>
          <div className="mt-3 text-[11px]" style={{ color: c }}>{findings.length} change(s){drafted ? " · PR drafted" : ""}</div>
        </div>
      ) : (
        <p className="font-mono text-[12px] leading-relaxed text-fog">No behavior-preserving cleanup found this shift — the working tree is already tidy.</p>
      )}
    </ArtifactShell>
  );
}

function ToolArt({ meta, run, status, onGotoOperations }: { meta: Meta; run?: AgentRun; status: Status; onGotoOperations?: () => void }) {
  const isDetective = meta.key === "detective";
  return (
    <ArtifactShell label={isDetective ? "Git history · root cause" : "Grounded answer · retrieval"} status={status} accent={meta.color}>
      {run?.summary ? (
        <p className="font-mono text-[12px] leading-relaxed text-fog">{groundRefs(run.summary)}</p>
      ) : (
        <div className="font-mono text-[12px] leading-relaxed text-fog">
          <p>{isDetective ? "Traces an incident to its root-cause commit from real git history — reasoned by OpenAI, not guessed." : "Answers questions about this codebase, grounded in real file and line references."}</p>
          {onGotoOperations && (
            <button onClick={onGotoOperations} className="mt-3 rounded-full border border-[color:var(--surface-border)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fog transition-colors hover:text-cloud" style={{ borderColor: `${meta.color}44` }}>
              open in Operations ↓
            </button>
          )}
        </div>
      )}
    </ArtifactShell>
  );
}
