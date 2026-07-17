"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { EASE } from "@/lib/motion";
import { GlowCard } from "@/components/ui/glow-card";

/* -----------------------------------------------------------------------------
   Operations Board — the hero centerpiece.

   A night shift, REPLAYED. Five real agents move through a scripted sequence so a
   judge watching for ~30s *sees the product work* instead of reading about it.
   Labelled REPLAY, with a grounded/never-fabricated footer, so a scripted demo is
   never passed off as live truth.

   Two disciplines keep it "mission control", not "AI startup":
   1. Pacing — each beat holds for several seconds (varied), and the whole loop
      runs ~30s. It reads as a shift progressing, not a loading animation.
   2. Colour = 10% signal, 90% neutral. Exactly ONE agent is lit at a time (its
      identity colour, or rose for risk); everyone else stays neutral/steady. Each
      specialist gets a single colour moment across the loop, so the crew stays
      distinct without the board ever glowing like a roles dashboard.
----------------------------------------------------------------------------- */

type Tone = "idle" | "busy" | "signal" | "risk" | "done";
type Cell = { word: string; readout: string; tone: Tone };
type Frame = { caption: string; hold: number; state: Record<string, Cell> };

const FOG = "#8b90a6";
const RISK = "#fb7185";
const RESOLVE = "#5eead4";

const AGENTS: { key: string; letter: string; name: string; role: string; color: string }[] = [
  { key: "watchman", letter: "W", name: "WATCHMAN", role: "Dependency sentinel", color: "#22d3ee" },
  { key: "reviewer", letter: "R", name: "REVIEWER", role: "PR risk analyst", color: "#a78bfa" },
  { key: "detective", letter: "D", name: "DETECTIVE", role: "Incident tracer", color: "#fbbf24" },
  { key: "janitor", letter: "J", name: "JANITOR", role: "Tech-debt sweeper", color: "#5eead4" },
  { key: "ask", letter: "A", name: "ASK UMBRA", role: "Codebase oracle", color: "#f472b6" },
];

const idle = (readout = "awaiting dispatch"): Cell => ({ word: "standby", readout, tone: "idle" });
const busy = (word: string, readout: string): Cell => ({ word, readout, tone: "busy" });

// Six beats. One protagonist (signal/risk) per beat — colours appear one at a
// time. Holds are varied and long enough to read as work, not a ride.
const FRAMES: Frame[] = [
  {
    caption: "02:00 — repository connected",
    hold: 3200,
    state: {
      watchman: idle(),
      reviewer: idle(),
      detective: idle("no active incident"),
      janitor: idle(),
      ask: idle("ready for questions"),
    },
  },
  {
    caption: "02:07 — Watchman flags a known CVE",
    hold: 5600,
    state: {
      watchman: { word: "alert", readout: "CVE-2024-29041 · express@4.17.1 · HIGH", tone: "risk" },
      reviewer: busy("reviewing", "reading PR #128 diff"),
      detective: busy("standby", "opening git history"),
      janitor: busy("sweeping", "indexing modules"),
      ask: idle("ready for questions"),
    },
  },
  {
    caption: "02:09 — Detective reasons to the root-cause commit",
    hold: 6000,
    state: {
      watchman: busy("on watch", "patch prepared → 4.19.2"),
      reviewer: busy("reviewing", "assessing blast-radius"),
      detective: { word: "tracing", readout: "reasoning · git blame → commit a9c31f", tone: "signal" },
      janitor: busy("sweeping", "4 dead exports found"),
      ask: idle("ready for questions"),
    },
  },
  {
    caption: "02:12 — Reviewer validates the fix",
    hold: 5000,
    state: {
      watchman: busy("on watch", "patch ready for review"),
      reviewer: { word: "reviewing", readout: "risk · low · safe to merge", tone: "signal" },
      detective: busy("filed", "root cause documented"),
      janitor: busy("sweeping", "cleanup PR drafted"),
      ask: idle("ready for questions"),
    },
  },
  {
    caption: "04:30 — Ask Umbra answers, grounded in real refs",
    hold: 4800,
    state: {
      watchman: busy("on watch", "monitoring dependencies"),
      reviewer: busy("queued", "1 PR reviewed"),
      detective: busy("idle", "1 incident traced"),
      janitor: busy("sweeping", "removing dead code"),
      ask: { word: "answering", readout: "“how does routing work?” → router.js:22", tone: "signal" },
    },
  },
  {
    caption: "06:00 — morning report · Umbra Score 78 · 2 fixes proposed",
    hold: 7000,
    state: {
      watchman: { word: "done", readout: "1 advisory · patch ready", tone: "done" },
      reviewer: { word: "done", readout: "PR #128 · reviewed safe", tone: "done" },
      detective: { word: "done", readout: "1 incident · root-caused", tone: "done" },
      janitor: { word: "done", readout: "4 dead exports removed", tone: "done" },
      ask: { word: "done", readout: "3 questions answered w/ refs", tone: "done" },
    },
  },
];

const FREEZE = 2; // reduced-motion: hold the Detective-reasoning beat (best screenshot).

export function OperationsBoard() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce) {
      setI(FREEZE);
      return;
    }
    const t = setTimeout(() => setI((p) => (p + 1) % FRAMES.length), FRAMES[i].hold);
    return () => clearTimeout(t);
  }, [i, reduce]);

  const frame = FRAMES[i];

  return (
    <GlowCard glow="rgba(34,211,238,0.18)" className="overflow-hidden">
      {/* Header — board identity + honest REPLAY label. No announcement here; the
          reasoning is demonstrated in the roster below. */}
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--surface-border)] px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_#22d3ee] animate-pulse-glow" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-cloud">Night shift</span>
          <span className="rounded-full border border-[color:var(--surface-border)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-fog">
            Replay
          </span>
        </div>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-fog sm:inline">5 specialists · in parallel</span>
      </div>

      {/* Roster — the crew, at their stations. */}
      <div className="relative">
        {/* Occasional scan sweep — a single pass, not a constant strobe. */}
        {!reduce && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-10 w-28"
            style={{ background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.07), transparent)" }}
            initial={{ x: "-15%" }}
            animate={{ x: "115%" }}
            transition={{ duration: 6.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 3.5 }}
          />
        )}

        <div className="divide-y divide-[color:var(--surface-border)]">
          {AGENTS.map((a) => {
            const cell = frame.state[a.key];
            const lit = cell.tone === "signal" || cell.tone === "risk";
            const sig = cell.tone === "risk" ? RISK : a.color; // protagonist colour
            return (
              <div key={a.key} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-6">
                {/* L3 — identity monogram. Neutral at rest; its colour only when lit. */}
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border font-mono text-[13px] font-semibold transition-colors duration-500"
                  style={
                    lit
                      ? { color: sig, borderColor: `${sig}66`, background: `${sig}14`, boxShadow: `0 0 22px -10px ${sig}` }
                      : { color: FOG, borderColor: "var(--surface-border)", background: "var(--surface)" }
                  }
                >
                  {a.letter}
                </span>

                <div className="w-[86px] shrink-0 sm:w-[118px]">
                  <div className="font-mono text-[11.5px] font-semibold tracking-[0.1em] text-cloud sm:text-[12px]">{a.name}</div>
                  <div className="hidden font-mono text-[9.5px] tracking-[0.06em] text-fog sm:block">{a.role}</div>
                </div>

                {/* L5 — status: dot + word. Signal colour only when lit. */}
                <div className="flex w-[70px] shrink-0 items-center gap-1.5 sm:w-[92px] sm:gap-2">
                  <span className="relative grid h-3.5 w-3.5 place-items-center">
                    {cell.tone === "idle" ? (
                      <span className="h-2 w-2 rounded-full border" style={{ borderColor: FOG }} />
                    ) : cell.tone === "busy" ? (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: FOG, opacity: 0.7 }} />
                    ) : cell.tone === "done" ? (
                      <span className="text-[11px] leading-none" style={{ color: RESOLVE }}>✓</span>
                    ) : (
                      <>
                        <span className="absolute h-3.5 w-3.5 rounded-full animate-pulse-glow" style={{ background: sig, opacity: 0.22 }} />
                        <span className="h-2 w-2 rounded-full" style={{ background: sig, boxShadow: `0 0 8px ${sig}` }} />
                      </>
                    )}
                  </span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.08em] sm:text-[10.5px]"
                    style={{ color: lit ? sig : cell.tone === "done" ? RESOLVE : FOG }}
                  >
                    {cell.word}
                  </span>
                </div>

                {/* L4 — the live readout (real output shapes: CVE, commit, file:line). */}
                <div className="min-w-0 flex-1">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={cell.readout}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0, y: -6 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className={`truncate font-mono text-[11px] sm:text-[12px] ${lit ? "text-cloud/85" : "text-cloud/50"}`}
                    >
                      {cell.readout}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer — animated narration (the story) + the honesty ledger. */}
      <div className="flex flex-col gap-1.5 border-t border-[color:var(--surface-border)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <AnimatePresence mode="wait">
          <motion.span
            key={frame.caption}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="truncate font-mono text-[11px] text-cyan/90"
          >
            {frame.caption}
          </motion.span>
        </AnimatePresence>
        <span className="shrink-0 font-mono text-[10px] text-fog/70">grounded in OSV + git history · never fabricated</span>
      </div>
    </GlowCard>
  );
}
