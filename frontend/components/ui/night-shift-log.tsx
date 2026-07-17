"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { EASE } from "@/lib/motion";

/* -----------------------------------------------------------------------------
   Night Shift Log — not a "how it works" timeline. A log.

   The vertical beam is the night itself; it fills as you scroll (Umbra moving
   through the repository, station to station). Events hang off the beam as
   engineering-log entries — no floating cards. Each event is neutral until the
   beam reaches it, then it ignites in its ONE status colour: rose = risk found,
   amber = root cause, teal = resolved. The page becomes a visual language.

   Aceternity influence — tracing beam, scroll reveal, restrained glow — without
   copying an effect. Reduced-motion: the beam is fully lit and every entry is
   already logged.
----------------------------------------------------------------------------- */

const FOG = "#8b90a6";
const GRAD = "linear-gradient(180deg, #22d3ee 0%, #a78bfa 52%, #5eead4 100%)";

type LogEntry = {
  time: string;
  unit: string;
  head: string;
  detail: string;
  color: string;
  tag: string;
};

const EVENTS: LogEntry[] = [
  { time: "02:00", unit: "System online", head: "Repository connected", detail: "5 units dispatched into the dark", color: "#22d3ee", tag: "online" },
  { time: "02:07", unit: "Watchman", head: "Dependency exposure detected", detail: "express@4.17.1 · CVE-2024-29041", color: "#fb7185", tag: "high risk" },
  { time: "02:09", unit: "Detective", head: "Root cause isolated", detail: "reasoned via git blame → commit a9c31f", color: "#fbbf24", tag: "root cause" },
  { time: "02:12", unit: "Reviewer", head: "Fix validated", detail: "blast-radius low · safe to merge", color: "#a78bfa", tag: "reviewed" },
  { time: "06:00", unit: "Morning report", head: "Ready for developer review", detail: "Umbra Score 78 · 2 fixes proposed", color: "#5eead4", tag: "resolved" },
];

export function NightShiftLog() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.72", "end 0.38"] });
  const fillH = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <div ref={ref} className="relative">
      {/* Log header — reads as the top of a shift record, not a section title. */}
      <div className="mb-8 flex items-center gap-3 pl-9 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" />
        Night shift log
        <span className="text-fog/40">·</span>
        <span className="tabular-nums text-fog/70">02:00 → 06:00</span>
      </div>

      {/* The beam — the night. Track behind; scroll-linked fill in front. */}
      <div className="pointer-events-none absolute left-[7px] top-[54px] bottom-6 w-px">
        <div className="absolute inset-0 bg-[color:var(--surface-border)]" />
        {reduce ? (
          <div className="absolute inset-x-0 top-0 h-full w-px" style={{ background: GRAD }} />
        ) : (
          <motion.div className="absolute inset-x-0 top-0 w-px" style={{ height: fillH, background: GRAD }}>
            {/* leading edge — the cursor of the night, moving through the repo */}
            <span className="absolute -bottom-[3px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-cloud shadow-[0_0_12px_4px_rgba(34,211,238,0.5)]" />
          </motion.div>
        )}
      </div>

      {/* Entries — hung off the beam. */}
      <div className="flex flex-col gap-11 sm:gap-14">
        {EVENTS.map((e) => (
          <LogEventRow key={e.time + e.unit} e={e} reduce={!!reduce} />
        ))}
      </div>
    </div>
  );
}

function LogEventRow({ e, reduce }: { e: LogEntry; reduce: boolean }) {
  const [on, setOn] = useState(reduce);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      onViewportEnter={() => setOn(true)}
      viewport={{ once: true, margin: "-45% 0px -45% 0px" }}
      transition={{ duration: 0.55, ease: EASE }}
      className="relative pl-9"
    >
      {/* Node — sits on the beam. Neutral until the night reaches it. */}
      <span className="absolute left-0 top-1 grid h-3.5 w-3.5 place-items-center">
        {on ? (
          <>
            <span
              className="absolute h-3.5 w-3.5 rounded-full transition-opacity duration-500"
              style={{ background: e.color, opacity: 0.22 }}
            />
            <span
              className="h-2 w-2 rounded-full transition-all duration-500"
              style={{ background: e.color, boxShadow: `0 0 10px ${e.color}` }}
            />
          </>
        ) : (
          <span className="h-2 w-2 rounded-full border" style={{ borderColor: FOG }} />
        )}
      </span>

      {/* Meta row — timestamp · unit callsign · status tag. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-[12px] tabular-nums tracking-[0.06em] transition-colors duration-500" style={{ color: on ? e.color : FOG }}>
          {e.time}
        </span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cloud">{e.unit}</span>
        <span
          className="rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-all duration-500"
          style={
            on
              ? { color: e.color, borderColor: `${e.color}55`, background: `${e.color}12` }
              : { color: FOG, borderColor: "var(--surface-border)", background: "transparent" }
          }
        >
          {e.tag}
        </span>
      </div>

      {/* Headline + grounded detail. */}
      <h3 className="mt-2 font-serif text-[clamp(20px,2.4vw,28px)] leading-[1.1] tracking-[-0.02em] text-cloud">{e.head}</h3>
      <p className="mt-1.5 font-mono text-[12px] leading-relaxed text-fog">{e.detail}</p>
    </motion.div>
  );
}
