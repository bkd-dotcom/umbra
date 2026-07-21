"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { EASE } from "@/lib/motion";
import { GlowCard } from "@/components/ui/glow-card";

/* -----------------------------------------------------------------------------
   Crew Dossier — the crew is the main character.

   Not a feature grid: a classified operations file. A monochrome roster on the
   left (only the unit on station is lit, in its identity colour); a large
   focused dossier on the right showing that agent's live operational artifact.
   It cycles calmly on its own (a shift rotating through stations), pauses on
   hover, and any unit is clickable.

   Discipline: 90% neutral, one identity colour at a time. Every animation is the
   agent *doing its job* — Watchman sweeps deps, Detective collapses git history
   to a root cause, Janitor strikes out dead code, Ask resolves to a file:line.
----------------------------------------------------------------------------- */

const FOG = "#8b90a6";
const RISK = "#fb7185";

type Agent = {
  key: string;
  letter: string;
  name: string;
  role: string;
  color: string;
  status: string;
  blurb: string;
  specialty: string[];
  logTime: string;
  logAction: string;
};

const AGENTS: Agent[] = [
  {
    key: "watchman",
    letter: "W",
    name: "Watchman",
    role: "Dependency sentinel",
    color: "#22d3ee",
    status: "on watch",
    blurb: "Hunts known CVEs across every resolved dependency, live against OSV.dev advisories. Never sleeps.",
    specialty: ["OSV.dev", "CVSS", "blast-radius"],
    logTime: "02:07:14",
    logAction: "flagged express@4.17.1 · package-lock.json",
  },
  {
    key: "reviewer",
    letter: "R",
    name: "Reviewer",
    role: "PR risk analyst",
    color: "#a78bfa",
    status: "reviewing",
    blurb: "Scores blast-radius and merge risk on every open pull request — before you do.",
    specialty: ["diff analysis", "risk score", "PRs"],
    logTime: "02:12:03",
    logAction: "scored PR #128 · low risk",
  },
  {
    key: "detective",
    letter: "D",
    name: "Detective",
    role: "Incident tracer",
    color: "#fbbf24",
    status: "tracing",
    blurb: "Traces incidents to the root-cause commit from real git history — reasoned by OpenAI, not guessed.",
    specialty: ["git blame", "git log", "root cause"],
    logTime: "02:09:41",
    logAction: "traced incident → commit a9c31f",
  },
  {
    key: "janitor",
    letter: "J",
    name: "Janitor",
    role: "Tech-debt sweeper",
    color: "#5eead4",
    status: "sweeping",
    blurb: "Clears dead code and quiet tech debt in a disposable checkout, then opens a PR for review.",
    specialty: ["dead code", "unused exports", "cleanup"],
    logTime: "03:48:22",
    logAction: "removed 4 dead exports · utils/legacy.ts",
  },
  {
    key: "ask",
    letter: "A",
    name: "Ask Umbra",
    role: "Codebase oracle",
    color: "#f472b6",
    status: "answering",
    blurb: "Answers questions about your codebase, grounded in real file and line references.",
    specialty: ["retrieval", "file:line", "grounded"],
    logTime: "04:30:09",
    logAction: "answered routing → router.js:22",
  },
];

export function CrewDossier() {
  return (
    <>
      {/* Desktop (lg+) — monochrome roster rail + auto-rotating focused dossier. */}
      <div className="hidden lg:block">
        <CrewDossierDesktop />
      </div>
      {/* Mobile/tablet (below lg) — an accessible, MANUAL one-agent-at-a-time
          carousel. No auto-rotation (a carousel that moves itself while someone
          is reading a description is an anti-pattern on touch, where there is no
          hover-to-pause). Full name + role + description always visible. */}
      <div className="lg:hidden">
        <CrewCarouselMobile />
      </div>
    </>
  );
}

function CrewDossierDesktop() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto rotation: 2.5s per station, paused on hover, focus-within, or any explicit
  // interaction, and disabled under reduced-motion.
  useEffect(() => {
    if (reduce || paused) return;
    const t = setTimeout(() => setActive((p) => (p + 1) % AGENTS.length), 2500);
    return () => clearTimeout(t);
  }, [active, paused, reduce]);

  const agent = AGENTS[active];

  return (
    <div
      className="grid gap-4 lg:grid-cols-[280px_1fr]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Roster rail — monochrome; only the unit on station is lit. */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {AGENTS.map((a, i) => {
          const on = i === active;
          return (
            <button
              key={a.key}
              onClick={() => setActive(i)}
              aria-pressed={on}
              className="group relative flex min-w-[210px] shrink-0 items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-all duration-300 hover:-translate-y-px lg:min-w-0"
              style={{ borderColor: on ? `${a.color}55` : "var(--surface-border)", background: on ? `${a.color}0e` : "var(--surface)" }}
            >
              <span className="absolute inset-y-2 left-0 w-0.5 rounded-full transition-opacity duration-300" style={{ background: a.color, opacity: on ? 1 : 0 }} />
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border font-mono text-[13px] font-semibold transition-colors duration-300"
                style={on ? { color: a.color, borderColor: `${a.color}66`, background: `${a.color}14` } : { color: FOG, borderColor: "var(--surface-border)" }}
              >
                {a.letter}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: on ? "#eef1f9" : FOG }}>
                  {a.name}
                </div>
                <div className="truncate font-mono text-[9.5px] tracking-[0.05em] text-fog">{a.role}</div>
              </div>
              <span className="ml-auto hidden shrink-0 lg:block">
                {on ? (
                  <span className="relative grid h-2.5 w-2.5 place-items-center">
                    <span className="absolute h-2.5 w-2.5 rounded-full animate-pulse-glow" style={{ background: a.color, opacity: 0.25 }} />
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color, boxShadow: `0 0 8px ${a.color}` }} />
                  </span>
                ) : (
                  <span className="block h-1.5 w-1.5 rounded-full border" style={{ borderColor: FOG }} />
                )}
              </span>
            </button>
          );
        })}
        {/* Subtle rotation label — never implies live agent activity. */}
        {!reduce && (
          <div className="mt-1 hidden items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.16em] text-fog/45 lg:flex">
            <span className="h-1 w-1 rounded-full bg-fog/40" /> Crew rotation · hover to hold
          </div>
        )}
      </div>

      {/* Focused dossier — the primary object. FIXED height so the window never
          resizes between agents (no vertical expand/jump on the next reveal). Both
          cards share one css-grid cell and cross-fade; each card fills the fixed
          height (h-full) with the artifact area flexing, so every station renders in
          the exact same frame. */}
      <GlowCard glow={`${agent.color}22`} className="relative grid h-[480px] overflow-hidden">
        {/* Control handoff — a single beam sweeps the top edge as the shift moves
            to this desk. Not a slide transition; the station just came online. */}
        {!reduce && (
          <motion.span
            key={`transfer-${agent.key}`}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-20 h-[2px]"
            style={{ background: `linear-gradient(90deg, ${agent.color}, transparent)`, boxShadow: `0 0 12px ${agent.color}` }}
            initial={{ width: "0%", opacity: 0.9 }}
            animate={{ width: "100%", opacity: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        )}
        <AnimatePresence initial={false}>
          <motion.div
            key={agent.key}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="flex h-full flex-col overflow-hidden p-6 [grid-area:1/1] sm:p-8"
          >
            {/* Header — callsign monogram + codename + status on station */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border font-mono text-xl font-semibold"
                  style={{ color: agent.color, borderColor: `${agent.color}55`, background: `${agent.color}12`, boxShadow: `0 0 30px -12px ${agent.color}` }}
                >
                  {agent.letter}
                </span>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog">Night shift · Unit 0{active + 1}</div>
                  <div className="font-serif text-[clamp(26px,3vw,38px)] leading-none tracking-[-0.02em]">{agent.name}</div>
                  <div className="mt-1.5 font-mono text-[11px] tracking-[0.06em] text-fog">{agent.role}</div>
                </div>
              </div>
              <span
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
                style={{ borderColor: `${agent.color}44`, color: agent.color, background: `${agent.color}0e` }}
              >
                <span className="h-1.5 w-1.5 rounded-full animate-pulse-glow" style={{ background: agent.color, boxShadow: `0 0 8px ${agent.color}` }} />
                {agent.status}
              </span>
            </div>

            <p className="mt-5 max-w-[48ch] text-[14px] leading-relaxed text-cloud/80">{agent.blurb}</p>

            {/* Mission log — one operational record line. Small detail; big "live". */}
            <div className="mt-4 flex items-center gap-2 font-mono text-[10.5px]">
              <span className="uppercase tracking-[0.16em] text-fog/55">Last action</span>
              <span className="tabular-nums text-cloud/80" style={{ color: agent.color }}>{agent.logTime}</span>
              <span className="text-fog/50">·</span>
              <span className="truncate text-fog">{agent.logAction}</span>
            </div>

            {/* Operational artifact — the agent doing its job, one thing, live.
                Centered within the flexible space so agents with a shorter artifact
                (Watchman, Janitor) sit balanced instead of leaving a gap above the
                specialty ledger — every card reads evenly padded top-to-bottom. */}
            <div className="flex flex-1 flex-col justify-center py-1">
              <Artifact agent={agent} reduce={!!reduce} />
            </div>

            {/* Specialty ledger */}
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--surface-border)] pt-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Specialty</span>
              {agent.specialty.map((s) => (
                <span key={s} className="rounded-md border border-[color:var(--surface-border)] px-2 py-0.5 font-mono text-[10px] text-fog">
                  {s}
                </span>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </GlowCard>
    </div>
  );
}

/* -----------------------------------------------------------------------------
   Mobile crew carousel — accessible, manual, one-agent-at-a-time, touch-native.

   Interaction: the dossier card is horizontally draggable. A deliberate drag
   past a distance/velocity threshold advances exactly one agent and springs to
   settle; anything short snaps back. dragDirectionLock keeps vertical page
   scrolling free — a small vertical move never traps the page. No auto-rotation
   (an anti-pattern on touch, where there is no hover-to-pause). Prev/Next
   buttons, letter dots, keyboard, aria-live, and reduced-motion are all kept as
   equal-footing controls. A segmented track (not a bare "N / 5") reads as a
   real carousel position. Name + role + FULL description always visible.
----------------------------------------------------------------------------- */
// The dossier changes with the SAME fade + subtle vertical settle as desktop
// (no horizontal fly-out), regardless of whether the change came from a swipe,
// a button, a tab, or a keyboard arrow. `dir` is retained only so the small
// settle leans in the direction of travel.
const SLIDE_VARIANTS = {
  enter: (d: number) => ({ opacity: 0, y: d >= 0 ? 10 : -10 }),
  center: { opacity: 1, y: 0 },
  exit: (d: number) => ({ opacity: 0, y: d >= 0 ? -8 : 8 }),
};

function CrewCarouselMobile() {
  const reduce = useReducedMotion();
  const [[active, dir], setState] = useState<[number, number]>([0, 0]);
  const [paused, setPaused] = useState(false);
  const agent = AGENTS[active];
  const total = AGENTS.length;

  // Advance by direction; wrap. `dir` drives the slide-in side so the incoming
  // card enters from the side the finger pushed toward.
  const go = (d: 1 | -1) => setState(([p]) => [(p + d + total) % total, d]);
  const jump = (i: number) => setState(([p]) => [i, i > p ? 1 : i < p ? -1 : 0]);

  // Self-advancing rotation (2.5s/card), matching the specialists carousel. Paused
  // on hover, focus, or an in-progress drag; disabled under reduced-motion.
  useEffect(() => {
    if (reduce || paused || total <= 1) return;
    const t = setTimeout(() => go(1), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, reduce, total]);

  // Distance OR velocity crosses the threshold → commit one step.
  const SWIPE_DISTANCE = 56; // px, deliberate
  const SWIPE_VELOCITY = 480; // px/s
  const onDragEnd = (
    _e: unknown,
    info: { offset: { x: number }; velocity: { x: number } },
  ) => {
    setPaused(false);
    const power = info.offset.x + info.velocity.x * 0.2;
    if (power <= -SWIPE_DISTANCE || info.velocity.x <= -SWIPE_VELOCITY) go(1);
    else if (power >= SWIPE_DISTANCE || info.velocity.x >= SWIPE_VELOCITY) go(-1);
    // else: dragSnapToOrigin springs it back.
  };

  return (
    <div
      className="w-full min-w-0"
      role="group"
      aria-roledescription="carousel"
      aria-label="Night crew agents"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      }}
      tabIndex={0}
    >
      {/* Position readout + prev/next controls. */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous agent"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-cloud transition-colors hover:border-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
        >
          <ChevronLeft />
        </button>

        {/* Segmented carousel track — reads as a real position, not a counter. */}
        <div className="flex flex-1 items-center gap-1.5" aria-hidden>
          {AGENTS.map((a, i) => (
            <span
              key={a.key}
              className="h-1 flex-1 rounded-full transition-colors duration-300"
              style={{ background: i === active ? a.color : "var(--surface-border)", boxShadow: i === active ? `0 0 8px ${a.color}` : "none" }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next agent"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] text-cloud transition-colors hover:border-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Screen-reader status for the current position. */}
      <p className="sr-only" aria-live="polite">
        Agent {active + 1} of {total}: {agent.name}, {agent.role}
      </p>

      {/* Roster dots — also directly selectable, keyboard reachable. */}
      <div className="mt-3 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Select an agent">
        {AGENTS.map((a, i) => {
          const on = i === active;
          return (
            <button
              key={a.key}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={`${a.name} · ${a.role}`}
              onClick={() => jump(i)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border font-mono text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
              style={on ? { color: a.color, borderColor: `${a.color}66`, background: `${a.color}14` } : { color: FOG, borderColor: "var(--surface-border)" }}
            >
              {a.letter}
            </button>
          );
        })}
      </div>

      {/* Draggable dossier. overflow-hidden clips the sliding card so nothing
          bleeds past the section width. The card is always mounted with full
          content, so it is never blank; AnimatePresence (no mode="wait") slides
          the incoming card in as the outgoing one leaves. */}
      {/* Both the outgoing and incoming dossier occupy the same grid cell, so the
          shell height is always the current card's height and the console is never
          blank during the cross-fade (no mode="wait", no popLayout collapse). */}
      <div className="relative mt-4 grid h-[640px] overflow-hidden sm:h-[560px]">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={agent.key}
            custom={dir}
            drag={reduce ? false : "x"}
            dragDirectionLock
            dragSnapToOrigin
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragStart={() => setPaused(true)}
            onDragEnd={onDragEnd}
            variants={SLIDE_VARIANTS}
            initial={reduce ? false : "enter"}
            animate="center"
            exit={reduce ? undefined : "exit"}
            transition={{ duration: 0.42, ease: EASE }}
            className="h-full touch-pan-y select-none [grid-area:1/1]"
          >
            <GlowCard glow={`${agent.color}22`} className="relative h-full overflow-hidden">
              <div className="flex h-full flex-col p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border font-mono text-lg font-semibold"
                      style={{ color: agent.color, borderColor: `${agent.color}55`, background: `${agent.color}12` }}
                    >
                      {agent.letter}
                    </span>
                    <div className="min-w-0">
                      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog">Night shift · Unit 0{active + 1}</div>
                      <div className="font-serif text-[24px] leading-none tracking-[-0.02em]">{agent.name}</div>
                      <div className="mt-1 font-mono text-[10.5px] tracking-[0.06em] text-fog">{agent.role}</div>
                    </div>
                  </div>
                  <span
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]"
                    style={{ borderColor: `${agent.color}44`, color: agent.color, background: `${agent.color}0e` }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: agent.color, boxShadow: `0 0 8px ${agent.color}` }} />
                    {agent.status}
                  </span>
                </div>

                {/* Full description — never clipped. */}
                <p className="mt-4 text-[13.5px] leading-relaxed text-cloud/80">{agent.blurb}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px]">
                  <span className="uppercase tracking-[0.16em] text-fog/55">Last action</span>
                  <span className="tabular-nums text-cloud/80" style={{ color: agent.color }}>{agent.logTime}</span>
                  <span className="text-fog/50">·</span>
                  <span className="text-fog">{agent.logAction}</span>
                </div>

                <div className="mt-4">
                  <Artifact agent={agent} reduce={!!reduce} />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[color:var(--surface-border)] pt-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Specialty</span>
                  {agent.specialty.map((s) => (
                    <span key={s} className="rounded-md border border-[color:var(--surface-border)] px-2 py-0.5 font-mono text-[10px] text-fog">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </GlowCard>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Hint — disappears once a drag has happened is overkill; keep it quiet. */}
      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-fog/45" aria-hidden>
        swipe or use arrows
      </p>
    </div>
  );
}

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

/* --- Operational artifacts --------------------------------------------------
   One shared chrome, one live signal each. Motion communicates activity only. */

function ArtifactShell({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)]">
      <div className="flex items-center justify-between border-b border-[color:var(--surface-border)] px-4 py-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog">{label}</span>
        <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color }}>
          <span className="h-1.5 w-1.5 rounded-full animate-pulse-glow" style={{ background: color, boxShadow: `0 0 8px ${color}` }} /> live
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Artifact({ agent, reduce }: { agent: Agent; reduce: boolean }) {
  switch (agent.key) {
    case "watchman":
      return <WatchmanArt color={agent.color} reduce={reduce} />;
    case "reviewer":
      return <ReviewerArt color={agent.color} reduce={reduce} />;
    case "detective":
      return <DetectiveArt color={agent.color} reduce={reduce} />;
    case "janitor":
      return <JanitorArt color={agent.color} reduce={reduce} />;
    default:
      return <AskArt color={agent.color} reduce={reduce} />;
  }
}

function WatchmanArt({ color, reduce }: { color: string; reduce: boolean }) {
  const deps = [
    { n: "lodash@4.17.21", flag: false },
    { n: "react@18.2.0", flag: false },
    { n: "express@4.17.1", flag: true },
    { n: "minimist@1.2.8", flag: false },
  ];
  return (
    <ArtifactShell label="Dependency scan · OSV" color={color}>
      <div className="relative">
        {!reduce && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 h-9"
            style={{ background: `linear-gradient(180deg, transparent, ${color}14, transparent)` }}
            initial={{ top: "-25%" }}
            animate={{ top: "125%" }}
            transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.2 }}
          />
        )}
        <div className="flex flex-col gap-2 font-mono text-[12px]">
          {deps.map((d, i) => (
            <motion.div
              key={d.n}
              initial={reduce ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 * i, duration: 0.4, ease: EASE }}
              className="flex items-center justify-between"
            >
              <span className={d.flag ? "text-cloud" : "text-fog"}>{d.n}</span>
              {d.flag ? (
                <span className="flex items-center gap-1.5 text-[11px] text-[color:var(--sev-critical)]">
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse-glow" style={{ background: RISK }} /> CVE-2024-29041 · HIGH
                </span>
              ) : (
                <span className="text-[11px] text-fog/75">✓ clear</span>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </ArtifactShell>
  );
}

function ReviewerArt({ color, reduce }: { color: string; reduce: boolean }) {
  return (
    <ArtifactShell label="Pull request · risk" color={color}>
      <div className="font-mono text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-cloud">PR #128 · refactor cart totals</span>
          <span className="text-fog">3 files</span>
        </div>
        <div className="mt-2.5 flex items-center gap-3 text-[11px]">
          <span className="text-teal">+48</span>
          <span className="text-[color:var(--sev-critical)]">−12</span>
          <span className="ml-auto text-fog">blast-radius</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: "26%" }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.25 }}
          />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <span className="text-fog">verdict:</span>
          <span style={{ color }}>low · safe to merge</span>
        </div>
      </div>
    </ArtifactShell>
  );
}

function DetectiveArt({ color, reduce }: { color: string; reduce: boolean }) {
  const commits = [
    { h: "c31f2a", m: "add cart totals", root: false },
    { h: "b7e910", m: "update pricing", root: false },
    { h: "a9c31f", m: "refactor cart totals", root: true },
    { h: "4d2e01", m: "fix rounding", root: false },
  ];
  return (
    <ArtifactShell label="Git history · root cause" color={color}>
      <div className="relative flex flex-col gap-2.5 font-mono text-[12px]">
        <span aria-hidden className="absolute bottom-2 left-[6px] top-2 w-px" style={{ background: "var(--surface-border)" }} />
        {commits.map((c, i) => (
          <motion.div
            key={c.h}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.09 * i, duration: 0.4 }}
            className="relative flex items-center gap-3 pl-5"
          >
            <span className="absolute left-0 grid w-3 place-items-center">
              {c.root ? (
                <span className="relative grid h-2.5 w-2.5 place-items-center">
                  <span className="absolute h-2.5 w-2.5 rounded-full animate-pulse-glow" style={{ background: color, opacity: 0.3 }} />
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                </span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: FOG, opacity: 0.5 }} />
              )}
            </span>
            <span style={{ color: c.root ? color : FOG }}>{c.h}</span>
            <span className={c.root ? "text-cloud" : "text-fog/70"}>{c.m}</span>
          </motion.div>
        ))}
        <div className="pl-5 text-[10px] text-fog">reasoned via git blame → root cause</div>
      </div>
    </ArtifactShell>
  );
}

function JanitorArt({ color, reduce }: { color: string; reduce: boolean }) {
  const lines = [
    { t: "export const oldParse = …", dead: true },
    { t: "export function unused() { … }", dead: true },
    { t: "export const config = { … }", dead: false },
  ];
  return (
    <ArtifactShell label="Dead code · sweep" color={color}>
      <div className="font-mono text-[12px]">
        <div className="text-fog/70">utils/legacy.ts</div>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {lines.map((l, i) => (
            <motion.div
              key={l.t}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12 * i, duration: 0.4 }}
              className="flex items-center gap-2"
            >
              {l.dead ? (
                <>
                  <span className="text-fog/45 line-through">{l.t}</span>
                  <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color }}>
                    removed
                  </span>
                </>
              ) : (
                <span className="text-fog">{l.t}</span>
              )}
            </motion.div>
          ))}
        </div>
        <div className="mt-3 text-[11px]" style={{ color }}>
          4 dead exports removed · PR drafted
        </div>
      </div>
    </ArtifactShell>
  );
}

function AskArt({ color, reduce }: { color: string; reduce: boolean }) {
  return (
    <ArtifactShell label="Grounded answer · retrieval" color={color}>
      <div className="font-mono text-[12px]">
        <div className="flex items-start gap-2">
          <span style={{ color }}>?</span>
          <span className="text-cloud">how does routing work?</span>
        </div>
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-2.5 flex items-start gap-2"
        >
          <span style={{ color }}>→</span>
          <span className="text-fog">
            Express matches routes in definition order; the first match wins. See <span className="text-cloud">router.js:22</span>.
          </span>
        </motion.div>
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <span className="text-fog">grounded ·</span>
          <span style={{ color }}>router.js:22</span>
          {!reduce && <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse-glow" style={{ background: color }} />}
        </div>
      </div>
    </ArtifactShell>
  );
}
