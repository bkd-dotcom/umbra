"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Corona } from "@/components/ui/corona";
import { OperationsBoard } from "@/components/ui/operations-board";
import { CrewDossier } from "@/components/ui/crew-dossier";
import { NightShiftPipeline, PIPELINE_SCENES } from "@/components/ui/night-shift-pipeline";
import { DitherImage } from "@/components/ui/dither-image";
import { Magnetic } from "@/components/ui/magnetic-button";
import { GlowCard } from "@/components/ui/glow-card";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SignInDialog } from "@/components/ui/sign-in-dialog";
import { FounderDialog } from "@/components/ui/founder-dialog";
import { Reveal, RevealGroup } from "@/components/ui/reveal";
import { LocalWeather } from "@/components/ui/local-weather";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { MacbookScroll } from "@/components/ui/macbook-scroll";
import { ChatGptThread } from "@/components/ui/chatgpt-thread";
import { MovingBorderCard } from "@/components/ui/moving-border";
import { HeroParallax } from "@/components/ui/hero-parallax";
import { SectionFX } from "@/components/ui/section-fx";
import { Spotlight } from "@/components/ui/spotlight";
import { ChapterRail } from "@/components/ui/chapter-rail";
import { fadeUp, scaleIn, slideLeft, slideRight, blurRise, EASE } from "@/lib/motion";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/* Landing cards use GlowCard's subtle cursor glow. The reflexive 3D "comet" tilt
   and the auto-scrolling marquees were removed so motion is reduced to a few
   purposeful moments — chiefly the hero's live OperationsBoard — and the rest of
   the page stays calm and legible (motion as intent, not decoration). */
function TiltCard({ children, className, glow, ...rest }: { children: React.ReactNode; className?: string; glow?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <GlowCard glow={glow} className={className} {...rest}>{children}</GlowCard>
  );
}

export default function Landing() {
  const [signIn, setSignIn] = useState(false);
  const [founderOpen, setFounderOpen] = useState(false);
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
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] overflow-x-clip px-6 md:px-10">
      {/* Landing signature backdrop: the eclipse. One intentional atmosphere — a
          corona ring over the umbra core on a faint operational grid — replacing
          the old four-effect wash. Fixed, behind content, reduced-motion aware. */}
      <div className="bg-bold pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <Corona />
      </div>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} api={API} />
      <FounderDialog open={founderOpen} onClose={() => setFounderOpen(false)} />

      {/* Nav */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className={`sticky top-3 z-40 mt-3 flex items-center justify-between rounded-2xl px-5 py-3 transition-all duration-300 ${scrolled ? "glass shadow-[var(--shadow-card)]" : ""}`}
      >
        <div className="flex items-center gap-2 text-[15px] font-extrabold tracking-[0.35em]">
          <span className="text-2xl text-cyan tracking-normal">◐</span> UMBRA
        </div>
        {/* Center nav — simple hover-underline links (Aceternity-style). */}
        <div className="hidden items-center gap-1 md:flex">
          {([["Proof", "#evidence-locker"], ["Report", "#report"], ["Crew", "#crew"], ["Shift", "#pipeline-setup"], ["OpenAI", "#openai"]] as const).map(([label, href]) => (
            <a key={href} href={href} className="group relative rounded-lg px-3 py-1.5 font-mono text-[12px] text-fog transition-colors hover:text-cloud">
              {label}
              <span className="absolute inset-x-3 -bottom-0.5 h-px origin-left scale-x-0 bg-cyan transition-transform duration-300 group-hover:scale-x-100" />
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <LocalWeather />
          <ThemeToggle variant="inline" />
          <HoverBorderGradient onClick={() => setSignIn(true)} className="px-4 py-2 text-xs">
            Sign in <span className="text-cyan">↗</span>
          </HoverBorderGradient>
        </div>
      </motion.nav>

      {/* Optional chapter progress aid — after the primary nav in DOM order so the
          real site navigation is the first landmark / tab stop. Fixed visually. */}
      <ChapterRail />

      {/* Hero — arrival: the shift begins. One massive statement, one clarifier,
          then the live operations board does the explaining. */}
      <section data-chapter="Captured proof" className="chapter relative flex min-h-[90vh] flex-col justify-center overflow-x-clip py-16 md:py-20">
        <Spotlight className="-left-[32rem] -top-[30rem] opacity-40" fill="#22d3ee" />
        <div className="relative z-10 max-w-[64rem]">
          <motion.div
            initial={false}
            className="mb-7 flex flex-wrap items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_#22d3ee] animate-pulse-glow" />
            <span className="text-cyan">Live</span>
            <span className="text-fog/40">·</span>
            <span>Autonomous night shift</span>
            <span className="text-fog/40">·</span>
            <span className="text-violet">OpenAI reasoning</span>
          </motion.div>

          {/* Hero headline is deliberately visible on first paint — a plain <h1>,
              no entrance animation — so screenshots, reduced-motion users, and slow
              devices always see the title immediately. */}
          <h1 className="font-serif text-[clamp(52px,8.4vw,116px)] font-normal leading-[0.92] tracking-[-0.035em] text-cloud">
            {["Your repo never", "sleeps alone."].map((line) => (
              <span key={line} className="block overflow-hidden">
                <span className="block pb-[0.12em]">{line}</span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={false}
            className="mt-6 max-w-[42ch] text-[clamp(17px,2.1vw,22px)] leading-snug text-cloud/75"
          >
            An autonomous engineer you can actually trust — because every change is governed.
          </motion.p>

          {/* Stable capability line — visible on first paint, no entrance gate. */}
          <motion.p
            initial={false}
            className="mt-4 max-w-[68ch] font-mono text-[clamp(13px,1.55vw,15px)] leading-relaxed text-fog"
          >
            Coding agents can change your repo. Umbra makes those changes <span className="text-teal">governable</span>: it tests whether an agent obeys <span className="text-cyan">your repository&apos;s rules</span>, then grants only the authority it <span className="text-amber">earns</span> — and proves it with a <span className="text-pink">signed receipt</span>. It <span className="text-cloud">never merges</span>.
          </motion.p>

          {/* Primary judge action — visible on first paint (no entrance gate), above
              the fold, no sign-in. The captured proof is the fastest, highest-
              confidence path into the product. */}
          <motion.div initial={false} className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Magnetic>
              <HoverBorderGradient href="/dashboard?proof=calhacks" className="px-7 py-3.5 text-sm font-semibold">
                <span aria-hidden>▶</span> Open captured proof
              </HoverBorderGradient>
            </Magnetic>
            <span className="font-mono text-[12px] text-teal">instant · no sign-in</span>
            <span className="hidden text-fog/30 sm:inline">·</span>
            <a href="#report" className="font-mono text-[13px] text-cloud transition-colors hover:text-cyan">View morning report ↓</a>
          </motion.div>

          {/* Judge proof strip — what's real, at a glance. */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ delay: 0.28 }}
            className="mt-6 flex flex-wrap gap-2"
          >
            {([
              ["Executable change contract", "#22d3ee"],
              ["Untrusted-content quarantine", "#5eead4"],
              ["Independent verifier", "#a78bfa"],
              ["Signed remediation receipt", "#fbbf24"],
              ["Never auto-merges", "#8b90a6"],
            ] as const).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-2.5 py-1 font-mono text-[10.5px] tracking-[0.03em] text-fog">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </motion.div>

          {/* Secondary: run a live scan on your own repo (slower path), plus sign-in. */}
          <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.32 }} className="mt-7 w-full max-w-[560px]">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">Or run a live scan on a public repo</p>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-3 transition-colors focus-within:border-cyan/50">
                <span className="font-mono text-[12px] text-fog">▸</span>
                <input
                  value={demoRepo}
                  onChange={(e) => setDemoRepo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") window.location.href = scanHref; }}
                  spellCheck={false}
                  aria-label="Public GitHub repository to scan"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-cloud outline-none placeholder:text-fog/60"
                />
              </div>
              <HoverBorderGradient href={scanHref} className="px-6 py-3.5 text-sm font-semibold">
                Run public repo scan <span className="text-cyan">→</span>
              </HoverBorderGradient>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[12px]">
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

      {/* The Evidence Locker — what's INSIDE a captured shift (the hero already
          owns the "open it" CTA). This section shows the receipt's contents so the
          proof reads as substance, not a second identical button. Static card:
          motion is reserved for the hero's live OperationsBoard. */}
      <section id="evidence-locker" data-chapter="Evidence Locker" className="chapter relative py-20 md:py-24">
        <SectionFX accent="#5eead4" variant="top" />
        <Reveal variants={blurRise}>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-teal shadow-[0_0_8px_#5eead4]" /> The Evidence Locker
          </p>
          <h2 className="mt-3 max-w-[22ch] font-serif text-[clamp(30px,4.4vw,54px)] leading-[1.02] tracking-[-0.03em]">One night. One repo. Every receipt.</h2>
          <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-fog">
            Every captured shift opens to the full chain — OSV advisories, the Codex diff, the provider ledger, and the earned authority level, plus an exportable Evidence Pack (stamped with a recomputable SHA-256 integrity hash) and a signature-verifiable, Ed25519-signed Remediation Receipt.
          </p>
        </Reveal>
        <Reveal className="mt-9">
          <div className="surface overflow-hidden rounded-2xl p-7 sm:p-9">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 font-mono text-[12.5px]">
              <span className="flex items-center gap-2 text-cloud"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> 26 advisories found</span>
              <span className="text-fog/25">·</span>
              <span className="text-cloud">next 14.2.5 <span className="text-teal">→</span> 14.2.33</span>
              <span className="text-fog/25">·</span>
              <span className="text-cyan">osv.dev · repo-clone · codex-cli</span>
              <span className="text-fog/25">·</span>
              <span className="text-fog">human review required</span>
            </div>
            <div className="mt-7 border-t border-[color:var(--surface-border)] pt-6">
              <HoverBorderGradient href="/dashboard?proof=calhacks" className="px-6 py-3.5 text-sm font-semibold">
                Open the captured shift <span className="text-teal">→</span>
              </HoverBorderGradient>
            </div>
          </div>
        </Reveal>
      </section>

      {/* The handoff — the morning report inside a MacBook that opens as you scroll.
          "You slept. They didn't." lives here and nowhere else. */}
      <section id="report" data-chapter="Morning report" className="chapter relative">
        <MacbookScroll
          showGradient
          title={
            <span className="block">
              <span className="block font-mono text-[11px] uppercase tracking-[0.24em] text-fog">The handoff</span>
              <span className="mt-3 block font-serif text-[clamp(34px,5.2vw,64px)] font-normal leading-[1.0] tracking-[-0.03em] text-cloud">You slept. They didn&rsquo;t.</span>
              <span className="mx-auto mt-4 block max-w-[48ch] text-[15px] leading-relaxed text-fog">
                Every morning the report is already waiting: what broke, what Codex prepared, what still needs review, and what never got merged without you.
              </span>
            </span>
          }
        />
      </section>

      {/* What the night crew does — parallax artifact tiles. */}
      <section className="relative -mx-6 overflow-hidden rounded-[2rem] border border-violet/10 bg-[radial-gradient(70%_80%_at_15%_0%,rgba(167,139,250,0.10),transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent)] px-6 py-20 md:-mx-10 md:px-10">
        <div className="pointer-events-none absolute right-6 top-6 hidden font-mono text-[10px] uppercase tracking-[0.28em] text-violet/40 md:block">unit manifest</div>
        <HeroParallax
          heading={<h2 className="font-serif text-[clamp(28px,4vw,46px)] leading-[1.05] tracking-[-0.02em] text-cloud">Bounded specialists, one shift.</h2>}
          sub="Each works a disposable clone and files a grounded artifact — no fabrication, no auto-merge."
          items={[
            { title: "Watchman", sub: "Hunts CVEs across resolved dependencies, live against OSV.dev.", accent: "#22d3ee" },
            { title: "Reviewer", sub: "Scores blast-radius and merge risk on the exact diff being shipped.", accent: "#a78bfa" },
            { title: "Detective", sub: "Traces an incident to its root-cause commit from real git history.", accent: "#fbbf24" },
            { title: "Janitor", sub: "Clears dead code and quiet tech debt, then drafts a PR for review.", accent: "#5eead4" },
            { title: "Ask Umbra", sub: "Answers questions about your codebase, grounded to file:line.", accent: "#f472b6" },
            { title: "Evidence pack", sub: "Every run exports a hashable audit trail — receipts, not vibes.", accent: "#8b90a6" },
          ]}
        />
      </section>

      {/* Evidence — "does it actually work?" answered first, with a real artifact. */}
      <section id="evidence" className="relative -mx-6 overflow-hidden rounded-[2rem] border border-cyan/10 bg-[radial-gradient(70%_90%_at_100%_0%,rgba(34,211,238,0.10),transparent_60%),linear-gradient(180deg,rgba(34,211,238,0.035),transparent)] px-6 py-24 md:-mx-10 md:px-10">
        <SectionFX accent="#22d3ee" variant="left" />
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.035]" aria-hidden />
        <div className="relative z-10">
        <Reveal variants={slideLeft}>
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
            <TiltCard glow="rgba(251,113,133,0.20)" className="h-full">
              <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-6 py-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fog">Case file · CVE-2024-29041</span>
                <span className="flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--sev-critical)]">
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
            </TiltCard>
          </Reveal>

          {/* Detective root-cause + Reviewer verdict — breadth beyond security */}
          <Reveal delay={0.05}>
            <div className="flex h-full flex-col gap-5">
              <TiltCard glow="rgba(251,191,36,0.18)" className="p-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Incident · root cause</span>
                <p className="mt-3 text-[13px] leading-relaxed text-cloud">
                  <span className="text-amber">⌁ DETECTIVE</span> traced <span className="text-cloud">500s on /checkout</span> to one commit — reasoned over real git history, not guessed.
                </p>
                <div className="mt-4 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3 py-2.5 font-mono text-[11px] text-fog">
                  <span className="text-amber">commit a9c31f</span> — “refactor cart totals”<br />
                  <span className="text-cloud">3 days ago · @dev</span>
                </div>
              </TiltCard>
              <TiltCard glow="rgba(167,139,250,0.18)" className="p-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">PR review · verdict</span>
                <p className="mt-3 text-[13px] leading-relaxed text-cloud">
                  <span className="text-violet">◈ REVIEWER</span> scored the fix: <span className="text-teal">blast-radius low · safe to merge</span>.
                </p>
              </TiltCard>
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
                <span key={src} className="rounded-full border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2.5 py-1 font-mono text-[10px] text-fog">
                  <span className="text-cloud">{src}</span> · {out}
                </span>
              ))}
            </div>
            <span className="font-mono text-[10px] text-fog/70">grounded, never fabricated · your own scan shows live / cache / unavailable</span>
          </div>
        </Reveal>
        </div>
      </section>

      {/* Night crew — the main character: a classified ops file, one unit on station. */}
      <section id="crew" data-chapter="Night crew" className="chapter relative py-24">
        <SectionFX accent="#a78bfa" variant="right" />
        <div className="pointer-events-none absolute left-1/2 top-16 h-56 w-56 -translate-x-1/2 rounded-full bg-violet/10 blur-[90px]" aria-hidden />
        <Reveal variants={scaleIn}>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> The night crew
          </p>
          <h2 className="mt-3 max-w-[18ch] font-serif text-[clamp(30px,4.2vw,52px)] leading-[1.02] tracking-[-0.03em]">Specialists on station. Every change still governed.</h2>
          <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-fog">Open the file on each. They investigate and prepare work — but nothing reaches your repo without passing the contract, the verifier, and you.</p>
        </Reveal>
        <Reveal className="mt-10">
          <CrewDossier />
        </Reveal>
      </section>

      {/* The night shift, replayed — one real captured shift, broken into four
          viewport-sized scenes (setup → detection & evidence → draft & check →
          signed receipt & human gate). Each is its own chapter so the rail tracks
          the real narrative beats; scrolling stays continuous (no pinned track). */}
      {PIPELINE_SCENES.map((s, i) => (
        <section key={s.key} id={s.key} data-chapter={s.label} className={`chapter ${s.fit ? "chapter-fit" : ""} relative py-16 md:py-20`}>
          <NightShiftPipeline scene={i} />
        </section>
      ))}

      {/* How OpenAI is used — an engineering evidence panel, not a marketing block.
          Placed after the story, before the ChatGPT surface. */}
      <section id="openai" data-chapter="OpenAI evidence" className="chapter relative py-24">
        <SectionFX accent="#34d399" variant="grid" />
        <Reveal variants={blurRise}>
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
              {p.title === "Codex CLI" ? (
                <MovingBorderCard duration={7} className="h-full p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-serif text-xl">{p.title}</h3>
                    <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: p.color, borderColor: `${p.color}44`, background: `${p.color}12` }}>{p.tag}</span>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-fog">{p.body}</p>
                  <div className="mt-5 rounded-xl border border-violet/20 bg-violet/5 p-4 font-mono text-[11px] leading-relaxed text-violet/90">
                    codex exec · disposable clone · diff-only artifact · no auto-merge
                  </div>
                </MovingBorderCard>
              ) : (
              <TiltCard className="h-full p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-serif text-xl">{p.title}</h3>
                  <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: p.color, borderColor: `${p.color}44`, background: `${p.color}12` }}>{p.tag}</span>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-fog">{p.body}</p>
              </TiltCard>
              )}
            </Reveal>
          ))}
        </RevealGroup>
      </section>

      {/* Where this goes next — the honest trajectory from "here's a draft, check it"
          to "I tested it, ship it". Each card grounds what runs TODAY before naming
          what's next, so the roadmap reads as confidence, not a wishlist. */}
      <section id="next" className="relative py-24">
        <SectionFX accent="#38bdf8" variant="left" />
        <Reveal variants={slideLeft}>
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
            { title: "Contract-declared checks", today: "Runs the contract's required checks (allowlisted profiles, secret-stripped env) on the base commit and the changed tree, capping authority when they don't pass.", next: "Broader check profiles and richer per-check provenance in the signed receipt." },
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
      <section id="chatgpt" data-chapter="In ChatGPT" className="chapter relative -mx-6 overflow-hidden rounded-[2rem] border border-teal/10 bg-[radial-gradient(70%_80%_at_100%_100%,rgba(16,163,127,0.10),transparent_58%),linear-gradient(180deg,rgba(16,163,127,0.035),transparent)] px-6 py-24 md:-mx-10 md:px-10">
        <SectionFX accent="#10a37f" variant="right" />
        <div className="pointer-events-none absolute left-6 top-6 hidden font-mono text-[10px] uppercase tracking-[0.28em] text-teal/45 md:block">gpt action surface</div>
        <Reveal variants={slideRight}>
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
        <div className="mt-9 grid items-start gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          {/* The proof: a live-looking ChatGPT thread, grounded + honest. */}
          <Reveal parallax={0}>
            <ChatGptThread />
          </Reveal>
          {/* The three read-only actions this surface exposes. */}
          <Reveal delay={0.05} className="flex flex-col gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal/70">Read-only actions</p>
            {[
              { n: "scanRepo", body: "Umbra Score + live CVEs for any public repo." },
              { n: "investigateIncident", body: "An error → the root-cause commit from real git history." },
              { n: "askUmbra", body: "A question → an answer with real file:line references." },
            ].map((a) => (
              <div key={a.n} className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] p-4">
                <b className="font-mono text-[12px] text-cyan">{a.n}</b>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-fog">{a.body}</p>
              </div>
            ))}
          </Reveal>
        </div>
        <Reveal className="mt-6 flex flex-wrap items-center gap-4">
          <a href="/openapi-actions.yaml" className="font-mono text-[12px] text-cyan hover:underline">OpenAPI schema ↗</a>
          <span className="text-fog/40">·</span>
          <a href="/.well-known/ai-plugin.json" className="font-mono text-[12px] text-cyan hover:underline">Plugin manifest ↗</a>
          <span className="text-fog/40">·</span>
          <a href="https://github.com/bkd-dotcom/umbra/tree/main/custom_gpt" target="_blank" rel="noreferrer" className="font-mono text-[12px] text-fog hover:text-cloud">Build the GPT ↗</a>
        </Reveal>
        <Reveal className="mt-8">
          <div className="flex flex-wrap gap-2.5">
            {[
              "Scan github.com/expressjs/express",
              "Why did checkout fail?",
              "Which file handles routing?",
              "Trace this stack trace to a commit",
              "Summarize the dependency risk",
            ].map((item) => (
              <span key={item} className="rounded-xl border border-teal/20 bg-[color:var(--surface)] px-4 py-3 font-mono text-[12px] text-fog">
                &ldquo;{item}&rdquo;
              </span>
            ))}
          </div>
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
            <FounderCard onOpen={() => setFounderOpen(true)} />
          </div>
        </Reveal>
      </section>

      {/* Final CTA — a calm close, three clear doors for a judge. */}
      <section className="relative pb-28 pt-10 text-center">
        <Reveal>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">Your next night shift</p>
          <h2 className="mx-auto mt-4 max-w-[16ch] font-serif text-[clamp(28px,4.2vw,48px)] leading-[1.05] tracking-[-0.03em]">Point the crew at a repo.</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Magnetic>
              <HoverBorderGradient href={scanHref} className="px-7 py-4 text-sm font-semibold">Run public repo scan <span className="text-cyan">→</span></HoverBorderGradient>
            </Magnetic>
            <a href="/dashboard?proof=calhacks" className="font-mono text-[13px] text-teal transition-colors hover:text-cyan">▶ Open captured proof</a>
            <span className="text-fog/30">·</span>
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

/** The operator — a compact identity strip that opens the operator reveal. The
 *  resting state shows the dithered avatar (the machine's view); clicking it
 *  resolves to the real photo, motto, and story in a dialog. */
function FounderCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="group inline-flex flex-col items-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-8 py-6 text-center transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/50 hover:shadow-[0_0_36px_-8px_rgba(34,211,238,0.4)]"
    >
      <DitherImage
        src="/founder.jpg"
        pixelSize={2}
        levels={6}
        strength={0.32}
        className="h-20 w-20 shrink-0 rounded-lg border border-[color:var(--surface-border)]"
      />
      <div className="font-serif text-[19px] leading-none">Binay Dalai</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Founder · solo builder</div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fog transition-colors group-hover:text-cyan">
        Read my story <span className="inline-block transition-transform duration-300 group-hover:translate-x-0.5">→</span>
      </div>
    </button>
  );
}
