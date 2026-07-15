"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Radar from "../../components/Radar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const withCreds: RequestInit = { credentials: "include" };

const seedEvents: Array<readonly [string, string, string, string]> = [["02:14:08", "WATCHMAN", "CVE-2025-4723 found in lodash@4.17.20", "critical"], ["02:14:15", "CODEX", "Drafted package-lock.json patch · 3 tests passed", "cyan"], ["02:17:42", "DETECTIVE", "Root cause isolated to auth middleware commit a17e9", "violet"], ["02:18:03", "JANITOR", "Found 12 unused imports across 4 modules", "muted"]];
type Replay = { id?: string; agent: string; prompt: string; codex_diff: string; tests: string; reasoning: string; timings: { codex_ms?: number; reasoning_ms?: number; tests_ms?: number }; providers?: Record<string, string> };
type User = { name?: string; email?: string; avatar?: string; provider: string; login?: string; sub: string };
type Repo = { name: string; full_name: string; url: string; private: boolean; stars: number };
type Scan = { repo_full_name: string; umbra_score?: number; source?: string; vuln_count?: number; ran_at?: string };
const fallbackReplay: Replay = { agent: "WATCHMAN", prompt: "Audit package dependencies and draft the smallest safe patch.", codex_diff: "package-lock.json\nlodash 4.17.20 → patched release", tests: "Targeted dependency regression replay passed.", reasoning: "The dependency is reachable through a transitive parser path. The compatible patch narrows the blast radius to dependency resolution.", timings: { codex_ms: 1840, reasoning_ms: 926, tests_ms: 4810 } };

const LIVE_PROVIDERS = new Set(["codex-cli", "osv.dev", "local-git", "local-git-grep", "responses-api", "responses-api-stream"]);
function providerTone(value: string): string { if (LIVE_PROVIDERS.has(value)) return "live"; if (value.includes("cache")) return "cache"; return "off"; }
function repoFullName(url: string): string { return url.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, ""); }

export default function Dashboard() {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [activeReplay, setActiveReplay] = useState<Replay | null>(null);
  const [events, setEvents] = useState<string[][]>(seedEvents.map(event => [...event]));
  const [replays, setReplays] = useState<Replay[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoUrl, setRepoUrl] = useState("https://github.com/expressjs/express");
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ note: string; live: boolean } | null>(null);
  const [history, setHistory] = useState<Scan[]>([]);

  const loadHistory = useCallback(() => { fetch(`${API}/api/my/scans`, withCreds).then(r => r.ok ? r.json() : []).then((d: Scan[]) => Array.isArray(d) && setHistory(d)).catch(() => {}); }, []);

  // Auth gate: confirm the session, else bounce to the landing page.
  useEffect(() => {
    fetch(`${API}/api/me`, withCreds)
      .then(r => { if (!r.ok) throw new Error("unauthenticated"); return r.json(); })
      .then((me: User) => {
        setUser(me);
        if (me.provider === "github") fetch(`${API}/api/my/repos`, withCreds).then(r => r.ok ? r.json() : []).then((d: Repo[]) => { if (Array.isArray(d) && d.length) { setRepos(d); setRepoUrl(d[0].url); } }).catch(() => {});
        loadHistory();
      })
      .catch(() => { setUser(null); window.location.replace("/"); });
  }, [loadHistory]);

  useEffect(() => { if (user === "loading" || user === null) return; fetch(`${API}/api/replays`, withCreds).then(response => response.ok ? response.json() : []).then((data: Replay[]) => { if (Array.isArray(data) && data.length) setReplays(data.map((replay, index) => ({ ...replay, id: replay.id ?? `${replay.agent}-${index}` }))); }).catch(() => {}); }, [user]);

  useEffect(() => { if (user === "loading" || user === null) return; const source = new EventSource(`${API}/api/events`, { withCredentials: true }); source.addEventListener("umbra", event => { try { const incoming = JSON.parse((event as MessageEvent).data); setEvents(current => [[String(incoming.time ?? "NOW"), String(incoming.agent ?? "UMBRA"), String(incoming.message ?? "Event received"), incoming.level === "critical" ? "critical" : "cyan"], ...current].slice(0, 5)); } catch { /* seeded demo remains visible */ } }); return () => source.close(); }, [user]);

  const launchScan = useCallback(async () => {
    if (scanning || !repoUrl.trim()) return;
    setScanning(true);
    setScanStatus({ note: `Dispatching the night shift on ${repoFullName(repoUrl)}…`, live: false });
    try {
      const response = await fetch(`${API}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_url: repoUrl.trim() }) });
      if (!response.ok) throw new Error(`scan returned ${response.status}`);
      const data = await response.json();
      const runs: Replay[] = (data.agent_results ?? []).map((run: { agent: string; replay: Replay }) => ({ ...run.replay, id: run.agent }));
      if (runs.length) setReplays(runs);
      const liveAgents: string[] = data.live_agents ?? [];
      setScanStatus({ note: liveAgents.length ? `Live run · ${data.source} · ${liveAgents.join(", ")}` : `Replay assembled · ${data.source ?? "demo-cache"}`, live: liveAgents.length > 0 });
      const spotlight = runs.find(run => run.providers && Object.values(run.providers).some(p => LIVE_PROVIDERS.has(p))) ?? runs[0];
      if (spotlight) setActiveReplay(spotlight);
      // Persist the run to this user's history.
      fetch(`${API}/api/my/scans`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_full_name: repoFullName(repoUrl), umbra_score: data.umbra_score, source: data.source ?? "demo-cache", vuln_count: (data.vulnerabilities ?? []).length }) }).then(loadHistory).catch(() => {});
    } catch (error) {
      setScanStatus({ note: `Scan unavailable: ${(error as Error).message}`, live: false });
    } finally {
      setScanning(false);
    }
  }, [repoUrl, scanning, loadHistory]);

  const openReplay = useCallback((agentName: string) => { const match = replays.find(replay => replay.agent?.toUpperCase() === agentName.toUpperCase()) ?? replays[0]; setActiveReplay(match ?? { ...fallbackReplay, agent: agentName }); }, [replays]);
  const logout = useCallback(() => { fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).finally(() => window.location.replace("/")); }, []);

  if (user === "loading") return <main className="gate">Authenticating…</main>;
  if (user === null) return <main className="gate">Redirecting…</main>;

  const firstName = (user.name || user.login || "engineer").split(" ")[0];

  return <main>
    <div className="aurora one" /><div className="aurora two" />
    <div className="dash-top">
      <div className="brand"><span>◐</span> UMBRA</div>
      <div className="who">
        {user.avatar ? <img className="avatar" src={user.avatar} alt="" /> : <div className="avatar" />}
        <div><b>{user.name || user.login}</b><span>{user.email || user.provider}</span></div>
        <button className="logout" onClick={logout}>Sign out</button>
      </div>
    </div>

    <section className="hero" style={{ paddingTop: 40, paddingBottom: 44 }}>
      <div><p className="eyebrow">MISSION CONTROL · {new Date().getHours() < 6 ? "NIGHT SHIFT" : "ON DUTY"}</p><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"},<br /><strong className="shimmer">{firstName}.</strong></h1><p className="lede">Point the night crew at one of your repositories. Findings are real and grounded; anything Codex-only is labelled honestly on the public deploy.</p>
        <div className="repo-picker" style={{ marginTop: 28 }}>
          {repos.length > 0 && <select className="repo-select" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} aria-label="Your repositories">{repos.map(r => <option key={r.full_name} value={r.url}>{r.full_name}{r.stars ? `  ★${r.stars}` : ""}</option>)}</select>}
          <input className="scan-input" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") launchScan(); }} placeholder="github.com/owner/repo" spellCheck={false} aria-label="Repository to scan" />
          <button className="scan-run" onClick={launchScan} disabled={scanning}>{scanning ? "RUNNING" : "RUN"}</button>
        </div>
        {scanStatus && <p className={`scan-note ${scanStatus.live ? "live" : ""}`} style={{ marginTop: 14 }}>{scanStatus.note}</p>}
        {user.provider !== "github" && <p className="scan-note" style={{ marginTop: 10 }}>Signed in with Google — sign in with GitHub to list your own repositories.</p>}
      </div>
      <article className="score glass"><p>UMBRA SCORE <small>↗ live</small></p><div className="score-row"><strong>82</strong><span>/100<br /><b>RESILIENT</b></span></div><div className="meter"><i /></div><footer><span>Security <b>88</b></span><span>Quality <b>79</b></span><span>Velocity <b>80</b></span></footer></article>
    </section>

    <section className="grid"><article className="terminal glass"><header><div><p className="eyebrow">LIVE AGENT TERMINAL</p><h2>Night shift activity</h2></div><span className="live"><i /> STREAMING</span></header><div className="feed">{events.map(([time, agent, text, tone], index) => <div className="event" key={`${time}-${index}`}><time>{time}</time><b className={tone}>{agent}</b><span>{text}</span><button onClick={() => openReplay(agent)} aria-label="Open reasoning replay">↗</button></div>)}</div></article><article className="glass radar-card"><header><div><p className="eyebrow">THREAT RADAR</p><h2>Attack surface</h2></div><span className="risk">2 open risks</span></header><div className="radar-wrap"><Radar /><div className="radar-copy"><b>HIGH</b><p>Dependency<br />exposure</p><small>OWASP A06</small></div></div></article></section>

    <section className="agents"><div><p className="eyebrow">THE NIGHT CREW</p><h2>Five specialists. One quiet shift.</h2></div><div className="agent-list">{[["◉", "WATCHMAN", "Hunts CVEs", "#22D3EE"], ["◈", "REVIEWER", "Sees risk", "#A78BFA"], ["⌁", "DETECTIVE", "Traces cause", "#F9A8D4"], ["◒", "JANITOR", "Clears debt", "#5EEAD4"], ["?", "ASK UMBRA", "Answers codebase questions", "#FDE68A"]].map(([mark, name, job, color]) => <article className="glass" key={name} onClick={() => openReplay(name)} style={{ cursor: "pointer" }}><i style={{ color }}>{mark}</i><b>{name}</b><span>{job}</span></article>)}</div></section>

    {history.length > 0 && <section className="agents" style={{ paddingTop: 40 }}><div><p className="eyebrow">YOUR SCAN HISTORY</p><h2>Where the night crew has been</h2></div><div className="history" style={{ marginTop: 18 }}>{history.map((scan, i) => <div className="history-row" key={i}><b>{scan.repo_full_name}</b><em>score {scan.umbra_score ?? "—"} · {scan.vuln_count ?? 0} vulns · {scan.source}</em><time>{scan.ran_at ? new Date(scan.ran_at).toLocaleString() : ""}</time></div>)}</div></section>}

    {activeReplay && <div className="modal-backdrop" onClick={() => setActiveReplay(null)}><article className="glass replay" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setActiveReplay(null)} aria-label="Close">×</button><h2>{activeReplay.agent} · reasoning replay</h2>
      <div className="replay-step"><span>01</span><div><b>PROMPT</b><p>{activeReplay.prompt}</p></div><small>{activeReplay.timings?.codex_ms ? `${activeReplay.timings.codex_ms}ms` : ""}</small></div>
      <div className="replay-step"><span>02</span><div><b>CODEX DIFF</b><pre>{activeReplay.codex_diff || "No diff produced."}</pre></div><small /></div>
      <div className="replay-step"><span>03</span><div><b>TESTS</b><p>{activeReplay.tests}</p></div><small>{activeReplay.timings?.tests_ms ? `${activeReplay.timings.tests_ms}ms` : ""}</small></div>
      <div className="replay-step"><span>04</span><div><b>REASONING</b><p>{activeReplay.reasoning}</p></div><small>{activeReplay.timings?.reasoning_ms ? `${activeReplay.timings.reasoning_ms}ms` : ""}</small></div>
      {activeReplay.providers && <div className="replay-step"><span>05</span><div><b>PROVIDER LEDGER</b><div className="ledger">{Object.entries(activeReplay.providers).map(([k, v]) => <span key={k} className={`chip ${providerTone(v)}`}>{k}: {v}</span>)}</div></div><small /></div>}
      <footer>Every half is labelled with what produced it — never fabricated.</footer></article></div>}
  </main>;
}
