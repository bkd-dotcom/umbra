"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { GlowCard } from "@/components/ui/glow-card";
import { MovingBorderCard } from "@/components/ui/moving-border";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { StatefulButton } from "@/components/ui/stateful-button";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { Spotlight } from "@/components/ui/spotlight";
import { DitherImage } from "@/components/ui/dither-image";
import { Magnetic } from "@/components/ui/magnetic-button";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ScoreDial } from "@/components/ui/score-dial";
import { SeverityChip } from "@/components/ui/severity-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { type Dep } from "@/components/ui/dependency-map";
import { GitHubIcon, LockIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { scrollToTop } from "@/components/ui/smooth-scroll";
import { LocalWeather } from "@/components/ui/local-weather";
import { EASE, fadeUp } from "@/lib/motion";

// three.js visualizations are client-only + heavy → lazy-loaded so the static
// export stays valid and the initial dashboard bundle stays lean.
const ThreatScatter3D = dynamic(() => import("@/components/ui/threat-scatter-3d").then((m) => m.ThreatScatter3D), { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-xl" /> });
const DependencyGraph3D = dynamic(() => import("@/components/ui/dependency-graph-3d").then((m) => m.DependencyGraph3D), { ssr: false, loading: () => <Skeleton className="h-[320px] w-full rounded-xl" /> });

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const creds: RequestInit = { credentials: "include" };

type User = { name?: string; email?: string; avatar?: string; provider: string; login?: string; sub: string; github_connected?: boolean; github_login?: string; has_openai_key?: boolean; is_founder?: boolean };
type Repo = { name: string; full_name: string; url: string; private: boolean; stars: number };
type Vuln = { package: string; version: string; cve: string; severity: string; owasp?: string; summary?: string };
type Replay = { agent: string; prompt: string; codex_diff: string; tests: string; reasoning: string; timings: Record<string, number>; providers?: Record<string, string> };
type AgentRun = { agent: string; summary: string; findings: unknown[]; replay: Replay };
type ScanResult = { umbra_score?: number; vulnerabilities?: Vuln[]; dependencies?: Dep[]; source?: string; live_agents?: string[]; agent_results?: AgentRun[]; reasoning_summary?: string; repo_url?: string };
type Scan = { repo_full_name: string; umbra_score?: number; source?: string; vuln_count?: number; ran_at?: string; report?: ScanResult };
type Reference = { file: string; lines?: string; note?: string };
type AskAnswer = { answer: string; references: Reference[]; blast_radius?: string; source?: string };
type Postmortem = { incident: string; root_cause_commit: string; confidence: number; timeline: string[]; explanation: string; blast_radius: string; suggested_fix: string; reasoning_chain: string[]; source?: string };

const LIVE_PROVIDERS = new Set(["codex-cli", "osv.dev", "local-git", "local-git-grep", "responses-api", "responses-api-stream"]);

function repoFullName(url: string): string {
  return url.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
}
function providerTone(v: string): string {
  if (LIVE_PROVIDERS.has(v)) return "text-teal border-teal/40 bg-teal/10";
  if (v.includes("cache")) return "text-amber border-amber/40 bg-amber/10";
  return "text-fog border-[color:var(--surface-border)] bg-white/5";
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

export default function Dashboard() {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoError, setRepoError] = useState<{ status: number; msg: string } | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  // Scan speed profile — defaults to the fastest usable combo for a snappy first run.
  const [model, setModel] = useState<ModelId>("gpt-5.6-luna");
  const [effort, setEffort] = useState<Effort>("low");
  const [crew, setCrew] = useState<Crew>("quick");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [history, setHistory] = useState<Scan[]>([]);
  const [appInfo, setAppInfo] = useState<{ configured: boolean; install_url: string | null } | null>(null);
  const [appInstalls, setAppInstalls] = useState<{ installation_id: number; account_login: string; repos: string[] }[]>([]);
  const [activeReplay, setActiveReplay] = useState<Replay | null>(null);
  const [prTarget, setPrTarget] = useState<{ mode: "bump" | "codex"; vuln?: Vuln } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [viewingSaved, setViewingSaved] = useState<string | null>(null);
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

  // Auth gate.
  useEffect(() => {
    fetch(`${API}/api/me`, creds)
      .then((r) => { if (!r.ok) throw new Error("unauthenticated"); return r.json(); })
      .then((me: User) => {
        setUser(me);
        if (me.github_connected) { loadRepos(); }
        loadApp();
        loadHistory();
      })
      .catch(() => { setUser(null); window.location.replace("/"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const launchScan = useCallback(async (target?: string) => {
    const url = (target ?? repoUrl).trim();
    if (scanning || !url) return;
    if (target && target !== repoUrl) setRepoUrl(target);
    setScanning(true); setScanError(null); setResult(null); setStep(0); setViewingSaved(null);
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
      setHistory([]);
      if (viewingSaved) { setViewingSaved(null); setResult(null); }
    } finally { setClearingHistory(false); }
  }, [viewingSaved]);

  const vulns = result?.vulnerabilities ?? [];
  const deps = result?.dependencies ?? [];
  const targetRepo = (result?.repo_url || repoUrl || "").trim();
  const filteredRepos = useMemo(() => (repos ?? []).filter((r) => r.full_name.toLowerCase().includes(repoQuery.toLowerCase())), [repos, repoQuery]);

  if (user === "loading") return <AuthLoading />;
  if (user === null) return <main className="grid min-h-screen place-items-center text-fog">Redirecting…</main>;

  const firstName = (user.name || user.login || "engineer").split(" ")[0];
  const greet = new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening";
  const canPr = !!user.github_connected;

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] px-6 pb-24 md:px-10">
      {/* Dashboard backdrop (bold but readable): Aceternity Background Beams +
          a violet Spotlight layered over the slowly-drifting dot grid. Behind
          content, pointer-events-none, and reduced-motion aware; the glassy cards
          keep the data legible on top. */}
      <div className="bg-bold pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 dot-bg-drift opacity-[0.13]" />
        <BackgroundBeams className="opacity-50" />
        <Spotlight className="left-0 top-[-30%] md:left-[30%] md:top-[-25%]" fill="#a78bfa" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 -mx-6 mb-2 flex items-center justify-between gap-4 bg-ink/85 px-6 py-4 backdrop-blur-md md:-mx-10 md:px-10">
        <div className="flex items-center gap-2 text-sm font-extrabold tracking-[0.35em]"><span className="text-xl text-cyan tracking-normal">◐</span> UMBRA</div>
        <div className="flex items-center gap-3">
          <LocalWeather />
          {user.is_founder && <span className="hidden rounded-full border border-violet/40 bg-violet/10 px-2.5 py-1 font-mono text-[10px] text-violet sm:inline">FOUNDER · LIVE CODEX</span>}
          <DitherImage src={user.avatar || "/founder.jpg"} rounded pixelSize={2} className="h-9 w-9 border border-[color:var(--surface-border)]" />
          <div className="hidden sm:block">
            <div className="text-sm font-semibold leading-tight">{user.name || user.login}</div>
            <div className="text-[11px] text-fog">{user.email || user.provider}</div>
          </div>
          <button onClick={logout} className="rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2 text-xs text-fog transition-colors hover:border-rose-400/50 hover:text-cloud">Sign out</button>
        </div>
      </header>

      {/* Greeting + repo picker */}
      <section className="relative py-8">
        <motion.p variants={fadeUp} initial="hidden" animate="show" className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan">Mission control · {new Date().getHours() < 6 ? "night shift" : "on duty"}</motion.p>
        <motion.h1 variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.08 }} className="mt-2 font-serif text-[clamp(32px,4vw,52px)] leading-tight">
          Good {greet}, <span className="text-shimmer">{firstName}.</span>
        </motion.h1>
        <motion.p variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.16 }} className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-fog">
          Point the night crew at one of your repositories. Findings are real and grounded; anything Codex-only is labelled honestly.
        </motion.p>

        <div className="mt-7">
          <RepoPicker
            user={user}
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
          />
          <ScanOptions model={model} setModel={setModel} effort={effort} setEffort={setEffort} crew={crew} setCrew={setCrew} />
          <AutoReviewPanel appInfo={appInfo} installs={appInstalls} />
        </div>
        {scanError && <p className="mt-3 font-mono text-xs text-rose-300">Scan unavailable: {scanError}</p>}
      </section>

      {/* Scan progress */}
      <AnimatePresence>
        {scanning && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <GlowCard className="mb-6 p-6">
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

      {/* Results */}
      {result && !scanning && (
        <div className="grid gap-6">
          {viewingSaved && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan/30 bg-cyan/5 px-4 py-3 text-[13px]">
              <span className="text-fog">📄 Viewing a saved report{result.repo_url ? ` for ${repoFullName(result.repo_url)}` : ""} · {viewingSaved}</span>
              <button onClick={() => { setResult(null); setViewingSaved(null); }} className="font-mono text-[12px] text-cyan hover:underline">Back to scanning →</button>
            </div>
          )}
          {/* top row: score + radar */}
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <Reveal><GlowCard className="flex flex-col justify-between p-7">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Umbra score</p>
                <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${providerTone(result.source ?? "")}`}>{result.source}</span>
              </div>
              <div className="mt-5"><ScoreDial value={result.umbra_score ?? 0} /></div>
              <p className="mt-5 text-[13px] leading-relaxed text-fog">{result.reasoning_summary || "Scan complete."}</p>
            </GlowCard></Reveal>

            <Reveal delay={0.05}>
              <MovingBorderCard className="h-full">
                <div className="p-7">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Threat radar</p>
                    <span className="font-mono text-[10px] text-fog">{vulns.length} {vulns.length === 1 ? "advisory" : "advisories"}</span>
                  </div>
                  <ThreatScatter3D points={vulns} className="h-[260px] w-full" />
                  <div className="mt-1 flex items-center justify-between">
                    <b className="font-mono text-[10px] tracking-[0.12em]" style={{ color: vulns.length ? "#fb7185" : "#5eead4" }}>{vulns.length ? "EXPOSURE" : "CLEAR"}</b>
                    <small className="text-[10px] text-fog">drag to orbit · scroll to zoom · OWASP A06</small>
                  </div>
                </div>
              </MovingBorderCard>
            </Reveal>
          </div>

          {/* Vulnerability list */}
          <Reveal>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-2xl">Advisories</h2>
              <div className="flex items-center gap-3">
                {user.is_founder && canPr && <button onClick={() => setPrTarget({ mode: "codex" })} className="rounded-full border border-violet/40 bg-violet/10 px-3 py-1 font-mono text-[10px] text-violet transition-colors hover:bg-violet/20">Open a Codex fix PR →</button>}
                <span className="font-mono text-[11px] text-fog">{vulns.length} {vulns.length === 1 ? "advisory" : "advisories"} across {new Set(vulns.map((v) => v.package)).size} {new Set(vulns.map((v) => v.package)).size === 1 ? "dependency" : "dependencies"}</span>
              </div>
            </div>
            {vulns.length === 0 ? (
              <GlowCard glow="rgba(94,234,212,0.25)" className="grid place-items-center gap-2 p-12 text-center">
                <div className="text-3xl">✳</div>
                <p className="text-lg">0 advisories — clean</p>
                <p className="max-w-[42ch] text-[13px] text-fog">Watchman checked every resolved dependency against OSV and found no known advisories.</p>
              </GlowCard>
            ) : (
              <div className="flex flex-col gap-3">
                {vulns.map((v, i) => <VulnRow key={`${v.cve}-${i}`} v={v} i={i} onOpenPr={canPr ? () => setPrTarget({ mode: "bump", vuln: v }) : undefined} />)}
              </div>
            )}
          </Reveal>

          {/* dependency map + agent runs */}
          <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
            <Reveal><GlowCard className="p-7">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Dependency graph</p>
              <p className="mb-2 text-[13px] text-fog">{deps.length} dependencies · <span className="text-rose-300">{deps.filter((d) => d.vulnerable).length} vulnerable</span> · {vulns.length} {vulns.length === 1 ? "advisory" : "advisories"}</p>
              <DependencyGraph3D deps={deps} root={repoFullName(result.repo_url || repoUrl).split("/")[1] || "repo"} className="h-[320px] w-full" />
            </GlowCard></Reveal>

            <Reveal delay={0.05}><GlowCard className="p-7">
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Night crew · this run</p>
              <div className="flex flex-col gap-3">
                {(result.agent_results ?? []).map((run) => <AgentRunRow key={run.agent} run={run} onOpen={() => setActiveReplay(run.replay)} />)}
              </div>
            </GlowCard></Reveal>
          </div>
        </div>
      )}

      {/* The rest of the night crew — usable on the current repo target */}
      {targetRepo && !scanning && (
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <AskPanel repo={targetRepo} />
          <DetectivePanel repo={targetRepo} />
        </section>
      )}

      {/* Empty state before first scan */}
      {!result && !scanning && (
        <Reveal className="mt-2">
          <GlowCard className="grid place-items-center gap-3 p-16 text-center">
            <div className="text-4xl opacity-70">◐</div>
            <p className="text-lg">Pick a repository and press Run.</p>
            <p className="max-w-[44ch] text-[13px] text-fog">The score, threat radar, dependency graph, and every finding on this page are driven by the live scan — nothing is pre-filled.</p>
          </GlowCard>
        </Reveal>
      )}

      {/* BYO OpenAI key */}
      <section className="mt-8">
        <ByoKeyPanel user={user} keyInput={keyInput} setKeyInput={setKeyInput} onSave={saveKey} onRemove={removeKey} saving={savingKey} />
      </section>

      {/* Portfolio rollup + remediation queue — aggregated across saved scans */}
      {history.length > 0 && (
        <section className="mt-10 grid gap-6">
          <RepoRollup history={history} onView={viewSaved} />
          <RemediationQueue history={history} canPr={canPr} />
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="mt-10">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-2xl">Your scan history</h2>
            <button
              onClick={clearHistory}
              disabled={clearingHistory}
              className="rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2 font-mono text-[11px] text-fog transition-colors hover:border-rose-400/50 hover:text-rose-300 disabled:opacity-50"
            >
              {clearingHistory ? "Clearing…" : "Clear history"}
            </button>
          </div>
          <p className="mb-4 text-[13px] text-fog">Every report is saved — click one to re-open the full findings without re-scanning. Clearing removes them permanently from Umbra.</p>
          <div className="flex flex-col gap-2.5">
            {history.map((s, i) => {
              const openable = !!s.report;
              return (
                <button
                  key={i}
                  onClick={() => viewSaved(s)}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-left text-sm transition-colors hover:border-cyan/40"
                >
                  <b className="font-mono text-[13px] text-cyan/90">{s.repo_full_name}</b>
                  <span className="text-[12px] text-fog">score {s.umbra_score ?? "—"} · {s.vuln_count ?? 0} advisories · {s.source}</span>
                  <span className="flex items-center gap-3">
                    <time className="font-mono text-[10px] text-fog">{s.ran_at ? new Date(s.ran_at).toLocaleString() : ""}</time>
                    <span className="font-mono text-[11px] text-cyan">{openable ? "View report →" : "Re-scan →"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Replay modal */}
      <ReplayModal replay={activeReplay} onClose={() => setActiveReplay(null)} />

      {/* Pull-request confirm dialog (explicit, branch-only, never merges) */}
      <PrDialog target={prTarget} repo={targetRepo} onClose={() => setPrTarget(null)} />
    </main>
  );
}

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

function RepoPicker({ user, repos, repoError, onRetry, filtered, query, setQuery, repoUrl, setRepoUrl, scanning, onRun }: {
  user: User; repos: Repo[] | null; repoError: { status: number; msg: string } | null; onRetry: () => void;
  filtered: Repo[]; query: string; setQuery: (v: string) => void;
  repoUrl: string; setRepoUrl: (v: string) => void; scanning: boolean; onRun: () => void;
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
                          {r.stars > 0 && <span className="shrink-0 text-[11px] text-fog">★ {r.stars}</span>}
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
  return (
    <div className="mt-4 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-cloud">Autonomous PR auto-review</p>
          <p className="mt-0.5 text-[12px] text-fog">
            Install the Umbra GitHub App once, pick your repos, and Umbra posts an advisory review on every new PR — public or private, never merges.
          </p>
        </div>
        {appInfo.configured && appInfo.install_url ? (
          <a
            href={appInfo.install_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-xl border border-violet/50 bg-violet/10 px-3.5 py-2.5 text-center font-mono text-[12px] text-violet transition-colors hover:bg-violet/20"
          >
            {covered.length ? "Manage installation" : "Install GitHub App"}
          </a>
        ) : (
          <span className="shrink-0 rounded-xl border border-[color:var(--surface-border)] px-3.5 py-2.5 font-mono text-[11px] text-fog">Coming soon</span>
        )}
      </div>
      {covered.length > 0 && (
        <div className="mt-3 border-t border-[color:var(--surface-border)] pt-3">
          <p className="font-mono text-[11px] text-fog">Auto-reviewing {covered.length} repo{covered.length === 1 ? "" : "s"}:</p>
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

function VulnRow({ v, i, onOpenPr }: { v: Vuln; i: number; onOpenPr?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: Math.min(i * 0.04, 0.4) }}>
      <GlowCard glow="rgba(251,113,133,0.22)" className="p-0">
        <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
          <SeverityChip severity={v.severity} />
          <span className="font-mono text-[13px] text-cloud">{v.package}<span className="text-fog">@{v.version}</span></span>
          <span className="ml-auto font-mono text-[12px] text-fog">{v.cve}</span>
          <span className="text-fog transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="border-t border-[color:var(--surface-border)] px-5 py-4 text-[13px] leading-relaxed text-fog">
                <p>{v.summary || "No advisory summary supplied."}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {v.owasp && <span className="rounded-full border border-[color:var(--surface-border)] px-2.5 py-1 font-mono text-[10px] text-fog">{v.owasp}</span>}
                  <a href={`https://osv.dev/vulnerability/${encodeURIComponent(v.cve)}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-cyan hover:underline">View advisory on OSV ↗</a>
                  {onOpenPr && <button onClick={onOpenPr} className="rounded-full border border-cyan/40 bg-cyan/10 px-3 py-1 font-mono text-[10px] text-cyan transition-colors hover:bg-cyan/20">Open fix PR →</button>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlowCard>
    </motion.div>
  );
}

function AgentRunRow({ run, onOpen }: { run: AgentRun; onOpen: () => void }) {
  const providers = run.replay?.providers ?? {};
  return (
    <button onClick={onOpen} className="flex items-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-left transition-colors hover:border-[color:var(--surface-border-hover)]">
      <b className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-cloud">{run.agent}</b>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(providers).map(([k, val]) => (
          <span key={k} className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${providerTone(val)}`}>{k}:{val}</span>
        ))}
      </div>
      <span className="ml-auto text-fog">↗</span>
    </button>
  );
}

function PrDialog({ target, repo, onClose }: { target: { mode: "bump" | "codex"; vuln?: Vuln } | null; repo: string; onClose: () => void }) {
  const [status, setStatus] = useState<"confirm" | "working" | "done" | "error">("confirm");
  const [result, setResult] = useState<{ url: string; number: number; branch: string; base: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (target) { setStatus("confirm"); setResult(null); setErr(null); } }, [target]);

  const submit = useCallback(async () => {
    if (!target) return;
    setStatus("working"); setErr(null);
    try {
      const body = target.mode === "bump"
        ? { repo_url: repo, mode: "bump", package: target.vuln?.package, version: target.vuln?.version, cve: target.vuln?.cve }
        : { repo_url: repo, mode: "codex" };
      const r = await fetch(`${API}/api/my/pr`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.detail || `Pull-request request failed (${r.status})`);
      setResult(data); setStatus("done");
    } catch (e) { setErr((e as Error).message); setStatus("error"); }
  }, [target, repo]);

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
                  ) : (
                    <p className="text-fog">Let Codex propose the smallest safe fix for <b className="font-mono text-cloud">{repoFullName(repo)}</b> in a disposable checkout, then open it as a PR on a new branch. Uses founder Codex credits.</p>
                  )}
                </div>
                {err && <p className="font-mono text-xs text-rose-300">{err}</p>}
                <div className="flex items-center gap-2">
                  <StatefulButton loading={status === "working"} onClick={submit}>{target.mode === "bump" ? "Open bump PR" : "Run Codex & open PR"}</StatefulButton>
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
    try {
      const r = await fetch(`${API}/api/ask/stream?repo_url=${encodeURIComponent(repo)}&question=${encodeURIComponent(question)}`, creds);
      if (!r.ok) throw new Error(`Ask Umbra returned ${r.status}`);
      await readSSE(r, (event, data) => {
        try {
          const p = JSON.parse(data);
          if (event === "references") { references = p.references ?? []; source = p.source; }
          else if (event === "umbra") { answer += p.chunk ?? ""; }
        } catch { /* ignore a malformed frame */ }
        setAns({ answer, references, source });
      });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [q, busy, repo]);

  return (
    <GlowCard glow="rgba(251,191,36,0.16)" className="flex flex-col p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg text-amber not-italic">?</span>
        <h3 className="font-serif text-xl">Ask Umbra</h3>
        <span className="ml-auto truncate font-mono text-[10px] text-fog">grounded in {repoFullName(repo)}</span>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-fog">Ask anything about this repo — answers are grounded in real code references, never invented.</p>
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="How does authentication work?" className="flex-1 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 text-[13px] outline-none focus:border-cyan/50" />
        <StatefulButton loading={busy} disabled={!q.trim()} onClick={ask}>Ask</StatefulButton>
      </div>
      {err && <p className="mt-3 font-mono text-xs text-rose-300">{err}</p>}
      {ans && (
        <div className="mt-4 border-t border-[color:var(--surface-border)] pt-4">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-cloud">{ans.answer}{busy && <span className="ml-0.5 inline-block animate-pulse text-cyan">▍</span>}</p>
          {ans.references?.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              <b className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">References</b>
              {ans.references.map((rf, i) => (
                <a key={`${rf.file}-${i}`} href={`https://github.com/${repoFullName(repo)}/blob/HEAD/${rf.file}${rf.lines ? `#L${rf.lines}` : ""}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-cyan hover:underline">{rf.file}{rf.lines ? `:${rf.lines}` : ""} ↗</a>
              ))}
            </div>
          )}
          {ans.source && <span className={`mt-3 inline-block rounded-full border px-2.5 py-1 font-mono text-[10px] ${providerTone(ans.source)}`}>{ans.source}</span>}
        </div>
      )}
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

  return (
    <GlowCard glow="rgba(244,114,182,0.16)" className="flex flex-col p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg text-pink not-italic">⌁</span>
        <h3 className="font-serif text-xl">Detective</h3>
        <span className="ml-auto truncate font-mono text-[10px] text-fog">git history · {repoFullName(repo)}</span>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-fog">Paste an error log or stack trace — Detective traces it to a root-cause commit from the real git history.</p>
      <textarea value={log} onChange={(e) => setLog(e.target.value)} rows={3} placeholder="Paste an error log or stack trace…" className="w-full resize-y rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-2.5 font-mono text-[12px] outline-none focus:border-cyan/50" />
      <div className="mt-2 flex justify-end">
        <StatefulButton loading={busy} disabled={!log.trim()} onClick={investigate}>Investigate</StatefulButton>
      </div>
      {err && <p className="mt-3 font-mono text-xs text-rose-300">{err}</p>}
      {pm && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[color:var(--surface-border)] pt-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">Root cause</b>
            <span className={`font-mono text-[12px] ${confirmed ? "text-teal" : "text-fog"}`}>{confirmed ? pm.root_cause_commit : "unconfirmed"}</span>
            <span className="ml-auto font-mono text-[10px] text-fog">confidence {Math.round((pm.confidence ?? 0) * 100)}%</span>
          </div>
          {pm.timeline?.length > 0 && (
            <div>
              <b className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">Recent history</b>
              <ul className="mt-1.5 flex flex-col gap-1">
                {pm.timeline.map((t, i) => <li key={i} className="font-mono text-[11px] text-fog">{t}</li>)}
              </ul>
            </div>
          )}
          <p className="whitespace-pre-wrap leading-relaxed text-cloud">{pm.explanation}{busy && <span className="ml-0.5 inline-block animate-pulse text-pink">▍</span>}</p>
          {pm.source && <span className={`inline-block self-start rounded-full border px-2.5 py-1 font-mono text-[10px] ${providerTone(pm.source)}`}>{pm.source}</span>}
        </div>
      )}
    </GlowCard>
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

function RemediationQueue({ history, canPr }: { history: Scan[]; canPr: boolean }) {
  const items = useMemo(() => {
    const out: { repo: string; v: Vuln }[] = [];
    const seenKey = new Set<string>();
    for (const s of latestPerRepo(history)) {
      for (const v of s.report?.vulnerabilities ?? []) {
        const key = `${s.repo_full_name}:${v.package}@${v.version}:${v.cve}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        out.push({ repo: s.repo_full_name, v });
      }
    }
    // Worst first.
    return out.sort((a, b) => SEV_ORDER.indexOf(a.v.severity as typeof SEV_ORDER[number]) - SEV_ORDER.indexOf(b.v.severity as typeof SEV_ORDER[number])).slice(0, 25);
  }, [history]);
  if (items.length === 0) return null;

  return (
    <Reveal>
      <GlowCard glow="rgba(94,234,212,0.2)" className="p-7">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-2xl">Remediation queue</h2>
          <span className="font-mono text-[11px] text-fog">{items.length} fixable {items.length === 1 ? "advisory" : "advisories"}</span>
        </div>
        <p className="mb-4 text-[13px] text-fog">
          One click opens a <b className="text-cloud">branch-only</b> dependency-bump PR (deterministic, no Codex credits) — Umbra never merges.
          {!canPr && <> Connect GitHub with repo access to enable this.</>}
        </p>
        <div className="flex flex-col gap-2.5">
          {items.map((it) => <RemediationRow key={`${it.repo}:${it.v.package}:${it.v.cve}`} repo={it.repo} v={it.v} canPr={canPr} />)}
        </div>
      </GlowCard>
    </Reveal>
  );
}

function RemediationRow({ repo, v, canPr }: { repo: string; v: Vuln; canPr: boolean }) {
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3">
      <SeverityChip severity={v.severity} />
      <span className="font-mono text-[13px] text-cloud">{v.package}<span className="text-fog">@{v.version}</span></span>
      <span className="font-mono text-[11px] text-fog">{v.cve}</span>
      <span className="ml-auto truncate font-mono text-[11px] text-fog/70">{repo}</span>
      {status === "done" && pr ? (
        <a href={pr.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-teal hover:underline">✓ PR #{pr.number} ↗</a>
      ) : (
        <button
          onClick={openPr}
          disabled={!canPr || status === "working"}
          title={canPr ? "Open a dependency-bump PR" : "Connect GitHub to open PRs"}
          className="rounded-full border border-cyan/40 bg-cyan/10 px-3 py-1 font-mono text-[10px] text-cyan transition-colors hover:bg-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "working" ? "Opening…" : "Open bump PR →"}
        </button>
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
              return (
                <>
                  <Step n="01" label="PROMPT"><p>{replay.prompt}</p></Step>
                  <Step n="02" label="CODEX DIFF">
                    {replay.codex_diff
                      ? <pre className="overflow-auto rounded-lg bg-black/50 p-3 font-mono text-[12px] text-cyan/90">{replay.codex_diff}</pre>
                      : codexDown
                        ? <Unavailable title="Codex didn’t complete on this run." raw={replay.tests} />
                        : <p className="text-fog">No changes proposed on this run.</p>}
                  </Step>
                  <Step n="03" label="TESTS">
                    {codexDown ? <p className="text-fog">Not reached — Codex didn’t run to completion.</p> : <p>{replay.tests}</p>}
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
