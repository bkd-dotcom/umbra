# Devpost — paste-ready copy (current UI)

> Category: **Developer Tools**. Copy each field into the Devpost submission form, then
> attach the video URL, repo URL, and live URL, enter the session ID, and click **Submit**.

---

## Project name
**Umbra**

## Tagline (≤ ~60 chars)
`Governed autonomy for coding agents — trust, earned and proven.`

## Elevator pitch (the "what")
Umbra is a change-control plane for coding agents. Before an agent is trusted *with*
authority in your GitHub repo, Umbra tests whether it can be trusted *in* your repo: an
executable contract bounds the change, untrusted repository text is quarantined, an
independent verifier the writer can't bypass checks the result, and only the authority
the run *earns* is granted — every action sealed in an Ed25519-signed, independently
verifiable receipt. Codex proposes patches in a disposable clone; Umbra never merges.

## Inspiration / the problem
Coding agents (Codex, Claude Code, Devin) can now change repositories, and teams are
adopting them right now — but there's no repeatable way to prove an agent stayed in
bounds. "AI found a CVE and opened a PR" is already crowded (Dependabot, Snyk, CodeRabbit,
Copilot). The unsolved problem isn't generation; it's *governed execution*: letting an
agent work without blindly trusting it. Prompt injection via instruction files and
over-broad agent authority are named risks in the OWASP Top 10 for LLM Apps (2025) —
LLM01 and LLM06. Umbra is the control that's missing.

## What it does
**The Agent Admission Test** — one governed, deterministic pipeline that runs before any PR:
1. **Executable Change Contract** — allowed/forbidden paths, diff budget, required checks, network policy; evaluated outside the model, fails closed.
2. **Trust Boundary** — repo text is untrusted; flagged prompt-injection in README/AGENTS.md is redacted on disk before the agent runs (the quarantine architecture is the guarantee, not perfect detection).
3. **Required checks** — run in an isolated sandbox (bubblewrap/unshare) with a secret-stripped env; a non-profile command is refused.
4. **Independent Verifier** — a separate deterministic pass the patch-writer can't bypass; confirms scope, secrets, and that a dependency bump *actually* clears the cited CVE.
5. **Earned-authority passport** — L0 observe / L1 analyze / L2 branch-PR; revocable, bound to the exact run, 7-day expiry, with a server-side emergency brake. auto_merge is false at every level.
6. **Ed25519-signed Remediation Receipt** — verifiable against Umbra's own pinned public key.

Plus a crew that operates *inside* that boundary (dependency CVE scanning via OSV.dev, PR
risk scoring, git-history root-cause tracing, dead-code cleanup, grounded codebase Q&A),
a branch-only PR path, and an in-ChatGPT GPT Action surface.

## How we built it
FastAPI + async orchestrator; **Codex** (`codex exec`) for engineering in an
origin-stripped disposable clone; **GPT-5.6** via the Responses API (tiers gpt-5.6-sol /
terra / luna) for reasoning; OSV.dev + local git for grounding; deterministic
contract/verifier/trust-boundary modules; Ed25519 receipts. Next.js 15 + Tailwind
dashboard. 282 backend tests; committed offline eval fixtures anyone can reproduce.

## How Codex + GPT-5.6 were used (required)
Codex was the *primary engineer* — it built the platform phase by phase from a master
build manual, committing and running tests after each phase. Commit-level receipts are in
`docs/CODEX_USAGE.md` (e.g. `39a4b52` built the contract/verifier/trust-boundary spine;
`7342b85` closed the integrity gaps). Codex also runs live at inference time via
`codex exec` in a disposable checkout (never pushes/merges). GPT-5.6 does the reasoning
via `client.responses.create/stream`. Every output carries an honesty-ledger label naming
what produced it (`codex-cli` / `responses-api` / `osv.dev` / `local-git` / `cache` /
`unavailable`).

## How to test it (no rebuild)
- **Live:** https://umbra.engineer → hero "Run the Admission demo" (no sign-in) → run the
  fixtures (permitted → L2, forbidden → L0, failing-check → L1), verify the receipt, hit the
  emergency brake, open the captured proof scan.
- **One command:** `make judge` → admits a fixture and verifies the signed receipt (OK).
- **API:** `POST /api/admit {"fixture":"permitted-dependency-fix"}`; `POST /api/receipt/verify`; `GET /api/verify-key`; rate-limited live: `POST /api/admit/public-live {"repo_url":"https://github.com/expressjs/express"}`.
- **ChatGPT:** import `https://umbra.engineer/openapi-actions.yaml` (auth None) → "Scan github.com/expressjs/express".

## Built with
Codex · GPT-5.6 · Python · FastAPI · Next.js · TypeScript · Tailwind · OSV.dev · Ed25519 · Cloud Run

## Links
- Live: https://umbra.engineer
- Repo: https://github.com/bkd-dotcom/umbra  *(⚠ make public or share with testing@devpost.com + build-week-event@openai.com before submitting)*
- Demo video: **← paste your YouTube URL**
- Codex /feedback session ID: `019f66b8-a2ce-7103-aaed-2f60900d1aab`  *(confirm this is correct)*
