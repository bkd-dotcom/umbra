"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/ui/reveal";
import { GlowCard } from "@/components/ui/glow-card";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";

/* -----------------------------------------------------------------------------
   Agent Admission — the differentiator, told first (landing section).

   The crowded category is "AI finds a CVE and opens a PR." Umbra's defensible
   wedge is one layer up: it decides whether an agent should be ALLOWED to make a
   change at all, grants only the authority the run EARNS, and seals the decision
   in an independently verifiable receipt. This section leads the page so the idea
   reads as governed autonomy, not "another review bot."

   (Distinct from the dashboard's interactive `AgentAdmission` panel — this is the
   marketing/explainer surface on the landing page.)
----------------------------------------------------------------------------- */

const LADDER: { key: string; label: string; detail: string; color: string }[] = [
  { key: "contract", label: "Change contract", detail: "allowed paths · diff budget · required checks — evaluated outside the model, fails closed", color: "#22d3ee" },
  { key: "trust", label: "Trust boundary", detail: "repo text is untrusted; flagged injection in README / AGENTS.md is redacted on disk before the run (the quarantine, not perfect detection, is the guarantee)", color: "#5eead4" },
  { key: "checks", label: "Required checks", detail: "run sandboxed (bubblewrap / unshare) with a secret-stripped env — a non-profile command is refused", color: "#38bdf8" },
  { key: "verifier", label: "Independent verifier", detail: "a separate deterministic pass the writer can't bypass — re-checks scope, secrets, and that the bump actually clears the CVE", color: "#a78bfa" },
  { key: "authority", label: "Earned authority", detail: "L0 observe · L1 analyze · L2 branch-PR — revocable, bound to the exact run, 7-day expiry", color: "#fbbf24" },
  { key: "receipt", label: "Signed receipt", detail: "the whole chain sealed in an Ed25519 envelope, verifiable against Umbra's pinned key (a dev key in the public demo, labelled as such)", color: "#f472b6" },
];

const COMPARISON: { them: string; they: string; us: string }[] = [
  { them: "Review bots (CodeRabbit, Greptile, Qodo)", they: "comment on the change — advisory", us: "gate the agent's authority to write — a decision, fail-closed" },
  { them: "Dependency bots (Dependabot, Snyk)", they: "open the bump PR", us: "independently verify the bump actually clears the cited CVE" },
  { them: "The coding agent itself (Codex, Devin)", they: "trusts its own output", us: "a verifier the writer can't bypass, plus a signed receipt" },
];

export function AdmissionSection() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(-1);
  const [inView, setInView] = useState(false);

  // Once the ladder scrolls into view, sweep an "active gate" through the six
  // rungs on a loop so the pipeline reads as *executing*, not a static diagram.
  // Disabled under reduced-motion.
  useEffect(() => {
    if (reduce || !inView) return;
    let i = 0;
    setActive(0);
    const t = setInterval(() => {
      i = (i + 1) % (LADDER.length + 2); // +2 = a brief "settled" pause after the last
      setActive(i >= LADDER.length ? -1 : i);
    }, 900);
    return () => clearInterval(t);
  }, [reduce, inView]);

  return (
    <section id="admission" data-chapter="Agent Admission" className="chapter relative isolate py-[clamp(48px,8vw,128px)]">
      <Reveal>
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-fog">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" /> The Agent Admission Test
        </p>
        <h2 className="mt-3 max-w-[24ch] font-serif text-[clamp(30px,4.6vw,56px)] leading-[1.02] tracking-[-0.03em]">
          Test the agent <span className="text-cyan">before</span> you trust it with your repo.
        </h2>
        <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-fog">
          &ldquo;AI finds a CVE and opens a PR&rdquo; is a crowded category. Umbra&rsquo;s wedge is one layer up: one
          governed, deterministic pipeline runs <span className="text-cloud">before any PR</span> and decides whether a
          change is even allowed — then grants only the authority it earns.
        </p>
      </Reveal>

      {/* The trust ladder — six gates, left to right. A sweeping "active gate"
          makes it read as a pipeline executing. This is the 10-second read. */}
      <motion.div
        className="mt-9"
        onViewportEnter={() => setInView(true)}
        viewport={{ once: true, margin: "-10%" }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {LADDER.map((step, i) => {
            const on = active === i;
            const done = active === -1 || active > i;
            return (
              <motion.div
                key={step.key}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-10%" }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="relative flex flex-col overflow-hidden rounded-xl border p-4 transition-colors duration-300"
                style={{
                  borderColor: on ? `${step.color}aa` : "var(--surface-border)",
                  background: on ? `${step.color}12` : "var(--surface)",
                  boxShadow: on ? `0 0 24px -8px ${step.color}` : "none",
                }}
              >
                {/* top progress bar that fills while this gate is active */}
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 h-[2px]"
                    style={{ background: step.color }}
                    initial={{ width: "0%" }}
                    animate={{ width: on ? "100%" : done ? "100%" : "0%", opacity: on ? 1 : done ? 0.35 : 0 }}
                    transition={{ duration: on ? 0.85 : 0.3, ease: "linear" }}
                  />
                )}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tabular-nums text-fog/50">0{i + 1}</span>
                  <span
                    className="grid h-6 w-6 place-items-center rounded-md border font-mono text-[11px] transition-transform duration-300"
                    style={{ color: step.color, borderColor: `${step.color}55`, background: `${step.color}12`, transform: on ? "scale(1.12)" : "scale(1)" }}
                  >
                    ✓
                  </span>
                </div>
                <div className="mt-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.08em] text-cloud">{step.label}</div>
                <div className="mt-1.5 text-[12px] leading-relaxed text-fog">{step.detail}</div>
                {i < LADDER.length - 1 && (
                  <span aria-hidden className="pointer-events-none absolute -right-3 top-1/2 hidden -translate-y-1/2 font-mono text-fog/40 lg:block">→</span>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Two headline objects: the earned-authority passport (the component nobody
          else ships) + the real caught-bug (demonstrated impact, not a promise). */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Reveal>
          <GlowCard glow="#fbbf2422" className="h-full p-6 sm:p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber">Earned-authority passport</p>
            <h3 className="mt-2 font-serif text-[22px] leading-tight tracking-[-0.01em]">Authority is earned per run, and revocable.</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {[["L0", "observe"], ["L1", "analyze"], ["L2", "branch-PR"]].map(([lvl, name]) => (
                <span key={lvl} className="flex items-center gap-1.5 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2.5 py-1.5 font-mono text-[11px]">
                  <span className="text-amber">{lvl}</span>
                  <span className="text-fog">{name}</span>
                </span>
              ))}
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-fog">
              Bound to the exact run (receipt hash, base commit, executor + Codex config hash), 7-day expiry.
              A server-side <span className="text-cloud">Emergency Brake</span> forces Level 0 — and the PR route
              refuses to open a PR for a repo that&rsquo;s revoked, below L2, or expired. <span className="text-cloud">auto_merge is false at every level.</span>
            </p>
          </GlowCard>
        </Reveal>

        <Reveal>
          <GlowCard glow="#fb718522" className="h-full p-6 sm:p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--sev-critical)]">Caught in the act</p>
            <h3 className="mt-2 font-serif text-[22px] leading-tight tracking-[-0.01em]">A fix that didn&rsquo;t actually fix it.</h3>
            <p className="mt-4 text-[13px] leading-relaxed text-fog">
              Umbra once opened a bump — <span className="font-mono text-cloud">next 14.2.5 → 14.2.7</span> &ldquo;to remediate GHSA-h25m-26qc-wcjf.&rdquo;
              But <span className="font-mono text-cloud">14.2.7</span> is <span className="text-[color:var(--sev-critical)]">still inside</span> that advisory&rsquo;s vulnerable range.
              The independent verifier is now <span className="text-cloud">CVE-aware</span>: it reads the produced manifest and confirms the bump
              actually clears the named advisory (real fix: <span className="font-mono text-teal">15.0.8</span>) — and regenerates the lockfile.
            </p>
            <p className="mt-3 font-mono text-[11.5px] text-teal">Umbra never claims a remediation it can&rsquo;t stand behind.</p>
          </GlowCard>
        </Reveal>
      </div>

      {/* Why this isn't just OPA + Sigstore + a review bot — answered before asked. */}
      <Reveal className="mt-6">
        <div className="overflow-hidden rounded-2xl border border-[color:var(--surface-border)]">
          <div className="border-b border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-5 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog">Why it isn&rsquo;t just glue over existing tools</p>
          </div>
          <div className="divide-y divide-[color:var(--surface-border)]">
            {COMPARISON.map((row) => (
              <div key={row.them} className="grid gap-1 px-5 py-4 sm:grid-cols-[1fr_1fr] sm:gap-6">
                <div>
                  <div className="text-[13px] font-medium text-cloud">{row.them}</div>
                  <div className="mt-0.5 font-mono text-[11.5px] text-fog">{row.they}</div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-mono text-[11px] text-cyan">Umbra</span>
                  <span className="text-[12.5px] leading-relaxed text-cloud/85">{row.us}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Why now — turns "anticipatory" into "the industry is already alarmed." */}
      <Reveal className="mt-6">
        <div className="rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[62ch] text-[13px] leading-relaxed text-fog">
              <span className="text-cloud">Why now:</span> teams are adopting coding agents (Codex, Claude Code, Devin)
              across their repos today — and the two risks Umbra is built to contain are named in the
              <span className="text-cloud"> OWASP Top 10 for LLM Apps (2025)</span>. There is no repeatable way to
              <span className="text-cloud"> prove</span> an agent stayed in bounds. Umbra is that proof.
            </p>
            <HoverBorderGradient href="/dashboard?proof=calhacks" ariaLabel="Run the Agent Admission demo — no sign-in" className="shrink-0 px-6 py-3 text-sm font-semibold whitespace-nowrap">
              Run the Admission demo <span className="text-cyan">→</span>
            </HoverBorderGradient>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[color:var(--surface-border)] pt-3">
            <a
              href="https://genai.owasp.org/llmrisk/llm01-prompt-injection/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2.5 py-1.5 font-mono text-[10.5px] text-fog transition-colors hover:border-cyan/40 hover:text-cloud"
            >
              <span className="text-cyan">LLM01</span> Prompt Injection <span className="text-fog/40">→ our trust boundary</span> ↗
            </a>
            <a
              href="https://genai.owasp.org/llmrisk/llm062025-excessive-agency/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)] px-2.5 py-1.5 font-mono text-[10.5px] text-fog transition-colors hover:border-amber/40 hover:text-cloud"
            >
              <span className="text-amber">LLM06</span> Excessive Agency <span className="text-fog/40">→ our earned authority</span> ↗
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
