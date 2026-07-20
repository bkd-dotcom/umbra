"use client";

import { useMemo } from "react";
import { CREW, primaryProvider, providerStatus, toneColor, type Mode, type Replay, type ScanResult, type Status } from "@/components/ui/shift-primitives";

/* -----------------------------------------------------------------------------
   Activity / Audit Timeline — the shift's actions as a chronological, navigable
   audit trail. Everything is derived from REAL data: agent actions come from the
   scan's agent_results (real durations from `timings`, honest provider labels),
   triage decisions and past shifts carry their real timestamps. Nothing is
   fabricated — no invented wall-clock times, no action shown that didn't run.

   This is the "audit trail, made navigable" — the honesty spine turned into a
   feed a team can scan. Guest/captured views see the shift's agent actions;
   logged-in users also get their triage decisions + recent shift history.
----------------------------------------------------------------------------- */

type TriageRec = { finding_key: string; status?: string; reason?: string; updated_at?: string; repo?: string };
type ScanRow = { repo_full_name?: string; umbra_score?: number; vuln_count?: number; source?: string; ran_at?: string };

function fmtMs(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

const TRIAGE_LABEL: Record<string, string> = {
  snoozed: "Snoozed",
  accepted_risk: "Accepted risk",
  open: "Reopened",
  pr_drafted: "PR drafted",
  fixed: "Fixed (verified)",
};

type AgentEvent = { agent: string; accent: string; title: string; detail: string; status: Status; ms: number; codexRan: boolean; replay?: Replay };

function buildAgentEvents(shift: ScanResult, mode: Mode): AgentEvent[] {
  const runs = shift.agent_results ?? [];
  const depCount = (shift.dependencies ?? []).length;
  const vulnCount = (shift.vulnerabilities ?? []).length;
  const order = CREW.map((m) => m.key);
  return [...runs]
    .sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent))
    .map((run) => {
      const meta = CREW.find((m) => m.key === run.agent);
      const providers = run.replay?.providers ?? {};
      const status = providerStatus(primaryProvider(run.agent, providers), mode);
      const timings = run.replay?.timings ?? {};
      const ms = Object.values(timings).reduce<number>((a, b) => a + (Number(b) || 0), 0);
      const codexRan = ["engineering", "reasoning", "review"].some((k) => providers[k] === "codex-cli");
      let title = meta?.name ?? run.agent;
      let detail = "";
      if (run.agent === "watchman") { title = "Watchman · dependency scan"; detail = `${depCount} deps checked · ${vulnCount} advisories`; }
      else if (run.agent === "reviewer") { const f = (run.findings?.[0] ?? {}) as { risk_score?: number }; title = "Reviewer · PR risk"; detail = typeof f.risk_score === "number" ? `blast-radius risk ${f.risk_score}/100` : "assessed the diff"; }
      else if (run.agent === "janitor") { title = "Janitor · dead-code sweep"; detail = `${run.findings?.length ?? 0} change(s) prepared`; }
      else { detail = run.summary?.slice(0, 80) ?? ""; }
      const hasReplay = !!(run.replay && (run.replay.codex_diff || run.replay.reasoning || run.replay.prompt || run.replay.tests));
      return { agent: run.agent, accent: meta?.color ?? "#8b90a6", title, detail, status, ms, codexRan, replay: hasReplay ? run.replay : undefined };
    });
}

function Pill({ status }: { status: Status }) {
  const c = toneColor(status.tone, "#22d3ee");
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]" style={{ borderColor: `${c}44`, color: c, background: `${c}12` }}>
      <span className="h-1 w-1 rounded-full" style={{ background: c, boxShadow: status.tone === "idle" ? "none" : `0 0 6px ${c}` }} />
      {status.label}
    </span>
  );
}

function Node({ accent, last }: { accent: string; last?: boolean }) {
  return (
    <div className="relative flex w-4 shrink-0 justify-center">
      <span className="z-10 mt-1.5 h-2.5 w-2.5 rounded-full border" style={{ background: accent, borderColor: accent, boxShadow: `0 0 8px ${accent}88` }} />
      {!last && <span className="absolute top-3 h-[calc(100%+0.25rem)] w-px" style={{ background: "var(--surface-border)" }} />}
    </div>
  );
}

export function AuditTimeline({
  shift,
  history = [],
  triage = [],
  mode,
  onOpenReplay,
}: {
  shift: ScanResult;
  history?: ScanRow[];
  triage?: TriageRec[];
  mode: Mode;
  onOpenReplay?: (replay: Replay) => void;
}) {
  const events = useMemo(() => buildAgentEvents(shift, mode), [shift, mode]);
  const decisions = useMemo(() => triage.filter((t) => t.status && t.status !== "open").slice(0, 6), [triage]);
  const shifts = useMemo(() => history.slice(0, 5), [history]);

  return (
    <div className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Activity · this shift</p>
        <span className="font-mono text-[10px] text-fog/60">what actually ran, in order — every row grounded, no fabricated times</span>
        {mode === "captured" && <span className="ml-auto rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber">captured</span>}
        {mode === "sample" && <span className="ml-auto rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fog/80">sample</span>}
      </div>

      {/* Agent actions — the core audit trail (guest-visible). */}
      <ol className="flex flex-col">
        {events.map((e, i) => {
          const dur = fmtMs(e.ms);
          return (
            <li key={`${e.agent}-${i}`} className="flex gap-3">
              <Node accent={e.accent} last={i === events.length - 1 && !decisions.length && !shifts.length} />
              <div className="min-w-0 flex-1 pb-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[12.5px] text-cloud">{e.title}</span>
                  <Pill status={e.status} />
                  {e.codexRan && mode !== "sample" && <span className="rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-violet">Codex</span>}
                  {dur && <span className="font-mono text-[10px] text-fog/70">{dur}</span>}
                  {e.replay && onOpenReplay && (
                    <button onClick={() => onOpenReplay(e.replay!)} className="ml-auto shrink-0 rounded-full border border-[color:var(--surface-border)] px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">
                      replay ↗
                    </button>
                  )}
                </div>
                {e.detail && <p className="mt-0.5 font-mono text-[11px] text-fog">{e.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Triage decisions — logged-in; real timestamps + reasons (auditable suppressions). */}
      {decisions.length > 0 && (
        <>
          <p className="mb-3 mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Triage decisions</p>
          <ol className="flex flex-col">
            {decisions.map((t, i) => (
              <li key={t.finding_key} className="flex gap-3">
                <Node accent={t.status === "accepted_risk" ? "#fbbf24" : "#8b90a6"} last={i === decisions.length - 1 && !shifts.length} />
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[12px] text-cloud">{TRIAGE_LABEL[t.status ?? ""] ?? t.status}</span>
                    <span className="min-w-0 break-all font-mono text-[11px] text-fog">{t.finding_key.split(":").slice(1).join(":") || t.finding_key}</span>
                    {t.updated_at && <span className="ml-auto shrink-0 font-mono text-[10px] text-fog/60">{fmtTime(t.updated_at)}</span>}
                  </div>
                  {t.reason && <p className="mt-0.5 font-mono text-[11px] italic text-fog/80">“{t.reason}”</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* Recent shifts — logged-in; real ran_at timestamps. */}
      {shifts.length > 0 && (
        <>
          <p className="mb-3 mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Recent shifts</p>
          <ol className="flex flex-col">
            {shifts.map((s, i) => (
              <li key={`${s.repo_full_name}-${s.ran_at}-${i}`} className="flex gap-3">
                <Node accent="#5eead4" last={i === shifts.length - 1} />
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 break-all font-mono text-[12px] text-cyan/90">{s.repo_full_name}</span>
                    <span className="font-mono text-[11px] text-fog">score {s.umbra_score ?? "—"} · {s.vuln_count ?? 0} advisories</span>
                    {s.ran_at && <span className="ml-auto shrink-0 font-mono text-[10px] text-fog/60">{fmtTime(s.ran_at)}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
