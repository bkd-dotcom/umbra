"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GlowCard } from "@/components/ui/glow-card";
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
import { PROOF_SCAN, PROOF_REPO, PROOF_CAPTURED_AT } from "@/lib/proof-scan";
import { EASE, fadeUp, stagger } from "@/lib/motion";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const creds: RequestInit = { credentials: "include" };

type User = { name?: string; email?: string; avatar?: string; provider: string; login?: string; sub: string; github_connected?: boolean; github_login?: string; has_openai_key?: boolean; is_founder?: boolean };
type Repo = { name: string; full_name: string; url: string; private: boolean; stars: number };
type Vuln = { package: string; version: string; cve: string; severity: string; owasp?: string; summary?: string };
type Replay = { agent: string; prompt: string; codex_diff: string; tests: string; reasoning: string; timings: Record<string, number>; providers?: Record<string, string> };
type AgentRun = { agent: string; summary: string; findings: unknown[]; replay: Replay };
type Autonomy = { level: number; label: string; auto_merge: boolean; human_review_required: boolean };
type Policy = { loaded: boolean; path?: string; summary: string };
type ScanResult = { umbra_score?: number; vulnerabilities?: Vuln[]; dependencies?: Dep[]; source?: string; live_agents?: string[]; agent_results?: AgentRun[]; reasoning_summary?: string; repo_url?: string; run_id?: string; evidence_hash?: string; autonomy?: Autonomy; policy?: Policy };
type Scan = { scan_id?: string; repo_full_name: string; umbra_score?: number; source?: string; vuln_count?: number; ran_at?: string; report?: ScanResult };
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
  return "text-fog border-[color:var(--surface-border)] bg-white/5";
}

// Affirmative provenance pill for reports — LIVE vs SAMPLE (and cache/unavailable),
// so a judge instantly knows whether a card reflects their scan or example data.
function StatusPill({ kind }: { kind: "live" | "sample" | "cache" | "captured" | "unavailable" }) {
  const map = {
    live: { label: "LIVE SCAN RESULT", cls: "text-teal border-teal/40 bg-teal/10" },
    sample: { label: "SAMPLE SHIFT", cls: "text-fog/80 border-[color:var(--surface-border)] bg-white/5" },
    cache: { label: "CACHE", cls: "text-amber border-amber/40 bg-amber/10" },
    captured: { label: "CAPTURED SCAN", cls: "text-amber border-amber/40 bg-amber/10" },
    unavailable: { label: "UNAVAILABLE", cls: "text-fog border-[color:var(--surface-border)] bg-white/5" },
  }[kind];
  return <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${map.cls}`}>{map.label}</span>;
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
  return { label: "Elevated risk", tone: "text-rose-300", note: "Address the advisories below." };
}

// The five agents, identical identity to the homepage crew. Colour is used only
// as status: an agent lights in its identity colour when working this shift, and
// stays fog when idle. Detective = amber, Ask = pink (aligned with the homepage).
const CREW = [
  { key: "watchman", letter: "W", name: "WATCHMAN", role: "Dependency sentinel", working: "ON WATCH", idle: "STANDBY", doing: "scanning dependencies", color: "#22d3ee" },
  { key: "detective", letter: "D", name: "DETECTIVE", role: "Incident tracer", working: "REASONING", idle: "STANDBY", doing: "tracing incident history", color: "#fbbf24" },
  { key: "reviewer", letter: "R", name: "REVIEWER", role: "PR risk analyst", working: "REVIEWING", idle: "WAITING", doing: "PR risk analysis", color: "#a78bfa" },
  { key: "janitor", letter: "J", name: "JANITOR", role: "Tech-debt sweeper", working: "CLEANING", idle: "IDLE", doing: "dead-code sweep", color: "#5eead4" },
  { key: "ask", letter: "A", name: "ASK UMBRA", role: "Codebase oracle", working: "ANSWERING", idle: "READY", doing: "grounded code answers", color: "#f472b6" },
] as const;

// Short filed-action lines for the sample shift, so the guest preview reads like
// the homepage dispatch (real per-agent work, not just a status dot).
const DEMO_DETAIL: Record<string, string> = {
  watchman: "1 advisory · patch prepared",
  detective: "incident traced to a9c31f",
  reviewer: "PR #128 · low blast-radius",
  janitor: "4 dead exports swept",
  ask: "3 answers · grounded",
};

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
  const [prTarget, setPrTarget] = useState<{ mode: "bump" | "codex"; vuln?: Vuln } | null>(null);
  // A PR that was just opened — surfaced as a persistent toast so the "it's ready"
  // signal survives after the dialog closes. Umbra never merges; this is advisory.
  const [prOpened, setPrOpened] = useState<{ url: string; number: number; branch: string; base: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [viewingSaved, setViewingSaved] = useState<string | null>(null);
  // When set, the dashboard is showing the bundled real-but-captured proof scan
  // (instant, no wait) rather than a live run — labelled CAPTURED SCAN, never live.
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(() => {
    fetch(`${API}/api/my/scans`, creds).then((r) => (r.ok ? r.json() : [])).then((d: Scan[]) => Array.isArray(d) && setHistory(d)).catch(() => {});
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
    setScanning(true); setScanError(null); setResult(null); setStep(0); setViewingSaved(null); setCapturedAt(null);
    scrollToTop();
    stepTimer.current = setInterval(() => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 1400);
    try {
      const res = await fetch(`${API}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_url: url, model, reasoning_effort: effort, agents: crew === "quick" ? ["watchman"] : undefined }) });
      if (!res.ok) throw new Error(`scan returned ${res.status}`);
      const data: ScanResult = await res.json();
      setResult(data);
      // Persist the FULL report so this scan can be re-opened later without re-scanning.
      fetch(`${API}/api/my/scans`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_full_name: repoFullName(url), umbra_score: data.umbra_score, source: data.source ?? "demo-cache", vuln_count: (data.vulnerabilities ?? []).length, report: data }) }).then(loadHistory).catch(() => {});
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
      setScanning(false);
    }
  }, [repoUrl, scanning, loadHistory, model, effort, crew]);

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
  // Phase drives the command header + crew board. The guest sample preview reads
  // as a *filed* shift (matching its sample score/findings); a real logged-in
  // dashboard with no scan yet reads "standing by". Live scans progress normally.
  const phase: Phase = scanning ? "scanning" : result || showingDemo ? "done" : "idle";

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] px-6 pb-24 md:px-10">
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
        <ApiStatus up={apiUp} />
        {me && <AutoReviewPanel appInfo={appInfo} installs={appInstalls} />}
        {scanError && <p className="mt-3 font-mono text-xs text-rose-300">Scan unavailable: {scanError}{guest ? " — showing the sample shift below." : ""}</p>}

        {/* Scan progress */}
        <AnimatePresence>
          {scanning && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <GlowCard className="mt-5 p-6">
                <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan">Running · {repoFullName(repoUrl)}</p>
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
            (hero score + filed dispatch); an idle dashboard keeps the compact
            score + crew status while it waits for the next scan. */}
        {!scanning && (
          phase === "done" && shift ? (
            <ShiftReport result={shift} repo={shiftRepo} demo={showingDemo} capturedAt={capturedAt} />
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
              <ScorePanel result={shift} demo={showingDemo} capturedAt={capturedAt} />
              <CrewStatusBoard phase={phase} crew={crew} result={shift} demo={showingDemo} />
            </div>
          )
        )}
      </section>

      {/* ── Zone 02 · Findings ──────────────────────────────────────────────── */}
      {shift && !scanning && (
        <section className="relative mt-14">
          <ZoneLabel n="02" title="Findings" hint={showingDemo ? "sample" : captured ? `captured ${capturedAt}` : shift.source} />
          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="flex flex-col gap-5">
              <FindingsLedger vulns={shiftVulns} canPr={canPr && !showingDemo && !captured} demo={showingDemo} onOpenPr={(v) => setPrTarget({ mode: "bump", vuln: v })} />
              {me?.is_founder && canPr && !showingDemo && !captured && shiftVulns.length > 0 && (
                <button onClick={() => setPrTarget({ mode: "codex" })} className="self-start rounded-full border border-violet/40 bg-violet/10 px-3.5 py-1.5 font-mono text-[11px] text-violet transition-colors hover:bg-violet/20">Open a Codex fix PR →</button>
              )}
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
          {/* Reasoning replays — keep the honest per-agent replay reachable */}
          {result?.agent_results && result.agent_results.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Reasoning replays · this run</p>
              <div className="flex flex-col gap-2.5">
                {result.agent_results.map((run) => <AgentRunRow key={run.agent} run={run} onOpen={() => setActiveReplay(run.replay)} />)}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Zone 03 · Operations & actions ──────────────────────────────────── */}
      {targetRepo && !scanning && (
        <section className="relative mt-14">
          <ZoneLabel n="03" title="Operations" hint={repoFullName(targetRepo)} />
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

          {history.length > 0 && (
            <section className="mt-10 grid gap-6">
              <RepoRollup history={history} onView={viewSaved} />
              <RemediationQueue history={history} canPr={canPr} dismissed={dismissedKeys} onDismiss={dismissRemediation} onRestore={restoreRemediation} />
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
                      <button onClick={clearSelectedScans} className="rounded-xl border border-rose-400/40 px-3.5 py-2 font-mono text-[11px] text-rose-300 transition-colors hover:bg-rose-400/10">Clear selected ({selectedScans.size})</button>
                    )}
                    <button onClick={clearHistory} disabled={clearingHistory} className="rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2 font-mono text-[11px] text-fog transition-colors hover:border-rose-400/50 hover:text-rose-300 disabled:opacity-50">
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
      {me && <PrDialog target={prTarget} repo={targetRepo} diff={watchmanDiff} model={model} effort={effort} onClose={() => setPrTarget(null)} onOpened={setPrOpened} />}

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
            <p className="text-sm font-semibold text-rose-300">Couldn&apos;t load your repositories</p>
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
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/5 ${r.url === repoUrl ? "bg-cyan/10 text-cyan" : ""}`}
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
      {/* Surface the concrete model + effort so "Fast / Balanced" isn't opaque —
          the spec is real (these are the exact Codex model IDs the scan runs on). */}
      <p className="font-mono text-[11px] text-fog">
        Codex model <span className="text-cloud">{model}</span> · reasoning <span className="text-cloud">{effort}</span> · {crew === "quick" ? "1 agent" : "3 agents"}
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
function ApiStatus({ up }: { up: boolean | null }) {
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
          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-[color:var(--surface-border)] bg-black/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-cloud">uv run uvicorn backend.main:app --reload   # http://localhost:8000</pre>
        </>
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
    ["01", "Run a public repo scan", "Live, OSV-grounded findings from any open-source repo — or open a captured scan below for instant proof."],
    ["02", "Read the Provider Ledger", "Every output labelled live / cache / unavailable — never fabricated."],
    ["03", "Open a reasoning replay", "After a scan, open any agent below for its Codex CLI prompt + diff and GPT‑5.6 reasoning — shown when enabled."],
  ] as const;
  return (
    <GlowCard className="mt-4 mb-5 p-5">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan">For judges</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">A 30-second path through the proof</span>
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
      <span className="font-mono text-[13px] font-bold tracking-[0.18em] text-cloud"><span className="text-cyan">◐</span> UMBRA <span className="text-fog/40">//</span> <span className="text-fog">MISSION CONTROL</span></span>
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
      <div className="flex items-center gap-3">
        <LocalWeather />
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
            <StatusPill kind="live" />
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

function CrewStatusBoard({ phase, crew, result, demo }: { phase: Phase; crew: Crew; result: ScanResult | null; demo?: boolean }) {
  // Truth source for completion is the actual run: an agent reads DONE only if it
  // filed a result this shift (result.agent_results) — never the crew toggle. During
  // a live scan we light the agents that will participate. Detective + Ask are
  // on-demand tools with their own flows, so they sit standby/ready, not in the scan.
  const runs = new Map((result?.agent_results ?? []).map((r) => [r.agent, r] as const));
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Crew status</p>
        <span className="font-mono text-[10px] text-fog">{phase === "scanning" ? "shift active" : phase === "done" ? "shift filed" : "standing by"}</span>
      </div>
      <div className="flex flex-col divide-y divide-[color:var(--surface-border)]">
        {CREW.map((a) => {
          const isAsk = a.key === "ask";
          const run = runs.get(a.key);
          // Watchman always scans; Reviewer + Janitor join a full crew. Detective is
          // incident-triggered (Operations zone), never part of a dependency scan.
          const scanCrew = a.key === "watchman" || (crew === "full" && (a.key === "reviewer" || a.key === "janitor"));
          let state: "idle" | "working" | "done" | "ready";
          let status: string;
          if (isAsk) { state = "ready"; status = a.idle; }
          // Sample preview: the whole crew filed the shift (matches sample findings).
          else if (demo) { state = "done"; status = "DONE"; }
          // Filed this shift — the agent actually ran and returned a result.
          else if (run) { state = "done"; status = "DONE"; }
          else if (phase === "scanning" && scanCrew) { state = "working"; status = a.working; }
          else { state = "idle"; status = a.idle; }
          // Prefer the agent's own filed summary (parity with the homepage dispatch).
          const detail = run?.summary?.trim() || (demo ? DEMO_DETAIL[a.key] : "") || a.doing;
          const lit = state !== "idle";
          const color = lit ? a.color : "#8b90a6";
          return (
            <div key={a.key} className="flex items-center gap-3 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border font-mono text-[11px] font-semibold" style={lit ? { color: a.color, borderColor: `${a.color}55`, background: `${a.color}12` } : { color: "#8b90a6", borderColor: "var(--surface-border)" }}>{a.letter}</span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cloud">{a.name}</div>
                <div className="truncate font-mono text-[10px] text-fog">{detail}</div>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color }}>
                {state === "working" ? (
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse-glow" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                ) : state === "done" ? (
                  <span className="text-[11px] leading-none text-teal">✓</span>
                ) : state === "ready" ? (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full border" style={{ borderColor: color }} />
                )}
                {status}
              </span>
            </div>
          );
        })}
      </div>
    </GlowCard>
  );
}

// Dawn palette — shared with the homepage Morning Report so a filed shift here
// reads with the same cinematic conclusion, driven by the real scan.
const DAWN = { risk: "#fb7185", amber: "#fbbf24", resolve: "#5eead4", fog: "#8b90a6" };

// Highlight grounded references (CVE, short commit, pkg@ver, PR #) inside a filed
// summary so the dispatch reads like the homepage's grounded signatures.
function groundRefs(text: string): React.ReactNode {
  const re = /(CVE-\d{4}-\d+|PR #\d+|\b[0-9a-f]{6,40}\b|[a-z0-9][a-z0-9/._-]*@[\d][\w.]*)/gi;
  return text.split(re).map((p, i) => (i % 2 === 1 ? <span key={i} className="font-mono text-cloud">{p}</span> : <span key={i}>{p}</span>));
}

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
                <StatusPill kind="live" />
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

        {/* The night's work — one filed signature per unit that actually ran. */}
        {runs.length > 0 && (
          <>
            <div className="mt-8 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fog/70">
              <span className="h-px w-6" style={{ background: "var(--surface-border)" }} /> The night&rsquo;s work
            </div>
            <motion.div
              className="mt-2 divide-y divide-[color:var(--surface-border)]"
              initial={reduce ? false : "hidden"} animate="show" variants={stagger(0.12, 0.08)}
            >
              {runs.map((r) => {
                const m = DISPATCH_META[r.agent];
                return (
                  <motion.div key={r.agent} variants={fadeUp} className="py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--surface-border)] font-mono text-[11px] font-semibold text-fog">{m.letter}</span>
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-cloud">{m.unit}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fog">{m.from} <span style={{ color: m.toColor }}>&rarr; {m.to}</span></span>
                    </div>
                    <p className="mt-1.5 pl-10 font-mono text-[12px] leading-relaxed text-fog">{groundRefs(r.summary || "filed")}</p>
                  </motion.div>
                );
              })}
            </motion.div>
          </>
        )}

        {/* Signature — honest provenance, the same line as the homepage. */}
        <div className="mt-6 border-t border-[color:var(--surface-border)] pt-4 font-mono text-[10px] leading-relaxed text-fog/70">
          Filed by the night crew · grounded in OSV + git history · never fabricated{demo ? " · sample shift" : capturedAt ? ` · captured ${capturedAt}` : ""}
        </div>
      </div>
    </GlowCard>
  );
}

function FindingsLedger({ vulns, canPr, demo, onOpenPr }: { vulns: Vuln[]; canPr: boolean; demo?: boolean; onOpenPr: (v: Vuln) => void }) {
  return (
    <GlowCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Findings ledger</p>
        <span className="font-mono text-[10px] text-fog">{vulns.length} {vulns.length === 1 ? "advisory" : "advisories"}</span>
      </div>
      {demo && vulns.length > 0 && (
        <p className="mb-3 rounded-lg border border-[color:var(--surface-border)] bg-white/5 px-3 py-2 font-mono text-[10.5px] leading-snug text-fog/80">
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
          {vulns.map((v, i) => <FindingRow key={`${v.cve}-${i}`} v={v} canPr={canPr} onOpenPr={() => onOpenPr(v)} />)}
        </div>
      )}
    </GlowCard>
  );
}

function FindingRow({ v, canPr, onOpenPr }: { v: Vuln; canPr: boolean; onOpenPr: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-left">
        <SeverityChip severity={v.severity} />
        <span className="min-w-0 break-all font-mono text-[13px] text-cloud">{v.package}<span className="text-fog">@{v.version}</span></span>
        <span className="min-w-0 break-all font-mono text-[11px] text-fog">{v.cve}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-fog">
          <span className="text-cyan">◉ WATCHMAN</span>
          <span className="text-fog/40">· osv.dev</span>
          <span className="text-fog transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
        </span>
      </button>
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
        <span className="font-mono text-[10px] text-fog">{deps.length} deps · <span className={vulnCount ? "text-rose-300" : "text-teal"}>{vulnCount} vulnerable</span></span>
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
        <span className="rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-rose-300">never auto-merges</span>
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
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${loaded ? "text-teal border-teal/40 bg-teal/10" : "text-fog border-[color:var(--surface-border)] bg-white/5"}`}>{loaded ? "loaded" : "default"}</span>
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

function AgentRunRow({ run, onOpen }: { run: AgentRun; onOpen: () => void }) {
  const providers = run.replay?.providers ?? {};
  return (
    <button onClick={onOpen} className="flex items-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-left transition-colors hover:border-[color:var(--surface-border-hover)]">
      <b className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-cloud sm:w-24">{run.agent}</b>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {Object.entries(providers).map(([k, val]) => (
          <span key={k} className={`break-all rounded-full border px-2 py-0.5 font-mono text-[9px] ${providerTone(val)}`}>{k}:{val}</span>
        ))}
      </div>
      <span className="ml-auto shrink-0 text-fog">↗</span>
    </button>
  );
}

function PrDialog({ target, repo, diff, model, effort, onClose, onOpened }: { target: { mode: "bump" | "codex"; vuln?: Vuln } | null; repo: string; diff: string; model: string; effort: string; onClose: () => void; onOpened: (pr: { url: string; number: number; branch: string; base: string }) => void }) {
  const [status, setStatus] = useState<"confirm" | "working" | "done" | "error">("confirm");
  const [result, setResult] = useState<{ url: string; number: number; branch: string; base: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (target) { setStatus("confirm"); setResult(null); setErr(null); } }, [target]);

  // For a Codex fix, reuse the patch Watchman already produced in the scan (the
  // diff on screen): applying it opens a PR in seconds with no second Codex run.
  // Only fall back to a fresh Codex run when there is no diff to reuse.
  const reuseDiff = target?.mode === "codex" && !!diff.trim();

  const submit = useCallback(async () => {
    if (!target) return;
    setStatus("working"); setErr(null);
    try {
      const body = target.mode === "bump"
        ? { repo_url: repo, mode: "bump", package: target.vuln?.package, version: target.vuln?.version, cve: target.vuln?.cve }
        : reuseDiff
          ? { repo_url: repo, mode: "apply_diff", diff }
          : { repo_url: repo, mode: "codex", model, reasoning_effort: effort };
      const r = await fetch(`${API}/api/my/pr`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.detail || `Pull-request request failed (${r.status})`);
      setResult(data); setStatus("done");
      if (data?.url && typeof data.number === "number") onOpened(data);
    } catch (e) { setErr((e as Error).message); setStatus("error"); }
  }, [target, repo, reuseDiff, diff, model, effort, onOpened]);

  return (
    <AnimatePresence>
      {target && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm" />
          <motion.div
            className="relative w-[min(520px,100%)] rounded-3xl border border-[color:var(--surface-border)] bg-ink-2/95 p-7"
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onClose} className="absolute right-5 top-4 text-2xl text-fog hover:text-cloud">×</button>
            <h3 className="mb-1 font-serif text-2xl">Open a pull request</h3>
            <p className="mb-4 text-[13px] text-fog">Umbra opens PRs only — it never merges, and only ever touches a new <span className="font-mono">umbra/…</span> branch.</p>
            {status === "done" && result ? (
              <div className="flex flex-col gap-3">
                <p className="text-[14px] text-teal">✓ Opened PR #{result.number} on <span className="font-mono">{result.branch}</span> → {result.base}.</p>
                <a href={result.url} target="_blank" rel="noreferrer" className="break-all font-mono text-[13px] text-cyan hover:underline">{result.url} ↗</a>
                <button onClick={onClose} className="mt-2 self-start rounded-xl border border-[color:var(--surface-border)] px-4 py-2.5 text-xs text-fog transition-colors hover:text-cloud">Close</button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4 text-[13px] leading-relaxed">
                  {target.mode === "bump" ? (
                    <p className="text-fog">Bump <b className="font-mono text-cloud">{target.vuln?.package}@{target.vuln?.version}</b> to its OSV-patched version in <b className="font-mono text-cloud">{repoFullName(repo)}</b>{target.vuln?.cve ? <> — remediating <span className="font-mono">{target.vuln.cve}</span></> : null}. Deterministic edit; no Codex credits used.</p>
                  ) : reuseDiff ? (
                    <p className="text-fog">Open a PR from the patch Umbra <b className="text-cloud">already proposed</b> during the scan (the diff you reviewed) for <b className="font-mono text-cloud">{repoFullName(repo)}</b> — applied on a new branch in seconds. No new Codex run, no credits used.</p>
                  ) : (
                    <p className="text-fog">Let Codex propose the smallest safe fix for <b className="font-mono text-cloud">{repoFullName(repo)}</b> in a disposable checkout, then open it as a PR on a new branch. Uses founder Codex credits.</p>
                  )}
                </div>
                {err && <p className="font-mono text-xs text-rose-300">{err}</p>}
                <div className="flex items-center gap-2">
                  <StatefulButton loading={status === "working"} onClick={submit}>{target.mode === "bump" ? "Open bump PR" : reuseDiff ? "Open patch PR" : "Run Codex & open PR"}</StatefulButton>
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
      <div className="flex items-center gap-2 border-b border-[color:var(--surface-border)] bg-black/25 px-4 py-2.5">
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
        {err && <p className="mt-3 text-[11px] text-rose-300">{err}</p>}
        {ans && (
          <div className="mt-4 border-t border-[color:var(--surface-border)] pt-3">
            <div className="flex gap-2">
              <span className="shrink-0" style={{ color: PINK }}>umbra:</span>
              <p className="whitespace-pre-wrap leading-relaxed text-cloud">{ans.answer || (busy ? "" : "…")}{busy && <span className="ml-0.5 inline-block animate-pulse" style={{ color: PINK }}>▍</span>}</p>
            </div>
            {ans.references?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ans.references.map((rf, i) => (
                  <a key={`${rf.file}-${i}`} href={`https://github.com/${repoFullName(repo)}/blob/HEAD/${rf.file}${rf.lines ? `#L${rf.lines}` : ""}`} target="_blank" rel="noreferrer" className="rounded-md border border-[color:var(--surface-border)] bg-black/20 px-2 py-1 text-[11px] text-cyan transition-colors hover:border-cyan/50" title="verified reference">✓ {rf.file}{rf.lines ? `:${rf.lines}` : ""} ↗</a>
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
      <div className="flex items-center gap-2 border-b border-[color:var(--surface-border)] bg-black/25 px-4 py-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md border font-mono text-[11px] font-semibold" style={{ color: AMBER, borderColor: `${AMBER}55`, background: `${AMBER}12` }}>D</span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-cloud">Detective</span>
        <span className="ml-auto truncate font-mono text-[10px] text-fog">git history · {repoFullName(repo)}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <textarea value={log} onChange={(e) => setLog(e.target.value)} rows={2} placeholder="Paste an error log or stack trace…" className="w-full resize-y rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 font-mono text-[12px] outline-none focus:border-cyan/50" />
        <div className="mt-2 flex justify-end">
          <StatefulButton loading={busy} disabled={!log.trim()} onClick={investigate}>Trace root cause</StatefulButton>
        </div>
        {err && <p className="mt-3 font-mono text-[11px] text-rose-300">{err}</p>}
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
  const color = tone === "bad" ? "text-rose-300" : tone === "warn" ? "text-amber" : "text-cloud";
  return (
    <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">{label}</div>
      <div className={`mt-1 font-serif text-2xl ${color}`}>{value}</div>
    </div>
  );
}

function RemediationQueue({ history, canPr, dismissed, onDismiss, onRestore }: { history: Scan[]; canPr: boolean; dismissed: Set<string>; onDismiss: (key: string) => void; onRestore: (key: string) => void }) {
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
            active.map((it) => <RemediationRow key={it.key} repo={it.repo} v={it.v} canPr={canPr} onDismiss={() => onDismiss(it.key)} />)
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

function RemediationRow({ repo, v, canPr, dismissed, onDismiss, onRestore }: { repo: string; v: Vuln; canPr: boolean; dismissed?: boolean; onDismiss?: () => void; onRestore?: () => void }) {
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
    } catch (e) { setErr((e as Error).message); setStatus("error"); }
  }, [repo, v]);

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
            <button onClick={onDismiss} title="Dismiss from the queue" className="rounded-full border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] text-fog transition-colors hover:border-rose-400/50 hover:text-rose-300">Dismiss</button>
          )}
        </>
      )}
      {err && <span className="w-full font-mono text-[10px] text-rose-300">{err}</span>}
    </div>
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
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="sk-…" className="w-52 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2.5 font-mono text-[13px] outline-none focus:border-cyan/50" />
            <StatefulButton loading={saving} disabled={!keyInput.startsWith("sk-")} onClick={onSave}>Connect</StatefulButton>
          </div>
        )}
      </div>
    </GlowCard>
  );
}

function ReplayModal({ replay, onClose }: { replay: Replay | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {replay && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm" />
          <motion.article
            data-lenis-prevent
            className="relative max-h-[86vh] w-[min(680px,100%)] overflow-auto rounded-3xl border border-[color:var(--surface-border)] bg-ink-2/95 p-7"
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.32, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onClose} className="absolute right-5 top-4 text-2xl text-fog hover:text-cloud">×</button>
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
                        ? <pre className="overflow-auto rounded-lg bg-black/50 p-3 font-mono text-[12px] text-cyan/90">{replay.codex_diff}</pre>
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
