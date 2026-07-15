const events = [
  ["02:14:08", "WATCHMAN", "CVE-2025-4723 found in lodash@4.17.20", "critical"],
  ["02:14:15", "CODEX", "Drafted package-lock.json patch · 3 tests passed", "cyan"],
  ["02:17:42", "DETECTIVE", "Root cause isolated to auth middleware commit a17e9", "violet"],
  ["02:18:03", "JANITOR", "Found 12 unused imports across 4 modules", "muted"],
] as const;

function Radar() {
  return <div className="radar" aria-label="Threat radar"><i /><i /><i /><span className="sweep" /><b className="blip one" /><b className="blip two" /><b className="blip three" /></div>;
}

export default function Home() {
  return <main>
    <div className="aurora one" /><div className="aurora two" />
    <nav><div className="brand"><span>◐</span> UMBRA</div><div className="nav-state"><em /> NIGHT SHIFT ACTIVE</div><button>Launch scan <span>↗</span></button></nav>
    <section className="hero">
      <div><p className="eyebrow">MISSION CONTROL / 03:17 AM</p><h1>Your repo never<br /><strong>sleeps alone.</strong></h1><p className="lede">Umbra finds vulnerabilities, traces incidents, reviews risk, and drafts the pull requests your team sees in the morning.</p><div className="actions"><button className="primary">View night shift <span>→</span></button><button className="ghost">Ask Umbra <span>⌘ K</span></button></div></div>
      <article className="score glass"><p>UMBRA SCORE <small>↗ 6 this week</small></p><div className="score-row"><strong>82</strong><span>/100<br /><b>RESILIENT</b></span></div><div className="meter"><i /></div><footer><span>Security <b>88</b></span><span>Quality <b>79</b></span><span>Velocity <b>80</b></span></footer></article>
    </section>
    <section className="grid">
      <article className="terminal glass"><header><div><p className="eyebrow">LIVE AGENT TERMINAL</p><h2>Night shift activity</h2></div><span className="live"><i /> STREAMING</span></header><div className="feed">{events.map(([time, agent, text, tone]) => <div className="event" key={time}><time>{time}</time><b className={tone}>{agent}</b><span>{text}</span><button aria-label="Open reasoning replay">↗</button></div>)}</div><footer><span className="prompt">›</span> Waiting for next mission<span className="cursor">_</span></footer></article>
      <article className="glass radar-card"><header><div><p className="eyebrow">THREAT RADAR</p><h2>Attack surface</h2></div><span className="risk">2 open risks</span></header><div className="radar-wrap"><Radar /><div className="radar-copy"><b>HIGH</b><p>Dependency<br />exposure</p><small>OWASP A06</small></div></div></article>
    </section>
    <section className="agents"><div><p className="eyebrow">THE NIGHT CREW</p><h2>Five specialists. One quiet shift.</h2></div><div className="agent-list">{[["◉","WATCHMAN","Hunts CVEs","#22D3EE"],["◈","REVIEWER","Sees risk","#A78BFA"],["⌁","DETECTIVE","Traces cause","#F9A8D4"],["◒","JANITOR","Clears debt","#5EEAD4"],["?","ASK UMBRA","Answers codebase questions","#FDE68A"]].map(([mark, name, job, color]) => <article className="glass" key={String(name)}><i style={{color: String(color)}}>{mark}</i><b>{name}</b><span>{job}</span></article>)}</div></section>
  </main>;
}

