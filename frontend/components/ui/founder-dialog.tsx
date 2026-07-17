"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { GitHubIcon } from "./icons";

/* -----------------------------------------------------------------------------
   Founder dialog — the "operator reveal".

   The resting card shows a dithered avatar (the machine's view of the operator);
   opening this dialog resolves it to the real photo — the human behind the crew.
   Aceternity-flavoured: a spotlight glow behind a ringed portrait, a serif motto
   pull-quote, the motivation, then the socials. Matches SignInDialog's motion so
   the whole site feels like one product.
----------------------------------------------------------------------------- */

const MOTTO = "Give engineers their mornings back.";

const MOTIVATION =
  "I'm a senior at Penn State studying computer science. Across every internship and late-night on-call, I kept seeing the same pattern: the work that actually breaks things — a CVE landing at 2am, a regression buried in git history, the tech debt nobody has time to clear — always happens in the hours no one is watching. Umbra is my answer. I built it solo for OpenAI Build Week to see how far one engineer and Codex could go: an autonomous crew that works while you sleep, so your team wakes up to answers instead of alarms.";

export function FounderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal
            aria-label="About the operator, Binay Dalai"
            className="relative w-[min(540px,100%)] overflow-hidden rounded-3xl border border-[color:var(--surface-border)] bg-ink-2/95 p-8 shadow-2xl"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.38, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Spotlight glow — the corona behind the operator. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-24 h-56 opacity-70"
              style={{ background: "radial-gradient(50% 100% at 50% 0%, rgba(34,211,238,0.22), rgba(34,211,238,0) 70%)" }}
            />

            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-[color:var(--surface-border)] text-fog transition-colors hover:border-cyan/50 hover:text-cloud"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>

            <div className="relative flex flex-col items-center text-center">
              {/* Real photo — the reveal, no dither. Ringed and glowing. */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}
                className="relative h-32 w-32"
              >
                <div className="absolute -inset-1 rounded-full bg-[conic-gradient(from_180deg,rgba(34,211,238,0.5),rgba(167,139,250,0.5),rgba(94,234,212,0.5),rgba(34,211,238,0.5))] blur-md" aria-hidden />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/founder.jpg"
                  alt="Binay Dalai"
                  className="relative h-32 w-32 rounded-full border border-[color:var(--surface-border)] object-cover"
                />
              </motion.div>

              <h3 className="mt-5 font-serif text-2xl leading-none">Binay Dalai</h3>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
                Senior @ Penn State · B.S. Computer Science
              </p>

              <blockquote className="mt-5 font-serif text-[19px] italic leading-snug text-cloud">
                &ldquo;{MOTTO}&rdquo;
              </blockquote>

              <p className="mt-4 max-w-[46ch] text-[13.5px] leading-relaxed text-fog">{MOTIVATION}</p>

              <div className="mt-6">
                <FounderSocials />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The operator's links — reused by the resting card's trigger and the dialog. */
export function FounderSocials() {
  return (
    <div className="flex items-center gap-2">
      <FounderLink href="https://github.com/bkd-dotcom" label="GitHub">
        <GitHubIcon className="h-4 w-4" />
      </FounderLink>
      <FounderLink href="https://www.linkedin.com/in/binay-dalai/" label="LinkedIn">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0z" />
        </svg>
      </FounderLink>
      <FounderLink href="mailto:binaydalai2024@gmail.com" label="Email">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </FounderLink>
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
