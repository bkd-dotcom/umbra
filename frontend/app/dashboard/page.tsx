"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GlowCard } from "@/components/ui/glow-card";
import { UmbraLogo } from "@/components/ui/umbra-logo";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { StatefulButton } from "@/components/ui/stateful-button";
import { Spotlight } from "@/components/ui/spotlight";
import { DitherImage } from "@/components/ui/dither-image";
import { Magnetic } from "@/components/ui/magnetic-button";
import { SegmentedTabs } from "@/components/ui/tabs";
import { SeverityChip } from "@/components/ui/severity-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { type Dep } from "@/components/ui/dependency-map";
import { GitHubIcon, LockIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { scrollToTop } from "@/components/ui/smooth-scroll";
import { LocalWeather } from "@/components/ui/local-weather";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import dynamic from "next/dynamic";
// Below-the-fold, interactive panels — code-split so they don't ship in the
// initial /dashboard bundle (they render only after a scan / in later zones).
const ShiftDossier = dynamic(() => import("@/components/ui/shift-dossier").then((m) => m.ShiftDossier), { ssr: false });
const AuditTimeline = dynamic(() => import("@/components/ui/audit-timeline").then((m) => m.AuditTimeline), { ssr: false });
const AgentAdmission = dynamic(() => import("@/components/ui/agent-admission").then((m) => m.AgentAdmission), { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)]" /> });
import { DiffView } from "@/components/ui/diff-view";
import { PROOF_SCAN, PROOF_REPO, PROOF_CAPTURED_AT } from "@/lib/proof-scan";
import { EASE } from "@/lib/motion";
import { useModalA11y } from "@/lib/use-modal-a11y";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const creds: RequestInit = { credentials: "include" };

type User = { name?: string; email?: string; avatar?: string; provider: string; login?: string; sub: string; github_connected?: boolean; github_login?: string; has_openai_key?: boolean; is_founder?: boolean; scheduling_enabled?: boolean; email_enabled?: boolean; notifications_opt_out?: boolean };
type Schedule = { id: string; repo_full_name: string; hour: number; minute: number; timezone: string; cadence: string; email: string; enabled: boolean; next_run_at?: string | null; last_run_at?: string | null; last_delivery_status?: string | null; last_delivery_detail?: string | null; last_delivery_at?: string | null };
type Repo = { name: string; full_name: string; url: string; private: boolean; stars: number };
type Vuln = { package: string; version: string; cve: string; severity: string; owasp?: string; summary?: string };
type Replay = { agent: string; prompt: string; codex_diff: string; tests: string; reasoning: string; timings: Record<string, number>; providers?: Record<string, string> };
type AgentRun = { agent: string; summary: string; findings: unknown[]; replay: Replay };
type Autonomy = { level: number; label: string; auto_merge: boolean; human_review_required: boolean };
type Policy = { loaded: boolean; path?: string; summary: string };
type ScanResult = { umbra_score?: number; vulnerabilities?: Vuln[]; dependencies?: Dep[]; source?: string; live_agents?: string[]; agent_results?: AgentRun[]; reasoning_summary?: string; repo_url?: string; run_id?: string; evidence_hash?: string; autonomy?: Autonomy; policy?: Policy };
type Scan = { scan_id?: string; repo_full_name: string; umbra_score?: number; source?: string; vuln_count?: number; ran_at?: string; report?: ScanResult };
type TriageRec = { finding_key: string; status?: string; reason?: string; repo?: string; updated_at?: string };
// A durable receipt for a branch-only PR Umbra opened (the PR ledger). `Review` is
// declared lower in the file; TS type aliases are hoisted, so the reference is fine.
type PrRecord = { repo_url?: string; number: number; url: string; branch?: string; base?: string; mode?: string; package?: string; cve?: string; review?: Review; opened_at?: string };
type Reference = { file: string; lines?: string; note?: string };
type AskAnswer = { answer: string; references: Reference[]; blast_radius?: string; source?: string; reasoning?: string };
type Postmortem = { incident: string; root_cause_commit: string; confidence: number; timeline: string[]; explanation: string; blast_radius: string; suggested_fix: string; reasoning_chain: string[]; source?: string };

const LIVE_PROVIDERS = new Set(["codex-cli", "osv.dev", "local-git", "local-git-grep", "repo-clone", "responses-api", "responses-api-stream"]);

// Reduce any repo reference to its `owner/repo` slug (for display / labels).
function repoFullName(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
}
// Canonicalise any repo reference to a full GitHub URL. Accepts `owner/repo`,
// `github.com/owner/repo`, or `https://github.com/owner/repo` (returns "" if empty).
function normalizeRepoUrl(raw: string): string {
  const slug = repoFullName(raw.trim());
  return slug ? `https://github.com/${slug}` : "";
}
function providerTone(v: string): string {
  if (LIVE_PROVIDERS.has(v)) return "text-teal border-teal/40 bg-teal/10";
  // founder-gated = hosted public preview blocks Codex spend — a specific state,
  // not "live" and not a plain failure. Violet, matching the FOUNDER badge.
  if (v === "founder-gated") return "text-violet border-violet/40 bg-violet/10";
  if (v.includes("cache")) return "text-amber border-amber/40 bg-amber/10";
  return "text-fog border-[color:var(--surface-border)] bg-[color:var(--surface-2)]";
}

// Affirmative provenance pill for reports — LIVE vs SAMPLE (and cache/unavailable),
// so a judge instantly knows whether a card reflects their scan or example data.
function StatusPill({ kind }: { kind: "live" | "sample" | "cache" | "captured" | "unavailable" }) {
  const map = {
    live: { label: "LIVE SCAN RESULT", cls: "text-teal border-teal/40 bg-teal/10" },
    sample: { label: "SAMPLE SHIFT", cls: "text-fog/80 border-[color:var(--surface-border)] bg-[color:var(--surface-2)]" },
    cache: { label: "CACHE", cls: "text-amber border-amber/40 bg-amber/10" },
    captured: { label: "CAPTURED SCAN", cls: "text-amber border-amber/40 bg-amber/10" },
    unavailable: { label: "UNAVAILABLE", cls: "text-fog border-[color:var(--surface-border)] bg-[color:var(--surface-2)]" },
  }[kind];
  return <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${map.cls}`}>{map.label}</span>;
}

// Provenance derived from the run's ACTUAL source — never hardcoded. Live scans
// set source "live-*"/"live" (see orchestrator); demo-cache / cache-fallback /
// empty is CACHE; an explicit unavailable stays UNAVAILABLE. Mirrors the honest
// ProviderLedger map so the loud hero pill can't claim LIVE on a cached result.
// (honesty invariant: never label a non-live provider as LIVE.)
function scanPillKind(source?: string): "live" | "cache" | "unavailable" {
  const s = (source ?? "").toLowerCase();
  if (s.includes("unavailable")) return "unavailable";
  if (s.startsWith("live")) return "live";
  return "cache";
}

// Minimal SSE reader over fetch's ReadableStream — lets the Ask + Detective
// panels render the first tokens in ~1–3s (streaming) instead of blocking on the
// whole response. Parses `event:` / `data:` frames separated by blank lines.
async function readSSE(res: Response, onEvent: (event: string, data: string) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      let ev = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) onEvent(ev, data);
    }
  }
}

const SCAN_STEPS = ["Dispatching the night crew", "Cloning a disposable checkout", "Querying OSV advisories", "Assembling the report"];

// --- Scan speed controls ----------------------------------------------------
// The model + reasoning effort are the biggest levers on how long a scan takes;
// crew size (1 vs 3 agents) multiplies the number of Codex calls. Only whitelisted
// values are sent — the backend re-validates and ignores anything unexpected.
type ModelId = "gpt-5.6-luna" | "gpt-5.6-terra";
type Effort = "low" | "medium" | "high";
type Crew = "quick" | "full";

const MODELS: { id: ModelId; label: string }[] = [
  { id: "gpt-5.6-luna", label: "Fast" },
  { id: "gpt-5.6-terra", label: "Balanced" },
];
const EFFORTS: Effort[] = ["low", "medium", "high"];

// Rough, deliberately conservative wall-clock estimate: per-call seconds (model ×
// effort) × ~one Codex call per agent, plus clone/OSV overhead. Labelled as an
// approximation in the UI; warns when the heaviest combo nears Cloud Run's 15-min cap.
function estimateEta(model: ModelId, effort: Effort, crew: Crew): { label: string; warn: boolean } {
  const perCall = { "gpt-5.6-luna": { low: 30, medium: 55, high: 90 }, "gpt-5.6-terra": { low: 55, medium: 100, high: 180 } }[model][effort];
  const secs = perCall * (crew === "quick" ? 1 : 3) + 20;
  const label = secs < 90 ? "under ~1½ min" : secs < 240 ? "~2–4 min" : secs < 480 ? "~4–8 min" : secs < 780 ? "~8–13 min" : "~13+ min";
  return { label, warn: secs > 600 };
}

// A short, formal verdict derived from the score itself (not model prose), used
// as the headline above the analyst summary on the score card.
function scoreVerdict(score: number): { label: string; tone: string; note: string } {
  if (score >= 80) return { label: "Low risk", tone: "text-teal", note: "Clean — nothing pressing." };
  if (score >= 60) return { label: "Needs attention", tone: "text-amber", note: "Fixable risks remain." };
  if (score >= 30) return { label: "Elevated risk", tone: "text-amber", note: "Address the advisories below." };
  // A floored score (many advisories) is a deliberate, severe rating — label it as
  // such so it reads as a real finding, not a missing value.
  return { label: "Critical risk", tone: "text-[color:var(--sev-critical)]", note: "Multiple unpatched advisories — patch before shipping." };
}

// A labelled sample shift — shown in the logged-out preview and never passed off
// as live. Same canonical incident as the homepage (express CVE-2024-29041 / a9c31f).
const DEMO_RESULT: ScanResult = {
  umbra_score: 78,
  source: "demo-cache",
  repo_url: "https://github.com/expressjs/express",
  reasoning_summary: "Two fixable risks remain — a high-severity advisory with a prepared patch, and one incident traced to its root-cause commit. Nothing was merged.",
  vulnerabilities: [
    { package: "express", version: "4.17.1", cve: "CVE-2024-29041", severity: "high", owasp: "A06:2021", summary: "Open redirect via malformed URL handling. Upgrade to express@4.19.2." },
  ],
  dependencies: [
    { name: "express", version: "4.17.1", vulnerable: true },
    { name: "lodash", version: "4.17.21", vulnerable: false },
    { name: "react", version: "18.2.0", vulnerable: false },
    { name: "minimist", version: "1.2.8", vulnerable: false },
  ],
  agent_results: [
    { agent: "watchman", summary: "Flagged CVE-2024-29041 in express@4.17.1 — patch to express@4.19.2 prepared.", findings: [], replay: { agent: "watchman", prompt: "", codex_diff: "", tests: "", reasoning: "", timings: {}, providers: { advisories: "osv.dev", engineering: "codex-cli", reasoning: "responses-api" } } },
    { agent: "detective", summary: "Traced the incident through git history to commit a9c31f.", findings: [], replay: { agent: "detective", prompt: "", codex_diff: "", tests: "", reasoning: "", timings: {}, providers: { reasoning: "responses-api", vulnerabilities: "osv.dev" } } },
    { agent: "reviewer", summary: "Scored PR #128 — blast-radius low, safe to merge.", findings: [], replay: { agent: "reviewer", prompt: "", codex_diff: "", tests: "", reasoning: "", timings: {}, providers: { review: "codex-cli", reasoning: "responses-api" } } },
    { agent: "janitor", summary: "Swept 4 dead exports from utils/legacy.ts — cleanup PR drafted.", findings: [], replay: { agent: "janitor", prompt: "", codex_diff: "", tests: "", reasoning: "", timings: {}, providers: { engineering: "codex-cli" } } },
    { agent: "ask", summary: "Answered 3 questions, each grounded to a real reference — router.js:22.", findings: [], replay: { agent: "ask", prompt: "", codex_diff: "", tests: "", reasoning: "", timings: {}, providers: { reasoning: "responses-api-stream" } } },
  ],
  autonomy: { level: 1, label: "Prepare diff", auto_merge: false, human_review_required: true },
  policy: { loaded: false, summary: "Default Umbra policy applied: prepare reviewable work, never auto-merge." },
};

export default function Dashboard() {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [apiUp, setApiUp] = useState<boolean | null>(null); // backend reachability (null = probing)
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoError, setRepoError] = useState<{ status: number; msg: string } | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  // Scan speed profile — defaults to the fastest usable combo for a snappy first run.
  const [model, setModel] = useState<ModelId>("gpt-5.6-luna");
  const [effort, setEffort] = useState<Effort>("low");
  // Default to the fast single-agent path (Quick · 1) so a guest/judge's first scan
  // is snappy; logged-in users are bumped to the full crew on load (see the /api/me
  // effect below). Full · 3 stays explicitly selectable for everyone.
  const [crew, setCrew] = useState<Crew>("quick");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [history, setHistory] = useState<Scan[]>([]);
  const [appInfo, setAppInfo] = useState<{ configured: boolean; install_url: string | null } | null>(null);
  const [appInstalls, setAppInstalls] = useState<{ installation_id: number; account_login: string; repos: string[] }[]>([]);
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [activeReplay, setActiveReplay] = useState<Replay | null>(null);
  const [prTarget, setPrTarget] = useState<{ mode: "bump" | "codex" | "bump_all" | "combine"; vuln?: Vuln } | null>(null);
  // A PR that was just opened — surfaced as a persistent toast so the "it's ready"
  // signal survives after the dialog closes. Umbra never merges; this is advisory.
  const [prOpened, setPrOpened] = useState<{ url: string; number: number; branch: string; base: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [viewingSaved, setViewingSaved] = useState<string | null>(null);
  // When set, the dashboard is showing the bundled real-but-captured proof scan
  // (instant, no wait) rather than a live run — labelled CAPTURED SCAN, never live.
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [triageList, setTriageList] = useState<TriageRec[]>([]);
  const [prList, setPrList] = useState<PrRecord[]>([]);
  const [onboardDismissed, setOnboardDismissed] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Onboarding guide dismissal persists across reloads (client-only; read after
  // mount so there's no hydration mismatch).
  useEffect(() => { try { if (localStorage.getItem("umbra-onboarding-dismissed") === "1") setOnboardDismissed(true); } catch {} }, []);
  const dismissOnboarding = useCallback(() => { setOnboardDismissed(true); try { localStorage.setItem("umbra-onboarding-dismissed", "1"); } catch {} }, []);

  const loadHistory = useCallback(() => {
    fetch(`${API}/api/my/scans`, creds).then((r) => (r.ok ? r.json() : [])).then((d: Scan[]) => Array.isArray(d) && setHistory(d)).catch(() => {});
  }, []);

  // The PR ledger — every branch-only PR Umbra opened for this user (durable
  // receipts: PR #, branch, the advisory it fixes, the Reviewer verdict). Refreshed
  // after any open so a just-created PR appears without a reload.
  const loadPrs = useCallback(() => {
    fetch(`${API}/api/my/prs`, creds).then((r) => (r.ok ? r.json() : [])).then((d: PrRecord[]) => Array.isArray(d) && setPrList(d)).catch(() => {});
  }, []);

  const loadSchedules = useCallback(() => {
    fetch(`${API}/api/my/schedules`, creds).then((r) => (r.ok ? r.json() : [])).then((d: Schedule[]) => Array.isArray(d) && setSchedules(d)).catch(() => {});
  }, []);

  // Turn report emails on/off from the dashboard (inverse of the opt-out flag the
  // email unsubscribe link sets). Optimistic; refetch not needed.
  const setNotifications = useCallback(async (enabled: boolean) => {
    setUser((u) => (u && u !== "loading" ? { ...u, notifications_opt_out: !enabled } : u));
    await fetch(`${API}/api/my/notifications`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ enabled }) }).catch(() => {});
  }, []);

  // PR auto-review is an install-once GitHub App: the user installs it (and picks
  // repos) in GitHub's own UI, so there is nothing to toggle here — we just show
  // whether it's available and which repos it currently covers.
  const loadApp = useCallback(() => {
    fetch(`${API}/api/github/app`, creds).then((r) => (r.ok ? r.json() : null)).then((d) => d && setAppInfo(d)).catch(() => {});
    fetch(`${API}/api/my/app-installations`, creds).then((r) => (r.ok ? r.json() : [])).then((d) => Array.isArray(d) && setAppInstalls(d)).catch(() => {});
  }, []);

  // Persisted per-user remediation-queue dismissals, so hidden advisories stay
  // hidden across reloads (the queue itself is derived from saved scans).
  const loadDismissals = useCallback(() => {
    fetch(`${API}/api/my/remediation-dismissals`, creds).then((r) => (r.ok ? r.json() : { keys: [] })).then((d) => setDismissedKeys(new Set(d?.keys ?? []))).catch(() => {});
  }, []);

  // Persisted per-user finding triage (open / snoozed / accepted_risk). Suppressions
  // carry a reason, so the activity timeline + evidence show WHY a finding was set aside.
  const loadTriage = useCallback(() => {
    fetch(`${API}/api/my/triage`, creds).then((r) => (r.ok ? r.json() : [])).then((d: TriageRec[]) => Array.isArray(d) && setTriageList(d)).catch(() => {});
  }, []);

  const applyTriage = useCallback(async (findingKey: string, status: string, reason?: string, repo?: string) => {
    // Optimistic: reopen removes the record; snooze/accept upserts it to the top.
    // Snapshot the prior list so a failed POST can be rolled back — the ledger +
    // audit timeline must NEVER assert a suppression the store didn't record.
    let snapshot: TriageRec[] = [];
    setTriageList((list) => {
      snapshot = list;
      const rest = list.filter((t) => t.finding_key !== findingKey);
      return status === "open" ? rest : [{ finding_key: findingKey, status, reason, repo, updated_at: new Date().toISOString() }, ...rest];
    });
    try {
      const res = await fetch(`${API}/api/my/triage`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ finding_key: findingKey, status, reason, repo }) });
      if (!res.ok) throw new Error(`triage ${res.status}`);
    } catch {
      setTriageList(snapshot); // revert the optimistic change
      loadTriage(); // reconcile with server truth
    }
  }, [loadTriage]);

  const loadRepos = useCallback(() => {
    setRepoError(null);
    setRepos(null);
    fetch(`${API}/api/my/repos`, creds)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw Object.assign(new Error(body?.detail || `Repo listing failed (${r.status})`), { status: r.status });
        }
        return r.json();
      })
      .then((d: Repo[]) => { if (Array.isArray(d)) { setRepos(d); if (d.length && !repoUrl) setRepoUrl(d[0].url); } })
      .catch((e: Error & { status?: number }) => { setRepos([]); setRepoError({ status: e.status ?? 0, msg: e.message }); });
  }, [repoUrl]);

  // Backend reachability probe — a rejected fetch (connection refused / CORS)
  // means the API is down; any HTTP response (even 401) means it's reachable. Lets
  // the dashboard tell a judge to start the API instead of silently failing scans.
  useEffect(() => {
    fetch(`${API}/api/health`).then(() => setApiUp(true)).catch(() => setApiUp(false));
  }, []);

  // Auth gate — logged-out visitors are NOT redirected; they get the public
  // Mission Control preview (a labelled demo shift + a working public scan).
  useEffect(() => {
    fetch(`${API}/api/me`, creds)
      .then((r) => { if (!r.ok) throw new Error("unauthenticated"); return r.json(); })
      .then((me: User) => {
        setUser(me);
        setCrew("full"); // logged-in users get the complete dispatch by default
        if (me.github_connected) { loadRepos(); }
        loadApp();
        loadHistory();
        loadDismissals();
        loadSchedules();
        loadTriage();
        loadPrs();
      })
      .catch(() => { setUser(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const launchScan = useCallback(async (target?: string) => {
    // Canonicalise whatever was typed/passed (owner/repo, github.com/…, https://…)
    // so the scan always POSTs a valid GitHub URL.
    const url = normalizeRepoUrl(target ?? repoUrl);
    if (scanning || !url) return;
    if (target && target !== repoUrl) setRepoUrl(target);
    setScanning(true); setScanError(null); setResult(null); setStep(0); setElapsed(0); setViewingSaved(null); setCapturedAt(null);
    scrollToTop();
    // The step checklist advances on a slow cadence but is CAPPED at the second-to-last
    // step until the real response arrives — so the UI never claims "report assembled"
    // before the backend actually returns. A live elapsed timer shows real progress of
    // time, and the scan is cancellable.
    stepTimer.current = setInterval(() => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 2)), 2200);
    elapsedTimer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    const controller = new AbortController();
    scanAbort.current = controller;
    try {
      const res = await fetch(`${API}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", signal: controller.signal, body: JSON.stringify({ repo_url: url, model, reasoning_effort: effort, agents: crew === "quick" ? ["watchman"] : undefined }) });
      if (!res.ok) throw new Error(`scan returned ${res.status}`);
      const data: ScanResult = await res.json();
      setStep(SCAN_STEPS.length - 1); // only now is the report actually assembled
      setResult(data);
      // Persist the FULL report so this scan can be re-opened later without re-scanning.
      fetch(`${API}/api/my/scans`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_full_name: repoFullName(url), umbra_score: data.umbra_score, source: data.source ?? "demo-cache", vuln_count: (data.vulnerabilities ?? []).length, report: data }) }).then(loadHistory).catch(() => {});
    } catch (e) {
      if ((e as Error).name === "AbortError") setScanError("Scan cancelled.");
      else setScanError((e as Error).message);
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      scanAbort.current = null;
      setScanning(false);
    }
  }, [repoUrl, scanning, loadHistory, model, effort, crew]);

  const cancelScan = useCallback(() => {
    scanAbort.current?.abort();
  }, []);

  // Open the bundled captured proof scan instantly (no backend round-trip) so a
  // judge sees a working scan without the ~90s live wait. The JSON is genuine scan
  // output; `as const` narrows it to readonly, hence the structural cast.
  const openCaptured = useCallback(() => {
    if (scanning) return;
    setScanError(null); setViewingSaved(null); setResult(PROOF_SCAN as unknown as ScanResult); setCapturedAt(PROOF_CAPTURED_AT);
    setRepoUrl(`github.com/${PROOF_REPO}`); // align the scan input with the captured report
    scrollToTop();
  }, [scanning]);

  // Landing handoff: `/dashboard?repo=owner/name` pre-fills the target and kicks
  // off one public scan so a judge arriving from the hero sees a live result
  // immediately (falls back to the labelled demo if the scan can't run).
  const booted = useRef(false);
  useEffect(() => {
    // Wait for auth to resolve so the ?proof gate below can trust the guest check.
    if (user === "loading" || booted.current) return;
    const params = new URLSearchParams(window.location.search);
    // `/dashboard?proof=...` opens the captured proof scan instantly (landing CTA).
    // It's a judge-facing artifact, so only for guests — a logged-in user working
    // the platform keeps their own session even if they follow that landing link.
    if (params.get("proof")) {
      booted.current = true;
      if (user === null) openCaptured();
      return;
    }
    // `/dashboard?scan=<id>` opens a specific saved report — the target of the
    // morning-report email's "View report" link. Logged-in only (it's the user's
    // own report); lands them on the loaded shift with the remediation actions.
    const scanId = params.get("scan");
    if (scanId && user) {
      booted.current = true;
      fetch(`${API}/api/my/scans/${encodeURIComponent(scanId)}`, creds)
        .then((r) => (r.ok ? r.json() : null))
        .then((s: Scan | null) => { if (s?.report) { setResult(s.report); setViewingSaved(s.ran_at ? new Date(s.ran_at).toLocaleString() : s.repo_full_name); scrollToTop(); } })
        .catch(() => {});
      return;
    }
    const raw = params.get("repo");
    if (!raw) return;
    booted.current = true;
    const url = normalizeRepoUrl(raw);
    if (!url) return;
    setRepoUrl(url);
    launchScan(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Logged-out preview: default the public input to the sample repo (matching the
  // sample header/state) when there's no ?repo handoff and nothing typed yet.
  useEffect(() => {
    if (user === null && !repoUrl && !new URLSearchParams(window.location.search).get("repo")) {
      setRepoUrl("github.com/expressjs/express");
    }
  }, [user, repoUrl]);

  const viewSaved = useCallback((s: Scan) => {
    // Older history rows were saved before full reports were persisted — re-run
    // them instead of showing a dead link, so every row stays actionable.
    if (!s.report) { launchScan(`https://github.com/${s.repo_full_name}`); return; }
    setResult(s.report);
    setViewingSaved(s.ran_at ? new Date(s.ran_at).toLocaleString() : s.repo_full_name);
    setScanError(null);
    scrollToTop();
  }, [launchScan]);

  const saveKey = useCallback(async () => {
    if (!keyInput.trim().startsWith("sk-")) return;
    setSavingKey(true);
    try {
      const r = await fetch(`${API}/api/my/openai-key`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ api_key: keyInput.trim() }) });
      if (r.ok) { setUser((u) => (u && u !== "loading" ? { ...u, has_openai_key: true } : u)); setKeyInput(""); }
    } finally { setSavingKey(false); }
  }, [keyInput]);

  const removeKey = useCallback(async () => {
    await fetch(`${API}/api/my/openai-key`, { method: "DELETE", credentials: "include" });
    setUser((u) => (u && u !== "loading" ? { ...u, has_openai_key: false } : u));
  }, []);

  const logout = useCallback(() => {
    fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).finally(() => window.location.replace("/"));
  }, []);

  const [clearingHistory, setClearingHistory] = useState(false);
  const clearHistory = useCallback(async () => {
    // Privacy control: deletes every saved scan for this user server-side, not
    // just from the local view.
    if (!window.confirm("Delete all saved scans? This permanently removes them from Umbra and can't be undone.")) return;
    setClearingHistory(true);
    try {
      await fetch(`${API}/api/my/scans`, { method: "DELETE", credentials: "include" });
      setHistory([]); setSelectedScans(new Set());
      if (viewingSaved) { setViewingSaved(null); setResult(null); }
    } finally { setClearingHistory(false); }
  }, [viewingSaved]);

  const toggleScan = useCallback((id: string) => {
    setSelectedScans((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);
  const clearSelectedScans = useCallback(async () => {
    const ids = [...selectedScans].filter(Boolean);
    if (ids.length === 0) return;
    await fetch(`${API}/api/my/scans/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ scan_ids: ids }) }).catch(() => {});
    const dropped = new Set(ids);
    setHistory((h) => h.filter((s) => !dropped.has(s.scan_id ?? "")));
    setSelectedScans(new Set());
  }, [selectedScans]);

  const dismissRemediation = useCallback(async (key: string) => {
    setDismissedKeys((prev) => new Set(prev).add(key));
    await fetch(`${API}/api/my/remediation-dismissals`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ keys: [key] }) }).catch(() => {});
  }, []);
  const restoreRemediation = useCallback(async (key: string) => {
    setDismissedKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
    await fetch(`${API}/api/my/remediation-dismissals/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ keys: [key] }) }).catch(() => {});
  }, []);

  // For a logged-out visitor with no target yet, default the live tools (Ask /
  // Detective) to the demo repo so they work without an account.
  const targetRepo = (result?.repo_url || repoUrl || (user === null ? DEMO_RESULT.repo_url : "") || "").trim();
  const filteredRepos = useMemo(() => (repos ?? []).filter((r) => r.full_name.toLowerCase().includes(repoQuery.toLowerCase())), [repos, repoQuery]);
  // Repos currently covered by an installed Umbra App (auto-PR-review on).
  const coveredRepos = useMemo(() => new Set(appInstalls.flatMap((i) => i.repos)), [appInstalls]);
  // Watchman's proposed patch from the current scan — reused to open a PR in
  // seconds (no second Codex run) instead of re-deriving the fix from scratch.
  const watchmanDiff = useMemo(() => result?.agent_results?.find((a) => a.agent === "watchman")?.replay?.codex_diff ?? "", [result]);
  // Janitor's cleanup diff from the same scan — paired with Watchman's for the
  // optional "combine crew changes into one PR" action.
  const janitorDiff = useMemo(() => result?.agent_results?.find((a) => a.agent === "janitor")?.replay?.codex_diff ?? "", [result]);
  // Finding_key → triage record, for O(1) status lookup in the ledger. Kept here
  // (above the early return) so hook order is stable.
  const triageMap = useMemo(() => new Map(triageList.map((t) => [t.finding_key, t] as const)), [triageList]);

  if (user === "loading") return <AuthLoading />;

  const guest = user === null;
  const me: User | null = user; // narrowed: User | null (guest = null)
  const canPr = !!me?.github_connected;
  // What the Current-Shift / Findings zones display: the live result, or — for a
  // logged-out visitor with no live result yet — a labelled sample shift.
  const shift = result ?? (guest ? DEMO_RESULT : null);
  const showingDemo = !result && guest;
  const captured = !!capturedAt; // viewing the bundled real-but-captured proof scan
  const shiftVulns = shift?.vulnerabilities ?? [];
  const shiftDeps = shift?.dependencies ?? [];
  const shiftRepo = shift?.repo_url ? repoFullName(shift.repo_url) : repoUrl ? repoFullName(repoUrl) : "no target";
  // Triage is a real, persisted, logged-in action — hidden on demo/captured views
  // (which also disable PR actions) so it never implies persistence a guest lacks.
  const canTriage = !!me && !showingDemo && !captured;
  // Phase drives the command header + crew board. The guest sample preview reads
  // as a *filed* shift (matching its sample score/findings); a real logged-in
  // dashboard with no scan yet reads "standing by". Live scans progress normally.
  const phase: Phase = scanning ? "scanning" : result || showingDemo ? "done" : "idle";

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] px-6 pb-24 md:px-10">
      {/* Accessible page title — visually hidden (the CommandHeader carries the brand
          visually) but present as the single <h1> for screen readers and SEO. */}
      <h1 className="sr-only">Umbra — Mission Control: govern and prove every coding-agent change</h1>
      {/* Backdrop — a faint operational grid + one subtle spotlight on the current
          shift. No animated beams; mission control reads calm, dense, legible. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 dot-bg opacity-[0.05]" />
        <Spotlight className="left-0 top-[-26%] md:left-[22%]" fill="#22d3ee" />
      </div>

      <CommandHeader me={me} repo={shiftRepo} phase={phase} onLogout={logout} />

      {/* ── Zone 01 · Current shift ─────────────────────────────────────────── */}
      <section className="relative pt-6">
        <ZoneLabel n="01" title="Current shift" hint={guest ? "public preview" : undefined} />

        {guest && <JudgePath onOpenCaptured={openCaptured} />}

        {/* First-run guide — shown until the essentials (connect GitHub + first
            scan) are done, or dismissed. Reflects real account state only. */}
        {me && !onboardDismissed && !(me.github_connected && history.length > 0) && (
          <OnboardingChecklist
            me={me}
            hasScanned={history.length > 0 || !!result}
            hasPr={prList.length > 0}
            hasSchedule={schedules.length > 0}
            onScan={scrollToTop}
            onDismiss={dismissOnboarding}
          />
        )}

        {/* Command bar — issue the scan */}
        {me ? (
          <RepoPicker
            user={me}
            repos={repos}
            repoError={repoError}
            onRetry={loadRepos}
            filtered={filteredRepos}
            query={repoQuery}
            setQuery={setRepoQuery}
            repoUrl={repoUrl}
            setRepoUrl={setRepoUrl}
            scanning={scanning}
            onRun={() => launchScan()}
            coveredRepos={coveredRepos}
          />
        ) : (
          <GuestScanBar repoUrl={repoUrl} setRepoUrl={setRepoUrl} scanning={scanning} onRun={() => launchScan()} />
        )}
        <ScanOptions model={model} setModel={setModel} effort={effort} setEffort={setEffort} crew={crew} setCrew={setCrew} />
        <ApiStatus up={apiUp} onOpenCaptured={openCaptured} />
        {me && <AutoReviewPanel appInfo={appInfo} installs={appInstalls} />}
        {scanError && <p className="mt-3 font-mono text-xs text-[color:var(--sev-critical)]">Scan unavailable: {scanError}{guest ? " — showing the sample shift below." : ""}</p>}

        {/* Scan progress */}
        <AnimatePresence>
          {scanning && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <GlowCard className="mt-5 p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan">Running · {repoFullName(repoUrl)}</p>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] tabular-nums text-fog" aria-live="polite">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed</span>
                    <button onClick={cancelScan} className="rounded-lg border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-rose-400/50 hover:text-cloud">Cancel</button>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5">
                  {SCAN_STEPS.map((s, i) => (
                    <div key={s} className="flex items-center gap-3 text-sm">
                      <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${i < step ? "border-teal/50 bg-teal/15 text-teal" : i === step ? "border-cyan/50 text-cyan" : "border-[color:var(--surface-border)] text-fog"}`}>
                        {i < step ? "✓" : i === step ? <span className="h-2 w-2 animate-spin rounded-full border border-cyan border-t-transparent" /> : i + 1}
                      </span>
                      <span className={i <= step ? "text-cloud" : "text-fog"}>{s}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 font-mono text-[10px] leading-snug text-fog/60">Live work — a full crew scan can take a few minutes on a cold clone. The last step completes only when the real report returns.</p>
              </GlowCard>
            </motion.div>
          )}
        </AnimatePresence>

        {viewingSaved && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan/30 bg-cyan/5 px-4 py-3 text-[13px]">
            <span className="text-fog">Viewing a saved report{result?.repo_url ? ` for ${repoFullName(result.repo_url)}` : ""} · {viewingSaved}</span>
            <button onClick={() => { setResult(null); setViewingSaved(null); }} className="font-mono text-[12px] text-cyan hover:underline">Back to scanning →</button>
          </div>
        )}

        {captured && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px]">
            <span className="min-w-0 text-fog">Viewing a <span className="text-amber">real scan captured {capturedAt}</span> on <span className="break-all text-cloud">{PROOF_REPO}</span> — shown instantly, no wait. Every result below is genuine output from that run. <span className="text-fog/80">Captured snapshot: PR actions are disabled here — launch a live scan to open branch-only PRs.</span></span>
            <button onClick={() => { setResult(null); setCapturedAt(null); }} className="shrink-0 font-mono text-[12px] text-cyan hover:underline">Back to scanning →</button>
          </div>
        )}

        {/* Shift at a glance — a filed shift reads as the cinematic Shift Report
            (hero score) followed by the live Crew Dossier (each agent's real
            operational artifact, honest per-agent status). An idle logged-in
            dashboard shows the awaiting score + a standby dossier so it still
            reads as mission control while it waits for the next scan. */}
        {!scanning && (
          shift ? (
            <>
              <ShiftReport result={shift} repo={shiftRepo} demo={showingDemo} capturedAt={capturedAt} />
              <ShiftDossier
                result={shift}
                mode={showingDemo ? "sample" : captured ? "captured" : "live"}
                founder={!!me?.is_founder}
                onOpenReplay={setActiveReplay}
                onGotoOperations={() => document.getElementById("operations")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            </>
          ) : (
            <div className="mt-5 flex flex-col gap-5">
              <ScorePanel result={null} demo={false} capturedAt={null} />
              <ShiftDossier
                result={{}}
                mode="live"
                founder={!!me?.is_founder}
                onOpenReplay={setActiveReplay}
                onGotoOperations={() => document.getElementById("operations")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            </div>
          )
        )}
      </section>

      {/* ── Zone 02 · Agent Admission ───────────────────────────────────────── */}
      {!scanning && (
        <section className="relative mt-14">
          <ZoneLabel n="02" title="Agent Admission" hint="does the agent obey this repo's rules?" />
          <AgentAdmission repo={targetRepo} signedIn={!!me} />
        </section>
      )}

      {/* ── Zone 03 · Findings ──────────────────────────────────────────────── */}
      {shift && !scanning && (
        <section className="relative mt-14">
          <ZoneLabel n="03" title="Findings" hint={showingDemo ? "sample" : captured ? `captured ${capturedAt}` : shift.source} />
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="flex flex-col gap-5">
              <FindingsLedger vulns={shiftVulns} canPr={canPr && !showingDemo && !captured} demo={showingDemo} onOpenPr={(v) => setPrTarget({ mode: "bump", vuln: v })} onOpenPrAll={() => setPrTarget({ mode: "bump_all" })} repo={shiftRepo} canTriage={canTriage} triage={triageMap} onTriage={applyTriage} />
              <div className="flex flex-wrap gap-2">
                {canPr && !showingDemo && !captured && watchmanDiff.trim() && janitorDiff.trim() && (
                  <button onClick={() => setPrTarget({ mode: "combine" })} className="self-start rounded-full border border-cyan/40 bg-cyan/10 px-3.5 py-1.5 font-mono text-[11px] text-cyan transition-colors hover:bg-cyan/20">Combine crew changes → one PR</button>
                )}
                {me?.is_founder && canPr && !showingDemo && !captured && shiftVulns.length > 0 && (
                  <button onClick={() => setPrTarget({ mode: "codex" })} className="self-start rounded-full border border-violet/40 bg-violet/10 px-3.5 py-1.5 font-mono text-[11px] text-violet transition-colors hover:bg-violet/20">Open a Codex fix PR →</button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-5">
              <DependencyRiskMap deps={shiftDeps} />
              <OpenAiStrip />
              <ProviderLedger result={shift} demo={showingDemo} founder={!!me?.is_founder} capturedAt={capturedAt} />
              <AutonomyCard autonomy={shift.autonomy} />
              <PolicyCard policy={shift.policy} />
              <EvidencePackButton result={shift} mode={showingDemo ? "demo" : captured ? "captured" : "live"} />
            </div>
          </div>
          {/* Activity / audit trail — what actually ran this shift, in order, from
              real data; logged-in users also see their triage decisions + history. */}
          <div className="mt-6">
            <AuditTimeline
              shift={shift}
              history={me && !captured ? history : []}
              triage={me && !captured ? triageList : []}
              mode={showingDemo ? "sample" : captured ? "captured" : "live"}
              onOpenReplay={setActiveReplay}
            />
          </div>
        </section>
      )}

      {/* ── Zone 03 · Operations & actions ──────────────────────────────────── */}
      {targetRepo && !scanning && (
        <section id="operations" className="relative mt-14">
          <ZoneLabel n="04" title="Operations" hint={repoFullName(targetRepo)} />
          <div className="grid gap-5 lg:grid-cols-2">
            <AskPanel repo={targetRepo} />
            <DetectivePanel repo={targetRepo} />
          </div>
        </section>
      )}

      {/* Guest → invite to sign in for the full cockpit */}
      {guest && (
        <section className="mt-14">
          <GlowCard className="flex flex-col items-start gap-4 p-7 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-serif text-xl">This is the public preview.</p>
              <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-fog">Scan any public repo above without an account. Sign in to scan your <b className="text-cloud">private</b> repositories, save shift history, and open branch-only fix PRs.</p>
            </div>
            <Magnetic><HoverBorderGradient href={`${API}/auth/login/github`} className="shrink-0 px-6 py-3.5 text-sm font-semibold"><GitHubIcon className="h-4 w-4" /> Sign in to scan private repos</HoverBorderGradient></Magnetic>
          </GlowCard>
        </section>
      )}

      {/* ── Logged-in only: live-reasoning key, portfolio, history ──────────── */}
      {me && (
        <>
          <section className="mt-14">
            <ByoKeyPanel user={me} keyInput={keyInput} setKeyInput={setKeyInput} onSave={saveKey} onRemove={removeKey} saving={savingKey} />
          </section>

          <section className="mt-10">
            <ScheduledReportsPanel user={me} schedules={schedules} defaultRepo={targetRepo ? repoFullName(targetRepo) : ""} onRefresh={loadSchedules} onSetNotifications={setNotifications} />
          </section>

          {prList.length > 0 && (
            <section className="mt-10">
              <PrLedger prs={prList} />
            </section>
          )}

          {history.length > 0 && (
            <section className="mt-10 grid gap-6">
              <RepoRollup history={history} onView={viewSaved} />
              <RemediationQueue history={history} canPr={canPr} dismissed={dismissedKeys} onDismiss={dismissRemediation} onRestore={restoreRemediation} onOpened={loadPrs} />
            </section>
          )}

          {history.length > 0 && (() => {
            const selectableIds = history.map((s) => s.scan_id).filter((id): id is string => !!id);
            const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedScans.has(id));
            return (
              <section className="mt-10">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-fog">Past shifts</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectableIds.length > 0 && (
                      <button onClick={() => setSelectedScans(allSelected ? new Set() : new Set(selectableIds))} className="rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2 font-mono text-[11px] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">
                        {allSelected ? "Deselect all" : "Select all"}
                      </button>
                    )}
                    {selectedScans.size > 0 && (
                      <button onClick={clearSelectedScans} className="rounded-xl border border-rose-400/40 px-3.5 py-2 font-mono text-[11px] text-[color:var(--sev-critical)] transition-colors hover:bg-rose-400/10">Clear selected ({selectedScans.size})</button>
                    )}
                    <button onClick={clearHistory} disabled={clearingHistory} className="rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2 font-mono text-[11px] text-fog transition-colors hover:border-rose-400/50 hover:text-[color:var(--sev-critical)] disabled:opacity-50">
                      {clearingHistory ? "Clearing…" : "Clear all"}
                    </button>
                  </div>
                </div>
                <p className="mb-4 text-[13px] text-fog">Every report is saved — click one to re-open the full findings without re-scanning. Tick rows to remove just those, or clear everything. Clearing removes them permanently from Umbra.</p>
                <div className="flex flex-col gap-2.5">
                  {history.map((s, i) => {
                    const openable = !!s.report;
                    const id = s.scan_id ?? "";
                    const checked = !!id && selectedScans.has(id);
                    return (
                      <div key={id || i} className={`group flex items-center gap-3 rounded-xl border bg-[color:var(--surface)] pl-3 pr-4 transition-colors ${checked ? "border-cyan/50" : "border-[color:var(--surface-border)] hover:border-cyan/40"}`}>
                        <input type="checkbox" checked={checked} onChange={() => id && toggleScan(id)} disabled={!id} aria-label={`Select scan of ${s.repo_full_name}`} title={id ? "Select for removal" : "Older scan — removable only via Clear all"} className="h-4 w-4 shrink-0 cursor-pointer accent-cyan disabled:cursor-not-allowed disabled:opacity-30" />
                        <button onClick={() => viewSaved(s)} className="flex flex-1 items-center justify-between gap-3 py-3 text-left text-sm">
                          <b className="font-mono text-[13px] text-cyan/90">{s.repo_full_name}</b>
                          <span className="text-[12px] text-fog">score {s.umbra_score ?? "—"} · {s.vuln_count ?? 0} advisories · {s.source}</span>
                          <span className="flex items-center gap-3">
                            <time className="font-mono text-[10px] text-fog">{s.ran_at ? new Date(s.ran_at).toLocaleString() : ""}</time>
                            <span className="font-mono text-[11px] text-cyan">{openable ? "View report →" : "Re-scan →"}</span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}
        </>
      )}

      {/* Replay modal */}
      <ReplayModal replay={activeReplay} onClose={() => setActiveReplay(null)} />

      {/* Pull-request confirm dialog (explicit, branch-only, never merges) */}
      {me && <PrDialog target={prTarget} repo={targetRepo} diff={watchmanDiff} diffs={[watchmanDiff, janitorDiff]} model={model} effort={effort} onClose={() => setPrTarget(null)} onOpened={(pr) => { setPrOpened(pr); loadPrs(); }} />}

      {/* PR-ready toast — the shift produced something you can act on */}
      <PrReadyToast pr={prOpened} onDismiss={() => setPrOpened(null)} />
    </main>
  );
}

// Persistent, dismissible confirmation that a pull request is up and clean. It is
// advisory only — Umbra opens PRs and never merges, so the human does the merge.
function PrReadyToast({ pr, onDismiss }: { pr: { url: string; number: number; branch: string; base: string } | null; onDismiss: () => void }) {
  return (
    <AnimatePresence>
      {pr && (
        <motion.div
          className="fixed inset-x-0 bottom-5 z-50 mx-auto w-[min(440px,calc(100%-2rem))]"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ duration: 0.32, ease: EASE }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-teal/40 bg-ink-2/95 p-4 shadow-[0_20px_60px_-24px_rgba(94,234,212,0.35)] backdrop-blur">
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(94,234,212,0.7), transparent)" }} />
            <button onClick={onDismiss} className="absolute right-3 top-2.5 text-lg leading-none text-fog hover:text-cloud">×</button>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-teal/50 bg-teal/10 text-[13px] text-teal">✓</span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-teal">Pull request ready</p>
                <p className="mt-1 text-[13px] leading-relaxed text-cloud">
                  PR <b className="font-mono">#{pr.number}</b> is up on <span className="font-mono text-fog">{pr.branch}</span> → <span className="font-mono text-fog">{pr.base}</span>. Umbra opened it on a fresh branch and never merges — review &amp; merge it on GitHub.
                </p>
                <a href={pr.url} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all font-mono text-[12px] text-cyan hover:underline">{pr.url} ↗</a>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type Phase = "idle" | "scanning" | "done";

function AuthLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] px-6 py-24 md:px-10">
      <h1 className="sr-only">Umbra — Mission Control (loading)</h1>
      <div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-4 w-40" /></div>
      <Skeleton className="mt-10 h-12 w-80" />
      <Skeleton className="mt-4 h-4 w-[36ch]" />
      <Skeleton className="mt-8 h-12 w-full max-w-2xl rounded-xl" />
      <div className="mt-8 grid gap-6 lg:grid-cols-2"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
    </main>
  );
}

function RepoPicker({ user, repos, repoError, onRetry, filtered, query, setQuery, repoUrl, setRepoUrl, scanning, onRun, coveredRepos }: {
  user: User; repos: Repo[] | null; repoError: { status: number; msg: string } | null; onRetry: () => void;
  filtered: Repo[]; query: string; setQuery: (v: string) => void;
  repoUrl: string; setRepoUrl: (v: string) => void; scanning: boolean; onRun: () => void;
  coveredRepos: Set<string>;
}) {
  const hasGitHub = !!user.github_connected;
  const [mode, setMode] = useState<"mine" | "public">(hasGitHub ? "mine" : "public");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking anywhere outside it.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [setQuery]);

  const selected = (repos ?? []).find((r) => r.url === repoUrl);
  const hasRepos = repos !== null && repos.length > 0;
  const triggerLabel = selected ? selected.full_name : repoUrl ? repoFullName(repoUrl) : hasRepos ? `Select one of your ${repos!.length} repositories…` : "Select a repository…";
  const reconnect = repoError && (repoError.status === 401 || repoError.status === 403);

  return (
    // overflow-visible so the absolutely-positioned repo dropdown isn't clipped
    // by the card's rounded overflow-hidden (that clip was hiding the repo list
    // and leaving only the filter box visible).
    <GlowCard className="relative z-30 overflow-visible p-5">
      {/* Mode tabs: browse your own repos, or scan any public repo (works for
          Google-only users and even if repo listing is unavailable). */}
      <SegmentedTabs
        className="mb-4"
        layoutId="repo-mode"
        value={mode}
        onChange={setMode}
        options={[{ value: "mine", label: "My repositories" }, { value: "public", label: "Public repo" }]}
      />

      {mode === "public" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onRun()}
              placeholder="github.com/owner/repo"
              spellCheck={false}
              autoFocus
              className="min-w-[260px] flex-1 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 font-mono text-[13px] outline-none focus:border-cyan/50"
            />
            <Magnetic><StatefulButton loading={scanning} onClick={onRun}>{scanning ? "Running" : "Run scan"}</StatefulButton></Magnetic>
          </div>
          <p className="text-[12px] text-fog">Scan any public GitHub repository — great for auditing a dependency or contributing a fix to open source.</p>
        </div>
      ) : !hasGitHub ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Connect GitHub to scan your repositories</p>
            <p className="mt-1 text-[13px] text-fog">You&apos;re signed in with {user.provider}. Link GitHub to list your own public &amp; private repos — or use the <b className="text-cloud">Public repo</b> tab for any open-source URL.</p>
          </div>
          <HoverBorderGradient href={`${API}/auth/connect/github`}><GitHubIcon className="h-4 w-4" /> Connect GitHub</HoverBorderGradient>
        </div>
      ) : repoError ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[color:var(--sev-critical)]">Couldn&apos;t load your repositories</p>
            <p className="mt-1 max-w-[60ch] text-[13px] text-fog">{repoError.msg} You can still scan any repo from the <b className="text-cloud">Public repo</b> tab.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onRetry} className="rounded-xl border border-[color:var(--surface-border)] px-4 py-2.5 text-xs text-fog transition-colors hover:border-cyan/50 hover:text-cloud">Retry</button>
            {reconnect && <HoverBorderGradient href={`${API}/auth/connect/github`}><GitHubIcon className="h-4 w-4" /> Reconnect</HoverBorderGradient>}
          </div>
        </div>
      ) : repos === null ? (
        <Skeleton className="h-11 w-full rounded-lg" />
      ) : repos.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-fog">No repositories found on your account. Use the <b className="text-cloud">Public repo</b> tab to scan any GitHub URL.</p>
          <button onClick={onRetry} className="shrink-0 rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2 text-xs text-fog transition-colors hover:border-cyan/50 hover:text-cloud">Refresh</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {/* Clickable dropdown — browse and pick a repo without remembering its name. */}
          <div ref={boxRef} className="relative min-w-[260px] flex-1">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 text-left font-mono text-[13px] outline-none transition-colors hover:border-cyan/40 focus:border-cyan/50"
            >
              <span className={`flex min-w-0 items-center gap-2 truncate ${selected || repoUrl ? "text-cloud" : "text-fog"}`}>
                {selected?.private && <LockIcon className="h-3 w-3 shrink-0 text-amber" />}
                <span className="truncate">{triggerLabel}</span>
              </span>
              <span className="shrink-0 text-fog transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none" }}>▾</span>
            </button>
            <AnimatePresence>
              {open && (
                <motion.div
                  role="listbox"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: EASE }}
                  className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-ink-2 shadow-2xl"
                >
                  <div className="border-b border-[color:var(--surface-border)] p-2">
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter repositories…"
                      className="w-full rounded-md border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2 font-mono text-[13px] outline-none focus:border-cyan/50"
                    />
                  </div>
                  <div data-lenis-prevent className="max-h-72 overflow-auto p-1">
                    {filtered.length === 0 ? (
                      <div className="px-3 py-3 text-[13px] text-fog">No repositories match “{query}”.</div>
                    ) : (
                      filtered.slice(0, 100).map((r) => (
                        <button
                          key={r.full_name}
                          onClick={() => { setRepoUrl(r.url); setQuery(""); setOpen(false); }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-2)] ${r.url === repoUrl ? "bg-cyan/10 text-cyan" : ""}`}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-mono">
                            {r.private && <LockIcon className="h-3 w-3 shrink-0 text-amber" />}
                            <span className="truncate">{r.full_name}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {coveredRepos.has(r.full_name) && <span className="rounded-full border border-violet/40 bg-violet/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-violet" title="Umbra auto-reviews new PRs on this repo">Auto-PR</span>}
                            {r.stars > 0 && <span className="text-[11px] text-fog">★ {r.stars}</span>}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Magnetic><StatefulButton loading={scanning} onClick={onRun}>{scanning ? "Running" : "Run scan"}</StatefulButton></Magnetic>
        </div>
      )}
    </GlowCard>
  );
}

// Install-once PR auto-review via the Umbra GitHub App. There is no per-repo
// toggle: the user installs the App (and picks repos) in GitHub's own UI. We
// only render the install link and the repos it currently auto-reviews.
function AutoReviewPanel({ appInfo, installs }: { appInfo: { configured: boolean; install_url: string | null } | null; installs: { installation_id: number; account_login: string; repos: string[] }[] }) {
  if (!appInfo) return null;
  const covered = installs.flatMap((i) => i.repos);
  const installed = covered.length > 0;
  return (
    <div className="mt-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-cloud">Autonomous PR auto-review</p>
          <p className="mt-0.5 text-[12px] text-fog">
            {installed
              ? <>Umbra auto-reviews new PRs on the repos you selected. Repos you didn&apos;t pick stay off — add or remove them anytime in GitHub.</>
              : <>Install the Umbra GitHub App once, pick your repos, and Umbra posts an advisory review on every new PR — public or private, never merges.</>}
          </p>
        </div>
        {appInfo.configured && appInfo.install_url ? (
          installed ? (
            <a href={appInfo.install_url} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-[12px] text-violet transition-colors hover:text-violet/80">
              Manage / add repos →
            </a>
          ) : (
            <a href={appInfo.install_url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-xl border border-violet/50 bg-violet/10 px-3.5 py-2.5 text-center font-mono text-[12px] text-violet transition-colors hover:bg-violet/20">
              Install GitHub App
            </a>
          )
        ) : (
          <span className="shrink-0 rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2.5 font-mono text-[11px] text-fog">Coming soon</span>
        )}
      </div>
      {installed && (
        <div className="mt-3 border-t border-[color:var(--surface-border)] pt-3">
          <p className="font-mono text-[11px] text-fog">Auto-reviewing {covered.length} repo{covered.length === 1 ? "" : "s"} — look for the <span className="text-violet">Auto-PR</span> badge in your repo list:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {covered.map((r) => (
              <span key={r} className="rounded-md border border-violet/30 bg-violet/5 px-2 py-1 font-mono text-[11px] text-violet">{r}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">{label}</span>
      {children}
    </div>
  );
}

function ScanOptions({ model, setModel, effort, setEffort, crew, setCrew }: {
  model: ModelId; setModel: (m: ModelId) => void;
  effort: Effort; setEffort: (e: Effort) => void;
  crew: Crew; setCrew: (c: Crew) => void;
}) {
  const eta = estimateEta(model, effort, crew);
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <OptionGroup label="Model">
          <SegmentedTabs layoutId="opt-model" value={model} onChange={setModel} options={MODELS.map((m) => ({ value: m.id, label: m.label }))} />
        </OptionGroup>
        <OptionGroup label="Reasoning">
          <SegmentedTabs layoutId="opt-effort" value={effort} onChange={setEffort} options={EFFORTS.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))} />
        </OptionGroup>
        <OptionGroup label="Crew">
          <SegmentedTabs layoutId="opt-crew" value={crew} onChange={setCrew} options={[{ value: "quick", label: "Quick · 1" }, { value: "full", label: "Full · 3" }]} />
        </OptionGroup>
      </div>
      {/* Surface the configured request so "Fast / Balanced" isn't opaque. This
          is not runtime attestation; the provider ledger and signed receipt are
          the source of truth for what actually ran. */}
      <p className="font-mono text-[11px] text-fog">
        Configured Codex model <span className="text-cloud">{model}</span> · requested reasoning <span className="text-cloud">{effort}</span> · {crew === "quick" ? "1 agent" : "3 agents"}
      </p>
      <p className={`font-mono text-[11px] ${eta.warn ? "text-amber" : "text-fog"}`}>
        {eta.warn ? "⚠ " : "◔ "}Estimated {eta.label} · approximate{eta.warn ? " — may approach the 15-min limit; try Fast / Low / Quick" : ""}
      </p>
    </div>
  );
}

// ── Mission Control shell components ────────────────────────────────────────

function ZoneLabel({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="font-mono text-[10px] tracking-[0.2em] text-fog/50">{n}</span>
      <span className="h-px w-6 bg-[color:var(--surface-border)]" />
      <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.22em] text-cloud">{title}</h2>
      {hint && <span className="rounded-full border border-[color:var(--surface-border)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog">{hint}</span>}
    </div>
  );
}

// Backend reachability indicator. When the API is unreachable a scan fails with a
// bare "Failed to fetch"; this makes the fix explicit (and only shows the local
// :8000 command when the client is actually pointed at localhost).
function ApiStatus({ up, onOpenCaptured }: { up: boolean | null; onOpenCaptured?: () => void }) {
  if (up === null) return null; // still probing
  if (up) {
    return (
      <p className="mt-2.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-teal/80">
        <span className="h-1.5 w-1.5 rounded-full bg-teal shadow-[0_0_6px_#5eead4]" /> API connected
      </p>
    );
  }
  const local = API.includes("localhost");
  return (
    <div className="mt-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3">
      <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-amber">
        <span className="h-1.5 w-1.5 rounded-full bg-amber" />
        API unavailable{local ? " — start the backend on :8000" : " — the service isn't responding"}
      </p>
      {local && (
        <>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-fog">Scans, Ask, and Detective need the local API. In a second terminal:</p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-cloud">uv run uvicorn backend.main:app --reload   # http://localhost:8000</pre>
        </>
      )}
      {/* Even with the API down, the bundled captured proof scan renders fully
          client-side — so a judge is never left with a dead dashboard. */}
      {onOpenCaptured && (
        <button
          type="button"
          onClick={onOpenCaptured}
          className="mt-2.5 inline-flex items-center gap-2 rounded-full border border-teal/40 bg-teal/10 px-3 py-1.5 font-mono text-[11px] text-teal transition-colors hover:bg-teal/20"
        >
          ▶ Open the captured proof scan instead <span className="text-teal/70">· works offline</span>
        </button>
      )}
    </div>
  );
}

// A short, guided path for a judge landing cold on the dashboard — orients them
// on where the live proof is before they start clicking. Guests only (judges
// arriving from the landing page); a logged-in user working the platform never
// sees the "For judges" onboarding card or its captured-scan shortcut.
function JudgePath({ onOpenCaptured }: { onOpenCaptured: () => void }) {
  const steps = [
    ["01", "Run the Agent Admission Test", "The differentiator — Zone 02 below. Run a fixture (permitted → forbidden → capped) to watch the pipeline decide the authority a change earns, then verify the signed receipt."],
    ["02", "Read the Provider Ledger", "Every output labelled live / cache / unavailable — never fabricated."],
    ["03", "Open a captured scan or agent replay", "A real captured scan for instant proof, plus recorded prompt / provider / proposed diff per agent."],
  ] as const;
  return (
    <GlowCard className="mt-4 mb-5 p-5">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan">For judges</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">A 30-second path through the proof — no sign-in</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map(([n, title, body]) => (
          <div key={n} className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-3.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.2em] text-cyan">{n}</span>
              <span className="font-mono text-[11.5px] font-semibold text-cloud">{title}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-fog">{body}</p>
          </div>
        ))}
      </div>
      {/* Instant proof — a real captured scan, no ~90s live wait. */}
      <div className="mt-3.5 flex flex-wrap items-center gap-3 border-t border-[color:var(--surface-border)] pt-3.5">
        <button
          type="button"
          onClick={onOpenCaptured}
          className="inline-flex items-center gap-2 rounded-full border border-teal/40 bg-teal/10 px-3.5 py-1.5 font-mono text-[11px] text-teal transition-colors hover:bg-teal/20"
        >
          ▶ Open a captured scan <span className="text-teal/70">· instant, no wait</span>
        </button>
        <span className="font-mono text-[10.5px] leading-snug text-fog/70">A real scan of {PROOF_REPO} — 26 live OSV advisories + Codex-proposed diffs, captured {PROOF_CAPTURED_AT}.</span>
      </div>
      {/* Same engine, inside ChatGPT — judges can import the live Action directly. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[color:var(--surface-border)] pt-3.5">
        <span className="rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-violet">Also in ChatGPT</span>
        <span className="font-mono text-[10.5px] leading-snug text-fog/80">
          Same live API as a GPT Action — import{" "}
          <a href="/openapi-actions.yaml" className="text-cloud underline decoration-dotted underline-offset-2 hover:text-cyan">/openapi-actions.yaml</a>{" "}
          (auth: None) and ask &ldquo;Scan github.com/expressjs/express&rdquo;. Manifest:{" "}
          <a href="/.well-known/ai-plugin.json" className="text-cloud underline decoration-dotted underline-offset-2 hover:text-cyan">ai-plugin.json</a>.
        </span>
      </div>
    </GlowCard>
  );
}

// First-run guide for a signed-in user. Every step reflects REAL account state
// (never a fabricated checkmark) and links to the exact action. It disappears once
// the essentials (connect GitHub + run a scan) are done, so return users aren't
// nagged; the "next steps" are nudges toward the deeper product, not blockers.
function OnboardingChecklist({ me, hasScanned, hasPr, hasSchedule, onScan, onDismiss }: {
  me: User; hasScanned: boolean; hasPr: boolean; hasSchedule: boolean; onScan: () => void; onDismiss: () => void;
}) {
  const connected = !!me.github_connected;
  const essentials = [
    { key: "signin", title: "Sign in", body: `Signed in as ${me.github_login || me.name || me.email || "you"}.`, done: true },
    { key: "github", title: "Connect GitHub", body: connected ? `Connected as @${me.github_login || "github"} — private repos & branch-only PRs unlocked.` : "Link GitHub to scan private repos and open branch-only fix PRs.", done: connected, cta: connected ? undefined : { label: "Connect GitHub →", href: `${API}/auth/connect/github` } },
    { key: "scan", title: "Run your first scan", body: hasScanned ? "First shift filed — your report is saved to history." : "Pick a repository and launch a scan to compute the Umbra Score.", done: hasScanned, cta: hasScanned ? undefined : { label: "Pick a repo below ↓", onClick: onScan } },
  ];
  const next = [
    { key: "pr", title: "Open a branch-only fix PR", body: hasPr ? "You've opened a fix PR — it's in the ledger below." : "After a scan, open a dependency-bump PR. Umbra never merges.", done: hasPr },
    { key: "key", title: "Add your OpenAI key", body: me.has_openai_key ? "Live reasoning enabled with your key." : "Optional — unlock live GPT-5.6 reasoning, billed to you.", done: !!me.has_openai_key },
    { key: "schedule", title: "Schedule a morning report", body: hasSchedule ? "A scheduled scan will email you a morning report." : "Optional — auto-scan on a schedule and get an emailed report.", done: hasSchedule },
  ];
  const doneCount = essentials.filter((s) => s.done).length;

  const Dot = ({ done, n }: { done: boolean; n: number }) => (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${done ? "border-teal/50 bg-teal/15 text-teal" : "border-cyan/50 text-cyan"}`}>{done ? "✓" : n}</span>
  );

  return (
    <GlowCard className="mt-4 mb-5 p-5">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan">Get set up</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">{doneCount} of {essentials.length} essentials done</span>
        </div>
        <button onClick={onDismiss} className="font-mono text-[11px] text-fog/70 transition-colors hover:text-cloud" title="Dismiss this guide">Dismiss ×</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {essentials.map((s, i) => (
          <div key={s.key} className={`rounded-xl border bg-[color:var(--surface)] p-3.5 ${s.done ? "border-teal/25" : "border-[color:var(--surface-border)]"}`}>
            <div className="flex items-center gap-2">
              <Dot done={s.done} n={i + 1} />
              <span className="font-mono text-[11.5px] font-semibold text-cloud">{s.title}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-fog">{s.body}</p>
            {s.cta && ("href" in s.cta ? (
              <a href={s.cta.href} className="mt-2 inline-block font-mono text-[11px] text-cyan hover:underline">{s.cta.label}</a>
            ) : (
              <button onClick={s.cta.onClick} className="mt-2 font-mono text-[11px] text-cyan hover:underline">{s.cta.label}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[color:var(--surface-border)] pt-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-fog/60">Next</span>
        {next.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px]">
            <span className={`text-[11px] ${s.done ? "text-teal" : "text-fog/40"}`}>{s.done ? "✓" : "○"}</span>
            <span className={s.done ? "text-fog" : "text-fog/80"} title={s.body}>{s.title}</span>
          </span>
        ))}
      </div>
    </GlowCard>
  );
}

// Mirrors the landing "How OpenAI is used" panel, compact, framing the Provider
// Ledger it sits beside. Each tag is a real provider value the ledger can show.
function OpenAiStrip() {
  const items = [
    { tag: "codex-cli", color: "#a78bfa", title: "Codex CLI", body: "Proposes diffs inside a disposable clone. Never auto-merges." },
    { tag: "gpt‑5.6", color: "#fbbf24", title: "GPT‑5.6 reasoning", body: "Reasons over real repo evidence, when live reasoning is enabled." },
    { tag: "responses-api-stream", color: "#22d3ee", title: "Responses streaming", body: "Powers Ask Umbra & Detective, token-by-token." },
    { tag: "provider ledger", color: "#5eead4", title: "Provider ledger", body: "Labels every output live / cache / unavailable." },
  ];
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">How OpenAI is used</p>
        <span className="font-mono text-[9.5px] text-fog/70">labelled, never faked</span>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((it) => (
          <div key={it.title}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color: it.color, borderColor: `${it.color}44`, background: `${it.color}12` }}>{it.tag}</span>
              <span className="font-mono text-[11.5px] text-cloud">{it.title}</span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fog">{it.body}</p>
          </div>
        ))}
      </div>
    </GlowCard>
  );
}

function CommandHeader({ me, repo, phase, onLogout }: { me: User | null; repo: string; phase: Phase; onLogout: () => void }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }) + " UTC");
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  const label = phase === "scanning" ? "SCAN RUNNING" : phase === "done" ? "SHIFT FILED" : "STANDING BY";
  const color = phase === "scanning" ? "#22d3ee" : phase === "done" ? "#5eead4" : "#8b90a6";
  return (
    <header className="sticky top-0 z-30 -mx-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[color:var(--surface-border)] bg-ink/85 px-6 py-3 backdrop-blur-md md:-mx-10 md:px-10">
      <a href="/" aria-label="Umbra home" className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan">
        <UmbraLogo size={20} />
        <span className="hidden font-mono text-[11px] tracking-[0.14em] text-fog sm:inline"><span className="text-fog/40">//</span> MISSION CONTROL</span>
      </a>
      <div className="order-3 flex w-full min-w-0 items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fog md:order-none md:w-auto">
        <span className="inline-flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-fog/50">repo</span> <span className="min-w-0 max-w-[52vw] truncate text-cloud md:max-w-[220px]">{repo}</span></span>
        <span className="text-fog/30">·</span>
        <span className="inline-flex shrink-0 items-center gap-1.5" style={{ color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          {label}
        </span>
        <span className="hidden text-fog/30 sm:inline">·</span>
        <span className="hidden shrink-0 tabular-nums sm:inline">{clock}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <LocalWeather />
        <ThemeToggle variant="inline" />
        {me?.is_founder && <span className="hidden rounded-full border border-violet/40 bg-violet/10 px-2.5 py-1 font-mono text-[10px] text-violet sm:inline">FOUNDER · LIVE CODEX</span>}
        {me ? (
          <>
            <DitherImage src={me.avatar || "/founder.jpg"} rounded pixelSize={2} className="h-8 w-8 border border-[color:var(--surface-border)]" />
            <button onClick={onLogout} className="rounded-lg border border-[color:var(--surface-border)] px-3 py-1.5 font-mono text-[11px] text-fog transition-colors hover:border-rose-400/50 hover:text-cloud">Sign out</button>
          </>
        ) : (
          <a href={`${API}/auth/login/github`} className="rounded-lg border border-[color:var(--surface-border)] px-3 py-1.5 font-mono text-[11px] text-cloud transition-colors hover:border-cyan/50">Guest · sign in</a>
        )}
      </div>
    </header>
  );
}

function GuestScanBar({ repoUrl, setRepoUrl, scanning, onRun }: { repoUrl: string; setRepoUrl: (v: string) => void; scanning: boolean; onRun: () => void }) {
  return (
    <GlowCard className="p-5">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Scan a public repository</p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onRun(); }}
          placeholder="github.com/owner/repo"
          spellCheck={false}
          className="min-w-[260px] flex-1 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 font-mono text-[13px] outline-none focus:border-cyan/50"
        />
        <Magnetic><StatefulButton loading={scanning} onClick={onRun}>{scanning ? "Running" : "Launch scan"}</StatefulButton></Magnetic>
      </div>
      {/* Make it obvious the private-repo dropdown is intentionally hidden for
          guests, not missing. */}
      <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fog">
        <LockIcon className="h-3 w-3 shrink-0 text-amber" />
        <span>Public preview mode · <a href={`${API}/auth/login/github`} className="text-cyan hover:underline">sign in</a> to browse private GitHub repos.</span>
      </p>
      <p className="mt-1.5 text-[12px] text-fog">No account needed to scan any open-source repo. Live OSV findings; reasoning and patches are shown when available and always labelled.</p>
    </GlowCard>
  );
}

function ScorePanel({ result, demo, capturedAt }: { result: ScanResult | null; demo: boolean; capturedAt?: string | null }) {
  const has = !!result && typeof result.umbra_score === "number";
  const score = result?.umbra_score ?? 0;
  const verdict = has ? scoreVerdict(score) : null;
  return (
    <GlowCard className="flex flex-col justify-between p-7">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Umbra score</p>
        {demo ? (
          <StatusPill kind="sample" />
        ) : capturedAt ? (
          <span className="flex items-center gap-2">
            <StatusPill kind="captured" />
            <span className="font-mono text-[9px] text-fog/55">{capturedAt}</span>
          </span>
        ) : has ? (
          <span className="flex items-center gap-2">
            <StatusPill kind={scanPillKind(result?.source)} />
            {result?.source && <span className="font-mono text-[9px] text-fog/55">{result.source}</span>}
          </span>
        ) : null}
      </div>
      <div className="mt-6 flex items-end gap-4">
        <span className="font-serif text-[clamp(72px,11vw,124px)] leading-[0.78] tracking-[-0.04em] text-cloud">{has ? score : "--"}</span>
        <span className="mb-3 font-mono text-[12px] text-fog/50">/ 100</span>
      </div>
      <div className="mt-6 border-t border-[color:var(--surface-border)] pt-4">
        {has && verdict ? (
          <>
            <p className={`font-serif text-xl leading-tight ${verdict.tone}`}>{verdict.label}</p>
            <p className="mt-2.5 max-w-[52ch] font-sans text-[13.5px] leading-relaxed tracking-[0.005em] text-fog">{result?.reasoning_summary || verdict.note}</p>
          </>
        ) : (
          <>
            <p className="font-serif text-xl leading-tight text-fog">Awaiting scan</p>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-fog">Launch a scan to compute the Umbra Score and open the shift.</p>
          </>
        )}
      </div>
    </GlowCard>
  );
}

// Dawn palette — shared with the homepage Morning Report so a filed shift here
// reads with the same cinematic conclusion, driven by the real scan.
const DAWN = { risk: "#fb7185", amber: "#fbbf24", resolve: "#5eead4", fog: "#8b90a6" };

// Per-agent signature metadata for the filed dispatch (unit, state arc, colour).
const DISPATCH_META: Record<string, { letter: string; unit: string; from: string; to: string; toColor: string }> = {
  watchman: { letter: "W", unit: "Watchman", from: "scanned", to: "patch prepared", toColor: DAWN.resolve },
  detective: { letter: "D", unit: "Detective", from: "traced", to: "root cause", toColor: DAWN.amber },
  reviewer: { letter: "R", unit: "Reviewer", from: "reviewed", to: "assessed", toColor: DAWN.fog },
  janitor: { letter: "J", unit: "Janitor", from: "swept", to: "drafted", toColor: DAWN.fog },
  ask: { letter: "A", unit: "Ask Umbra", from: "asked", to: "answered", toColor: DAWN.fog },
};

// The emotional conclusion of a real shift — the homepage Morning Report's design
// language (dawn light, hero score, filed signatures) driven entirely by the scan.
// Motion is arrival only: the score rises, the dispatch assembles, then it holds.
function ShiftReport({ result, repo, demo, capturedAt }: { result: ScanResult; repo: string; demo?: boolean; capturedAt?: string | null }) {
  const reduce = useReducedMotion();
  const has = typeof result.umbra_score === "number";
  const score = result.umbra_score ?? 0;
  const verdict = has ? scoreVerdict(score) : null;
  const vulns = result.vulnerabilities ?? [];
  const runs = (result.agent_results ?? []).filter((r) => DISPATCH_META[r.agent]);
  const counts = [
    `${vulns.length} ${vulns.length === 1 ? "finding" : "findings"}`,
    runs.length ? `${runs.length} ${runs.length === 1 ? "unit" : "units"} filed` : null,
  ].filter(Boolean).join(" · ");

  return (
    <GlowCard glow="rgba(251,191,36,0.12)" className="relative mt-5 overflow-hidden">
      {/* First light — dawn from the top edge, the eclipse resolving. */}
      <motion.div
        aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(251,191,36,0.11), rgba(251,191,36,0.03) 42%, transparent 72%)" }}
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, ease: EASE }}
      />
      <div className="relative p-7 sm:p-9">
        {/* Header — the shift, filed. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-fog">
          <span className="flex shrink-0 items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-teal shadow-[0_0_6px_#5eead4]" /> Shift filed</span>
          <span className="flex min-w-0 items-center gap-2 text-fog/70">
            <span className="min-w-0 max-w-[45vw] truncate normal-case tracking-normal sm:max-w-none">{repo}</span>
            {demo ? (
              <StatusPill kind="sample" />
            ) : capturedAt ? (
              <span className="flex items-center gap-2">
                <StatusPill kind="captured" />
                <span className="font-mono text-[9px] text-fog/55">{capturedAt}</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <StatusPill kind={scanPillKind(result.source)} />
                {result.source && <span className="font-mono text-[9px] text-fog/55">{result.source}</span>}
              </span>
            )}
          </span>
        </div>
        <div className="mt-4 h-px w-full" style={{ background: "linear-gradient(90deg, rgba(251,191,36,0.35), transparent 60%)" }} />

        {/* Hero — the Umbra Score as one enormous number. No dial, no chart. */}
        <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-fog">Umbra Score</div>
            <div className="mt-1 flex items-end gap-3">
              <span className="block overflow-hidden leading-[0.8]">
                <motion.span
                  className="block font-serif text-[clamp(80px,13vw,150px)] leading-[0.8] tracking-[-0.04em] text-cloud"
                  initial={reduce ? false : { y: "112%" }} animate={{ y: 0 }} transition={{ duration: 0.9, ease: EASE }}
                >
                  {has ? score : "--"}
                </motion.span>
              </span>
              <span className="mb-3 font-mono text-[13px] text-fog/60">/ 100</span>
            </div>
          </div>
          <div className="max-w-[36ch] sm:pb-3 sm:text-right">
            {verdict && <div className={`font-serif text-[clamp(20px,2.4vw,28px)] leading-tight ${verdict.tone}`}>{verdict.label}</div>}
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-fog">{result.reasoning_summary || verdict?.note}</p>
            {counts && <div className="mt-3 font-mono text-[11px] tracking-[0.04em] text-fog/80 sm:ml-auto">{counts}</div>}
          </div>
        </div>

        {/* The per-unit filed dispatch now lives in the live Crew Dossier directly
            below (richer, with each agent's real operational artifact), so the
            Shift Report stays the score conclusion and doesn't repeat it here. */}

        {/* Signature — honest provenance, the same line as the homepage. */}
        <div className="mt-6 border-t border-[color:var(--surface-border)] pt-4 font-mono text-[10px] leading-relaxed text-fog/70">
          Filed by the night crew · grounded in OSV + git history · never fabricated{demo ? " · sample shift" : capturedAt ? ` · captured ${capturedAt}` : ""}
        </div>
      </div>
    </GlowCard>
  );
}

function FindingsLedger({ vulns, canPr, demo, onOpenPr, onOpenPrAll, repo, canTriage, triage, onTriage }: { vulns: Vuln[]; canPr: boolean; demo?: boolean; onOpenPr: (v: Vuln) => void; onOpenPrAll?: () => void; repo?: string; canTriage?: boolean; triage?: Map<string, TriageRec>; onTriage?: (findingKey: string, status: string, reason?: string, repo?: string) => void }) {
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Findings ledger</p>
        <span className="font-mono text-[10px] text-fog">{vulns.length} {vulns.length === 1 ? "advisory" : "advisories"}</span>
      </div>
      {!demo && canPr && vulns.length >= 2 && onOpenPrAll && (
        <button onClick={onOpenPrAll} className="mb-3 flex w-full items-center justify-between rounded-lg border border-teal/40 bg-teal/10 px-3.5 py-2 font-mono text-[11px] text-teal transition-colors hover:bg-teal/20">
          <span>Fix all {vulns.length} advisories → one PR</span>
          <span className="text-fog/70">reviewer-gated · branch only</span>
        </button>
      )}
      {demo && vulns.length > 0 && (
        <p className="mb-3 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-3 py-2 font-mono text-[10.5px] leading-snug text-fog/80">
          Sample advisory — not from your repo. Run a scan for live findings.
        </p>
      )}
      {vulns.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-teal/30 bg-teal/5 px-4 py-6">
          <span className="text-lg text-teal">✓</span>
          <div>
            <p className="text-[14px] text-cloud">Clear — 0 advisories</p>
            <p className="text-[12px] text-fog">Watchman checked every resolved dependency against OSV and found nothing known.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--surface-border)]">
          {groupVulns(vulns).map((g) => {
            const tkey = repo ? `${repo}:${g.key}` : g.key;
            const tstatus = triage?.get(tkey)?.status;
            const onSet = canTriage && onTriage ? (status: string, reason?: string) => onTriage(tkey, status, reason, repo) : undefined;
            return g.items.length === 1 ? (
              <FindingRow key={g.key} v={g.items[0]} canPr={canPr} onOpenPr={() => onOpenPr(g.items[0])} triageStatus={tstatus} onTriage={onSet} />
            ) : (
              <PackageGroup key={g.key} group={g} canPr={canPr} onOpenPr={onOpenPr} triageStatus={tstatus} onTriage={onSet} />
            );
          })}
        </div>
      )}
    </GlowCard>
  );
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
type VulnGroup = { key: string; package: string; version?: string; items: Vuln[] };

/** Collapse a flat advisory list into one entry per package@version. A repo with
 *  26 CVEs on a single outdated package should read as one scannable line, not a
 *  wall of near-identical rows. Order is preserved (first-seen). */
function groupVulns(vulns: Vuln[]): VulnGroup[] {
  const by = new Map<string, VulnGroup>();
  const order: VulnGroup[] = [];
  for (const v of vulns) {
    const key = `${v.package}@${v.version ?? ""}`;
    let g = by.get(key);
    if (!g) { g = { key, package: v.package, version: v.version, items: [] }; by.set(key, g); order.push(g); }
    g.items.push(v);
  }
  return order;
}

function topSeverity(items: Vuln[]): string {
  return items.reduce((top, v) => (SEVERITY_RANK[(v.severity ?? "low").toLowerCase()] ?? 1) > (SEVERITY_RANK[top] ?? 1) ? (v.severity ?? "low").toLowerCase() : top, "low");
}

/** Per-finding triage — snooze / accept-risk require a reason (an auditable act,
 *  surfaced in the activity timeline), reopen clears it. Sits BESIDE the row's
 *  toggle button (never nested inside it) so the interactive elements stay valid. */
function TriageControl({ status, onTriage }: { status?: string; onTriage: (status: string, reason?: string) => void }) {
  const [mode, setMode] = useState<null | "snoozed" | "accepted_risk">(null);
  const [text, setText] = useState("");
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const commit = () => { if (text.trim()) { onTriage(mode!, text.trim()); setMode(null); setText(""); } };
  if (mode) {
    return (
      <span className="flex shrink-0 items-center gap-1.5" onClick={stop}>
        <input
          autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
          aria-label={mode === "snoozed" ? "Reason for snoozing this finding" : "Reason for accepting this risk"}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setMode(null); setText(""); } }}
          placeholder={mode === "snoozed" ? "why snooze? (required)" : "why accept the risk?"}
          className="w-44 rounded-md border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2 py-1 font-mono text-[10px] text-cloud focus:border-cyan/60"
        />
        <button disabled={!text.trim()} onClick={commit} className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 font-mono text-[9.5px] text-teal disabled:opacity-40">save</button>
        <button onClick={() => { setMode(null); setText(""); }} className="font-mono text-[9.5px] text-fog hover:text-cloud">cancel</button>
      </span>
    );
  }
  if (status === "snoozed" || status === "accepted_risk") {
    const label = status === "snoozed" ? "Snoozed" : "Accepted";
    const color = status === "snoozed" ? "#8b90a6" : "#fbbf24";
    return (
      <span className="flex shrink-0 items-center gap-1.5" onClick={stop}>
        <span className="rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]" style={{ borderColor: `${color}55`, color, background: `${color}18` }}>{label}</span>
        <button onClick={() => onTriage("open")} className="font-mono text-[9.5px] text-fog hover:text-cloud">reopen</button>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 opacity-70 transition-opacity group-hover:opacity-100" onClick={stop}>
      <button onClick={() => setMode("snoozed")} className="rounded-full border border-[color:var(--surface-border)] px-2 py-0.5 font-mono text-[9.5px] text-fog hover:text-cloud">snooze</button>
      <button onClick={() => setMode("accepted_risk")} className="rounded-full border border-[color:var(--surface-border)] px-2 py-0.5 font-mono text-[9.5px] text-fog hover:text-cloud">accept risk</button>
    </span>
  );
}

/** One collapsible row for a package with multiple advisories. */
function PackageGroup({ group, canPr, onOpenPr, triageStatus, onTriage }: { group: VulnGroup; canPr: boolean; onOpenPr: (v: Vuln) => void; triageStatus?: string; onTriage?: (status: string, reason?: string) => void }) {
  const [open, setOpen] = useState(false);
  const top = topSeverity(group.items);
  const dim = triageStatus === "snoozed" || triageStatus === "accepted_risk";
  return (
    <div className={`group ${dim ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-left">
          <SeverityChip severity={top} />
          <span className="min-w-0 break-all font-mono text-[13px] text-cloud">{group.package}<span className="text-fog">@{group.version}</span></span>
          <span className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-2 py-0.5 font-mono text-[10px] text-fog">{group.items.length} advisories</span>
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-fog">
            <span className="text-cyan">◉ WATCHMAN</span>
            <span className="text-fog/40">· osv.dev</span>
            <span className="text-fog transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
          </span>
        </button>
        {onTriage && <TriageControl status={triageStatus} onTriage={onTriage} />}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-col divide-y divide-[color:var(--surface-border)] border-l border-[color:var(--surface-border)] pb-3 pl-3">
              {group.items.map((v, i) => (
                <div key={`${v.cve}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <SeverityChip severity={v.severity} />
                  <a href={`https://osv.dev/vulnerability/${encodeURIComponent(v.cve)}`} target="_blank" rel="noreferrer" className="min-w-0 break-all font-mono text-[11px] text-cyan hover:underline">{v.cve} ↗</a>
                  {v.summary && <span className="w-full truncate text-[11.5px] text-fog sm:w-auto sm:flex-1">{v.summary}</span>}
                  {canPr && <button onClick={() => onOpenPr(v)} className="ml-auto rounded-full border border-teal/40 bg-teal/10 px-2.5 py-0.5 font-mono text-[10px] text-teal transition-colors hover:bg-teal/20">bump →</button>}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FindingRow({ v, canPr, onOpenPr, triageStatus, onTriage }: { v: Vuln; canPr: boolean; onOpenPr: () => void; triageStatus?: string; onTriage?: (status: string, reason?: string) => void }) {
  const [open, setOpen] = useState(false);
  const dim = triageStatus === "snoozed" || triageStatus === "accepted_risk";
  return (
    <div className={`group ${dim ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-left">
          <SeverityChip severity={v.severity} />
          <span className="min-w-0 break-all font-mono text-[13px] text-cloud">{v.package}<span className="text-fog">@{v.version}</span></span>
          <span className="min-w-0 break-all font-mono text-[11px] text-fog">{v.cve}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-fog">
            <span className="text-cyan">◉ WATCHMAN</span>
            <span className="text-fog/40">· osv.dev</span>
            <span className="text-fog transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
          </span>
        </button>
        {onTriage && <TriageControl status={triageStatus} onTriage={onTriage} />}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pb-4 text-[13px] leading-relaxed text-fog">
              <p className="break-words">{v.summary || "No advisory summary supplied."}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {v.owasp && <span className="rounded-full border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] text-fog">{v.owasp}</span>}
                <a href={`https://osv.dev/vulnerability/${encodeURIComponent(v.cve)}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-cyan hover:underline">View advisory on OSV ↗</a>
                {canPr && <button onClick={onOpenPr} className="rounded-full border border-teal/40 bg-teal/10 px-3 py-1 font-mono text-[10px] text-teal transition-colors hover:bg-teal/20">Patch prepared · open bump PR →</button>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DependencyRiskMap({ deps }: { deps: Dep[] }) {
  if (!deps.length) return null;
  const vulnCount = deps.filter((d) => d.vulnerable).length;
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Dependency risk map</p>
        <span className="font-mono text-[10px] text-fog">{deps.length} deps · <span className={vulnCount ? "text-[color:var(--sev-critical)]" : "text-teal"}>{vulnCount} vulnerable</span></span>
      </div>
      <div className="flex flex-col gap-1.5">
        {deps.slice(0, 12).map((d) => (
          <div key={d.name} className="flex items-center gap-3 font-mono text-[12px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: d.vulnerable ? "#fb7185" : "#5eead4" }} />
            <span className={d.vulnerable ? "text-cloud" : "text-fog"}>{d.name}{d.version ? <span className="text-fog/60">@{d.version}</span> : null}</span>
            <span className="ml-auto text-[10px] uppercase tracking-[0.1em]" style={{ color: d.vulnerable ? "#fb7185" : "#8b90a6" }}>{d.vulnerable ? "vulnerable" : "clear"}</span>
          </div>
        ))}
        {deps.length > 12 && <p className="mt-1 font-mono text-[10px] text-fog/60">+{deps.length - 12} more</p>}
      </div>
    </GlowCard>
  );
}

// Fold every agent's provider map into one, preferring a live value over a
// non-live one per key — so the ledger reflects the whole crew, not just the
// first agent (Watchman sets vulnerabilities/reasoning/engineering; Detective
// sets history; Ask sets retrieval).
function mergeProviders(result: ScanResult | null): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const run of result?.agent_results ?? []) {
    for (const [k, v] of Object.entries(run.replay?.providers ?? {})) {
      if (!(k in merged) || (!LIVE_PROVIDERS.has(merged[k]) && LIVE_PROVIDERS.has(v))) merged[k] = v;
    }
  }
  return merged;
}

function ProviderLedger({ result, demo, founder, capturedAt }: { result: ScanResult | null; demo: boolean; founder: boolean; capturedAt?: string | null }) {
  const providers = mergeProviders(result);
  const src = result?.source ?? "";

  // Every value below maps to something that literally happened — never a
  // generic "live" that implies a tool ran when it didn't (see honesty rules).
  const osv = demo ? "demo"
    : providers.vulnerabilities === "osv.dev" || src.includes("live-watchman") ? "osv.dev"
    : src.includes("cache") ? "cache" : "cache";
  const github = demo ? "demo"
    : providers.history === "local-git" || providers.retrieval === "local-git-grep" ? "local-git"
    : src.startsWith("live") ? "repo-clone" : "demo";
  const eng = providers.engineering;
  const codex = demo ? "demo"
    : eng === "codex-cli" ? "codex-cli"
    : !founder && eng === "unavailable" ? "founder-gated"
    : eng || "unavailable";
  const reasoning = demo ? "demo" : providers.reasoning || "unavailable";

  // Honest per-row footnote for each Codex state — never implies Codex ran.
  const codexNote = codex === "codex-cli"
    ? "Codex CLI ran on this repo (proposes a diff when there's a fix)."
    : codex === "founder-gated"
    ? "founder-gated on hosted public preview"
    : codex === "codex-cli-disabled"
    ? "Codex CLI is disabled in this environment."
    : codex === "unavailable"
    ? "Codex did not produce a diff for this run."
    : null;

  // In demo mode every value is illustrative, so suppress the per-row "live" hints
  // (they'd wrongly imply real repo evidence) and say so once in the footer.
  const rows = [
    { label: "OSV", value: osv, hint: demo ? null : "osv.dev = live advisory scan ran" },
    { label: "GitHub", value: github, hint: demo ? null : "repo evidence read from a local clone" },
    { label: "Codex", value: codex, hint: demo ? null : codexNote },
    { label: "Reasoning", value: reasoning, hint: demo ? null : reasoning.startsWith("responses-api") ? "GPT‑5.6 reasoning ran" : reasoning === "codex-cli" ? "reasoning via Codex" : null },
  ];
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Provider ledger</p>
        <span className="font-mono text-[9.5px] text-fog/70">what produced each output</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-fog">{r.label}</span>
              <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${providerTone(r.value)}`}>{r.value}</span>
            </div>
            {r.hint && <span className="font-mono text-[9px] leading-snug text-fog/55">{r.hint}</span>}
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-[color:var(--surface-border)] pt-3 font-mono text-[9.5px] leading-relaxed text-fog/70">
        {demo
          ? "Sample provider state — run a scan for live repo evidence."
          : capturedAt
          ? `These are the providers that actually ran, captured ${capturedAt} — never fabricated.`
          : "Every output is labelled live / cache / founder-gated / unavailable — never fabricated."}
      </p>
    </GlowCard>
  );
}

// ── Auditable product layer ─────────────────────────────────────────────────
// Autonomy ladder, repository policy, and a one-click Evidence Pack export turn
// the honesty system into a portable artifact a reviewer can audit. All three
// read fields the scan result already returns; none change any provider label.

const AUTONOMY_LADDER = [
  { level: 0, label: "Report only", note: "surface findings, no Codex propose" },
  { level: 1, label: "Prepare diff", note: "Codex proposes a reviewable patch" },
  { level: 2, label: "Open branch PR", note: "only via your explicit request" },
  { level: 3, label: "Request review", note: "advisory PR review, comment-only" },
] as const;

function AutonomyCard({ autonomy }: { autonomy?: Autonomy }) {
  const level = autonomy?.level ?? 1;
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Autonomy level</p>
        <span className="rounded-full border border-teal/40 bg-teal/10 px-2.5 py-0.5 font-mono text-[10px] text-teal">L{level} · {autonomy?.label ?? AUTONOMY_LADDER[level]?.label ?? "Prepare diff"}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {AUTONOMY_LADDER.map((rung) => {
          const active = rung.level === level;
          return (
            <div key={rung.level} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${active ? "border-teal/45 bg-teal/10" : "border-[color:var(--surface-border)] bg-[color:var(--surface)]"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border font-mono text-[10px] ${active ? "border-teal/50 text-teal" : "border-[color:var(--surface-border)] text-fog"}`}>{rung.level}</span>
              <div className="min-w-0">
                <span className={`font-mono text-[11.5px] ${active ? "text-cloud" : "text-fog"}`}>{rung.label}</span>
                <span className="ml-1.5 font-mono text-[10px] text-fog/60">· {rung.note}</span>
              </div>
              {active && <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-teal">current</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex items-center gap-2 border-t border-[color:var(--surface-border)] pt-3 font-mono text-[9.5px] leading-relaxed text-fog/70">
        <span className="rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[color:var(--sev-critical)]">never auto-merges</span>
        Human review is always required — Umbra opens branch-only PRs.
      </p>
    </GlowCard>
  );
}

function PolicyCard({ policy }: { policy?: Policy }) {
  const loaded = !!policy?.loaded;
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Repository policy</p>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${loaded ? "text-teal border-teal/40 bg-teal/10" : "text-fog border-[color:var(--surface-border)] bg-[color:var(--surface-2)]"}`}>{loaded ? "loaded" : "default"}</span>
      </div>
      <p className="font-mono text-[12px] text-cloud">
        {loaded ? <>Policy loaded: <span className="text-teal">{policy?.path ?? ".umbra/nightshift.md"}</span></> : "Default Umbra safety policy applied"}
      </p>
      {policy?.summary && <p className="mt-2 text-[12px] leading-relaxed text-fog">{policy.summary}</p>}
      <p className="mt-3 border-t border-[color:var(--surface-border)] pt-3 font-mono text-[9.5px] leading-relaxed text-fog/70">
        {loaded
          ? "Umbra reads .umbra/nightshift.md for repo-specific guardrails. Never auto-merges."
          : "Add a .umbra/nightshift.md to set repo-specific guardrails. Never auto-merges."}
      </p>
    </GlowCard>
  );
}

// Build a local Evidence Pack from the result when the backend is unreachable —
// so the export always works offline. Sanitizes any stray temp path client-side.
function localEvidenceMarkdown(result: ScanResult, mode: string): string {
  const scrub = (t: string) => (t ?? "")
    .replace(/(?:\/private)?\/(?:var\/folders\/[^\s")']*?|tmp)\/umbra-[A-Za-z0-9_-]+(?:\/repo)?\/?/g, "")
    .replace(/\/?umbra-(?:repo|reason|codex)-[A-Za-z0-9_-]+(?:\/repo)?\/?/g, "");
  const repo = result.repo_url ? repoFullName(result.repo_url) : "unknown-repo";
  const providers = mergeProviders(result);
  const ledger = Object.entries(providers).sort().map(([k, v]) => `- \`${k}\` → **${v}**`);
  const inline = [...new Set(Object.values(providers))].sort().join(" · ") || "none recorded";
  const vulns = result.vulnerabilities ?? [];
  const files = new Set<string>();
  const diffLines: string[] = [];
  for (const run of result.agent_results ?? []) {
    const diff = run.replay?.codex_diff ?? "";
    if (!diff.trim()) continue;
    const runFiles = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => scrub(m[1].trim())).filter(Boolean);
    runFiles.forEach((f) => files.add(f));
    diffLines.push(`- **${run.agent}** — ${diff.length} chars across ${runFiles.length} file(s): ${runFiles.join(", ") || "n/a"}`);
  }
  const a = result.autonomy ?? { level: 1, label: "Prepare diff", auto_merge: false, human_review_required: true };
  const p = result.policy ?? { loaded: false, summary: "Default Umbra policy applied: prepare reviewable work, never auto-merge." };
  const md = [
    "# Umbra Evidence Pack",
    "",
    `**Repository:** ${repo}  `,
    `**Run ID:** \`${result.run_id ?? "n/a"}\`  `,
    `**Run type:** ${mode}  `,
    `**Source:** \`${result.source ?? "—"}\`  `,
    result.evidence_hash ? `**Evidence hash:** \`${result.evidence_hash}\`  ` : "**Evidence hash:** computed server-side  ",
    "",
    "## Summary",
    "",
    `- **Umbra score:** ${result.umbra_score ?? "—"} / 100`,
    `- **Findings:** ${vulns.length} OSV ${vulns.length === 1 ? "advisory" : "advisories"}`,
    `- **Providers that ran:** ${inline}`,
    "",
    "## Provider ledger",
    "",
    ...(ledger.length ? ledger : ["- (no provider metadata recorded on this run)"]),
    "",
    "## Codex diff summary",
    "",
    ...(diffLines.length ? diffLines : ["- No Codex-authored diff on this run."]),
    "",
    "## Changed files",
    "",
    ...(files.size ? [...files].map((f) => `- \`${f}\``) : ["- none"]),
    "",
    "## Verification notes",
    "",
    scrub(result.reasoning_summary ?? "").trim() || "_No reasoning summary recorded for this run._",
    "",
    "## Autonomy",
    "",
    `- **Level ${a.level}** — ${a.label}`,
    `- Auto-merge: **no**`,
    `- Human review required: **yes**`,
    "",
    "## Policy",
    "",
    p.loaded ? `- Policy loaded from \`${p.path ?? ".umbra/nightshift.md"}\`` : "- Default Umbra safety policy applied",
    `- ${scrub(p.summary ?? "")}`,
    "",
    "---",
    "",
    "**Umbra never auto-merges. Human review required.**",
    "",
  ].join("\n");
  return scrub(md);
}

function EvidencePackButton({ result, mode }: { result: ScanResult; mode: "live" | "captured" | "demo" }) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "error">("idle");
  const [verify, setVerify] = useState<{ status: "idle" | "working" | "done" | "error"; verified?: boolean; hasClaim?: boolean; computed?: string }>({ status: "idle" });

  const exportPack = useCallback(async () => {
    setState("working");
    let markdown = "";
    try {
      const r = await fetch(`${API}/api/evidence-pack`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ result, mode }) });
      if (r.ok) markdown = (await r.json())?.markdown ?? "";
    } catch { /* fall through to local */ }
    if (!markdown) markdown = localEvidenceMarkdown(result, mode); // offline / backend-down fallback
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2600);
  }, [result, mode]);

  // Independently re-compute the canonical sha256 and compare to the embedded hash.
  // Makes the pack a receipt you can VERIFY, not just read — the "prove it" step.
  const verifyPack = useCallback(async () => {
    setVerify({ status: "working" });
    try {
      const r = await fetch(`${API}/api/evidence-pack/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ result }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setVerify({ status: "done", verified: !!d.verified, hasClaim: !!d.has_claim, computed: d.computed_hash });
    } catch {
      setVerify({ status: "error" });
    }
  }, [result]);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={exportPack}
        disabled={state === "working"}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-2.5 font-mono text-[11.5px] text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-60"
      >
        {state === "working" ? "Building…" : state === "copied" ? "✓ Evidence pack copied." : state === "error" ? "Copy failed — try again" : "⬇ Export Evidence Pack"}
      </button>
      <p className="font-mono text-[9.5px] leading-snug text-fog/60">A hashable Markdown record — providers, Codex diff, autonomy, policy. Copied to your clipboard.</p>

      {/* Verify integrity — recompute the canonical hash; prove the pack is tamper-evident. */}
      <button
        type="button"
        onClick={verifyPack}
        disabled={verify.status === "working"}
        className="mt-0.5 inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-4 py-2 font-mono text-[11px] text-fog transition-colors hover:border-teal/50 hover:text-cloud disabled:opacity-60"
      >
        {verify.status === "working" ? "Verifying…" : "🔒 Verify integrity"}
      </button>
      {verify.status === "done" && (
        <div
          className="rounded-lg border px-3 py-2 font-mono text-[10px] leading-snug"
          style={{
            borderColor: verify.hasClaim ? (verify.verified ? "color-mix(in oklab, var(--color-teal) 40%, transparent)" : "#fb718566") : "var(--surface-border)",
            background: verify.hasClaim ? (verify.verified ? "color-mix(in oklab, var(--color-teal) 8%, transparent)" : "#fb71851a") : "var(--surface-2)",
          }}
        >
          {verify.hasClaim ? (
            verify.verified ? (
              <span className="text-teal">✓ Verified — recomputed sha256 matches the embedded hash. Any change to a finding, diff, or provider label would change it.</span>
            ) : (
              <span style={{ color: "#fb7185" }}>✗ Mismatch — the contents no longer match the recorded hash (tampered or edited).</span>
            )
          ) : (
            <span className="text-fog">Recomputed canonical sha256 — deterministic &amp; reproducible. This run carried no embedded hash to compare against:</span>
          )}
          {verify.computed && <div className="mt-1 break-all text-fog/70">{verify.computed}</div>}
        </div>
      )}
      {verify.status === "error" && <p className="font-mono text-[9.5px] text-fog/60">Verify failed — is the API reachable?</p>}
      {/* Run receipt — the hard proof lives on the dashboard: a stable run id and a
          reproducible sha256 over the canonical result (computed on export when not
          yet present, e.g. the captured shift). */}
      {(result.run_id || result.evidence_hash) && (
        <div className="mt-1 flex flex-col gap-0.5 border-t border-[color:var(--surface-border)] pt-2 font-mono text-[9px] leading-snug text-fog/55">
          {result.run_id && <span className="break-all"><span className="text-fog/70">run</span> · {result.run_id}</span>}
          <span className="break-all"><span className="text-fog/70">sha</span> · {result.evidence_hash ?? "computed on export"}</span>
        </div>
      )}
    </div>
  );
}

type Review = { risk_score: number; severity: string; files_changed: number; blast_radius: number; missing_tests: boolean; recommendation: string };
type PrResult = { url: string; number: number; branch: string; base: string; review?: Review; skipped?: number };
type PrPreview = { title?: string; files?: string[]; review?: Review; skipped?: number; bumps?: { package: string; current: string; fixed: string; advisories: number }[] };

function ReviewVerdict({ review, skipped }: { review: Review; skipped?: number }) {
  const tone = review.severity === "critical" || review.severity === "high" ? "text-[color:var(--sev-critical)] border-rose-400/40 bg-rose-400/10" : review.severity === "medium" ? "text-amber border-amber/40 bg-amber/10" : "text-teal border-teal/40 bg-teal/10";
  return (
    <div className="rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] p-3 text-[12px]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">Reviewer assessment · deterministic</span>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${tone}`}>risk {review.risk_score}/100 · {review.severity}</span>
      </div>
      <p className="mt-2 text-fog">{review.files_changed} file(s) · blast-radius {review.blast_radius}/5 · {review.missing_tests ? "no test paths touched" : "touches test paths"} · <span className="text-cloud">{review.recommendation}</span></p>
      {!!skipped && <p className="mt-1 text-amber">⚠ {skipped} proposed change(s) will be skipped — they conflict; open separately.</p>}
    </div>
  );
}

function PrDialog({ target, repo, diff, diffs, model, effort, onClose, onOpened }: { target: { mode: "bump" | "codex" | "bump_all" | "combine"; vuln?: Vuln } | null; repo: string; diff: string; diffs?: string[]; model: string; effort: string; onClose: () => void; onOpened: (pr: { url: string; number: number; branch: string; base: string }) => void }) {
  const [status, setStatus] = useState<"confirm" | "working" | "done" | "error">("confirm");
  const [result, setResult] = useState<PrResult | null>(null);
  const [preview, setPreview] = useState<PrPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { dialogProps } = useModalA11y(!!target, onClose, "Open a pull request");

  // For a Codex fix, reuse the patch Watchman already produced in the scan (the
  // diff on screen): applying it opens a PR in seconds with no second Codex run.
  const reuseDiff = target?.mode === "codex" && !!diff.trim();
  const combineDiffs = (diffs ?? []).filter((d) => d.trim());
  // The exact patch this PR will carry, when Umbra already has it client-side (the
  // reviewed scan diffs). Deterministic bump/bump_all produce their edit server-side,
  // so there's no client diff to show — we render the planned file/bump list instead.
  const reviewDiff = reuseDiff ? diff : target?.mode === "combine" ? combineDiffs.join("\n") : "";

  // The request body — identical for the pre-confirm preview and the actual open.
  const bodyFor = useCallback(() => {
    if (!target) return null;
    if (target.mode === "bump") return { repo_url: repo, mode: "bump", package: target.vuln?.package, version: target.vuln?.version, cve: target.vuln?.cve };
    if (target.mode === "bump_all") return { repo_url: repo, mode: "bump_all" };
    if (target.mode === "combine") return { repo_url: repo, mode: "combine", diffs: combineDiffs };
    if (reuseDiff) return { repo_url: repo, mode: "apply_diff", diff };
    return { repo_url: repo, mode: "codex", model, reasoning_effort: effort };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, repo, reuseDiff, diff, JSON.stringify(combineDiffs), model, effort]);

  // Show the Reviewer's verdict BEFORE the user confirms — but skip the preview for
  // a fresh Codex run (mode 'codex' with no reusable diff), which would spend a
  // Codex call just to preview. The deterministic/apply paths preview cheaply.
  const skipPreview = target?.mode === "codex" && !reuseDiff;
  useEffect(() => {
    if (!target) return;
    setStatus("confirm"); setResult(null); setErr(null); setPreview(null);
    if (skipPreview) return;
    const body = bodyFor();
    if (!body) return;
    let cancelled = false;
    setPreviewing(true);
    fetch(`${API}/api/my/pr/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setPreview(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const submit = useCallback(async () => {
    const body = bodyFor();
    if (!body) return;
    setStatus("working"); setErr(null);
    try {
      const r = await fetch(`${API}/api/my/pr`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.detail || `Pull-request request failed (${r.status})`);
      setResult(data); setStatus("done");
      if (data?.url && typeof data.number === "number") onOpened(data);
    } catch (e) { setErr((e as Error).message); setStatus("error"); }
  }, [bodyFor, onOpened]);

  const label = target?.mode === "bump_all" ? "Open consolidated PR" : target?.mode === "combine" ? "Open combined PR" : target?.mode === "bump" ? "Open bump PR" : reuseDiff ? "Open patch PR" : "Run Codex & open PR";

  return (
    <AnimatePresence>
      {target && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            data-lenis-prevent
            {...dialogProps}
            className="relative max-h-[86vh] w-[min(520px,100%)] overflow-auto rounded-3xl border border-[color:var(--surface-border)] bg-ink-2/95 p-7 outline-none"
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onClose} aria-label="Close dialog" className="absolute right-5 top-4 text-2xl text-fog hover:text-cloud">×</button>
            <h3 className="mb-1 font-serif text-2xl">Open a pull request</h3>
            <p className="mb-4 text-[13px] text-fog">Umbra opens PRs only — it never merges, and only ever touches a new <span className="font-mono">umbra/…</span> branch. The Reviewer scores the exact change first.</p>
            {status === "done" && result ? (
              <div className="flex flex-col gap-3">
                <p className="text-[14px] text-teal">✓ Opened PR #{result.number} on <span className="font-mono">{result.branch}</span> → {result.base}.</p>
                {result.review && <ReviewVerdict review={result.review} skipped={result.skipped} />}
                <a href={result.url} target="_blank" rel="noreferrer" className="break-all font-mono text-[13px] text-cyan hover:underline">{result.url} ↗</a>
                <button onClick={onClose} className="mt-2 self-start rounded-xl border border-[color:var(--surface-border)] px-4 py-2.5 text-xs text-fog transition-colors hover:text-cloud">Close</button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 text-[13px] leading-relaxed">
                  {target.mode === "bump" ? (
                    <p className="text-fog">Bump <b className="font-mono text-cloud">{target.vuln?.package}@{target.vuln?.version}</b> to its OSV-patched version in <b className="font-mono text-cloud">{repoFullName(repo)}</b>{target.vuln?.cve ? <> — remediating <span className="font-mono">{target.vuln.cve}</span></> : null}. Deterministic edit; no Codex credits used.</p>
                  ) : target.mode === "bump_all" ? (
                    <p className="text-fog">Open <b className="text-cloud">one PR</b> that bumps <b className="text-cloud">every vulnerable dependency</b> in <b className="font-mono text-cloud">{repoFullName(repo)}</b> to a version that clears its OSV advisories. Deterministic edits; no Codex credits used.</p>
                  ) : target.mode === "combine" ? (
                    <p className="text-fog">Open <b className="text-cloud">one PR</b> combining the crew&apos;s reviewed changes (Watchman&apos;s dependency fix + Janitor&apos;s cleanup) for <b className="font-mono text-cloud">{repoFullName(repo)}</b>. Any change that conflicts is skipped and noted. No new Codex run.</p>
                  ) : reuseDiff ? (
                    <p className="text-fog">Open a PR from the patch Umbra <b className="text-cloud">already proposed</b> during the scan (the diff you reviewed) for <b className="font-mono text-cloud">{repoFullName(repo)}</b> — applied on a new branch in seconds. No new Codex run, no credits used.</p>
                  ) : (
                    <p className="text-fog">Let Codex propose the smallest safe fix for <b className="font-mono text-cloud">{repoFullName(repo)}</b> in a disposable checkout, then open it as a PR on a new branch. Uses founder Codex credits.</p>
                  )}
                </div>
                {/* The exact change under review — the real patch when Umbra has it
                    client-side, else the planned file/bump list from the preview. */}
                {reviewDiff.trim() ? (
                  <div>
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">The change under review</p>
                    <div data-lenis-prevent className="max-h-72 overflow-auto rounded-lg border border-[color:var(--surface-border)] p-2"><DiffView diff={reviewDiff} maxLines={220} /></div>
                  </div>
                ) : preview?.bumps?.length ? (
                  <div>
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">Planned bumps ({preview.bumps.length})</p>
                    <div className="flex flex-col gap-1 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] p-2.5 font-mono text-[11px]">
                      {preview.bumps.map((b) => (
                        <div key={b.package} className="flex items-center justify-between gap-3">
                          <span className="truncate text-cloud">{b.package}</span>
                          <span className="shrink-0 text-fog">{b.current} <span className="text-teal">→ {b.fixed}</span> · clears {b.advisories}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : preview?.files?.length ? (
                  <div>
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">Files this PR will change ({preview.files.length})</p>
                    <div className="flex flex-col gap-0.5 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] p-2.5 font-mono text-[11px] text-cloud">
                      {preview.files.map((f) => <span key={f} className="truncate">{f}</span>)}
                    </div>
                  </div>
                ) : null}
                {previewing && <p className="font-mono text-[12px] text-fog">Analyzing the change &amp; scoring risk…</p>}
                {preview?.review && <ReviewVerdict review={preview.review} skipped={preview.skipped} />}
                {err && <p className="font-mono text-xs text-[color:var(--sev-critical)]">{err}</p>}
                <div className="flex items-center gap-2">
                  <StatefulButton loading={status === "working"} onClick={submit}>{label}</StatefulButton>
                  <button onClick={onClose} className="rounded-xl border border-[color:var(--surface-border)] px-4 py-2.5 text-xs text-fog transition-colors hover:text-cloud">Cancel</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AskPanel({ repo }: { repo: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<AskAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ask = useCallback(async () => {
    const question = q.trim();
    if (!question || busy) return;
    // Stream the answer so the first grounded tokens appear in ~1–3s instead of
    // waiting for the whole response. References arrive in a leading SSE frame.
    setBusy(true); setErr(null); setAns({ answer: "", references: [] });
    let answer = "";
    let references: Reference[] = [];
    let source: string | undefined;
    let reasoning: string | undefined;
    try {
      const r = await fetch(`${API}/api/ask/stream?repo_url=${encodeURIComponent(repo)}&question=${encodeURIComponent(question)}`, creds);
      if (!r.ok) throw new Error(`Ask Umbra returned ${r.status}`);
      await readSSE(r, (event, data) => {
        try {
          const p = JSON.parse(data);
          if (event === "references") { references = p.references ?? []; source = p.source; }
          else if (event === "umbra") { answer += p.chunk ?? ""; }
          else if (event === "done") { reasoning = p.reasoning ?? reasoning; } // true GPT-5.6 reasoning provider
        } catch { /* ignore a malformed frame */ }
        setAns({ answer, references, source, reasoning });
      });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [q, busy, repo]);

  const PINK = "#f472b6";
  return (
    <GlowCard glow="rgba(244,114,182,0.14)" className="flex flex-col overflow-hidden p-0">
      {/* Terminal chrome — Ask Umbra as an operator console. */}
      <div className="flex items-center gap-2 border-b border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-4 py-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md border font-mono text-[11px] font-semibold" style={{ color: PINK, borderColor: `${PINK}55`, background: `${PINK}12` }}>A</span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-cloud">Ask Umbra</span>
        <span className="ml-auto truncate font-mono text-[10px] text-fog">repo: {repoFullName(repo)}</span>
      </div>
      <div className="flex flex-1 flex-col p-4 font-mono text-[12.5px]">
        {/* Prompt line */}
        <div className="flex items-center gap-2">
          <span style={{ color: PINK }}>&gt;</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder="why is checkout failing?" spellCheck={false} className="flex-1 bg-transparent text-cloud outline-none placeholder:text-fog/50" />
          <StatefulButton loading={busy} disabled={!q.trim()} onClick={ask}>Ask</StatefulButton>
        </div>
        {err && <p className="mt-3 text-[11px] text-[color:var(--sev-critical)]">{err}</p>}
        {ans && (
          <div className="mt-4 border-t border-[color:var(--surface-border)] pt-3">
            <div className="flex gap-2">
              <span className="shrink-0" style={{ color: PINK }}>umbra:</span>
              <p className="whitespace-pre-wrap leading-relaxed text-cloud">{ans.answer || (busy ? "" : "…")}{busy && <span className="ml-0.5 inline-block animate-pulse" style={{ color: PINK }}>▍</span>}</p>
            </div>
            {ans.references?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ans.references.map((rf, i) => (
                  <a key={`${rf.file}-${i}`} href={`https://github.com/${repoFullName(repo)}/blob/HEAD/${rf.file}${rf.lines ? `#L${rf.lines}` : ""}`} target="_blank" rel="noreferrer" className="rounded-md border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2 py-1 text-[11px] text-cyan transition-colors hover:border-cyan/50" title="verified reference">✓ {rf.file}{rf.lines ? `:${rf.lines}` : ""} ↗</a>
                ))}
              </div>
            )}
            {(ans.source || ans.reasoning) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {ans.source && <span className={`rounded-full border px-2.5 py-1 text-[10px] ${providerTone(ans.source)}`}>{ans.source}</span>}
                {ans.reasoning && <span className={`rounded-full border px-2.5 py-1 text-[10px] ${providerTone(ans.reasoning)}`}>reasoning: {ans.reasoning}</span>}
              </div>
            )}
          </div>
        )}
        {!ans && !err && <p className="mt-3 text-[11px] leading-relaxed text-fog">Grounded in real file:line references, never invented. Streams as GPT reasons — labelled with its source.</p>}
      </div>
    </GlowCard>
  );
}

function DetectivePanel({ repo }: { repo: string }) {
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [pm, setPm] = useState<Postmortem | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const investigate = useCallback(async () => {
    const error_log = log.trim();
    if (!error_log || busy) return;
    // Stream the root-cause reasoning live; the structured postmortem (root cause,
    // timeline) arrives in a final `result` frame once reasoning completes.
    setBusy(true); setErr(null); setPm(null);
    let explanation = "";
    let status = "";
    let base: Postmortem | null = null;
    const paint = () => setPm({
      incident: base?.incident ?? "",
      root_cause_commit: base?.root_cause_commit ?? "unconfirmed",
      confidence: base?.confidence ?? 0,
      timeline: base?.timeline ?? [],
      explanation: explanation || base?.explanation || status,
      blast_radius: base?.blast_radius ?? "",
      suggested_fix: base?.suggested_fix ?? "",
      reasoning_chain: base?.reasoning_chain ?? [],
      source: base?.source,
    });
    try {
      const r = await fetch(`${API}/api/investigate/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_url: repo, error_log }) });
      if (!r.ok) throw new Error(`Detective returned ${r.status}`);
      await readSSE(r, (event, data) => {
        try {
          const p = JSON.parse(data);
          if (event === "status") status = p.message ?? "";
          else if (event === "umbra") explanation += p.chunk ?? "";
          else if (event === "result") base = p as Postmortem;
        } catch { /* ignore a malformed frame */ }
        paint();
      });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [log, busy, repo]);

  const confirmed = pm && pm.root_cause_commit && pm.root_cause_commit !== "unconfirmed";

  const AMBER = "#fbbf24";
  return (
    <GlowCard glow="rgba(251,191,36,0.14)" className="flex flex-col overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-4 py-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md border font-mono text-[11px] font-semibold" style={{ color: AMBER, borderColor: `${AMBER}55`, background: `${AMBER}12` }}>D</span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-cloud">Detective</span>
        <span className="ml-auto truncate font-mono text-[10px] text-fog">git history · {repoFullName(repo)}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <textarea value={log} onChange={(e) => setLog(e.target.value)} rows={2} placeholder="Paste an error log or stack trace…" className="w-full resize-y rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 font-mono text-[12px] outline-none focus:border-cyan/50" />
        <div className="mt-2 flex justify-end">
          <StatefulButton loading={busy} disabled={!log.trim()} onClick={investigate}>Trace root cause</StatefulButton>
        </div>
        {err && <p className="mt-3 font-mono text-[11px] text-[color:var(--sev-critical)]">{err}</p>}
        {pm ? (
          <div className="relative mt-4 flex flex-col gap-3 border-t border-[color:var(--surface-border)] pt-4">
            {/* the trace beam — Detective following the error down to its origin */}
            <span aria-hidden className="absolute bottom-2 left-[6px] top-6 w-px" style={{ background: "var(--surface-border)" }} />
            <TraceStage color={AMBER} label="ERROR LOG" active>
              <span className="line-clamp-2 font-mono text-[11px] text-fog">{log.trim() || "—"}</span>
            </TraceStage>
            {pm.timeline?.length > 0 && (
              <TraceStage color="#8b90a6" label="RECENT HISTORY">
                <ul className="flex flex-col gap-0.5">
                  {pm.timeline.slice(0, 5).map((t, i) => <li key={i} className="font-mono text-[11px] text-fog">{t}</li>)}
                </ul>
              </TraceStage>
            )}
            <TraceStage color={confirmed ? AMBER : "#8b90a6"} label="CANDIDATE COMMIT" active={!!confirmed}>
              <span className="font-mono text-[12px]" style={{ color: confirmed ? AMBER : "#8b90a6" }}>{confirmed ? pm.root_cause_commit : "unconfirmed"}</span>
            </TraceStage>
            <TraceStage color={confirmed ? "#5eead4" : "#8b90a6"} label={confirmed ? "CONFIRMED" : "UNCONFIRMED"} active={!!confirmed}>
              <span className="font-mono text-[11px] text-fog">confidence {Math.round((pm.confidence ?? 0) * 100)}% · {confirmed ? "traced from real git history" : "not enough signal to name a commit"}</span>
            </TraceStage>
            {(pm.explanation || busy) && (
              <TraceStage color={AMBER} label="REASONING" active>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-cloud">{pm.explanation}{busy && <span className="ml-0.5 inline-block animate-pulse" style={{ color: AMBER }}>▍</span>}</p>
              </TraceStage>
            )}
            {pm.suggested_fix && (
              <TraceStage color="#5eead4" label="SUGGESTED FIX" active>
                <span className="text-[12.5px] leading-relaxed text-cloud">{pm.suggested_fix}</span>
              </TraceStage>
            )}
            {pm.source && <span className={`ml-5 inline-block self-start rounded-full border px-2.5 py-1 font-mono text-[10px] ${providerTone(pm.source)}`}>{pm.source}</span>}
          </div>
        ) : (
          !err && <p className="mt-3 text-[11px] leading-relaxed text-fog">Traces an error to its root-cause commit from real git history — reasoned by OpenAI, never guessed. Unconfirmed commits are labelled honestly.</p>
        )}
      </div>
    </GlowCard>
  );
}

function TraceStage({ color, label, active, children }: { color: string; label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex gap-3 pl-5">
      <span className="absolute left-0 top-0.5 grid w-3 place-items-center">
        {active ? (
          <span className="relative grid h-3 w-3 place-items-center">
            <span className="absolute h-3 w-3 rounded-full" style={{ background: color, opacity: 0.24 }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full border" style={{ borderColor: color }} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: active ? color : "#8b90a6" }}>{label}</div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;
const SEV_COLOR: Record<string, string> = { critical: "#fb7185", high: "#fbbf24", medium: "#22d3ee", low: "#5eead4" };

// Latest saved scan per repo (history is newest-first).
function latestPerRepo(history: Scan[]): Scan[] {
  const seen = new Map<string, Scan>();
  for (const s of history) if (!seen.has(s.repo_full_name)) seen.set(s.repo_full_name, s);
  return [...seen.values()];
}

function RepoRollup({ history, onView }: { history: Scan[]; onView: (s: Scan) => void }) {
  const latest = useMemo(() => latestPerRepo(history), [history]);
  const stats = useMemo(() => {
    const scores = latest.map((s) => s.umbra_score).filter((n): n is number => typeof n === "number");
    const sev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const s of latest) for (const v of s.report?.vulnerabilities ?? []) if (v.severity in sev) sev[v.severity]++;
    return {
      repos: latest.length,
      avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      worst: scores.length ? Math.min(...scores) : null,
      advisories: latest.reduce((a, s) => a + (s.vuln_count ?? 0), 0),
      sev,
      offenders: [...latest].sort((a, b) => (a.umbra_score ?? 101) - (b.umbra_score ?? 101)).slice(0, 5),
    };
  }, [latest]);
  if (latest.length < 2) return null; // a rollup only earns its place across multiple repos

  return (
    <Reveal>
      <GlowCard className="p-7">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-2xl">Portfolio overview</h2>
          <span className="font-mono text-[11px] text-fog">{stats.repos} repositories · latest scan each</span>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Repos" value={String(stats.repos)} />
          <Stat label="Avg score" value={stats.avg == null ? "—" : String(stats.avg)} tone={stats.avg != null && stats.avg < 60 ? "warn" : "ok"} />
          <Stat label="Worst score" value={stats.worst == null ? "—" : String(stats.worst)} tone={stats.worst != null && stats.worst < 60 ? "bad" : "ok"} />
          <Stat label="Advisories" value={String(stats.advisories)} tone={stats.advisories > 0 ? "warn" : "ok"} />
        </div>
        {stats.advisories > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {SEV_ORDER.filter((k) => stats.sev[k] > 0).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fog">
                <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[k] }} />
                {stats.sev[k]} {k}
              </span>
            ))}
          </div>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Needs attention</p>
          {stats.offenders.map((s) => (
            <button key={s.repo_full_name} onClick={() => onView(s)} className="group flex items-center justify-between gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-2.5 text-left transition-colors hover:border-cyan/40">
              <b className="truncate font-mono text-[13px] text-cyan/90">{s.repo_full_name}</b>
              <span className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-fog">
                <span>score {s.umbra_score ?? "—"}</span>
                <span>{s.vuln_count ?? 0} adv</span>
                <span className="text-cyan opacity-0 transition-opacity group-hover:opacity-100">open →</span>
              </span>
            </button>
          ))}
        </div>
      </GlowCard>
    </Reveal>
  );
}

function Stat({ label, value, tone = "ok" }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-[color:var(--sev-critical)]" : tone === "warn" ? "text-amber" : "text-cloud";
  return (
    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">{label}</div>
      <div className={`mt-1 font-serif text-2xl ${color}`}>{value}</div>
    </div>
  );
}

// The PR ledger — every branch-only PR Umbra opened for this user, as durable
// receipts grouped by repo. This is the accountability trail: a real PR #, the
// branch it lives on, the advisory it remediates, and the deterministic Reviewer
// verdict recorded at open time. Umbra never merges — every row says so.
function prModeLabel(mode?: string): string {
  return mode === "bump_all" ? "consolidated bumps" : mode === "combine" ? "combined crew changes" : mode === "apply_diff" ? "reviewed patch" : mode === "codex" ? "Codex-authored" : "dependency bump";
}
function PrLedger({ prs }: { prs: PrRecord[] }) {
  const groups = useMemo(() => {
    const by = new Map<string, PrRecord[]>();
    for (const p of prs) {
      const repo = repoFullName(p.repo_url ?? "") || "unknown";
      (by.get(repo) ?? by.set(repo, []).get(repo)!).push(p);
    }
    return [...by.entries()];
  }, [prs]);
  if (prs.length === 0) return null;

  return (
    <Reveal>
      <GlowCard glow="rgba(94,234,212,0.2)" className="p-7">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-2xl">Pull request ledger</h2>
          <span className="font-mono text-[11px] text-fog">{prs.length} opened · branch-only</span>
        </div>
        <p className="mb-4 text-[13px] text-fog">Every fix PR Umbra opened, on its own <span className="font-mono">umbra/…</span> branch — the Reviewer&apos;s risk verdict is recorded at open time. Umbra <b className="text-cloud">never merges</b>; you review &amp; merge on GitHub.</p>
        <div className="flex flex-col gap-4">
          {groups.map(([repo, rows]) => (
            <div key={repo}>
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-cyan/90">{repo}</p>
              <div className="flex flex-col gap-2">
                {rows.map((p) => {
                  const rev = p.review;
                  const tone = rev ? (rev.severity === "critical" || rev.severity === "high" ? "text-[color:var(--sev-critical)] border-rose-400/40 bg-rose-400/10" : rev.severity === "medium" ? "text-amber border-amber/40 bg-amber/10" : "text-teal border-teal/40 bg-teal/10") : "";
                  return (
                    <div key={`${repo}#${p.number}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3">
                      <span className="font-mono text-[12px] font-semibold text-cloud">#{p.number}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-teal">{prModeLabel(p.mode)}</span>
                      {p.package && <span className="font-mono text-[11px] text-fog">{p.package}{p.cve ? <> · {p.cve}</> : null}</span>}
                      {p.branch && <span className="font-mono text-[10px] text-fog/70">{p.branch} → {p.base ?? "main"}</span>}
                      {rev && <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${tone}`}>risk {rev.risk_score}/100</span>}
                      <span className="ml-auto flex items-center gap-3">
                        {p.opened_at && <time className="font-mono text-[10px] text-fog/70">{new Date(p.opened_at).toLocaleString()}</time>}
                        <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-cyan hover:underline">open ↗</a>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </GlowCard>
    </Reveal>
  );
}

function RemediationQueue({ history, canPr, dismissed, onDismiss, onRestore, onOpened }: { history: Scan[]; canPr: boolean; dismissed: Set<string>; onDismiss: (key: string) => void; onRestore: (key: string) => void; onOpened?: () => void }) {
  const items = useMemo(() => {
    const out: { repo: string; v: Vuln; key: string }[] = [];
    const seenKey = new Set<string>();
    for (const s of latestPerRepo(history)) {
      for (const v of s.report?.vulnerabilities ?? []) {
        const key = `${s.repo_full_name}:${v.package}@${v.version}:${v.cve}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        out.push({ repo: s.repo_full_name, v, key });
      }
    }
    // Worst first.
    return out.sort((a, b) => SEV_ORDER.indexOf(a.v.severity as typeof SEV_ORDER[number]) - SEV_ORDER.indexOf(b.v.severity as typeof SEV_ORDER[number])).slice(0, 25);
  }, [history]);
  const [showHidden, setShowHidden] = useState(false);
  if (items.length === 0) return null;
  const active = items.filter((it) => !dismissed.has(it.key));
  const hidden = items.filter((it) => dismissed.has(it.key));

  return (
    <Reveal>
      <GlowCard glow="rgba(94,234,212,0.2)" className="p-7">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-2xl">Remediation queue</h2>
          <span className="font-mono text-[11px] text-fog">{active.length} open{hidden.length ? ` · ${hidden.length} dismissed` : ""}</span>
        </div>
        <p className="mb-4 text-[13px] text-fog">
          One click opens a <b className="text-cloud">branch-only</b> dependency-bump PR (deterministic, no Codex credits) — Umbra never merges. Dismiss anything you&apos;ve handled or won&apos;t fix.
          {!canPr && <> Connect GitHub with repo access to enable this.</>}
        </p>
        <div className="flex flex-col gap-2.5">
          {active.length === 0 ? (
            <p className="text-[13px] text-fog">Nothing open — every advisory here has been dismissed.</p>
          ) : (
            active.map((it) => <RemediationRow key={it.key} repo={it.repo} v={it.v} canPr={canPr} onDismiss={() => onDismiss(it.key)} onOpened={onOpened} />)
          )}
        </div>
        {hidden.length > 0 && (
          <div className="mt-4 border-t border-[color:var(--surface-border)] pt-3">
            <button onClick={() => setShowHidden((s) => !s)} className="font-mono text-[11px] text-fog transition-colors hover:text-cloud">
              {showHidden ? "Hide dismissed" : `Show ${hidden.length} dismissed`}
            </button>
            {showHidden && (
              <div className="mt-2.5 flex flex-col gap-2.5">
                {hidden.map((it) => <RemediationRow key={it.key} repo={it.repo} v={it.v} canPr={canPr} dismissed onRestore={() => onRestore(it.key)} />)}
              </div>
            )}
          </div>
        )}
      </GlowCard>
    </Reveal>
  );
}

function RemediationRow({ repo, v, canPr, dismissed, onDismiss, onRestore, onOpened }: { repo: string; v: Vuln; canPr: boolean; dismissed?: boolean; onDismiss?: () => void; onRestore?: () => void; onOpened?: () => void }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [pr, setPr] = useState<{ url: string; number: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const openPr = useCallback(async () => {
    setStatus("working"); setErr(null);
    try {
      const r = await fetch(`${API}/api/my/pr`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_url: `https://github.com/${repo}`, mode: "bump", package: v.package, version: v.version, cve: v.cve }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.detail || `PR request failed (${r.status})`);
      setPr(data); setStatus("done");
      onOpened?.(); // refresh the PR ledger so this new receipt appears
    } catch (e) { setErr((e as Error).message); setStatus("error"); }
  }, [repo, v, onOpened]);

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 ${dismissed ? "opacity-60" : ""}`}>
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-cyan">
        <span className="grid h-5 w-5 place-items-center rounded border border-cyan/40 bg-cyan/10 text-[10px] font-semibold">W</span>WATCHMAN
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-teal">patch prepared</span>
      <SeverityChip severity={v.severity} />
      <span className="font-mono text-[12px] text-cloud">{v.package}<span className="text-fog">@{v.version}</span></span>
      <span className="font-mono text-[11px] text-fog">{v.cve}</span>
      <span className="ml-auto truncate font-mono text-[11px] text-fog/70">{repo}</span>
      {dismissed ? (
        <button onClick={onRestore} className="rounded-full border border-[color:var(--surface-border)] px-3 py-1 font-mono text-[10px] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">Restore</button>
      ) : status === "done" && pr ? (
        <a href={pr.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-teal hover:underline">✓ PR #{pr.number} ↗</a>
      ) : (
        <>
          <button
            onClick={openPr}
            disabled={!canPr || status === "working"}
            title={canPr ? "Open a dependency-bump PR" : "Connect GitHub to open PRs"}
            className="rounded-full border border-cyan/40 bg-cyan/10 px-3 py-1 font-mono text-[10px] text-cyan transition-colors hover:bg-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "working" ? "Opening…" : "Open bump PR →"}
          </button>
          {onDismiss && (
            <button onClick={onDismiss} title="Dismiss from the queue" className="rounded-full border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] text-fog transition-colors hover:border-rose-400/50 hover:text-[color:var(--sev-critical)]">Dismiss</button>
          )}
        </>
      )}
      {err && <span className="w-full font-mono text-[10px] text-[color:var(--sev-critical)]">{err}</span>}
    </div>
  );
}

// Honest, human labels for the delivery-status states the backend persists after
// each scheduled run. "accepted_for_delivery" is deliberately NOT "delivered" —
// it means the provider accepted the message, not that it reached an inbox.
const DELIVERY_LABELS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  scheduled: { label: "Scheduled — not yet run", tone: "muted" },
  accepted_for_delivery: { label: "Accepted for delivery", tone: "good" },
  email_rejected: { label: "Email rejected by provider", tone: "bad" },
  scan_failed: { label: "Scan failed — no report sent", tone: "bad" },
  email_unavailable: { label: "Email not configured / no recipient", tone: "warn" },
  skipped_opted_out: { label: "Skipped — notifications off", tone: "muted" },
};

function ScheduledReportsPanel({ user, schedules, defaultRepo, onRefresh, onSetNotifications }: {
  user: User; schedules: Schedule[]; defaultRepo: string; onRefresh: () => void; onSetNotifications: (enabled: boolean) => void;
}) {
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } }, []);
  const [repo, setRepo] = useState(defaultRepo);
  const [time, setTime] = useState("09:00");
  const [cadence, setCadence] = useState<"daily" | "weekdays">("daily");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // On-demand "email latest report now": per-repo send state so each row is independent.
  const [sending, setSending] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  // Prefill the repo once the current scan target is known (empty on first paint).
  useEffect(() => { if (defaultRepo) setRepo((r) => r || defaultRepo); }, [defaultRepo]);

  const notifOn = !user.notifications_opt_out;

  const emailNow = useCallback(async (targetRepo: string) => {
    setSending(targetRepo);
    setSendResult((prev) => { const n = { ...prev }; delete n[targetRepo]; return n; });
    try {
      const r = await fetch(`${API}/api/my/reports/email`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo: targetRepo }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.detail || `Could not send (${r.status})`);
      // Only claim acceptance when the backend confirms the provider accepted it.
      const ok = data?.status === "accepted_for_delivery";
      setSendResult((prev) => ({ ...prev, [targetRepo]: { ok, message: ok ? "Accepted for delivery" : "Sent, but not confirmed" } }));
    } catch (e) {
      setSendResult((prev) => ({ ...prev, [targetRepo]: { ok: false, message: (e as Error).message } }));
    } finally { setSending(null); }
  }, []);


  const create = useCallback(async () => {
    const slug = repoFullName(repo);
    if (!slug.includes("/")) { setErr("Enter a repository as owner/name."); return; }
    const [h, m] = time.split(":").map((n) => parseInt(n, 10));
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/api/my/schedules`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_full_name: slug, hour: h || 0, minute: m || 0, timezone: tz, cadence }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.detail || `Could not schedule (${r.status})`);
      onRefresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [repo, time, cadence, tz, onRefresh]);

  const toggle = useCallback(async (s: Schedule) => {
    await fetch(`${API}/api/my/schedules/${s.id}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ enabled: !s.enabled }) }).catch(() => {});
    onRefresh();
  }, [onRefresh]);

  const remove = useCallback(async (s: Schedule) => {
    await fetch(`${API}/api/my/schedules/${s.id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    onRefresh();
  }, [onRefresh]);

  return (
    <GlowCard glow="rgba(167,139,250,0.2)" className="p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl">Scheduled morning reports</h2>
        <span className="font-mono text-[11px] text-fog">{schedules.length} scheduled</span>
      </div>
      <p className="mb-4 max-w-[70ch] text-[13px] leading-relaxed text-fog">
        Umbra scans the repos you choose at the time you pick and emails you the report — so it&apos;s waiting when you wake up. Every report is also saved to your history. {user.is_founder ? "Live Codex patches run for your founder account." : "Codex patches are founder-gated on the hosted preview; you still get live OSV findings and the full report."}
      </p>

      {!user.scheduling_enabled && <p className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 font-mono text-[11px] text-amber">Scheduling isn&apos;t enabled on this server yet — schedules save but won&apos;t fire until the operator configures the scheduler.</p>}
      {user.scheduling_enabled && !user.email_enabled && <p className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 font-mono text-[11px] text-amber">Email delivery isn&apos;t configured on this server — scheduled scans still run and save to your history, but no email is sent.</p>}

      <div className="mb-4 flex items-center justify-between rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-4 py-3">
        <span className="text-[13px] text-fog">Email me when a report is ready</span>
        <button onClick={() => onSetNotifications(!notifOn)} className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${notifOn ? "border-teal/40 bg-teal/10 text-teal" : "border-[color:var(--surface-border)] text-fog"}`}>{notifOn ? "On" : "Off"}</button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog">Repository</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" spellCheck={false} className="rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2 font-mono text-[13px] outline-none focus:border-cyan/50" />
        </label>
        <label className="flex flex-col gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2 font-mono text-[13px] outline-none focus:border-cyan/50" />
        </label>
        <label className="flex flex-col gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog">Cadence</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as "daily" | "weekdays")} className="rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2 font-mono text-[13px] outline-none focus:border-cyan/50">
            <option value="daily">Daily</option><option value="weekdays">Weekdays</option>
          </select>
        </label>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <span className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-3 py-2 font-mono text-[13px] text-fog" title="Reports are sent only to your signed-in account email.">
          <span className="text-[10px] uppercase tracking-[0.12em] text-fog/70">To</span>
          <span className="truncate text-cloud">{user.email || "no account email"}</span>
        </span>
        <Magnetic><StatefulButton loading={busy} onClick={create}>Schedule report</StatefulButton></Magnetic>
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-fog/70">Reports are sent only to your signed-in account email. Timezone: {tz} · every report email includes a one-click unsubscribe.</p>
      {err && <p className="mt-2 font-mono text-[11px] text-[color:var(--sev-critical)]">{err}</p>}

      {schedules.length > 0 && (
        <div className="mt-5 flex flex-col divide-y divide-[color:var(--surface-border)]">
          {schedules.map((s) => {
            const status = s.last_delivery_status ? DELIVERY_LABELS[s.last_delivery_status] : null;
            const toneClass = status?.tone === "good" ? "text-teal" : status?.tone === "bad" ? "text-[color:var(--sev-critical)]" : status?.tone === "warn" ? "text-amber" : "text-fog";
            const result = sendResult[s.repo_full_name];
            return (
              <div key={s.id} className="flex flex-col gap-1.5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[12px] text-cloud">{s.repo_full_name}</span>
                  <span className="font-mono text-[11px] text-fog">{String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")} · {s.cadence} · {s.timezone}</span>
                  {s.next_run_at && <span className="font-mono text-[10px] text-fog/70">next {new Date(s.next_run_at).toLocaleString()}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    <button onClick={() => toggle(s)} className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${s.enabled ? "border-teal/40 bg-teal/10 text-teal" : "border-[color:var(--surface-border)] text-fog"}`}>{s.enabled ? "Active" : "Paused"}</button>
                    <button onClick={() => remove(s)} className="rounded-full border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] text-fog transition-colors hover:border-rose-400/50 hover:text-[color:var(--sev-critical)]">Delete</button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {status ? (
                    <span className={`font-mono text-[10px] ${toneClass}`}>
                      Last run: {status.label}{s.last_delivery_at ? ` · ${new Date(s.last_delivery_at).toLocaleString()}` : ""}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-fog/70">Last run: not yet run</span>
                  )}
                  <button
                    onClick={() => emailNow(s.repo_full_name)}
                    disabled={sending === s.repo_full_name}
                    className="ml-auto rounded-full border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] text-fog transition-colors hover:border-cyan/50 hover:text-cloud disabled:opacity-50"
                  >
                    {sending === s.repo_full_name ? "Sending…" : "Email latest report now"}
                  </button>
                </div>
                {result && (
                  <span className={`font-mono text-[10px] ${result.ok ? "text-teal" : "text-[color:var(--sev-critical)]"}`}>{result.message}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </GlowCard>
  );
}

function ByoKeyPanel({ user, keyInput, setKeyInput, onSave, onRemove, saving }: {
  user: User; keyInput: string; setKeyInput: (v: string) => void; onSave: () => void; onRemove: () => void; saving: boolean;
}) {
  return (
    <GlowCard glow="rgba(34,211,238,0.2)" className="p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold">Live reasoning {user.is_founder ? "· founder Codex enabled" : ""}</p>
          <p className="mt-1 max-w-[64ch] text-[13px] leading-relaxed text-fog">
            {user.has_openai_key
              ? "Your OpenAI key is connected — GPT reasoning runs on your account."
              : user.is_founder
                ? "As the founder, live Codex diffs + reasoning run on the server for your account. You can also add your own key."
                : "Add your own OpenAI key to unlock live GPT reasoning on your scans (billed to you). Codex diffs run on your own machine via the local CLI."}
          </p>
        </div>
        {user.has_openai_key ? (
          <button onClick={onRemove} className="shrink-0 rounded-xl border border-[color:var(--surface-border)] px-4 py-2.5 text-xs text-fog transition-colors hover:border-rose-400/50 hover:text-cloud">Remove key</button>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" aria-label="OpenAI API key" className="w-52 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2.5 font-mono text-[13px] outline-none focus:border-cyan/50" />
            <StatefulButton loading={saving} disabled={!keyInput.startsWith("sk-")} onClick={onSave}>Connect</StatefulButton>
          </div>
        )}
      </div>
    </GlowCard>
  );
}

function ReplayModal({ replay, onClose }: { replay: Replay | null; onClose: () => void }) {
  const { dialogProps } = useModalA11y(!!replay, onClose, replay ? `${replay.agent} reasoning replay` : "Reasoning replay");
  const { ref, ...aria } = dialogProps;
  return (
    <AnimatePresence>
      {replay && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.article
            data-lenis-prevent
            ref={ref as unknown as React.Ref<HTMLElement>}
            {...aria}
            className="relative max-h-[86vh] w-[min(680px,100%)] overflow-auto rounded-3xl border border-[color:var(--surface-border)] bg-ink-2/95 p-7 outline-none"
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.32, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onClose} aria-label="Close replay" className="absolute right-5 top-4 text-2xl text-fog hover:text-cloud">×</button>
            <h2 className="mb-5 font-serif text-2xl">{replay.agent} · reasoning replay</h2>
            {(() => {
              // Show ONE honest state per half instead of repeating the same raw
              // error across diff/tests/reasoning (the old behavior). The real
              // reason is still shown, de-emphasized, so it stays debuggable.
              const reasoningDown = replay.providers?.reasoning === "unavailable";
              const codexProvider = replay.providers?.engineering;
              const codexDown = !replay.codex_diff && (codexProvider === "unavailable" || /unavailable|failed|disabled/i.test(replay.tests || ""));
              // The Reviewer is read-only by design: it reads an existing PR's diff
              // (shown in the prompt) and reports risk — it never writes code, so an
              // empty diff here is expected, not a failed run.
              const isReview = /review/i.test(replay.agent);
              return (
                <>
                  <Step n="01" label={isReview ? "PR UNDER REVIEW" : "PROMPT"}><p>{replay.prompt}</p></Step>
                  <Step n="02" label={isReview ? "REVIEW OUTCOME" : "CODEX DIFF"}>
                    {isReview
                      ? <p className="text-fog">Read-only review — Umbra inspected the diff above and modified <b className="text-cloud">no files</b>. The risk assessment is in the reasoning below.</p>
                      : replay.codex_diff
                        ? <DiffView diff={replay.codex_diff} maxLines={400} />
                        : codexDown
                          ? <Unavailable title="Codex didn’t complete on this run." raw={replay.tests} />
                          : <p className="text-fog">No changes proposed on this run.</p>}
                  </Step>
                  <Step n="03" label={isReview ? "METHOD" : "TESTS"}>
                    {isReview
                      ? <p className="text-fog">A review runs no tests — it reads the pull request diff and reports concrete regressions, security risks, and missing coverage.</p>
                      : codexDown ? <p className="text-fog">Not reached — Codex didn’t run to completion.</p> : <p>{replay.tests}</p>}
                  </Step>
                  <Step n="04" label="REASONING">
                    {reasoningDown ? <Unavailable title="Live reasoning is unavailable on this run." raw={replay.reasoning} nudge /> : <p>{replay.reasoning}</p>}
                  </Step>
                </>
              );
            })()}
            {replay.providers && (
              <Step n="05" label="PROVIDER LEDGER">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(replay.providers).map(([k, v]) => <span key={k} className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${providerTone(v)}`}>{k}: {v}</span>)}
                </div>
              </Step>
            )}
            <p className="mt-4 border-t border-[color:var(--surface-border)] pt-4 font-mono text-[10px] tracking-[0.06em] text-fog">Every half is labelled with what produced it — never fabricated.</p>
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Unavailable({ title, raw, nudge }: { title: string; raw?: string; nudge?: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="text-fog">{title}</p>
      {nudge && <p className="text-[12px] text-cyan/80">Add your OpenAI key below to unlock live reasoning on your scans.</p>}
      {raw && <p className="font-mono text-[11px] leading-relaxed text-fog/55">{raw}</p>}
    </div>
  );
}

function Step({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-3 border-t border-[color:var(--surface-border)] py-4 first:border-t-0">
      <span className="font-mono text-[11px] text-cyan">{n}</span>
      <div>
        <b className="font-mono text-[11px] tracking-[0.08em]">{label}</b>
        <div className="mt-1.5 text-[13px] leading-relaxed text-fog [&_p]:whitespace-pre-wrap">{children}</div>
      </div>
    </div>
  );
}
