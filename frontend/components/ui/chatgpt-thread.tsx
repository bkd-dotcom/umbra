"use client";

import { motion, useReducedMotion } from "motion/react";
import { EASE } from "@/lib/motion";

/* A ChatGPT-style conversation showing the Umbra GPT Action answering, grounded,
   inside the chat surface — the section's whole point ("not trapped in a
   dashboard"). Purely presentational; the content mirrors the real action shapes
   (scanRepo / investigateIncident / askUmbra) and keeps the honesty framing.
   Theme-aware via site tokens; reduced-motion → renders fully settled. */

type Turn =
  | { role: "user"; text: string }
  | { role: "umbra"; action: string; body: React.ReactNode };

const THREAD: Turn[] = [
  { role: "user", text: "Scan github.com/expressjs/express for security risks." },
  {
    role: "umbra",
    action: "scanRepo",
    body: (
      <>
        <p className="text-cloud">
          <span className="font-serif text-[19px] text-cloud">Umbra Score 78</span>
          <span className="text-fog">/100 · </span>
          <span className="text-amber">Needs attention</span>
        </p>
        <div className="mt-3 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-3 font-mono text-[12px] leading-relaxed">
          <span className="text-[color:var(--sev-critical)]">● HIGH</span>{" "}
          <span className="text-cloud">express@4.17.1</span> — CVE-2024-29041 · open redirect
          <br />
          <span className="text-teal">→ fix: upgrade to 4.19.2</span>{" "}
          <span className="text-fog">(PR-ready diff · branch only)</span>
        </div>
        <p className="mt-2.5 text-[12.5px] text-fog">
          Grounded in <span className="text-cloud">OSV.dev</span> advisories. Nothing was merged.
        </p>
      </>
    ),
  },
  { role: "user", text: "Why did /checkout start returning 500s?" },
  {
    role: "umbra",
    action: "investigateIncident",
    body: (
      <>
        <p className="text-cloud">
          Traced to one commit in real git history — not guessed:
        </p>
        <div className="mt-3 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-3.5 py-3 font-mono text-[12px] leading-relaxed">
          <span className="text-amber">commit a9c31f</span> — “refactor cart totals”
          <br />
          <span className="text-fog">3 days ago · @dev · touches cart/totals.js:42</span>
        </div>
      </>
    ),
  },
];

export function ChatGptThread() {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] shadow-[var(--shadow-card)] backdrop-blur-xl">
      {/* window chrome */}
      <div className="flex items-center gap-2.5 border-b border-[color:var(--surface-border)] px-4 py-3">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-teal/70" />
        </span>
        <span className="ml-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
          <span className="grid h-4 w-4 place-items-center rounded-full" style={{ background: "#10a37f" }}>
            <span className="text-[9px] text-white">◐</span>
          </span>
          ChatGPT · Umbra GPT
        </span>
        <span className="ml-auto rounded-full border border-[color:#10a37f55] bg-[#10a37f14] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#34d399]">
          public · no sign-in
        </span>
      </div>

      {/* messages */}
      <div className="flex flex-col divide-y divide-[color:var(--surface-border)]">
        {THREAD.map((turn, i) => (
          <motion.div
            key={i}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : i * 0.12 }}
            className={`flex gap-3.5 px-5 py-4 ${turn.role === "user" ? "bg-transparent" : "bg-[color:var(--surface-2)]"}`}
          >
            {/* avatar */}
            {turn.role === "user" ? (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] font-mono text-[11px] text-fog">
                you
              </span>
            ) : (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ background: "#10a37f" }}>
                <span className="text-[13px]">◐</span>
              </span>
            )}
            <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
              {turn.role === "user" ? (
                <p className="text-cloud">{turn.text}</p>
              ) : (
                <>
                  {turn.body}
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2 py-1 font-mono text-[10px] text-fog">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#10a37f" }} />
                    via <span className="text-cloud">{turn.action}</span> action
                  </div>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* composer (decorative) */}
      <div className="flex items-center gap-3 border-t border-[color:var(--surface-border)] px-5 py-3.5">
        <div className="flex-1 truncate rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-4 py-2.5 font-mono text-[12px] text-fog/60">
          Ask about any repo, incident, or file…
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: "#10a37f" }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 11l5-5 5 5M12 6v12" />
          </svg>
        </span>
      </div>
    </div>
  );
}
