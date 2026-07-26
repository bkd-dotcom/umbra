"use client";

import { useState } from "react";
import Link from "next/link";
import { UmbraLogo } from "@/components/ui/umbra-logo";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-4 py-3 font-mono text-[13px] leading-relaxed text-cloud">
        {children}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 rounded-md border border-[color:var(--surface-border)] bg-ink/60 px-2 py-1 font-mono text-[10px] text-fog opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Copy"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[color:var(--surface-border)] py-8 first:border-t-0">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--surface-border)] font-mono text-xs text-cloud">
          {n}
        </span>
        <h2 className="font-serif text-2xl tracking-[-0.02em] text-cloud">{title}</h2>
      </div>
      <div className="ml-10 space-y-3 text-[15px] leading-relaxed text-fog">{children}</div>
    </section>
  );
}

export default function GetStarted() {
  return (
    <main className="min-h-screen bg-ink text-cloud">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[color:var(--surface-border)] bg-ink/85 px-6 py-3 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2" aria-label="Umbra home">
          <UmbraLogo size={20} />
          <span className="font-mono text-[11px] tracking-[0.14em] text-fog">// GET STARTED</span>
        </Link>
        <nav className="flex items-center gap-4 font-mono text-[11px] text-fog">
          <a href="https://bkd-dotcom.github.io/umbra-core/" className="hover:text-cloud">Docs</a>
          <a href="https://github.com/bkd-dotcom/umbra-umbrella" className="hover:text-cloud">GitHub</a>
          <a href={`${API}/auth/login/github`} className="rounded-lg border border-[color:var(--surface-border)] px-3 py-1.5 text-cloud hover:border-cyan/50">Sign in</a>
        </nav>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-serif text-[clamp(32px,5vw,52px)] leading-[1.05] tracking-[-0.03em]">
          Govern your first agent change in a minute.
        </h1>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-fog">
          Umbra decides how much authority a coding agent&apos;s change has earned — and proves it
          with a signed receipt. Pick a surface below. Everything runs the same admission pipeline
          (<a href="https://github.com/bkd-dotcom/umbra-core" className="underline decoration-fog/40 hover:text-cloud">umbra-core</a>);
          <code className="mx-1 rounded bg-[color:var(--surface-2)] px-1 font-mono text-[13px]">auto_merge</code>
          is always false — a human merges.
        </p>

        <Step n={1} title="Install the CLI">
          <p>Any one of these:</p>
          <Code>{`# Homebrew\nbrew install bkd-dotcom/umbra/umbra\n\n# pip / uv / pipx\npip install umbra-core\n\n# one-liner (uv \u2192 pipx \u2192 pip, fail-closed)\ncurl -fsSL https://raw.githubusercontent.com/bkd-dotcom/umbra-core/main/install.sh | sh`}</Code>
          <p>Optional shell completion:</p>
          <Code>{`umbra completion zsh >> ~/.zshrc   # or: bash | fish`}</Code>
        </Step>

        <Step n={2} title="Scaffold a contract">
          <p>
            Declare what a change may touch. <code className="rounded bg-[color:var(--surface-2)] px-1 font-mono text-[13px]">umbra init</code>{" "}
            writes a conservative starter; edit the scope to fit your repo.
          </p>
          <Code>{`umbra init            # writes .umbra/admission.yaml`}</Code>
        </Step>

        <Step n={3} title="Govern a change">
          <p>Run the admission pipeline. It exits non-zero below your authority bar, so it gates a hook or CI:</p>
          <Code>{`umbra admit . --mission "bump the vulnerable dependency" --min-authority 2\numbra gates receipt.json      # G1/G2/G3 proof gates\numbra verify receipt.json --public-key <key>`}</Code>
        </Step>

        <Step n={4} title="Enforce it on every PR">
          <p>
            The durable guarantee is a required check. Add the{" "}
            <a href="https://github.com/bkd-dotcom/umbra-action" className="underline decoration-fog/40 hover:text-cloud">GitHub Action</a>:
          </p>
          <Code>{`# .github/workflows/umbra.yml\non: { pull_request: {} }\npermissions: { contents: read, pull-requests: write }\njobs:\n  admit:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with: { fetch-depth: 0 }\n      - uses: bkd-dotcom/umbra-action@v1\n        with: { min-authority: "1" }`}</Code>
          <p>Every PR gets an Admission Decision comment + a signed receipt artifact. Add it to branch protection to block merges without it.</p>
        </Step>

        <Step n={5} title="Or govern from inside your tools">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><a href="https://github.com/bkd-dotcom/umbra-claude-code" className="underline decoration-fog/40 hover:text-cloud">Claude Code</a> — PreToolUse guard + <code className="font-mono text-[13px]">/umbra:admit</code> + MCP server.</li>
            <li><a href="https://github.com/bkd-dotcom/umbra-cursor" className="underline decoration-fog/40 hover:text-cloud">Cursor</a> — MCP server + project rule.</li>
            <li><a href="https://github.com/bkd-dotcom/umbra-codex" className="underline decoration-fog/40 hover:text-cloud">Codex</a> — MCP server + lifecycle-hook guard.</li>
            <li><a href="https://github.com/bkd-dotcom/umbra-precommit" className="underline decoration-fog/40 hover:text-cloud">pre-commit / git hooks</a> — universal guard.</li>
            <li>Any MCP client — <code className="font-mono text-[13px]">python -m umbra_core.mcp_server</code> exposes <code className="font-mono text-[13px]">umbra_admit</code> / <code className="font-mono text-[13px]">umbra_verify</code>.</li>
          </ul>
        </Step>

        <Step n={6} title="Watch it from the console">
          <p>
            Sign in to attach your repos, run admissions, and see passports, receipts, and org health
            in one place.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={`${API}/auth/login/github`} className="rounded-lg bg-[color:var(--color-teal)] px-4 py-2 text-sm font-medium text-[#001]">Open the dashboard</a>
            <Link href="/dashboard/overview/" className="rounded-lg border border-[color:var(--surface-border)] px-4 py-2 text-sm text-cloud">Mission Control</Link>
          </div>
        </Step>

        <footer className="mt-10 border-t border-[color:var(--surface-border)] pt-6 text-sm text-fog">
          Full reference at the{" "}
          <a href="https://bkd-dotcom.github.io/umbra-core/" className="underline decoration-fog/40 hover:text-cloud">docs site</a>{" "}
          · platform overview at the{" "}
          <a href="https://github.com/bkd-dotcom/umbra-umbrella" className="underline decoration-fog/40 hover:text-cloud">umbrella</a>.
        </footer>
      </div>
    </main>
  );
}
