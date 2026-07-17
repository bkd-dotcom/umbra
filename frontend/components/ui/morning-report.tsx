"use client";

import { type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE, fadeUp, stagger } from "@/lib/motion";
import { GlowCard } from "@/components/ui/glow-card";

/* -----------------------------------------------------------------------------
   Morning Report — the emotional conclusion. Not a dashboard, not a widget.

   You opened your laptop; a dispatch from the night crew is waiting. The Umbra
   Score is the hero — a single enormous typographic number, never a dial. Below
   it, the five units file what each of them did overnight, grounded in real refs.

   Discipline that separates this from the Operations Board:
   • The board PULSES (live, working). The report is STILL (filed, done) — no
     live dots. Motion is the arrival only: the score rises, the dispatch
     assembles, then it holds.
   • Monochrome-first. Colour is only status, in the same language as the Night
     Shift Log above: rose = risk found, amber = root cause, teal = resolved.
   • The eclipse resolves to dawn — a subtle first-light glow from the top edge.
----------------------------------------------------------------------------- */

const RISK = "#fb7185";
const AMBER = "#fbbf24";
const RESOLVE = "#5eead4";
const FOG = "#8b90a6";

// Each entry is a filed action — an attribution line (unit + state arc) and a
// past-tense sentence with grounded refs — not a row in a data table.
type Dispatch = { letter: string; unit: string; from: string; to: string; toColor: string; line: ReactNode };

const Ref = ({ children }: { children: ReactNode }) => <span className="text-cloud">{children}</span>;

const DISPATCH: Dispatch[] = [
  {
    letter: "W", unit: "Watchman", from: "detected", to: "resolved", toColor: RESOLVE,
    line: (
      <>Flagged <Ref>CVE-2024-29041</Ref> in <Ref>express@4.17.1</Ref> — <span style={{ color: RISK }}>HIGH</span>. Patch to <Ref>4.19.2</Ref> prepared for review.</>
    ),
  },
  {
    letter: "D", unit: "Detective", from: "traced", to: "root cause", toColor: AMBER,
    line: (
      <>Followed git blame through the history to <Ref>commit a9c31f</Ref> — the origin of the incident.</>
    ),
  },
  {
    letter: "R", unit: "Reviewer", from: "reviewed", to: "cleared", toColor: FOG,
    line: (
      <>Scored <Ref>PR #128</Ref> — blast-radius low. Safe to merge.</>
    ),
  },
  {
    letter: "J", unit: "Janitor", from: "swept", to: "drafted", toColor: FOG,
    line: (
      <>Removed <Ref>4 dead exports</Ref> from <Ref>utils/legacy.ts</Ref>. Cleanup PR drafted.</>
    ),
  },
  {
    letter: "A", unit: "Ask Umbra", from: "asked", to: "answered", toColor: FOG,
    line: (
      <>Answered <Ref>3 questions</Ref>, each grounded to a real reference — <Ref>router.js:22</Ref>.</>
    ),
  },
];

export function MorningReport() {
  const reduce = useReducedMotion();

  return (
    <GlowCard glow="rgba(251,191,36,0.12)" className="relative overflow-hidden">
      {/* First light — the eclipse ending. Warm dawn from the top edge only. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-48"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(251,191,36,0.11), rgba(251,191,36,0.03) 42%, transparent 72%)" }}
        initial={reduce ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.5, ease: EASE }}
      />

      <div className="relative p-7 sm:p-10">
        {/* Greeting — the crew addresses you. */}
        <div className="flex items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-fog">
          <span>Good morning</span>
          <span className="tabular-nums text-fog/70">06:00 · night shift #001</span>
        </div>
        <div className="mt-4 h-px w-full" style={{ background: "linear-gradient(90deg, rgba(251,191,36,0.35), transparent 60%)" }} />

        {/* Hero — the Umbra Score as one enormous number. No dial, no chart. */}
        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-fog">Umbra Score</div>
            <div className="mt-1 flex items-end gap-3">
              <span className="block overflow-hidden leading-[0.8]">
                <motion.span
                  className="block font-serif text-[clamp(96px,17vw,180px)] leading-[0.8] tracking-[-0.04em] text-cloud"
                  initial={reduce ? false : { y: "112%" }}
                  whileInView={{ y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.95, ease: EASE }}
                >
                  78
                </motion.span>
              </span>
              <span className="mb-3 font-mono text-[13px] text-fog/60">/ 100</span>
            </div>
          </div>

          <div className="max-w-[34ch] sm:pb-3 sm:text-right">
            <div className="font-serif text-[clamp(22px,2.6vw,30px)] leading-tight" style={{ color: AMBER }}>
              Needs attention
            </div>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-fog">
              Two fixable risks — both with patches already drafted and waiting for your review. Nothing was merged.
            </p>
            <div className="mt-3 font-mono text-[11px] tracking-[0.04em] text-fog/80 sm:ml-auto">
              3 findings · 1 root cause · 2 fixes proposed
            </div>
          </div>
        </div>

        {/* The night's work — one line per unit. Filed, still, grounded. */}
        <div className="mt-9 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fog/70">
          <span className="h-px w-6" style={{ background: "var(--surface-border)" }} />
          The night&rsquo;s work
        </div>

        <motion.div
          className="mt-2 divide-y divide-[color:var(--surface-border)]"
          initial={reduce ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger(0.15, 0.09)}
        >
          {DISPATCH.map((d) => (
            <motion.div key={d.unit} variants={fadeUp} className="py-4">
              {/* Attribution — who filed this, and the state it moved through. */}
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--surface-border)] font-mono text-[12px] font-semibold text-fog">
                  {d.letter}
                </span>
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-cloud">{d.unit}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fog">
                  {d.from} <span style={{ color: d.toColor }}>→ {d.to}</span>
                </span>
              </div>
              {/* The filed action, grounded in real refs. */}
              <p className="mt-2 pl-11 font-mono text-[12.5px] leading-relaxed text-fog">{d.line}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Signature — filed by the crew, honest provenance. */}
        <div className="mt-7 border-t border-[color:var(--surface-border)] pt-4 font-mono text-[10px] leading-relaxed text-fog/70">
          Filed 06:00 by the night crew · grounded in OSV + git history · never fabricated · reasoned by OpenAI
        </div>
      </div>
    </GlowCard>
  );
}
