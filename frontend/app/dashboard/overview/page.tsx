"use client";

import { useCallback, useEffect, useState } from "react";
import { GlowCard } from "@/components/ui/glow-card";
import { UmbraLogo } from "@/components/ui/umbra-logo";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const creds: RequestInit = { credentials: "include" };

type RepoRow = {
  repo: string;
  authority_level: number;
  effective_authority_level: number;
  authority?: string;
  revoked?: boolean;
  expired?: boolean;
  expires_at?: string | null;
  receipt_hash?: string | null;
  executor?: string | null;
  updated_at?: string | null;
};
type Pr = { repo_url?: string; number: number; url: string; branch?: string; cve?: string; opened_at?: string };
type Overview = {
  repos_enrolled: number;
  authority_counts: { l0: number; l1: number; l2: number };
  brake: { revoked: number; expired: number; expiring_soon: number };
  prs_opened: number;
  recent_prs: Pr[];
  avg_umbra_score: number | null;
  scans_saved: number;
  repos: RepoRow[];
  auto_merge: boolean;
  generated_at: string;
};

const LEVEL = {
  0: { label: "Observe", tone: "rose" as const, hex: "#fb7185" },
  1: { label: "Analyze", tone: "amber" as const, hex: "#fbbf24" },
  2: { label: "Branch-PR", tone: "teal" as const, hex: "#5eead4" },
};

function levelOf(n: number) {
  return LEVEL[(n as 0 | 1 | 2)] ?? LEVEL[0];
}

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

// A hero stat tile (score-dial-adjacent, but for a scalar with a caption).
function Stat({ value, label, hex }: { value: React.ReactNode; label: string; hex?: string }) {
  return (
    <GlowCard className="flex flex-col items-center justify-center px-4 py-5 text-center">
      <span className="font-serif text-[clamp(28px,4vw,40px)] leading-none tracking-[-0.02em]" style={{ color: hex ?? "var(--color-cloud, #e8ecf1)" }}>
        {value}
      </span>
      <span className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-fog">{label}</span>
    </GlowCard>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fog/70">
        <span className="text-fog/40">//</span> {kicker}
      </span>
      <h2 className="mt-1 font-serif text-[clamp(20px,2.6vw,28px)] leading-tight tracking-[-0.02em] text-cloud">{title}</h2>
      <div className="mt-3 h-px w-full" style={{ background: "linear-gradient(90deg, rgba(94,234,212,0.35), transparent 55%)" }} />
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unauth" | "error">("loading");
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await fetch(`${API}/api/my/overview`, creds);
      if (r.status === 401) return setState("unauth");
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.detail || `Request failed (${r.status})`);
        return setState("error");
      }
      setData(await r.json());
      setState("ok");
    } catch {
      setError("API unavailable — start the backend on :8000.");
      setState("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[1240px] bg-ink px-6 pb-24 text-cloud md:px-10">
      {/* Header — mirrors the dashboard CommandHeader. */}
      <header className="sticky top-0 z-30 -mx-6 mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[color:var(--surface-border)] bg-ink/85 px-6 py-3 backdrop-blur-md md:-mx-10 md:px-10">
        <a href="/" aria-label="Umbra home" className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan">
          <UmbraLogo size={20} />
          <span className="hidden font-mono text-[11px] tracking-[0.14em] text-fog sm:inline"><span className="text-fog/40">//</span> MISSION CONTROL</span>
        </a>
        <span className="order-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fog md:order-none">
          Org authority · multi-repo
        </span>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <a href="/dashboard/" className="rounded-lg border border-[color:var(--surface-border)] px-3 py-1.5 font-mono text-[11px] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">← Dashboard</a>
          <button onClick={load} className="rounded-lg border border-[color:var(--surface-border)] px-3 py-1.5 font-mono text-[11px] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">Refresh</button>
        </div>
      </header>

      {/* Intro */}
      <div className="mb-8">
        <h1 className="font-serif text-[clamp(26px,4vw,42px)] leading-[1.05] tracking-[-0.03em]">Mission Control</h1>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-fog">
          Every repo&apos;s <span className="text-cloud">earned authority</span> across your org, from signed passports only.
          A revoked or expired passport counts as <span className="text-[color:var(--sev-critical)]">L0</span> — never the level it once earned.
          <span className="text-cloud"> auto_merge is always false.</span>
        </p>
      </div>

      {state === "loading" && (
        <GlowCard className="grid place-items-center px-6 py-16">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fog/70 animate-pulse">Loading org overview…</span>
        </GlowCard>
      )}

      {state === "unauth" && (
        <GlowCard className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <p className="text-[14px] text-cloud">Sign in to see your org overview.</p>
          <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-fog">
            Authority passports are per-account. Sign in, then run the Agent Admission Test on your repos to populate this view.
          </p>
          <a href={`${API}/auth/login/github`} className="rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-teal transition-colors hover:bg-teal/20">Sign in with GitHub</a>
        </GlowCard>
      )}

      {state === "error" && (
        <GlowCard className="flex flex-col items-start gap-3 px-6 py-8" glow="#fb7185">
          <Chip tone="rose">error</Chip>
          <p className="text-[13.5px] text-cloud">Could not load the overview.</p>
          <p className="font-mono text-[12px] text-fog">{error}</p>
          <button onClick={load} className="mt-1 rounded-lg border border-[color:var(--surface-border)] px-3 py-1.5 font-mono text-[11px] text-fog transition-colors hover:border-cyan/50 hover:text-cloud">Retry</button>
        </GlowCard>
      )}

      {state === "ok" && data && (data.repos_enrolled === 0 ? (
        <GlowCard className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <UmbraLogo size={28} />
          <p className="text-[14px] text-cloud">No repos enrolled yet.</p>
          <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-fog">
            Run the <a href="/dashboard/" className="text-teal underline decoration-dotted underline-offset-2 hover:text-teal/80">Agent Admission Test</a> on a repo to earn its first authority passport,
            or add the <a href="https://github.com/bkd-dotcom/umbra-action" className="text-teal underline decoration-dotted underline-offset-2 hover:text-teal/80">GitHub Action</a> so every PR is admitted.
          </p>
        </GlowCard>
      ) : (
        <div className="space-y-12">
          {/* Hero stat rail */}
          <section>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat value={data.authority_counts.l2} label="L2 · Branch-PR" hex={LEVEL[2].hex} />
              <Stat value={data.authority_counts.l1} label="L1 · Analyze" hex={LEVEL[1].hex} />
              <Stat value={data.authority_counts.l0} label="L0 · Observe" hex={LEVEL[0].hex} />
              <Stat value={data.repos_enrolled} label="Repos enrolled" />
              <Stat value={data.avg_umbra_score ?? "—"} label="Avg score" />
              <Stat value={data.prs_opened} label="Branch PRs" />
            </div>

            {(data.brake.revoked + data.brake.expired + data.brake.expiring_soon) > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber/30 bg-amber/[0.06] px-4 py-2.5">
                <Chip tone="amber">passport lifecycle</Chip>
                {data.brake.revoked > 0 && <span className="font-mono text-[11px] text-fog"><span className="text-[color:var(--sev-critical)]">{data.brake.revoked}</span> revoked</span>}
                {data.brake.expired > 0 && <span className="font-mono text-[11px] text-fog"><span className="text-amber">{data.brake.expired}</span> expired</span>}
                {data.brake.expiring_soon > 0 && <span className="font-mono text-[11px] text-fog"><span className="text-amber">{data.brake.expiring_soon}</span> expiring soon</span>}
                <span className="text-[11px] text-fog/70">— counted as L0 until admission is re-run.</span>
              </div>
            )}
          </section>

          {/* Authority passports */}
          <section>
            <SectionTitle kicker="authority passports" title="What each repo earned" />
            <div className="grid gap-3 sm:grid-cols-2">
              {data.repos.map((r) => {
                const lv = levelOf(r.effective_authority_level);
                return (
                  <GlowCard key={r.repo} className="flex flex-col gap-3 p-5" glow={lv.hex}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 break-all font-mono text-[12.5px] text-cloud">{r.repo}</span>
                      <span className="shrink-0"><Chip tone={lv.tone}>L{r.effective_authority_level} · {lv.label}</Chip></span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.revoked && <Chip tone="rose">revoked</Chip>}
                      {r.expired && !r.revoked && <Chip tone="amber">expired</Chip>}
                      {r.executor && <Chip tone="fog">{r.executor}</Chip>}
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 border-t border-[color:var(--surface-border)] pt-3 font-mono text-[10.5px] text-fog">
                      <span className="text-fog/50">receipt</span>
                      <span className="truncate text-right text-cloud/80">{r.receipt_hash ? r.receipt_hash.replace("sha256:", "").slice(0, 12) + "…" : "—"}</span>
                      <span className="text-fog/50">expires</span>
                      <span className="text-right">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}</span>
                      <span className="text-fog/50">auto-merge</span>
                      <span className="text-right text-teal">never</span>
                    </div>
                  </GlowCard>
                );
              })}
            </div>
          </section>

          {/* Recent branch-only PRs */}
          {data.recent_prs.length > 0 && (
            <section>
              <SectionTitle kicker="pr ledger" title="Recent branch-only PRs" />
              <GlowCard className="divide-y divide-[color:var(--surface-border)] p-0">
                {data.recent_prs.map((pr) => (
                  <div key={pr.url} className="flex items-center justify-between gap-3 px-5 py-3">
                    <a href={pr.url} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-teal underline decoration-dotted underline-offset-2 hover:text-teal/80">
                      #{pr.number}{pr.branch ? ` · ${pr.branch}` : ""}
                    </a>
                    {pr.cve && <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fog">{pr.cve}</span>}
                  </div>
                ))}
              </GlowCard>
            </section>
          )}

          <p className="pt-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-fog/50">
            Numbers reflect signed receipts &amp; passports only · a human merges
          </p>
        </div>
      ))}
    </main>
  );
}
