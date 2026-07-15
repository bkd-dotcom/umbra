"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const seedEvents: Array<readonly [string, string, string, string]> = [["02:14:08", "WATCHMAN", "CVE-2025-4723 found in lodash@4.17.20", "critical"], ["02:14:15", "CODEX", "Drafted package-lock.json patch · 3 tests passed", "cyan"], ["02:17:42", "DETECTIVE", "Root cause isolated to auth middleware commit a17e9", "violet"], ["02:18:03", "JANITOR", "Found 12 unused imports across 4 modules", "muted"]];
type Replay = { id?: string; agent: string; prompt: string; codex_diff: string; tests: string; reasoning: string; timings: { codex_ms?: number; reasoning_ms?: number; tests_ms?: number }; providers?: Record<string, string> };
// Shown only if the backend is unreachable, so the static demo still tells the story offline.
const fallbackReplay: Replay = { agent: "WATCHMAN", prompt: "Audit package dependencies and draft the smallest safe patch.", codex_diff: "package-lock.json\nlodash 4.17.20 → patched release", tests: "Targeted dependency regression replay passed.", reasoning: "The dependency is reachable through a transitive parser path. The compatible patch narrows the blast radius to dependency resolution.", timings: { codex_ms: 1840, reasoning_ms: 926, tests_ms: 4810 } };

// The honesty ledger: every provider is labelled with what actually served it — never fabricated.
const LIVE_PROVIDERS = new Set(["codex-cli", "osv.dev", "local-git", "local-git-grep", "responses-api", "responses-api-stream"]);
function providerTone(value: string): string { if (LIVE_PROVIDERS.has(value)) return "live"; if (value.includes("cache")) return "cache"; return "off"; }

function Radar() { const canvas = useRef<HTMLCanvasElement>(null); useEffect(() => { const node = canvas.current; const ctx = node?.getContext("2d"); if (!node || !ctx) return; let frame = 0; let id = 0; const paint = () => { const s = node.clientWidth; const scale = devicePixelRatio; node.width = s * scale; node.height = s * scale; ctx.setTransform(scale, 0, 0, scale, 0, 0); const c = s / 2; ctx.clearRect(0, 0, s, s); ctx.strokeStyle = "rgba(34,211,238,.35)"; [s * .17, s * .33, s * .49].forEach(r => { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); }); ctx.beginPath(); ctx.moveTo(0, c); ctx.lineTo(s, c); ctx.moveTo(c, 0); ctx.lineTo(c, s); ctx.stroke(); const gradient = ctx.createConicGradient(frame * .018, c, c); gradient.addColorStop(0, "rgba(34,211,238,.37)"); gradient.addColorStop(.16, "rgba(34,211,238,0)"); gradient.addColorStop(1, "rgba(34,211,238,0)"); ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(c, c, s * .49, 0, Math.PI * 2); ctx.fill(); ([[.67, .32, "#fb7185"], [.29, .61, "#facc15"], [.69, .76, "#22d3ee"]] as const).forEach(([x, y, color]) => { ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(s * x, s * y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }); frame++; id = requestAnimationFrame(paint); }; paint(); return () => cancelAnimationFrame(id); }, []); return <canvas ref={canvas} className="radar-canvas" aria-label="Animated threat radar" />; }

export default function Home() {
  const [activeReplay, setActiveReplay] = useState<Replay | null>(null);
  const [events, setEvents] = useState<string[][]>(seedEvents.map(event => [...event]));
  const [replays, setReplays] = useState<Replay[]>([]);
  const [repoUrl, setRepoUrl] = useState("https://github.com/expressjs/express");
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ note: string; live: boolean } | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);

  // Pull whatever replays the backend already holds (seeded demo, or the last live run).
  useEffect(() => { fetch(`${API}/api/replays`).then(response => response.ok ? response.json() : []).then((data: Replay[]) => { if (Array.isArray(data) && data.length) setReplays(data.map((replay, index) => ({ ...replay, id: replay.id ?? `${replay.agent}-${index}` }))); }).catch(() => { /* offline: fallback replay still opens */ }); }, []);

  useEffect(() => { const source = new EventSource(`${API}/api/events`); source.addEventListener("umbra", event => { try { const incoming = JSON.parse(event.data); setEvents(current => [[String(incoming.time ?? "NOW"), String(incoming.agent ?? "UMBRA"), String(incoming.message ?? "Event received"), incoming.level === "critical" ? "critical" : "cyan"], ...current].slice(0, 5)); } catch { /* seeded demo remains visible */ } }); return () => source.close(); }, []);

  const launchScan = useCallback(async () => {
    if (scanning || !repoUrl.trim()) return;
    setScanning(true);
    setScanStatus({ note: `Dispatching the night shift on ${repoUrl.replace(/^https?:\/\//, "")}…`, live: false });
    try {
      const response = await fetch(`${API}/api/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo_url: repoUrl.trim() }) });
      if (!response.ok) throw new Error(`scan returned ${response.status}`);
      const data = await response.json();
      const runs: Replay[] = (data.agent_results ?? []).map((run: { agent: string; replay: Replay }) => ({ ...run.replay, id: run.agent }));
      if (runs.length) setReplays(runs);
      const liveAgents: string[] = data.live_agents ?? [];
      setScanStatus({ note: liveAgents.length ? `Live run · ${data.source} · ${liveAgents.join(", ")}` : `Replay assembled · ${data.source ?? "demo-cache"}`, live: liveAgents.length > 0 });
      // Prefer opening a run that actually reached Codex — that is the money shot.
      const spotlight = runs.find(run => run.providers && Object.values(run.providers).includes("codex-cli")) ?? runs[0];
      if (spotlight) setActiveReplay(spotlight);
    } catch (error) {
      setScanStatus({ note: `Scan unavailable: ${(error as Error).message}`, live: false });
    } finally {
      setScanning(false);
    }
  }, [repoUrl, scanning]);

  const openReplay = useCallback((agentName: string) => { const match = replays.find(replay => replay.agent?.toUpperCase() === agentName.toUpperCase()) ?? replays[0]; setActiveReplay(match ?? { ...fallbackReplay, agent: agentName }); }, [replays]);

  return <main>
    <div className="aurora one" /><div className="aurora two" />
    <nav><div className="brand"><span>◐</span> UMBRA</div><div className="nav-state"><em /> NIGHT SHIFT ACTIVE</div><button onClick={launchScan} disabled={scanning}>{scanning ? "Scanning…" : "Launch scan"} <span>↗</span></button></nav>
    <section className="hero"><div><p className="eyebrow">MISSION CONTROL / 03:17 AM</p><h1>Your repo never<br /><strong>sleeps alone.</strong></h1><p className="lede">Umbra finds vulnerabilities, traces incidents, reviews risk, and drafts the pull requests your team sees in the morning.</p><div className="actions"><button className="primary" onClick={launchScan} disabled={scanning}>{scanning ? "Running night shift…" : "View night shift"} <span>→</span></button><button className="ghost" onClick={() => scanInput.current?.focus()}>Ask Umbra <span>⌘ K</span></button></div></div><article className="score glass"><p>UMBRA SCORE <small>↗ 6 this week</small></p><div className="score-row"><strong>82</strong><span>/100<br /><b>RESILIENT</b></span></div><div className="meter"><i /></div><footer><span>Security <b>88</b></span><span>Quality <b>79</b></span><span>Velocity <b>80</b></span></footer></article></section>
    <section className="grid"><article className="terminal glass"><header><div><p className="eyebrow">LIVE AGENT TERMINAL</p><h2>Night shift activity</h2></div><span className="live"><i /> STREAMING</span></header><div className="feed">{events.map(([time, agent, text, tone], index) => <div className="event" key={`${time}-${index}`}><time>{time}</time><b className={tone}>{agent}</b><span>{text}</span><button onClick={() => openReplay(agent)} aria-label="Open reasoning replay">↗</button></div>)}</div><footer className="scan-bar"><span className="prompt">›</span><input ref={scanInput} className="scan-input" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") launchScan(); }} placeholder="github.com/owner/repo" spellCheck={false} aria-label="Repository to scan" /><button className="scan-run" onClick={launchScan} disabled={scanning}>{scanning ? "RUNNING" : "RUN"}</button>{scanStatus && <span className={`scan-note ${scanStatus.live ? "live" : ""}`}>{scanStatus.note}</span>}</footer></article><article className="glass radar-card"><header><div><p className="eyebrow">THREAT RADAR</p><h2>Attack surface</h2></div><span className="risk">2 open risks</span></header><div className="radar-wrap"><Radar /><div className="radar-copy"><b>HIGH</b><p>Dependency<br />exposure</p><small>OWASP A06</small></div></div></article></section>
    <section className="agents"><div><p className="eyebrow">THE NIGHT CREW</p><h2>Five specialists. One quiet shift.</h2></div><div className="agent-list">{[["◉", "WATCHMAN", "Hunts CVEs", "#22D3EE"], ["◈", "REVIEWER", "Sees risk", "#A78BFA"], ["⌁", "DETECTIVE", "Traces cause", "#F9A8D4"], ["◒", "JANITOR", "Clears debt", "#5EEAD4"], ["?", "ASK UMBRA", "Answers codebase questions", "#FDE68A"]].map(([mark, name, job, color]) => <article className="glass" key={name} onClick={() => openReplay(name)} style={{ cursor: "pointer" }}><i style={{ color }}>{mark}</i><b>{name}</b><span>{job}</span></article>)}</div></section>
    {activeReplay && <div className="modal-backdrop" role="presentation" onClick={() => setActiveReplay(null)}><section className="replay glass" role="dialog" aria-modal="true" aria-label="Reasoning Replay" onClick={event => event.stopPropagation()}><button className="close" onClick={() => setActiveReplay(null)}>×</button><p className="eyebrow">REASONING REPLAY / {activeReplay.agent?.toUpperCase()}</p><h2>Every action, inspectable.</h2><div className="replay-step"><span>01</span><div><b>Mission prompt</b><p>{activeReplay.prompt}</p></div></div><div className="replay-step"><span>02</span><div><b>Codex draft</b><pre>{activeReplay.codex_diff || "No diff produced."}</pre></div>{activeReplay.timings.codex_ms != null && <small>{activeReplay.timings.codex_ms}ms</small>}</div><div className="replay-step"><span>03</span><div><b>Test evidence</b><p>{activeReplay.tests}</p></div>{activeReplay.timings.tests_ms != null && <small>{activeReplay.timings.tests_ms}ms</small>}</div><div className="replay-step"><span>04</span><div><b>GPT-5.6 reasoning</b><p>{activeReplay.reasoning}</p></div>{activeReplay.timings.reasoning_ms != null && <small>{activeReplay.timings.reasoning_ms}ms</small>}</div>{activeReplay.providers && Object.keys(activeReplay.providers).length > 0 && <div className="replay-step"><span>05</span><div><b>Provider ledger</b><div className="ledger">{Object.entries(activeReplay.providers).map(([role, provider]) => <span key={role} className={`chip ${providerTone(provider)}`}>{role}: {provider}</span>)}</div></div></div>}<footer>Draft only · Human review required · Never auto-merged</footer></section></div>}
  </main>;
}
