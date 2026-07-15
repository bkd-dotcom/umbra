"use client";

import { useEffect } from "react";
import Radar from "../components/Radar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.4-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.3-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.75.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" /></svg>
);
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" /><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3 0-5.6-2-6.5-4.8h-4v3c2 3.9 6 6.5 10.5 6.5Z" /><path fill="#FBBC05" d="M5.5 14.5c-.2-.7-.4-1.5-.4-2.5s.1-1.8.4-2.5v-3h-4A11.9 11.9 0 0 0 0 12c0 1.9.5 3.7 1.5 5.5l4-3Z" /><path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.2 15.2 0 12 0 7.5 0 3.5 2.6 1.5 6.5l4 3c.9-2.8 3.5-4.7 6.5-4.7Z" /></svg>
);

const crew: Array<[string, string, string, string]> = [
  ["◉", "WATCHMAN", "Hunts CVEs in your dependencies", "#22D3EE"],
  ["◈", "REVIEWER", "Scores risk on every pull request", "#A78BFA"],
  ["⌁", "DETECTIVE", "Traces incidents to the root-cause commit", "#F9A8D4"],
  ["◒", "JANITOR", "Clears dead code and quiet tech debt", "#5EEAD4"],
  ["?", "ASK UMBRA", "Answers questions about your codebase", "#FDE68A"],
];

const steps: Array<[string, string, string]> = [
  ["01", "Sign in", "Continue with GitHub or Google. GitHub connects your own repositories."],
  ["02", "Point at a repo", "Pick one of your repositories. The night crew fans out — CVEs, git history, code retrieval."],
  ["03", "Read the report", "Every finding is grounded and labelled with what produced it. No fabricated results, ever."],
];

export default function Landing() {
  // Reveal sections as they scroll into view.
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.15 }
    );
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <main>
      <div className="aurora one" /><div className="aurora two" />

      <nav>
        <div className="brand"><span>◐</span> UMBRA</div>
        <a className="btn btn-google" href={`${API}/auth/login/github`} style={{ padding: "10px 16px", fontSize: 12 }}>Sign in <span style={{ color: "var(--cyan)", marginLeft: 6 }}>↗</span></a>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow rise">AUTONOMOUS ENGINEERING · MISSION CONTROL</p>
          <h1 className="rise d1">Your repo never<br /><strong className="shimmer">sleeps alone.</strong></h1>
          <p className="lede rise d2">Umbra is an autonomous AI engineering team for your GitHub repo. Sign in and the night crew hunts CVEs, traces incidents, reviews risk, and answers your codebase — then hands you the morning report.</p>
          <div className="signin rise d3">
            <a className="btn btn-github" href={`${API}/auth/login/github`}><GitHubIcon /> Continue with GitHub</a>
            <a className="btn btn-google" href={`${API}/auth/login/google`}><GoogleIcon /> Continue with Google</a>
          </div>
          <p className="scan-note rise d4" style={{ marginTop: 18 }}>Real OAuth — GitHub unlocks live scans of your own repositories.</p>
        </div>
        <article className="glass radar-card rise d2" style={{ padding: 0 }}>
          <header><div><p className="eyebrow">THREAT RADAR</p><h2 style={{ fontSize: 18 }}>Attack surface</h2></div><span className="live"><i /> LIVE</span></header>
          <div className="radar-wrap"><Radar /><div className="radar-copy"><b>SCANNING</b><p>Dependency<br />exposure</p><small>OWASP A06</small></div></div>
        </article>
      </section>

      <section className="section">
        <p className="kicker reveal">The night crew</p>
        <h2 className="reveal">Five specialists. One quiet shift.</h2>
        <div className="crew">
          {crew.map(([mark, name, job, color], i) => (
            <article className="glass reveal" key={name} style={{ transitionDelay: `${i * 60}ms` }}>
              <i style={{ color }}>{mark}</i><b>{name}</b><p>{job}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <p className="kicker reveal">How it works</p>
        <h2 className="reveal">Sign in. Point at a repo. Read the morning report.</h2>
        <div className="steps">
          {steps.map(([n, title, body], i) => (
            <article className="glass step reveal" key={n} style={{ transitionDelay: `${i * 60}ms` }}>
              <span className="n">{n}</span><h3>{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="foot">
        <div className="brand"><span>◐</span> UMBRA</div>
        <small>The public site runs in safe demo mode; the live Codex agents run on your machine.<br />Built with Codex for OpenAI Build Week 2026.</small>
      </footer>
    </main>
  );
}
