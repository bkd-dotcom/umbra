"use client";

import { useEffect, useState } from "react";
import { motion, type Variants } from "motion/react";
import { Corona } from "@/components/ui/corona";
import { OperationsBoard } from "@/components/ui/operations-board";
import { CrewDossier } from "@/components/ui/crew-dossier";
import { NightShiftLog } from "@/components/ui/night-shift-log";
import { MorningReport } from "@/components/ui/morning-report";
import { DitherImage } from "@/components/ui/dither-image";
import { Magnetic } from "@/components/ui/magnetic-button";
import { GlowCard } from "@/components/ui/glow-card";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SignInDialog } from "@/components/ui/sign-in-dialog";
import { Reveal, RevealGroup } from "@/components/ui/reveal";
import { GitHubIcon } from "@/components/ui/icons";
import { LocalWeather } from "@/components/ui/local-weather";
import { fadeUp, EASE, stagger } from "@/lib/motion";

// Hero headline: a per-line mask reveal (the shift "coming online"). The outer
// span clips; the inner slides up from below. Kept short so a judge reads the
// headline near-instantly — motion as arrival, never a comprehension gate.
const heroLine: Variants = {
  hidden: { y: "115%" },
  show: { y: 0, transition: { duration: 0.45, ease: EASE } },
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Landing() {
  const [signIn, setSignIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // Above-the-fold "try it" target — judges scan a public repo with no sign-in.
  const [demoRepo, setDemoRepo] = useState("github.com/expressjs/express");
  const scanHref = `/dashboard?repo=${encodeURIComponent((demoRepo.trim() || "github.com/expressjs/express").replace(/^https?:\/\//, ""))}`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] px-6 md:px-10">
      {/* Landing signature backdrop: the eclipse. One intentional atmosphere — a
          corona ring over the umbra core on a faint operational grid — replacing
          the old four-effect wash. Fixed, behind content, reduced-motion aware. */}
      <div className="bg-bold pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <Corona />
      </div>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} api={API} />

      {/* Nav */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className={`sticky top-3 z-40 mt-3 flex items-center justify-between rounded-2xl px-5 py-3 transition-all duration-300 ${scrolled ? "glass shadow-[0_10px_40px_-12px_#000]" : ""}`}
      >
        <div className="flex items-center gap-2 text-[15px] font-extrabold tracking-[0.35em]">
          <span className="text-2xl text-cyan tracking-normal">◐</span> UMBRA
        </div>
        <div className="flex items-center gap-3">
          <LocalWeather />
          <HoverBorderGradient onClick={() => setSignIn(true)} className="px-4 py-2 text-xs">
            Sign in <span className="text-cyan">↗</span>
          </HoverBorderGradient>
        </div>
      </motion.nav>

      {/* Hero — arrival: the shift begins. One massive statement, one clarifier,
          then the live operations board does the explaining. */}
      <section className="relative flex min-h-[90vh] flex-col justify-center py-16 md:py-20">
        <div className="relative z-10 max-w-[64rem]">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="mb-7 flex flex-wrap items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_#22d3ee] animate-pulse-glow" />
            <span className="text-cyan">Live</span>
            <span className="text-fog/40">·</span>
            <span>Autonomous night shift</span>
            <span className="text-fog/40">·</span>
            <span className="text-violet">OpenAI reasoning</span>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="show"
            variants={stagger(0.03, 0.07)}
            className="font-serif text-[clamp(52px,8.4vw,116px)] font-normal leading-[0.92] tracking-[-0.035em] text-cloud"
          >
            {["Your repo never", "sleeps alone."].map((line) => (
              <span key={line} className="block overflow-hidden">
                <motion.span variants={heroLine} className="block pb-[0.12em]">{line}</motion.span>
              </span>
            ))}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.12 }}
            className="mt-6 max-w-[42ch] text-[clamp(17px,2.1vw,22px)] leading-snug text-cloud/75"
          >
            An autonomous engineering crew that works while you sleep.
          </motion.p>

          {/* Concrete Build Week / OpenAI line — honest about what runs when. */}
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.18 }}
            className="mt-4 max-w-[64ch] text-[14px] leading-relaxed text-fog"
          >
            Built for <span className="text-cloud">OpenAI Build Week</span> — Codex proposes patches in a disposable clone and GPT‑5.6 reasons over your repo&apos;s evidence when enabled. Every output is labelled with what produced it.
          </motion.p>

          {/* Judge proof strip — what's real, at a glance. */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.24 }}
            className="mt-6 flex flex-wrap gap-2"
          >
            {([
              ["Live repo scan", "#22d3ee"],
              ["OSV-grounded findings", "#5eead4"],
              ["Codex patch proposals", "#a78bfa"],
              ["GPT reasoning replay", "#fbbf24"],
              ["Never auto-merges", "#8b90a6"],
            ] as const).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-2.5 py-1 font-mono text-[10.5px] tracking-[0.03em] text-fog">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </motion.div>

          {/* Try-it launcher — a judge sees the product without signing in. */}
          <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.3 }} className="mt-8 w-full max-w-[560px]">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-3 transition-colors focus-within:border-cyan/50">
                <span className="font-mono text-[12px] text-fog">▸</span>
                <input
                  value={demoRepo}
                  onChange={(e) => setDemoRepo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") window.location.href = scanHref; }}
                  spellCheck={false}
                  aria-label="Public GitHub repository to scan"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-cloud outline-none placeholder:text-fog/50"
                />
              </div>
              <Magnetic>
                <HoverBorderGradient href={scanHref} className="px-6 py-3.5 text-sm font-semibold">
                  Try public repo scan <span className="text-cyan">→</span>
                </HoverBorderGradient>
              </Magnetic>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[12px]">
              <a href="#evidence" className="text-cloud transition-colors hover:text-cyan">View demo report ↓</a>
              <span className="text-fog/30">·</span>
              <a href="/openapi-actions.yaml" className="text-fog transition-colors hover:text-cloud">Open GPT Action schema ↗</a>
              <span className="text-fog/30">·</span>
              <button onClick={() => setSignIn(true)} className="text-fog transition-colors hover:text-cloud">Sign in for private repos</button>
            </div>
          </motion.div>
        </div>

        {/* Live operations board — a night shift, replayed. The product, working. */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.7, ease: EASE }}
          className="relative z-10 mt-14"
        >
          <OperationsBoard />
        </motion.div>
      </section>

      {/* Evidence — "does it actually work?" answered first, with a real artifact. */}
      <section id="evidence" className="relative py-24">
        <Reveal>
          <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> Evidence · last night
            <span className="rounded-full border border-[color:var(--surface-border)] px-2 py-0.5 text-[9px] tracking-[0.16em] text-fog/80">Sample</span>
          </p>
          <h2 className="mt-3 max-w-[20ch] font-serif text-[clamp(30px,4.4vw,54px)] leading-[1.02] tracking-[-0.03em]">What Umbra found last night.</h2>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-fog">
            A representative finding — a sample of the real output shapes: an OSV advisory, a commit from{" "}
            <span className="text-cloud">git blame</span>, a proposed patch. Reasoned by OpenAI, grounded in your repo, never invented. Run your own scan to see live labels.
          </p>
        </Reveal>

        <div className="mt-9 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          {/* Watchman — CVE case file (the "holy crap it works" artifact) */}
          <Reveal>
            <GlowCard glow="rgba(251,113,133,0.20)" className="h-full">
              <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-6 py-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fog">Case file · CVE-2024-29041</span>
                <span className="flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-rose-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> High
                </span>
              </div>
              <div className="px-6 py-5">
                <h3 className="font-serif text-2xl leading-tight">Open redirect via malformed URL in Express</h3>
                <dl className="mt-5 grid grid-cols-[104px_1fr] gap-y-3.5 font-mono text-[12px]">
                  <dt className="pt-0.5 text-[10px] uppercase tracking-[0.1em] text-fog">Affected</dt>
                  <dd className="text-cloud">express@4.17.1</dd>
                  <dt className="pt-0.5 text-[10px] uppercase tracking-[0.1em] text-fog">Detected by</dt>
                  <dd className="text-cloud"><span className="text-cyan">◉ WATCHMAN</span> · via OSV.dev advisories</dd>
                  <dt className="pt-0.5 text-[10px] uppercase tracking-[0.1em] text-fog">Root cause</dt>
                  <dd className="text-cloud">commit a9c31f · “refactor static serving”</dd>
                  <dt className="pt-0.5 text-[10px] uppercase tracking-[0.1em] text-fog">Fix</dt>
                  <dd className="text-teal">→ upgrade to express@4.19.2</dd>
                </dl>
                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[color:var(--surface-border)] pt-4">
                  <span className="rounded-lg border border-teal/30 bg-teal/5 px-3 py-1.5 font-mono text-[11px] text-teal">PR-ready diff prepared</span>
                  <span className="font-mono text-[10px] text-fog">branch only · you review &amp; merge</span>
                </div>
              </div>
            </GlowCard>
          </Reveal>

          {/* Detective root-cause + Reviewer verdict — breadth beyond security */}
          <Reveal delay={0.05}>
            <div className="flex h-full flex-col gap-5">
              <GlowCard glow="rgba(251,191,36,0.18)" className="p-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Incident · root cause</span>
                <p className="mt-3 text-[13px] leading-relaxed text-cloud">
                  <span className="text-amber">⌁ DETECTIVE</span> traced <span className="text-cloud">500s on /checkout</span> to one commit — reasoned over real git history, not guessed.
                </p>
                <div className="mt-4 rounded-lg border border-[color:var(--surface-border)] bg-black/20 px-3 py-2.5 font-mono text-[11px] text-fog">
                  <span className="text-amber">commit a9c31f</span> — “refactor cart totals”<br />
                  <span className="text-cloud">3 days ago · @dev</span>
                </div>
              </GlowCard>
              <GlowCard glow="rgba(167,139,250,0.18)" className="p-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">PR review · verdict</span>
                <p className="mt-3 text-[13px] leading-relaxed text-cloud">
                  <span className="text-violet">◈ REVIEWER</span> scored the fix: <span className="text-teal">blast-radius low · safe to merge</span>.
                </p>
              </GlowCard>
            </div>
          </Reveal>
        </div>

        {/* Provider ledger — every field says what produced it. Honest on a sample. */}
        <Reveal className="mt-5">
          <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Provider ledger</span>
              {([
                ["OSV.dev", "advisory"],
                ["git blame", "commit"],
                ["Codex", "patch diff"],
                ["GPT‑5.6", "reasoning"],
              ] as const).map(([src, out]) => (
                <span key={src} className="rounded-full border border-[color:var(--surface-border)] bg-black/20 px-2.5 py-1 font-mono text-[10px] text-fog">
                  <span className="text-cloud">{src}</span> · {out}
                </span>
              ))}
            </div>
            <span className="font-mono text-[10px] text-fog/70">grounded, never fabricated · your own scan shows live / cache / unavailable</span>
          </div>
        </Reveal>
      </section>

      {/* Night crew — the main character: a classified ops file, one unit on station. */}
      <section id="crew" className="relative py-24">
        <Reveal>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> The night crew
          </p>
          <h2 className="mt-3 max-w-[18ch] font-serif text-[clamp(30px,4.2vw,52px)] leading-[1.02] tracking-[-0.03em]">Five specialists. One quiet shift.</h2>
          <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-fog">Open the file on each. One is always on station — the rest hold the line in the dark.</p>
        </Reveal>
        <Reveal className="mt-10">
          <CrewDossier />
        </Reveal>
      </section>

      {/* How the night unfolds — a shift log, not step cards. The beam is the
          night; each entry ignites in its status colour as you scroll through. */}
      <section id="how" className="relative py-24">
        <Reveal>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> How the night unfolds
          </p>
          <h2 className="mt-3 max-w-[18ch] font-serif text-[clamp(30px,4.2vw,52px)] leading-[1.02] tracking-[-0.03em]">One night, start to sunrise.</h2>
          <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-fog">Connect a repo and the shift begins. Follow the beam down — every entry is a real thing that happened, grounded and timestamped.</p>
        </Reveal>
        <Reveal className="mt-12 max-w-[680px]">
          <NightShiftLog />
        </Reveal>
      </section>

      {/* How OpenAI is used — an engineering evidence panel, not a marketing block.
          Placed after the story, before the ChatGPT surface. */}
      <section id="openai" className="relative py-24">
        <Reveal>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-violet shadow-[0_0_8px_#a78bfa]" /> How OpenAI is used
          </p>
          <h2 className="mt-3 max-w-[20ch] font-serif text-[clamp(30px,4.2vw,52px)] leading-[1.02] tracking-[-0.03em]">Built on Codex and GPT reasoning.</h2>
          <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-fog">
            Four moving parts, each labelled with what produced it — so you always know when a result is live, cached, or unavailable.
          </p>
        </Reveal>
        <RevealGroup className="mt-9 grid gap-4 sm:grid-cols-2">
          {[
            { tag: "codex-cli", color: "#a78bfa", title: "Codex CLI", body: "Proposes code diffs inside a disposable clone with no origin remote. Write credentials are never handed to the Codex process." },
            { tag: "gpt‑5.6", color: "#fbbf24", title: "GPT‑5.6 reasoning", body: "Explains blast-radius, root cause, and PR risk over real repo evidence — when live reasoning is enabled for your account." },
            { tag: "responses-api-stream", color: "#22d3ee", title: "Responses streaming", body: "Ask Umbra streams grounded answers token-by-token, each backed by a real file:line reference — never invented." },
            { tag: "provider ledger", color: "#5eead4", title: "Provider ledger", body: "Every output carries its source: live, cache, demo, or unavailable. Honesty is a first-class feature, not an afterthought." },
          ].map((p) => (
            <Reveal key={p.title} variants={fadeUp}>
              <GlowCard className="h-full p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-serif text-xl">{p.title}</h3>
                  <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: p.color, borderColor: `${p.color}44`, background: `${p.color}12` }}>{p.tag}</span>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-fog">{p.body}</p>
              </GlowCard>
            </Reveal>
          ))}
        </RevealGroup>
      </section>

      {/* Where this goes next — the honest trajectory from "here's a draft, check it"
          to "I tested it, ship it". Each card grounds what runs TODAY before naming
          what's next, so the roadmap reads as confidence, not a wishlist. */}
      <section id="next" className="relative py-24">
        <Reveal>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-teal shadow-[0_0_8px_#5eead4]" /> Where this goes next
          </p>
          <h2 className="mt-3 max-w-[24ch] font-serif text-[clamp(30px,4.2vw,52px)] leading-[1.02] tracking-[-0.03em]">From a draft you check to a fix you ship.</h2>
          <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-fog">
            Umbra already works in a disposable checkout and verifies before it hands you anything. Here&rsquo;s what runs today — and the next step that turns each agent from a junior into a senior.
          </p>
        </Reveal>
        <RevealGroup className="mt-9 grid gap-4 md:grid-cols-3">
          {[
            { title: "Sandbox validation", today: "Runs compile, dependency-resolution, and diff-integrity checks in the disposable clone.", next: "Full test-suite execution → a verified “tests passed” badge on every PR." },
            { title: "Proactive incidents", today: "Paste an error and the Detective traces it to a root-cause commit.", next: "Sentry / Datadog webhooks trigger the investigation before you even notice." },
            { title: "Grounded at scale", today: "Every answer cites a real file:line — never fabricated.", next: "AST / LSP-backed grounding for cross-file correctness across millions of lines." },
          ].map((p) => (
            <Reveal key={p.title} variants={fadeUp}>
              <GlowCard className="h-full p-6">
                <h3 className="font-serif text-xl">{p.title}</h3>
                <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-fog">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal shadow-[0_0_6px_#5eead4]" />
                  <span><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-teal">Today</span><br />{p.today}</span>
                </p>
                <p className="mt-3 flex items-start gap-2 border-t border-[color:var(--surface-border)] pt-3 text-[13px] leading-relaxed text-fog">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full border border-fog" />
                  <span><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog/80">Next</span><br />{p.next}</span>
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </RevealGroup>
      </section>

      {/* Umbra inside ChatGPT — proof it isn't trapped in a dashboard. Placed
          before the report so the OpenAI surface lands ahead of the payoff. */}
      <section id="chatgpt" className="relative py-24">
        <Reveal>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> Umbra inside ChatGPT
          </p>
          <h2 className="mt-3 max-w-[16ch] font-serif text-[clamp(30px,4.2vw,52px)] leading-[1.02] tracking-[-0.03em]">Not trapped inside a dashboard.</h2>
          <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-fog">
            Ask about your repository, investigate an incident, understand a change — without leaving the
            conversation. Umbra ships as a GPT Action, grounded in real OSV and git data, never invented.
            The read-only actions are public; no sign-in required.
          </p>
        </Reveal>
        <RevealGroup className="mt-9 grid gap-4 md:grid-cols-3">
          {[
            { n: "scanRepo", body: "“Scan github.com/expressjs/express” → Umbra Score + live CVEs." },
            { n: "investigateIncident", body: "Paste an error → the root-cause commit from real git history." },
            { n: "askUmbra", body: "“How does routing work?” → an answer with real file:line references." },
          ].map((a) => (
            <Reveal key={a.n} variants={fadeUp}>
              <GlowCard className="h-full p-6">
                <b className="font-mono text-[12px] text-cyan">{a.n}</b>
                <p className="mt-2.5 text-[13px] leading-relaxed text-fog">{a.body}</p>
              </GlowCard>
            </Reveal>
          ))}
        </RevealGroup>
        <Reveal className="mt-6 flex flex-wrap items-center gap-4">
          <a href="/openapi-actions.yaml" className="font-mono text-[12px] text-cyan hover:underline">OpenAPI schema ↗</a>
          <span className="text-fog/40">·</span>
          <a href="/.well-known/ai-plugin.json" className="font-mono text-[12px] text-cyan hover:underline">Plugin manifest ↗</a>
          <span className="text-fog/40">·</span>
          <a href="https://github.com/bkd-dotcom/umbra/tree/main/custom_gpt" target="_blank" rel="noreferrer" className="font-mono text-[12px] text-fog hover:text-cloud">Build the GPT ↗</a>
        </Reveal>
      </section>

      {/* The operator — the human hand behind the machine. Deliberately small; it
          must not steal oxygen from the report that follows. */}
      <section id="team" className="relative py-16">
        <Reveal className="mx-auto max-w-[600px] text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">The operator</p>
          <h2 className="mx-auto mt-4 max-w-[24ch] font-serif text-[clamp(22px,3vw,34px)] leading-[1.15] tracking-[-0.02em]">
            Built because software teams shouldn’t wake up to yesterday’s problems.
          </h2>
          <div className="mt-8">
            <FounderCard />
          </div>
        </Reveal>
      </section>

      {/* Morning report — “one more thing.” The resolution of the whole story:
          you slept, the crew filed the shift, and this is what was waiting. */}
      <section id="report" className="relative py-28">
        <Reveal className="text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">The handoff</p>
          <h2 className="mx-auto mt-3 max-w-[16ch] font-serif text-[clamp(34px,5.2vw,64px)] leading-[1.0] tracking-[-0.03em]">You slept. They didn’t.</h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-fog">
            Every morning the report is already waiting — what changed while you were away, and why.
          </p>
        </Reveal>

        <Reveal className="mx-auto mt-10 max-w-[840px]">
          <MorningReport />
        </Reveal>
      </section>

      {/* Final CTA — a calm close, three clear doors for a judge. */}
      <section className="relative pb-28 pt-10 text-center">
        <Reveal>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">Your next night shift</p>
          <h2 className="mx-auto mt-4 max-w-[16ch] font-serif text-[clamp(28px,4.2vw,48px)] leading-[1.05] tracking-[-0.03em]">Point the crew at a repo.</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Magnetic>
              <HoverBorderGradient href={scanHref} className="px-7 py-4 text-sm font-semibold">Try public repo scan <span className="text-cyan">→</span></HoverBorderGradient>
            </Magnetic>
            <a href="/dashboard" className="font-mono text-[13px] text-cloud transition-colors hover:text-cyan">Open dashboard ↗</a>
            <span className="text-fog/30">·</span>
            <a href="/openapi-actions.yaml" className="font-mono text-[13px] text-fog transition-colors hover:text-cloud">GPT Action schema ↗</a>
          </div>
          <button onClick={() => setSignIn(true)} className="mt-6 font-mono text-[12px] text-fog transition-colors hover:text-cloud">Sign in for private repos</button>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line py-10">
        <div className="flex items-center gap-2 text-sm font-extrabold tracking-[0.35em]">
          <span className="text-xl text-cyan tracking-normal">◐</span> UMBRA
        </div>
        <small className="text-[11px] leading-relaxed text-fog">
          Findings are real and grounded. Live Codex runs on your own account or the founder&apos;s.<br />
          Built with Codex for OpenAI Build Week 2026.
        </small>
      </footer>
    </main>
  );
}

/** The operator — a compact identity strip, not a team card. One human, a few
 *  links, no oxygen stolen from the report that follows. */
function FounderCard() {
  return (
    <div className="inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-5 py-3.5">
      <DitherImage src="/founder.jpg" rounded pixelSize={3} className="h-11 w-11 border border-[color:var(--surface-border)]" />
      <div className="text-left">
        <div className="font-serif text-[17px] leading-none">Binay Dalai</div>
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Founder · one engineer</div>
      </div>
      <span className="hidden h-8 w-px bg-[color:var(--surface-border)] sm:block" />
      <div className="flex items-center gap-2">
        <FounderLink href="https://github.com/bkd-dotcom" label="GitHub"><GitHubIcon className="h-4 w-4" /></FounderLink>
        <FounderLink href="https://www.linkedin.com/in/binay-dalai/" label="LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0z" /></svg>
        </FounderLink>
        <FounderLink href="mailto:binaydalai2024@gmail.com" label="Email">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
        </FounderLink>
      </div>
    </div>
  );
}

function FounderLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-fog transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/50 hover:text-cloud"
    >
      {children}
    </a>
  );
}
