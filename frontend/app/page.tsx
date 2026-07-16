"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import Radar from "@/components/Radar";
import { Aurora } from "@/components/ui/aurora-background";
import { Meteors } from "@/components/ui/meteors";
import { TextGenerate } from "@/components/ui/text-generate";
import { FlipWords } from "@/components/ui/flip-words";
import { GlowCard } from "@/components/ui/glow-card";
import { MovingBorderCard } from "@/components/ui/moving-border";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { InfiniteMovingCards } from "@/components/ui/infinite-moving-cards";
import { SignInDialog } from "@/components/ui/sign-in-dialog";
import { Reveal, RevealGroup } from "@/components/ui/reveal";
import { GitHubIcon } from "@/components/ui/icons";
import { LocalWeather } from "@/components/ui/local-weather";
import { fadeUp } from "@/lib/motion";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const crew: Array<{ mark: string; name: string; job: string; color: string }> = [
  { mark: "◉", name: "WATCHMAN", job: "Hunts CVEs in your dependencies with live OSV advisories.", color: "#22d3ee" },
  { mark: "◈", name: "REVIEWER", job: "Scores blast-radius and risk on every open pull request.", color: "#a78bfa" },
  { mark: "⌁", name: "DETECTIVE", job: "Traces incidents to the root-cause commit from real git history.", color: "#f472b6" },
  { mark: "◒", name: "JANITOR", job: "Clears dead code and quiet tech debt in a disposable checkout.", color: "#5eead4" },
  { mark: "?", name: "ASK UMBRA", job: "Answers questions about your codebase, grounded in real refs.", color: "#fbbf24" },
];

const steps: Array<{ n: string; title: string; body: string }> = [
  { n: "01", title: "Sign in", body: "Continue with GitHub or Google. GitHub connects your own public and private repositories." },
  { n: "02", title: "Point at a repo", body: "Pick one of your repos. The night crew fans out — CVEs, git history, code retrieval — in parallel." },
  { n: "03", title: "Read the morning report", body: "Every finding is grounded and labelled with what produced it. No fabricated results, ever." },
];

const marquee = ["Runs on Codex credits", "OSV.dev advisories", "GitHub public + private", "Grounded, never fabricated", "PRs only — never auto-merge", "Root-cause from git history"];

export default function Landing() {
  const [signIn, setSignIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] px-6 md:px-10">
      {/* Landing signature background: an expressive, slowly-drifting Aurora over
          the shared base gradient. Fixed + behind content; the global
          reduced-motion rule freezes the drift for accessibility. */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <Aurora intensity={0.55} />
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

      {/* Hero */}
      <section className="relative grid items-center gap-16 py-20 md:grid-cols-[1.4fr_0.85fr] md:py-28">
        <div className="relative z-10">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">
            Autonomous engineering · mission control
          </motion.p>
          <h1 className="font-serif text-[clamp(44px,5.6vw,76px)] font-normal leading-[0.98] tracking-[-0.03em]">
            <TextGenerate words="Your repo never sleeps alone." />
          </h1>
          <div className="mt-3 font-serif text-[clamp(26px,3.2vw,40px)] leading-tight text-fog">
            It <FlipWords words={["hunts CVEs", "traces incidents", "reviews PRs", "answers your codebase"]} className="text-shimmer font-medium" />
          </div>
          <motion.p variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.5 }} className="mt-7 max-w-[540px] text-[15px] leading-relaxed text-fog">
            Umbra is an autonomous AI engineering team for your GitHub repo. Sign in and the night crew hunts CVEs,
            traces incidents, reviews risk, and answers your codebase — then hands you the morning report.
          </motion.p>
          <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.65 }} className="mt-9 flex flex-wrap items-center gap-4">
            <HoverBorderGradient onClick={() => setSignIn(true)} className="px-6 py-3.5 text-sm font-semibold">
              Start the night shift
            </HoverBorderGradient>
            <a href="#crew" className="text-sm text-fog transition-colors hover:text-cloud">See the crew ↓</a>
          </motion.div>
          <p className="mt-5 font-mono text-[11px] text-fog/80">Real OAuth — GitHub unlocks live scans of your own repositories.</p>
        </div>

        {/* Showcase radar card */}
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8 }} className="relative z-10">
          <MovingBorderCard>
            <div className="relative overflow-hidden rounded-2xl p-6">
              <Meteors number={12} />
              <div className="relative z-10 mb-4 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">Threat radar</p>
                  <p className="mt-1 text-lg">Attack surface</p>
                </div>
                <span className="flex items-center gap-2 font-mono text-[10px] text-teal">
                  <i className="inline-block h-1.5 w-1.5 animate-pulse-glow rounded-full bg-teal shadow-[0_0_10px_#5eead4]" /> LIVE
                </span>
              </div>
              <div className="relative z-10 flex items-center justify-center gap-4 py-3">
                <Radar />
                <div className="text-left">
                  <b className="font-mono text-[10px] tracking-[0.12em] text-pink">SCANNING</b>
                  <p className="my-2 text-sm leading-tight">Dependency<br />exposure</p>
                  <small className="text-[10px] text-fog">OWASP A06</small>
                </div>
              </div>
            </div>
          </MovingBorderCard>
        </motion.div>
      </section>

      {/* Trust strip */}
      <Reveal className="py-6">
        <InfiniteMovingCards
          items={marquee.map((m) => (
            <span key={m} className="glass flex items-center gap-2 rounded-full px-5 py-2.5 font-mono text-xs text-fog">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan" /> {m}
            </span>
          ))}
        />
      </Reveal>

      {/* Night crew */}
      <section id="crew" className="relative py-20">
        <Reveal>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">The night crew</p>
          <h2 className="mt-3 max-w-[16ch] font-serif text-[clamp(28px,3.6vw,46px)] tracking-[-0.03em]">Five specialists. One quiet shift.</h2>
        </Reveal>
        <RevealGroup className="mt-9 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {crew.map((c, i) => (
            <Reveal key={c.name} variants={fadeUp} className={i === 0 ? "lg:col-span-2" : i === 4 ? "lg:col-span-2" : "lg:col-span-2"}>
              <GlowCard glow={`${c.color}30`} className="h-full p-6">
                <i className="mb-4 block text-2xl not-italic" style={{ color: c.color }}>{c.mark}</i>
                <b className="font-mono text-[11px] tracking-[0.11em]">{c.name}</b>
                <p className="mt-2.5 text-[13px] leading-relaxed text-fog">{c.job}</p>
              </GlowCard>
            </Reveal>
          ))}
        </RevealGroup>
      </section>

      {/* How it works */}
      <section className="relative py-20">
        <Reveal>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">How it works</p>
          <h2 className="mt-3 max-w-[20ch] font-serif text-[clamp(28px,3.6vw,46px)] tracking-[-0.03em]">Sign in. Point at a repo. Read the morning report.</h2>
        </Reveal>
        <RevealGroup className="mt-9 grid gap-4 md:grid-cols-3">
          {steps.map((s) => (
            <Reveal key={s.n} variants={fadeUp}>
              <GlowCard className="h-full p-7">
                <span className="font-mono text-[11px] tracking-[0.1em] text-cyan">{s.n}</span>
                <h3 className="mb-2.5 mt-3 font-serif text-2xl">{s.title}</h3>
                <p className="text-[13px] leading-relaxed text-fog">{s.body}</p>
              </GlowCard>
            </Reveal>
          ))}
        </RevealGroup>
      </section>

      {/* Meet the team */}
      <section id="team" className="relative py-20">
        <Reveal className="text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">Meet the team</p>
          <h2 className="mx-auto mt-3 max-w-[18ch] font-serif text-[clamp(28px,3.6vw,46px)] tracking-[-0.03em]">Built by one engineer, for every engineer.</h2>
        </Reveal>
        <Reveal className="mx-auto mt-9 max-w-[440px]">
          <FounderCard />
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

/** Founder card — Comet-style 3D tilt + glow. Handles are best-guess; correct
 *  them in this file if needed. */
function FounderCard() {
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  return (
    <motion.div
      style={{ transformStyle: "preserve-3d", transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        setTilt({ rx: -py * 8, ry: px * 8 });
      }}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
      className="transition-transform duration-200 ease-out"
    >
      <GlowCard glow="rgba(34,211,238,0.28)" className="p-8 text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-violet/40 to-cyan/40 font-serif text-3xl">BD</div>
        <div className="mt-5 font-serif text-2xl">Binay Dalai</div>
        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan">Founder</div>
        <p className="mx-auto mt-4 max-w-[34ch] text-[13px] leading-relaxed text-fog">
          Building Umbra so every repo has an autonomous engineering team on the night shift — grounded, auditable, and honest about what it did.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <FounderLink href="https://github.com/bkd-dotcom" label="GitHub"><GitHubIcon className="h-4 w-4" /></FounderLink>
          <FounderLink href="https://www.linkedin.com/in/binay-dalai/" label="LinkedIn">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0z" /></svg>
          </FounderLink>
          <FounderLink href="mailto:binaydalai2024@gmail.com" label="Email">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
          </FounderLink>
        </div>
      </GlowCard>
    </motion.div>
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
