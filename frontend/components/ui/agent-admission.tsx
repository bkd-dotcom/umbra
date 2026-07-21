"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { GlowCard } from "@/components/ui/glow-card";
import { SeverityChip } from "@/components/ui/severity-chip";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// --- Types mirroring backend AdmissionReport.to_public() + receipt envelope ---
type ContractCheck = { name: string; passed: boolean; detail: string };
type ContractResult = { status: string; passed: boolean; checks: ContractCheck[]; violations: string[]; changed_files: string[]; contract_hash: string };
type Quarantine = { source: string; line: number; category: string; excerpt: string; pattern: string };
type TrustBoundary = { clean: boolean; quarantined_count: number; scanned_sources: string[]; findings: Quarantine[]; note: string };
type VerifierCheck = { name: string; status: "pass" | "fail" | "unavailable"; detail: string; blocking: boolean };
type Verifier = { status: "reviewable" | "blocked"; blocked: boolean; evidence_completeness: number; changed_files: string[]; secrets_found: number; checks: VerifierCheck[] };
type ProposedChange = { package?: string; current?: string; fixed?: string; cve?: string | null; manifest?: string; ecosystem?: string };
type CheckRowT = { command: string; status: "passed" | "failed" | "blocked" | "unavailable"; exit_code: number | null; output_hash: string | null; detail: string };
type ChecksT = { ran: boolean; all_passed: boolean; enforcement: string; results: CheckRowT[] };
type DiagnosisT = { status: string; summary: string; per_check?: { command: string; baseline: string; post: string; verdict: string }[] };
type CodexConfig = { provider: string; model: string; reasoning_effort: string; config_hash: string; tests_passed_self_report: boolean | null };
type ReceiptEnvelope = { receipt: Record<string, unknown>; canonical_hash: string; signature: string; public_key: string; algorithm: string; key_ephemeral: boolean };
type AdmissionReport = {
  repo: string;
  task_type: string;
  executor: string;
  contract: { task_type: string; allowed_paths: string[]; forbidden_paths: string[]; max_files_changed: number; required_checks: string[]; network: string; source: string; policy_owner?: string; policy_version?: string; policy_approved_at?: string; policy_status?: { status: string; owner: string | null; version: string | null; approved_at: string | null; note: string } };
  contract_result: ContractResult;
  trust_boundary: TrustBoundary;
  verifier: Verifier | null;
  checks: ChecksT | null;
  baseline_checks: ChecksT | null;
  check_diagnosis: DiagnosisT | null;
  model_identity?: { executor: string; codex_cli_version: string | null; model_configured: string | null; model_resolved: string | null; model_evidence: string; reasoning_effort?: string; note?: string } | null;
  context_manifest?: { trusted_policy: string[]; included_evidence: { source: string; class: string; treatment: string }[]; excluded: string[]; redaction_count: number; excluded_categories: string[]; invariant: string } | null;
  changed_files: string[];
  proposed_change: ProposedChange | null;
  authority_level: number;
  authority: string;
  authority_label: string;
  outcome: string;
  blocked_reason: string | null;
  providers: Record<string, string>;
  base_commit: string | null;
  diff_hash: string | null;
  advisory_hash: string | null;
  codex_config: CodexConfig | null;
  context_quarantined: number;
  auto_merge: boolean;
  human_review_required: boolean;
  receipt?: ReceiptEnvelope;
};

// The backend-declared public-repo catalog (single source of truth for what's runnable).
type CatalogEntry = {
  repo_id: string;
  repo_url: string;
  name: string;
  mode: "captured" | "deterministic_live" | "founder_codex" | "unavailable";
  available: boolean;
  disabled_reason: string | null;
  consumes_quota: boolean;
  captured_proof_id: string | null;
  captured_at?: string;
};
type PublicCatalog = {
  entries: CatalogEntry[];
  limits: { deterministic_per_ip_per_hour: number; deterministic_global_per_hour: number; codex_per_ip_per_day: number; codex_global_per_day: number };
  codex_available: boolean;
  live_enabled: boolean;
  codex_remaining_for_you?: number;
  codex_remaining_global?: number;
};

const FIXTURES = [
  { id: "permitted-dependency-fix", label: "Permitted fix", hint: "in-scope bump → earns L2" },
  { id: "adversarial-readme-injection", label: "Adversarial README", hint: "prompt-injection quarantined" },
  { id: "forbidden-scope-violation", label: "Forbidden scope", hint: "out-of-bounds → blocked L0" },
  { id: "failing-check-caps-authority", label: "Failing check", hint: "pre-existing failure → cap L1" },
  { id: "regression-detected", label: "Regression", hint: "change broke a green check → cap L1" },
];

// Earned-authority ladder. The run lights up the rung it earned; nothing above is granted.
const LADDER = [
  { level: 0, key: "observe", label: "Observe", detail: "No change may be proposed" },
  { level: 1, key: "analyze", label: "Analyze", detail: "Findings & explanations only" },
  { level: 2, key: "branch_pr", label: "Branch PR", detail: "May prepare a branch-only PR — human merges" },
];

function Chip({ children, tone = "fog" }: { children: React.ReactNode; tone?: "teal" | "amber" | "rose" | "fog" | "violet" }) {
  const cls = {
    teal: "text-teal border-teal/40 bg-teal/10",
    amber: "text-amber border-amber/40 bg-amber/10",
    rose: "text-[color:var(--sev-critical)] border-rose-400/40 bg-rose-400/10",
    violet: "text-violet border-violet/40 bg-violet/10",
    fog: "text-fog border-[color:var(--surface-border)] bg-[color:var(--surface-2)]",
  }[tone];
  return <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${cls}`}>{children}</span>;
}

function CheckRow({ ok, name, detail, muted }: { ok: boolean | null; name: string; detail: string; muted?: boolean }) {
  const glyph = ok === null ? "○" : ok ? "✓" : "✗";
  const color = ok === null ? "text-fog/50" : ok ? "text-teal" : "text-[color:var(--sev-critical)]";
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={`mt-0.5 font-mono text-[12px] ${color}`}>{glyph}</span>
      <div className="min-w-0">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-cloud">{name.replace(/_/g, " ")}</span>
        <p className={`text-[12px] leading-snug ${muted ? "text-fog/60" : "text-fog"}`}>{detail}</p>
      </div>
    </div>
  );
}

export function AgentAdmission({ repo = "", signedIn = false, founder = false, onOpenCaptured }: { repo?: string; signedIn?: boolean; founder?: boolean; onOpenCaptured?: (proofId: string) => void }) {
  const [fixture, setFixture] = useState(FIXTURES[0].id);
  const [running, setRunning] = useState(false);
  const [runKind, setRunKind] = useState<"live" | "fixture" | null>(null);
  const [showEvals, setShowEvals] = useState(false);
  const [report, setReport] = useState<AdmissionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptCheck, setReceiptCheck] = useState<string | null>(null);
  const [braked, setBraked] = useState(false);
  const [brakeNote, setBrakeNote] = useState<string | null>(null);
  // The backend-declared catalog — the ONE source of runnable public repos. The UI
  // renders only what the backend marks available, so no button can 404/400.
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/admit/public-live/repos`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: PublicCatalog | null) => { if (!cancelled && c) setCatalog(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const repoLabel = repo.replace(/^https?:\/\//, "").replace(/^github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const canRunLive = !!repoLabel && signedIn;

  const runLive = useCallback(async () => {
    if (!repoLabel) return;
    setRunning(true); setRunKind("live"); setError(null); setReport(null); setReceiptCheck(null); setBraked(false); setBrakeNote(null);
    const repoUrl = repoLabel.startsWith("http") ? repoLabel : `https://github.com/${repoLabel}`;
    try {
      const res = await fetch(`${API}/api/admit`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_url: repoUrl }) });
      if (res.status === 503) throw new Error("Live admission is disabled on this server (set UMBRA_ENABLE_LIVE_REPOS). Try a reproducible public eval below.");
      if (!res.ok) throw new Error(`Admission failed (${res.status})`);
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Admission request failed.");
    } finally {
      setRunning(false);
    }
  }, [repoLabel]);

  const run = useCallback(async (fixtureId: string) => {
    setRunning(true); setRunKind("fixture"); setError(null); setReport(null); setReceiptCheck(null); setBraked(false); setBrakeNote(null);
    try {
      const res = await fetch(`${API}/api/admit`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ fixture: fixtureId }) });
      if (!res.ok) throw new Error(`Admission failed (${res.status})`);
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Admission request failed.");
    } finally {
      setRunning(false);
    }
  }, []);

  // Judge-triggerable LIVE run on an allowlisted public repo — no sign-in,
  // rate-limited server-side. A real clone + live OSV; the executor is a
  // deterministic policy evaluation (never spends Codex credits), labelled honestly.
  const runPublicLive = useCallback(async (repoUrl: string, codex = false) => {
    if (running) return; // prevent double-clicks / duplicate in-flight requests
    setRunning(true); setRunKind("live"); setError(null); setReport(null); setReceiptCheck(null); setBraked(false); setBrakeNote(null);
    try {
      const res = await fetch(`${API}/api/admit/public-live`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo_url: repoUrl, codex }) });
      if (res.status === 429 || res.status === 409) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "That live path is busy right now — open a verified captured run instead (instant, unlimited)."); }
      if (res.status === 503) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "Live repos are disabled on this server. Open a verified captured run instead."); }
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Live admission failed (${res.status})`); }
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Live admission request failed.");
    } finally {
      setRunning(false);
      // Refresh remaining Codex allowance after a genuine-Codex attempt.
      if (codex) fetch(`${API}/api/admit/public-live/repos`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((c) => c && setCatalog(c)).catch(() => {});
    }
  }, [running]);

  const brake = useCallback(async (repoArg: string) => {
    setBraked(true);
    // Real server-side revoke: durably forces this repo's passport to Level 0 so a
    // subsequent /api/my/pr is blocked. Requires a signed-in session; on the public
    // fixture preview (no auth) the call is rejected and we say so honestly.
    try {
      const res = await fetch(`${API}/api/my/authority/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ repo: repoArg, reason: "Emergency brake from dashboard" }) });
      if (res.ok) setBrakeNote("Authority revoked server-side — a PR for this repo is now blocked until re-admission.");
      else if (res.status === 401) setBrakeNote("Sign in to persist a revocation server-side. (Public eval preview revokes the view only.)");
      else setBrakeNote(`Revoke returned ${res.status}.`);
    } catch {
      setBrakeNote("Revoke request could not reach the API.");
    }
  }, []);

  const verifyReceipt = useCallback(async (envelope: ReceiptEnvelope) => {
    setReceiptCheck("checking");
    try {
      const res = await fetch(`${API}/api/receipt/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ envelope }) });
      const body = await res.json();
      setReceiptCheck(body.verified ? "verified" : "invalid");
    } catch {
      setReceiptCheck("error");
    }
  }, []);

  const tb = report?.trust_boundary;
  const cr = report?.contract_result;
  const vf = report?.verifier;
  const effectiveLevel = braked ? 0 : report?.authority_level ?? -1;

  return (
    <GlowCard glow="rgba(124,58,237,0.14)" className="p-6 md:p-7">
      {/* Header + the one question this surface answers */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Agent admission</p>
          <h3 className="mt-1 text-lg text-cloud">Can this agent be trusted in this repository?</h3>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-fog">
            Umbra runs a bounded task in a disposable checkout, treats repository text as untrusted,
            checks the change against an executable contract, verifies it independently, and grants
            only the authority the run <span className="text-cloud">earns</span>. It never merges.
          </p>
        </div>
        <Chip tone="violet">governed autonomy</Chip>
      </div>

      {/* Primary action: run admission on the dashboard's selected repository (live). */}
      <div className="mt-5 rounded-xl border border-violet/30 bg-violet/[0.06] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog/70">Run on this repository</p>
            <p className="mt-0.5 truncate font-mono text-[13px] text-cloud">{repoLabel || "— select a repository above —"}</p>
          </div>
          <button
            onClick={runLive}
            disabled={running || !canRunLive}
            title={!repoLabel ? "Pick a repository first" : !signedIn ? "Sign in to run a live admission" : "Run a genuine bounded Codex admission on this repo"}
            className="rounded-lg border border-violet/60 bg-violet/20 px-4 py-2 font-mono text-[12px] text-cloud transition-colors hover:bg-violet/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running && runKind === "live" ? "Running admission…" : "Run admission on this repository"}
          </button>
        </div>
        <p className="mt-2 font-mono text-[9.5px] leading-snug text-fog/55">
          {signedIn
            ? "Live run: clones a disposable checkout and (with the Codex CLI enabled) executes a genuine bounded Codex task, then enforces the contract, runs allowlisted checks in a sandbox, and issues a signed receipt."
            : "Sign in and pick one of your repositories to run a live, Codex-backed admission. Or try a live public repo or a reproducible eval below."}
        </p>
      </div>

      {/* ── Public-repo runs, backend-catalog-driven ─────────────────────────────
          Hierarchy: (1) verified captured runs (instant, unlimited, judge-safe),
          (2) live deterministic (no Codex credits), (3) founder-only genuine Codex.
          Only entries the backend marks available render a clickable button. */}
      {(() => {
        const entries = catalog?.entries ?? [];
        const captured = entries.filter((e) => e.mode === "captured");
        const deterministic = entries.filter((e) => e.mode === "deterministic_live");
        const codexRemaining = catalog?.codex_remaining_for_you ?? 0;
        const codexAvailable = !!catalog?.codex_available;
        return (
          <>
            {/* 1. Verified captured public runs — the judge-facing default. */}
            {captured.length > 0 && (
              <div className="mt-3 rounded-xl border border-teal/25 bg-teal/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-teal">Captured · verified</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog/70">Verified captured public runs — instant, unlimited</span>
                </div>
                <p className="mt-2 font-mono text-[9.5px] leading-snug text-fog/55">
                  A recorded run — not a new scan. No live clone, no Codex spend, no rate limit. Opens the
                  captured report with its provider ledger and SHA-256 evidence integrity.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {captured.map((e) => (
                    <button
                      key={e.repo_id}
                      onClick={() => onOpenCaptured?.(e.captured_proof_id || e.repo_id)}
                      disabled={!onOpenCaptured}
                      className="rounded-lg border border-teal/40 bg-[color:var(--surface)] px-3 py-1.5 text-left font-mono text-[11px] text-cloud transition-colors hover:border-teal/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ▶ {e.name}{e.captured_at ? <span className="text-fog/50"> · {e.captured_at}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Live deterministic — only when the backend enabled it. */}
            {deterministic.length > 0 && (
              <div className="mt-3 rounded-xl border border-cyan/25 bg-cyan/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan/40 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan">Live · no sign-in</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog/70">Live deterministic evaluation — no Codex credits</span>
                </div>
                <p className="mt-2 font-mono text-[9.5px] leading-snug text-fog/55">
                  A real clone + live OSV against the chosen repo. Rate-limited per visitor. The executor is a
                  deterministic policy evaluation — <span className="text-cloud">no Codex credits are spent</span> — labelled honestly in the report.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {deterministic.map((e) => (
                    <button
                      key={e.repo_id}
                      onClick={() => runPublicLive(e.repo_url, false)}
                      disabled={running}
                      className="rounded-lg border border-cyan/30 bg-[color:var(--surface)] px-3 py-1.5 font-mono text-[11px] text-cloud transition-colors hover:border-cyan/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {running && runKind === "live" ? "running…" : e.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Genuine Codex — FOUNDER-ONLY as an action. For everyone else
                (logged-out judges, non-founders) it is a non-clickable note that
                points to the captured proof, which already contains a real recorded
                Codex diff — so a judge never consumes a credit-spending run, waits
                minutes, or hits a rate-limit dead-end. */}
            {codexAvailable && deterministic.length > 0 && (
              <div className="mt-3 rounded-xl border border-violet/25 bg-violet/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-violet">Genuine Codex</span>
                  <span className="font-mono text-[9.5px] text-fog/60">a real <span className="text-cloud">codex exec</span> writes the diff{founder ? <> · ~1–2 min · <span className="text-cloud">{codexRemaining}</span> run{codexRemaining === 1 ? "" : "s"} left today</> : null}</span>
                </div>
                {founder ? (
                  codexRemaining > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {deterministic.slice(0, 2).map((e) => (
                        <button
                          key={e.repo_id}
                          onClick={() => runPublicLive(e.repo_url, true)}
                          disabled={running}
                          className="rounded-lg border border-violet/40 bg-violet/[0.08] px-3 py-1.5 font-mono text-[11px] text-cloud transition-colors hover:border-violet/60 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {running && runKind === "live" ? "running Codex…" : `▶ Codex · ${e.name}`}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 font-mono text-[9.5px] leading-snug text-amber/80">
                      Founder genuine-Codex run for today is used up — the <span className="text-teal">verified captured run</span> above already shows a real recorded Codex diff.
                    </p>
                  )
                ) : (
                  <p className="mt-2 font-mono text-[9.5px] leading-snug text-fog/60">
                    A genuine <span className="text-cloud">codex exec</span> diff is included in the{" "}
                    <button type="button" onClick={() => onOpenCaptured?.("calhacks")} className="text-teal underline decoration-dotted underline-offset-2 hover:text-teal/80">verified captured run</button>{" "}
                    above — instant and verifiable. Running a fresh Codex task on the server is founder-only (it spends Codex credits).
                  </p>
                )}
              </div>
            )}
          </>
        );
      })()}

      {/* Secondary: reproducible public evals (offline, deterministic — no auth). */}
      <div className="mt-3">
        <button onClick={() => setShowEvals((v) => !v)} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog/70 transition-colors hover:text-fog">
          <span className={`transition-transform ${showEvals ? "rotate-90" : ""}`}>▸</span> Reproducible public evals (offline)
        </button>
        <AnimatePresence>
          {showEvals && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <p className="mt-2 font-mono text-[9.5px] leading-snug text-fog/55">
                Deterministic policy evaluation — no Codex, no network, no sign-in. Anyone (a judge, CI) can reproduce these exact outcomes.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {FIXTURES.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => { setFixture(f.id); run(f.id); }}
                    disabled={running}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${fixture === f.id && runKind === "fixture" ? "border-violet/50 bg-violet/10" : "border-[color:var(--surface-border)] hover:border-[color:var(--surface-border-hover)]"}`}
                  >
                    <span className="block font-mono text-[11px] text-cloud">{f.label}</span>
                    <span className="block font-mono text-[9.5px] text-fog/70">{f.hint}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && <p className="mt-4 font-mono text-[12px] text-[color:var(--sev-critical)]">{error}</p>}

      <AnimatePresence>
        {report && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 space-y-5">
            {/* Outcome banner + earned authority ladder */}
            <div className={`rounded-xl border p-4 ${effectiveLevel >= 2 ? "border-teal/40 bg-teal/5" : effectiveLevel <= 0 ? "border-rose-400/40 bg-rose-400/5" : "border-amber/40 bg-amber/5"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-cloud">
                  {braked ? "Authority revoked (emergency brake)" : report.outcome}
                </span>
                <div className="flex items-center gap-2">
                  {report.executor === "codex-cli"
                    ? <Chip tone="violet">codex-cli</Chip>
                    : <Chip tone="fog">deterministic eval</Chip>}
                  <Chip tone="fog">auto-merge: never</Chip>
                  {report.human_review_required && <Chip tone="fog">human review required</Chip>}
                </div>
              </div>
              {report.blocked_reason && !braked && <p className="mt-2 text-[12px] text-[color:var(--sev-critical)]">{report.blocked_reason}</p>}

              <div className="mt-4 grid grid-cols-3 gap-2">
                {LADDER.map((rung) => {
                  const active = rung.level === effectiveLevel;
                  const reachable = rung.level <= effectiveLevel;
                  return (
                    <div key={rung.level} className={`rounded-lg border p-3 transition-colors ${active ? "border-teal/50 bg-teal/10" : reachable ? "border-[color:var(--surface-border)] bg-[color:var(--surface-2)]" : "border-[color:var(--surface-border)] opacity-40"}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cloud">L{rung.level} · {rung.label}</span>
                        {active && <span className="font-mono text-[9px] text-teal">EARNED</span>}
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-fog">{rung.detail}</p>
                    </div>
                  );
                })}
              </div>
              {effectiveLevel >= 1 && !braked && (
                <div className="mt-3">
                  <button onClick={() => brake(runKind === "live" ? repoLabel : report.repo)} className="rounded-lg border border-rose-400/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--sev-critical)] transition-colors hover:bg-rose-400/10">
                    ⦿ Emergency brake — revoke authority{runKind === "fixture" ? " (preview)" : ""}
                  </button>
                  {runKind === "fixture" && (
                    <p className="mt-1.5 font-mono text-[9.5px] leading-snug text-fog/55">On this offline preview the brake revokes the view only. Signed in on a live run, it persists server-side and blocks that repo&rsquo;s PR route until re-admission.</p>
                  )}
                </div>
              )}
              {braked && (
                <div className="mt-3">
                  <p className="font-mono text-[11px] text-fog">All authority revoked. Re-run admission to re-establish trust.</p>
                  {brakeNote && <p className="mt-1 font-mono text-[10px] text-fog/60">{brakeNote}</p>}
                </div>
              )}
            </div>

            {/* The governed pipeline: Contract → Trust boundary → Verifier → Receipt */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* 1. Contract */}
              <div className="rounded-xl border border-[color:var(--surface-border)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">1 · Change contract</span>
                  <Chip tone={cr?.passed ? "teal" : "rose"}>{cr?.passed ? "in scope" : "violated"}</Chip>
                </div>
                <p className="mb-2 font-mono text-[10px] text-fog/70">
                  {report.contract.source === "repo" ? ".umbra/admission.yaml" : "default contract"} · max {report.contract.max_files_changed || "∞"} files · net {report.contract.network}
                </p>
                {cr?.checks.map((c) => <CheckRow key={c.name} ok={c.passed} name={c.name} detail={c.detail} />)}
              </div>

              {/* 2. Trust boundary */}
              <div className="rounded-xl border border-[color:var(--surface-border)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">2 · Trust boundary</span>
                  <Chip tone={tb?.clean ? "teal" : "amber"}>{tb?.clean ? "no manipulation" : `${tb?.quarantined_count} quarantined`}</Chip>
                </div>
                {tb?.clean ? (
                  <p className="text-[12px] text-fog">No agent-directed manipulation patterns in the scanned repository text.</p>
                ) : (
                  <div className="space-y-2">
                    {tb?.findings.map((f, i) => (
                      <div key={i} className="rounded-lg border border-amber/30 bg-amber/5 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-amber">{f.category.replace(/_/g, " ")}</span>
                          <span className="font-mono text-[9.5px] text-fog/60">{f.source}:{f.line}</span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] italic text-fog">“{f.excerpt}”</p>
                        <p className="mt-1 text-[10.5px] text-fog/60">Redacted in the agent&apos;s temporary checkout and prompt context.</p>
                      </div>
                    ))}
                  </div>
                )}
                {tb && !tb.clean && <p className="mt-2 text-[10px] leading-snug text-fog/50">{tb.note}</p>}
                {tb?.scanned_sources && tb.scanned_sources.length > 0 && (
                  <p className="mt-2 font-mono text-[9px] leading-snug text-fog/50">
                    scanned: {tb.scanned_sources.join(" · ")}
                  </p>
                )}
              </div>

              {/* 3. Independent verifier */}
              <div className="rounded-xl border border-[color:var(--surface-border)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">3 · Independent verifier</span>
                  {vf ? <Chip tone={vf.blocked ? "rose" : "teal"}>{vf.status}</Chip> : <Chip tone="fog">no change</Chip>}
                </div>
                {vf ? (
                  <>
                    <p className="mb-2 font-mono text-[10px] text-fog/70">evidence completeness {vf.evidence_completeness}% · secrets {vf.secrets_found}</p>
                    {vf.checks.map((c) => (
                      <CheckRow key={c.name} ok={c.status === "unavailable" ? null : c.status === "pass"} name={c.name} detail={c.detail} muted={c.status === "unavailable"} />
                    ))}
                    {report.checks && report.contract.required_checks.length > 0 && (
                      <div className="mt-2 border-t border-[color:var(--surface-border)] pt-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog/70">required checks (executed)</span>
                          {(() => {
                            const enf = report.checks.enforcement;
                            const map: Record<string, { tone: "teal" | "amber" | "fog"; label: string }> = {
                              sandboxed: { tone: "teal", label: "enforced · sandboxed (fs+net)" },
                              "network-isolated": { tone: "teal", label: "network-isolated runner" },
                              "host-restricted": { tone: "amber", label: "host-restricted · isolation pending" },
                            };
                            const m = map[enf] ?? { tone: "fog" as const, label: "not enforced" };
                            return <Chip tone={m.tone}>{m.label}</Chip>;
                          })()}
                        </div>
                        {report.checks.results.map((r, i) => (
                          <CheckRow key={i} ok={r.status === "unavailable" || r.status === "blocked" ? null : r.status === "passed"} name={r.command} detail={r.detail + (r.exit_code !== null ? ` · exit ${r.exit_code}` : "")} muted={r.status === "unavailable"} />
                        ))}
                        {/* Baseline comparison: regression vs pre-existing failure. */}
                        {report.check_diagnosis && report.baseline_checks && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="font-mono text-[9px] text-fog/60">base commit:</span>
                            <span className={`font-mono text-[9px] ${report.baseline_checks.all_passed ? "text-teal" : "text-amber"}`}>
                              checks {report.baseline_checks.all_passed ? "passed" : "failed"}
                            </span>
                            <span className="font-mono text-[9px] text-fog/40">→</span>
                            <Chip tone={report.check_diagnosis.status === "regression" ? "rose" : report.check_diagnosis.status === "clean" || report.check_diagnosis.status === "fixed_suite" ? "teal" : "amber"}>
                              {report.check_diagnosis.status.replace(/_/g, " ")}
                            </Chip>
                          </div>
                        )}
                        {report.check_diagnosis && report.check_diagnosis.status !== "clean" && (
                          <p className="mt-1 text-[10.5px] text-amber">{report.check_diagnosis.summary}</p>
                        )}
                        {!report.checks.all_passed && report.authority_level < 2 && !report.check_diagnosis && (
                          <p className="mt-1 text-[10.5px] text-amber">Required checks did not all pass — branch-PR authority withheld (capped at analyze).</p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] text-fog/60">No change was proposed, so there was nothing to verify.</p>
                )}
              </div>

              {/* 4. Proposed change + signed receipt */}
              <div className="rounded-xl border border-[color:var(--surface-border)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">4 · Proposed change &amp; receipt</span>
                  {report.proposed_change ? <SeverityChip severity={report.proposed_change.cve ? "high" : "low"} /> : <Chip tone="fog">none</Chip>}
                </div>
                {report.proposed_change ? (
                  <p className="text-[12px] text-cloud">
                    <span className="font-mono text-teal">{report.proposed_change.package}</span>{" "}
                    <span className="font-mono text-fog">{report.proposed_change.current} → {report.proposed_change.fixed}</span>
                    {report.proposed_change.cve && <span className="ml-1 font-mono text-[10px] text-fog/70">({report.proposed_change.cve})</span>}
                  </p>
                ) : (
                  <p className="text-[12px] text-fog/60">No safe in-scope change was available to propose.</p>
                )}
                {report.receipt && (
                  <div className="mt-3 rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog">signed receipt · {report.receipt.algorithm}</span>
                      {report.receipt.key_ephemeral && <Chip tone="amber">dev key</Chip>}
                    </div>
                    <p className="mt-1 break-all font-mono text-[9.5px] text-fog/60">{report.receipt.canonical_hash}</p>
                    {/* Proof-binding: the receipt binds the exact commit + diff + advisory it examined. */}
                    <div className="mt-2 space-y-0.5 font-mono text-[9px] text-fog/55">
                      {report.base_commit && <p className="break-all">base commit: {report.base_commit.slice(0, 16)}</p>}
                      {report.diff_hash && <p className="break-all">diff: {report.diff_hash.slice(0, 26)}…</p>}
                      {report.advisory_hash && <p className="break-all">advisory: {report.advisory_hash.slice(0, 26)}…</p>}
                      {report.codex_config && <p className="break-all">codex config: {report.codex_config.config_hash.slice(0, 26)}…</p>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => verifyReceipt(report.receipt!)} className="rounded-lg border border-teal/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-teal transition-colors hover:bg-teal/10">
                        Verify signature
                      </button>
                      {receiptCheck === "verified" && <span className="font-mono text-[10px] text-teal">✓ issued by Umbra · untampered</span>}
                      {receiptCheck === "invalid" && <span className="font-mono text-[10px] text-[color:var(--sev-critical)]">✗ verification failed</span>}
                      {receiptCheck === "checking" && <span className="font-mono text-[10px] text-fog">checking…</span>}
                      {receiptCheck === "error" && <span className="font-mono text-[10px] text-fog">verify unavailable</span>}
                    </div>
                    <p className="mt-2 text-[10px] leading-snug text-fog/50">Verified against Umbra&apos;s own key (pinned) — the public key is served at <span className="font-mono">/api/verify-key</span>.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Provider provenance — what actually produced each part */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-fog/70">provenance</span>
              {Object.entries(report.providers).map(([k, v]) => (
                <span key={k} className="font-mono text-[10px] text-fog"><span className="text-fog/60">{k}:</span> {v}</span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlowCard>
  );
}
