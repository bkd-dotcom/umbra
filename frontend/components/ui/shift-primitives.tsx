"use client";

import { type ReactNode } from "react";
import { type Dep } from "@/components/ui/dependency-map";

/* -----------------------------------------------------------------------------
   Shift primitives — the single source of truth for crew identity, HONEST
   provider labelling, and the shared "operational artifact" chrome.

   Both the landing NightShiftPipeline and the dashboard ShiftDossier import from
   here so a provider is labelled LIVE / CACHE / GATED / SAMPLE identically on
   every surface. No component can accidentally present a non-live provider as
   LIVE, because there is exactly ONE statusFor().
----------------------------------------------------------------------------- */

// Structural types — kept compatible with the dashboard's ScanResult so a live
// result / DEMO_RESULT / PROOF_SCAN passes straight through.
export type Replay = { agent: string; prompt: string; codex_diff: string; tests: string; reasoning: string; timings: Record<string, number>; providers?: Record<string, string> };
export type AgentRun = { agent: string; summary: string; findings: unknown[]; replay: Replay };
export type Vuln = { package: string; version: string; cve: string; severity: string; owasp?: string; summary?: string };
export type Autonomy = { level?: number; label?: string; auto_merge?: boolean; human_review_required?: boolean };
export type ScanResult = {
  umbra_score?: number;
  vulnerabilities?: Vuln[];
  dependencies?: Dep[];
  agent_results?: AgentRun[];
  reasoning_summary?: string;
  source?: string;
  live_agents?: string[];
  run_id?: string;
  repo_url?: string;
  autonomy?: Autonomy;
};
export type { Dep };

export type Mode = "live" | "sample" | "captured";

export const LIVE_PROVIDERS = new Set(["codex-cli", "osv.dev", "local-git", "local-git-grep", "repo-clone", "responses-api", "responses-api-stream", "deterministic"]);
export const FOG = "#8b90a6";

export type Meta = { key: string; letter: string; name: string; role: string; color: string; specialty: string[]; tool: boolean };
export const CREW: Meta[] = [
  { key: "watchman", letter: "W", name: "Watchman", role: "Dependency sentinel", color: "#22d3ee", specialty: ["OSV.dev", "CVSS", "blast-radius"], tool: false },
  { key: "reviewer", letter: "R", name: "Reviewer", role: "PR risk analyst", color: "#a78bfa", specialty: ["diff analysis", "risk score", "PRs"], tool: false },
  { key: "janitor", letter: "J", name: "Janitor", role: "Tech-debt sweeper", color: "#5eead4", specialty: ["dead code", "unused exports", "cleanup"], tool: false },
  { key: "detective", letter: "D", name: "Detective", role: "Incident tracer", color: "#fbbf24", specialty: ["git blame", "git log", "root cause"], tool: true },
  { key: "ask", letter: "A", name: "Ask Umbra", role: "Codebase oracle", color: "#f472b6", specialty: ["retrieval", "file:line", "grounded"], tool: true },
];

export type Tone = "live" | "cache" | "gated" | "ready" | "idle";
export type Status = { label: string; tone: Tone };

/** The provider that best represents whether THIS agent's core job ran. */
export function primaryProvider(key: string, providers: Record<string, string>): string {
  if (key === "reviewer") return providers.review ?? providers.reasoning ?? "";
  if (key === "detective" || key === "ask") return providers.reasoning ?? "";
  return providers.engineering ?? providers.vulnerabilities ?? providers.reasoning ?? ""; // watchman, janitor
}

/** Honest status — never labels a non-live provider as LIVE. */
export function statusFor(meta: Meta, run: AgentRun | undefined, mode: Mode, founder: boolean): Status {
  if (mode === "sample") return { label: "SAMPLE", tone: "idle" };
  if (!run) return meta.tool ? { label: "READY", tone: "ready" } : { label: "STANDBY", tone: "idle" };
  const p = primaryProvider(meta.key, run.replay?.providers ?? {});
  if (LIVE_PROVIDERS.has(p)) return { label: "LIVE", tone: "live" };
  if (p.includes("cache") || p.includes("demo")) return { label: "CACHE", tone: "cache" };
  if (p === "founder-gated") return { label: "GATED", tone: "gated" };
  if (p === "unavailable") return founder ? { label: "UNAVAILABLE", tone: "idle" } : { label: "GATED", tone: "gated" };
  if (!p) return { label: "FILED", tone: "idle" };
  return { label: p.toUpperCase(), tone: "idle" };
}

/** Honest status for a single raw provider string — for per-provider ledger rows.
 *  Same LIVE/CACHE/GATED rules as statusFor, never labels a non-live provider LIVE. */
export function providerStatus(provider: string | undefined, mode: Mode): Status {
  if (mode === "sample") return { label: "SAMPLE", tone: "idle" };
  const p = provider ?? "";
  if (LIVE_PROVIDERS.has(p)) return { label: "LIVE", tone: "live" };
  if (p.includes("cache") || p.includes("demo")) return { label: "CACHE", tone: "cache" };
  if (p === "founder-gated" || p === "unavailable") return { label: "GATED", tone: "gated" };
  if (!p) return { label: "—", tone: "idle" };
  return { label: p.toUpperCase(), tone: "idle" };
}

export function toneColor(tone: Tone, accent: string): string {
  switch (tone) {
    case "live": return "#5eead4";
    case "cache": return "#fbbf24";
    case "gated": return "#a78bfa";
    case "ready": return accent;
    default: return FOG;
  }
}

export function StatusPill({ status, accent }: { status: Status; accent: string }) {
  const c = toneColor(status.tone, accent);
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ borderColor: `${c}44`, color: c, background: `${c}12` }}>
      <span className={`h-1.5 w-1.5 rounded-full ${status.tone === "live" ? "animate-pulse-glow" : ""}`} style={{ background: c, boxShadow: status.tone === "idle" ? "none" : `0 0 8px ${c}` }} />
      {status.label}
    </span>
  );
}

/** The framed "operational artifact" panel used across crew surfaces.
 *  `still` (default false) suppresses the live-dot pulse for static fallbacks. */
export function ArtifactShell({ label, status, accent, children, still = false }: { label: string; status: Status; accent: string; children: ReactNode; still?: boolean }) {
  const c = toneColor(status.tone, accent);
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)]">
      <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-4 py-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog">{label}</span>
        <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: c }}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.tone === "live" && !still ? "animate-pulse-glow" : ""}`} style={{ background: c, boxShadow: status.tone === "idle" ? "none" : `0 0 8px ${c}` }} /> {status.label}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* Highlight grounded references (CVE, short commit, pkg@ver, PR #) inside a filed
   summary so dispatches read consistently across surfaces. */
export function groundRefs(text: string): ReactNode {
  const re = /(CVE-\d{4}-\d+|GHSA-[0-9a-z-]+|PR #\d+|\b[0-9a-f]{7,40}\b|[a-z0-9][a-z0-9/._-]*@[\d][\w.]*)/gi;
  return text.split(re).map((p, i) => (i % 2 === 1 ? <span key={i} className="text-cloud">{p}</span> : <span key={i}>{p}</span>));
}
