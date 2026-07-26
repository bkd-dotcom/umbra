"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

const LEVEL_LABEL: Record<number, string> = { 0: "Observe", 1: "Analyze", 2: "Branch-PR" };
const LEVEL_COLOR: Record<number, string> = {
  0: "var(--sev-critical)",
  1: "var(--color-amber)",
  2: "var(--color-teal)",
};

function Chip({ level, count }: { level: number; count: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl border px-6 py-4"
      style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}
    >
      <span className="text-3xl font-semibold" style={{ color: LEVEL_COLOR[level] }}>
        {count}
      </span>
      <span className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-2)" }}>
        L{level} {LEVEL_LABEL[level]}
      </span>
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
      if (r.status === 401) {
        setState("unauth");
        return;
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.detail || `Request failed (${r.status})`);
        setState("error");
        return;
      }
      setData(await r.json());
      setState("ok");
    } catch (e) {
      // Fail-closed and honest: never render a fake-green state.
      setError("API unavailable — start the backend on :8000.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-10" style={{ color: "var(--color-ink)" }}>
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UmbraLogo className="h-7 w-7" />
          <div>
            <h1 className="text-lg font-semibold">Mission Control</h1>
            <p className="text-xs" style={{ color: "var(--color-ink-2)" }}>
              Multi-repo org health across your earned-authority passports.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--surface-border)" }}
        >
          ← Dashboard
        </Link>
      </header>

      {state === "loading" && (
        <div className="animate-pulse rounded-2xl border p-10 text-center" style={{ borderColor: "var(--surface-border)", color: "var(--color-ink-2)" }}>
          Loading org overview…
        </div>
      )}

      {state === "unauth" && (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "var(--surface-border)" }}>
          <p className="mb-4">Sign in to see your org overview.</p>
          <a href={`${API}/auth/login/github`} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: "var(--color-teal)", color: "#001" }}>
            Sign in with GitHub
          </a>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border p-6" style={{ borderColor: "var(--sev-critical)", color: "var(--sev-critical)" }}>
          <p className="font-medium">Could not load the overview</p>
          <p className="mt-1 text-sm">{error}</p>
          <button onClick={load} className="mt-3 rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--surface-border)", color: "var(--color-ink)" }}>
            Retry
          </button>
        </div>
      )}

      {state === "ok" && data && (
        <>
          {data.repos_enrolled === 0 ? (
            <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "var(--surface-border)", color: "var(--color-ink-2)" }}>
              <p className="mb-2 text-base" style={{ color: "var(--color-ink)" }}>No repos enrolled yet.</p>
              <p className="text-sm">
                Run the Agent Admission Test on a repo from the{" "}
                <Link href="/dashboard/" className="underline" style={{ color: "var(--color-teal)" }}>dashboard</Link>{" "}
                to earn its first authority passport, or add the{" "}
                <a href="https://github.com/bkd-dotcom/umbra-action" className="underline" style={{ color: "var(--color-teal)" }}>GitHub Action</a>.
              </p>
            </div>
          ) : (
            <>
              {/* Hero: authority distribution + score */}
              <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Chip level={2} count={data.authority_counts.l2} />
                <Chip level={1} count={data.authority_counts.l1} />
                <Chip level={0} count={data.authority_counts.l0} />
                <div className="flex flex-col items-center justify-center rounded-2xl border px-6 py-4" style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}>
                  <span className="text-3xl font-semibold">{data.avg_umbra_score ?? "—"}</span>
                  <span className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-2)" }}>Avg score</span>
                </div>
                <div className="flex flex-col items-center justify-center rounded-2xl border px-6 py-4" style={{ borderColor: "var(--surface-border)", background: "var(--surface)" }}>
                  <span className="text-3xl font-semibold">{data.prs_opened}</span>
                  <span className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-2)" }}>Branch PRs</span>
                </div>
              </section>

              {/* Brake / lifecycle status — always honest about revoked/expired */}
              {(data.brake.revoked || data.brake.expired || data.brake.expiring_soon) > 0 && (
                <section className="mb-6 rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--color-amber)" }}>
                  <span style={{ color: "var(--color-amber)" }}>Passport lifecycle:</span>{" "}
                  {data.brake.revoked} revoked · {data.brake.expired} expired · {data.brake.expiring_soon} expiring soon.
                  {" "}Revoked and expired passports count as L0 until admission is re-run.
                </section>
              )}

              {/* Per-repo authority table */}
              <section className="mb-8 overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--surface-border)" }}>
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr style={{ background: "var(--surface-2)", color: "var(--color-ink-2)" }}>
                      <th className="px-4 py-2 text-left font-medium">Repository</th>
                      <th className="px-4 py-2 text-left font-medium">Authority</th>
                      <th className="px-4 py-2 text-left font-medium">Executor</th>
                      <th className="px-4 py-2 text-left font-medium">Receipt</th>
                      <th className="px-4 py-2 text-left font-medium">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.repos.map((r) => (
                      <tr key={r.repo} className="border-t" style={{ borderColor: "var(--surface-border)" }}>
                        <td className="px-4 py-2 font-mono">{r.repo}</td>
                        <td className="px-4 py-2">
                          <span style={{ color: LEVEL_COLOR[r.effective_authority_level] }}>
                            L{r.effective_authority_level} {LEVEL_LABEL[r.effective_authority_level]}
                          </span>
                          {r.revoked && <span className="ml-2 text-xs" style={{ color: "var(--sev-critical)" }}>revoked</span>}
                          {r.expired && !r.revoked && <span className="ml-2 text-xs" style={{ color: "var(--color-amber)" }}>expired</span>}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--color-ink-2)" }}>{r.executor || "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--color-ink-2)" }}>
                          {r.receipt_hash ? r.receipt_hash.slice(0, 18) + "…" : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs" style={{ color: "var(--color-ink-2)" }}>
                          {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Recent branch-only PRs */}
              {data.recent_prs.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--color-ink-2)" }}>
                    Recent branch-only PRs
                  </h2>
                  <ul className="space-y-2">
                    {data.recent_prs.map((pr) => (
                      <li key={pr.url} className="flex items-center justify-between rounded-xl border px-4 py-2 text-sm" style={{ borderColor: "var(--surface-border)" }}>
                        <a href={pr.url} className="font-mono underline" style={{ color: "var(--color-teal)" }} target="_blank" rel="noreferrer">
                          #{pr.number} {pr.branch ? `· ${pr.branch}` : ""}
                        </a>
                        <span className="text-xs" style={{ color: "var(--color-ink-2)" }}>{pr.cve || ""}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="mt-8 text-center text-xs" style={{ color: "var(--color-ink-2)" }}>
                auto_merge is always false — a human merges. Numbers reflect signed receipts and passports only.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
