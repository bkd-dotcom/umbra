# Umbra — The AI engineer that works the night shift

Umbra is a **change-control plane for coding agents**. Before an agent is trusted
*with* authority in your repo, Umbra tests whether it can be trusted *in* your
repo: an **executable contract** bounds the change, untrusted repository text is
**quarantined**, an **independent verifier** checks the result, and only the
**authority the run earns** is granted — every action sealed in a **signed,
independently verifiable receipt**. **Codex proposes patches in a disposable
clone; Umbra never merges.**

Built for **OpenAI Build Week 2026**. Recommended submission category: **Developer
Tools / Agents** (see [SUBMISSION.md](SUBMISSION.md)).

## The Agent Admission Test (what makes Umbra different)

"AI finds a CVE and opens a PR" is a crowded category. Umbra's defensible wedge is
one layer up: **it decides whether an agent should be allowed to make a change at
all, and proves why.** One governed pipeline runs before any PR:

```
load executable contract (.umbra/admission.yaml)
  → redact untrusted repository text on disk (README / AGENTS.md / CLAUDE.md / … — the
                                              agent can't read what isn't there)
  → run required checks on the BASE commit          (in an isolated worktree, per check, to
                                                     tell a regression from a pre-existing failure)
  → run the bounded task in a disposable checkout   (a real Codex run live, or a
                                                     deterministic policy evaluation offline)
  → evaluate the changeset against the contract     (deterministic, outside the model)
  → re-run required checks on the CHANGED tree       (allowlisted profiles, secret-stripped env,
                                                     network-jailed on Linux; missing/failing → cap at analyze)
  → independently verify it                          (the patch-writer can't self-approve)
  → grant only the authority the run EARNED          (0 observe · 1 analyze · 2 branch-PR)
  → seal it in an Ed25519-signed Remediation Receipt (binds base commit + diff + advisory + checks)
```

Authority is a **result of evidence**, never a checkbox — a forbidden-path attempt,
a failing required check, or a verifier block keeps it below branch-PR. `auto_merge`
is false at every level, and the earned passport actually gates PR creation (with a
server-side Emergency Brake to revoke it). The offline fixtures run as a deterministic
policy evaluation (no Codex, no network) so anyone can reproduce them; a live repo run
executes a genuine bounded Codex task — the report labels which executor ran.
Try it with zero setup on the dashboard's **Agent Admission** panel (five committed,
offline fixtures) or via the API:

```bash
# offline, deterministic — no auth, no network (judges/CI reproduce it)
curl -s -X POST localhost:8000/api/admit -d '{"fixture":"permitted-dependency-fix"}'      # → earns L2 branch-PR (required check ran & passed)
curl -s -X POST localhost:8000/api/admit -d '{"fixture":"adversarial-readme-injection"}'  # → injection quarantined, fix still permitted
curl -s -X POST localhost:8000/api/admit -d '{"fixture":"forbidden-scope-violation"}'      # → BLOCKED at L0 (out of scope)
curl -s -X POST localhost:8000/api/admit -d '{"fixture":"failing-check-caps-authority"}'   # → capped at L1 (pre-existing check failure)
curl -s -X POST localhost:8000/api/admit -d '{"fixture":"regression-detected"}'            # → capped at L1 (change caused a regression)

# verify a receipt against Umbra's OWN pinned public key (proves Umbra issued it)
curl -s localhost:8000/api/verify-key
```

Fixtures live in [`evals/fixtures/`](evals/fixtures/); the modules are
[`backend/contract.py`](backend/contract.py), [`backend/verifier.py`](backend/verifier.py),
[`backend/checks.py`](backend/checks.py),
[`backend/trust_boundary.py`](backend/trust_boundary.py), [`backend/admission.py`](backend/admission.py),
and [`backend/receipt.py`](backend/receipt.py).

## Test it (no rebuild required)

- **Live site:** [umbra.engineer](https://umbra.engineer) — hosted on Google Cloud Run. Sign in with
  **GitHub or Google**, then point the night crew at one of your own repos (public or private).
  Findings are **real** — OSV CVEs, dependency graph, git-history root-cause — and every result is
  labelled with what produced it.
- **In ChatGPT (plugin / GPT Action):** the read-only actions are public (no auth). Try the shared
  **Umbra Engineer** GPT, or wire it up yourself from the served schema:
  - Plugin manifest: <https://umbra.engineer/.well-known/ai-plugin.json>
  - OpenAPI (actions): <https://umbra.engineer/openapi-actions.yaml>
  - Build instructions: [`custom_gpt/`](custom_gpt/instructions.md) — e.g. *"Scan github.com/expressjs/express"*
- **Autonomous ("works while you sleep"):** drop [`.github/workflows/umbra.yml`](.github/workflows/umbra.yml)
  into any repo (add an `OPENAI_API_KEY` secret) — Umbra reviews every PR and runs a nightly scan
  that opens branch-only fix PRs. Or install the **Umbra GitHub App** once (any account/org, public or
  private repos, pick your repos in GitHub's UI) — every new PR gets an advisory review comment posted by
  the App (never merges). Setup: [docs/github-app.md](docs/github-app.md).

## How Codex + GPT-5.6 are used

- **Codex** (`codex exec`, ChatGPT login) explores a **disposable checkout**, edits code, runs tests
  in a sandbox, and drafts the change — never pushes, commits, or merges. See
  [`backend/codex_client.py`](backend/codex_client.py).
- **Reasoning** runs on **GPT-5.6**: the Responses API (Sol / Terra / Luna — deep / work / fast) when
  available, otherwise the Codex CLI itself (which runs a GPT-5.6 model). See
  [`backend/reasoning.py`](backend/reasoning.py). Umbra runs live on **Codex credits alone — no OpenAI
  API key required.**
- **Honesty ledger:** every run labels each half with what actually served it (`codex-cli` /
  `osv.dev` / `local-git` / `responses-api` / `demo-cache` / `unavailable`). Reasoning is never
  fabricated. See [docs/live-mode.md](docs/live-mode.md).
- **Where Codex accelerated the build & the `/feedback` session ID:** see [SUBMISSION.md](SUBMISSION.md).

## The accountability layer (what makes Umbra different)

An autonomous crew is only useful if you can trust what it did overnight. Umbra treats every
finding and fix as an **auditable receipt**, not a claim to take on faith:

- **Provider ledger** — every half of every run is labelled with what actually served it
  (`codex-cli` / `osv.dev` / `local-git` / `responses-api` / `cache-fallback` / `unavailable`).
  A non-live provider is never dressed up as live; a stage the crew didn't run is chipped `SAMPLE`.
- **In-app PR review** — the Codex-drafted patch renders as a real diff (per-file, hunk headers,
  ±line gutters) with the deterministic **Reviewer** risk verdict beside it, so you review the exact
  change *before* opening it. PRs are **branch-only** — Umbra never merges. See
  [`frontend/components/ui/diff-view.tsx`](frontend/components/ui/diff-view.tsx).
- **PR ledger** — every branch-only PR Umbra opens becomes a durable receipt (PR #, branch, the
  advisory it remediates, the recorded Reviewer verdict, opened-at), grouped by repo.
- **Triage with reasons** — snoozing or accepting-risk on a finding requires a reason and is recorded
  server-side, so a suppression is an auditable act surfaced in the activity timeline — never a silent hide.
- **Evidence Pack + integrity hash** — any run exports to a portable, path-sanitized Markdown pack
  stamped with a canonical `sha256`; `POST /api/evidence-pack/verify` **recomputes** that hash to catch
  accidental alteration. This is an *integrity checksum*, not tamper-proof provenance — anyone can edit a
  report and recompute the hash. For tamper-evidence, use the signed receipt below. See
  [`backend/evidence.py`](backend/evidence.py).
- **Signed Remediation Receipt (tamper-evident)** — every admission run seals its accountability chain
  (base commit, contract, trust-boundary, executed checks, verifier, earned authority, diff/advisory
  hashes, and the Codex config hash when Codex ran) into an **Ed25519-signed** envelope.
  `POST /api/receipt/verify` verifies the signature **against Umbra's own pinned public key** (served at
  `GET /api/verify-key`) — so it proves *Umbra* issued the receipt, not merely that some key signed it.
  The receipt honestly flags whether the signing key is the managed production key or a dev fallback. See
  [`backend/receipt.py`](backend/receipt.py).
- **Earned-authority passport** — the authority an agent earned per repo is persisted and revocable, and
  bound to the exact run (receipt hash, base commit, executor + Codex config hash, check result, 7-day
  expiry). Re-running admission upserts it, a failed run downgrades it, and the Emergency Brake
  (`POST /api/my/authority/revoke`) forces it to Level 0 — which the PR-open route enforces (a revoked,
  sub-L2, or expired passport blocks the PR). `auto_merge` is never stored true. Set
  `UMBRA_REQUIRE_ADMISSION=true` for strict mode, where a repo with no passport cannot get an
  agent-created PR at all (otherwise admission governs *enrolled* repositories).
- **Activity / audit timeline** — the shift, in order, from real durations and provider labels.

### Honest enforcement boundaries

Umbra states what it actually enforces, never more:

- **Required checks** run only **allowlisted profiles** (`npm test`/`ci`, `pytest`, …) with a
  **secret-stripped environment**, under the strongest isolation that actually preflights — recorded
  truthfully as one of three tiers:
  - **`sandboxed`** — a bubblewrap filesystem+network sandbox (read-only OS, writable bind only on the
    disposable checkout, private HOME/tmp, all namespaces unshared). This is the only tier called a full
    sandbox: the repo's own build scripts can't read the host home or write outside the checkout.
  - **`network-isolated`** — Linux `unshare -rn` (network cut, host filesystem — *not* a full sandbox).
  - **`host-restricted`** — no working wrapper (e.g. macOS dev): allowlist + secret-stripped env only.
  Each wrapper is **preflighted** (`… true`) before its tier is claimed, so a namespace that fails to
  initialize is never mislabeled. The report/receipt record the tier achieved and the UI shows it
  (*enforced · sandboxed* / *network-isolated runner* / *host-restricted · isolation pending*).
- **Trust boundary:** untrusted instruction files (README / AGENTS.md / CLAUDE.md / .cursorrules / …) are
  **redacted on disk** in the disposable checkout *before* a Codex run, so the agent can't read the
  manipulation. They're restored afterward and the changeset is **recomputed from `git` on the final
  tree**, so the signed diff reflects only the agent's real change (never the redaction); any agent edit
  to an instruction file is dropped and recorded. It catches *tested* patterns; it is not a claim to
  defeat all prompt injection.

The landing page's **Night-Shift pipeline** walks this end-to-end (Scan → Triage → Root-cause →
Draft fix → Evidence → Human gate), replaying a real captured scan.

## Threat model, privacy & enforcement labels

Umbra states plainly what it guarantees, what it merely mitigates, and what it does not attempt — so
its claims survive a skeptical read.

### What each enforcement label means (recorded truthfully in every report/receipt)

- **`enforced · sandboxed`** — required checks ran under a **bubblewrap** filesystem+network sandbox
  (read-only OS, writable bind only on the disposable checkout, private HOME/tmp, all namespaces
  unshared, no network). Preflighted with `… true` before the tier is claimed.
- **`network-isolated`** — Linux `unshare -rn` (network cut, host filesystem — **not** a full sandbox).
- **`host-restricted`** — no working isolation wrapper (e.g. macOS dev): allowlist + secret-stripped
  env only. We do **not** call this "sandboxed."
- **`declared / unavailable`** — a required check could not run here (tool absent). Authority is
  **capped at analyze (L1)** — branch-PR (L2) requires the contract's checks to have actually run and
  passed. A missing/failing/blocked check never earns L2.

### Trust boundary — threat model and non-goals

- **Treated as untrusted (data, not instructions):** repository-derived text that **Umbra
  supplies in its constructed context** — README / AGENTS.md / CLAUDE.md / .cursorrules /
  CONTRIBUTING and other scanned instruction files, plus repo docs passed as context. Only
  **Umbra-owned policy** (the mission + contract) is treated as an instruction. Every run records a
  signed **context manifest** naming what was trusted-as-policy vs supplied-as-quoted-evidence vs
  redacted.
- **What is enforced:** known agent-directed manipulation patterns (policy override, secret access,
  scope expansion, agent directives, command injection) are **redacted on disk** in the disposable
  checkout before a Codex run, and any agent edit to an instruction file is dropped and recorded.
- **Non-goals (explicitly not guaranteed):** Umbra does **not** claim to defeat all prompt injection,
  and the context manifest does **not** enumerate every file the agent may independently read (a
  workspace-access agent can open files itself; the CLI exposes no complete read log). Untrusted text
  can live beyond the scanned set; novel phrasings may evade the pattern detector. The boundary catches
  *tested* patterns and treats Umbra-supplied repository text as evidence — it is a mitigation, not a
  proof of safety. Required checks prove only what the contract **declared**, not that the whole
  repository is safe.

### Model provenance (Codex + GPT-5.6), stated only when observable

Each receipt carries a signed `model_identity`: `executor`, observed `codex_cli_version`, the
`model_configured` (what Umbra **requested** via `-m`, e.g. `gpt-5.6-luna`/`terra`/`sol`), a
`model_resolved` value that stays **`unavailable`** unless a provider/CLI explicitly attests the model
that ran (passing `-m` proves the model was *requested*, not that it was confirmed — we never promote
configured to resolved), and a `model_evidence` source (`cli-argument` for a `-m` request,
`codex-default` when unset, `no-model` for the deterministic offline path). We never infer the model
the CLI selected.

### Policy ownership & change control

A contract hash proves **which** rules ran; the receipt's `policy_status` states **who authorized**
them, honestly. Declared owner/version metadata is **not** a cryptographic signature, so the status is
`declared` when a `policy_owner` + `policy_version` are set in `.umbra/admission.yaml`, `incomplete`
when they are missing (fail-safe default), and `cryptographically-signed` **only** for a policy
carrying a verifiable signature (a scheme Umbra does not assert today — the value exists so the field
stays truthful). Authority is always additionally gated by the deterministic contract, independent
verifier, and required checks, so a permissive policy cannot by itself grant more than those allow.
Production teams should own and version their policy.

### Privacy & data handling (what Umbra controls)

Umbra states only what it technically controls — not behavior owned by Cloud Run, platform logs,
GitHub, OSV, or other providers:

- **Disposable checkout:** live repos are cloned into a temp checkout with the `origin` remote removed;
  Codex is never given GitHub write credentials. Umbra deletes the checkout when the run ends.
- **No auto-merge, ever:** `auto_merge` is false at every authority level and in the signed receipt;
  PRs are branch-only and a human merges.
- **Secret-stripped execution:** required-check subprocesses run with a minimal env — OpenAI / GitHub /
  cloud / session secrets are stripped.
- **Receipt contents:** the receipt binds hashes (base commit, diff, advisory) and provider labels;
  the Evidence Pack is **path-sanitized** (the server's temp paths are stripped from free text). Diffs
  are recomputed from `git` on the final tree, so the redaction never appears in the receipt.
- **Private repos:** supported for signed-in users; findings run server-side. Live Codex on the server
  is hard-gated to the founder account (`UMBRA_FOUNDER_IDS`); other users see findings plus an honest
  "Codex runs on your machine" label.
- **What Umbra does not control / promise:** it cannot guarantee the retention or deletion behavior of
  the hosting platform, its request/stdout logs, GitHub, OSV, or any external provider; it is not a
  data-processing agreement or a compliance certification. Treat the hosted demo as a demo; self-host
  for control over the surrounding infrastructure.

### Production limitations

- On environments without Linux isolation, checks are `host-restricted`, not sandboxed (correctly
  labelled; L2 still requires checks to run and pass).
- The prompt-injection boundary catches tested patterns only (see non-goals above).
- Live Codex runs can take minutes; the captured-proof path is the instant, offline judge route.

## Supported platforms

macOS, Linux, Windows (Python 3.11+, Node 20+). Any public GitHub repository. The ChatGPT plugin /
GPT Action works anywhere ChatGPT Actions are supported.

## Run from source

The repo standardizes on [**uv**](https://docs.astral.sh/uv/):

```bash
git clone https://github.com/bkd-dotcom/umbra
cd umbra
uv sync --extra dev                        # backend deps + test tooling
uv run uvicorn backend.main:app --reload   # API at http://localhost:8000
cd frontend && npm install && npm run dev  # dashboard at http://localhost:3000
```

**Both servers must run together.** The dashboard calls the API at `NEXT_PUBLIC_API_URL`
(default `http://localhost:8000`), and the API only accepts the origin set in
`UMBRA_FRONTEND_ORIGIN` (default `http://localhost:3000`). If Next.js picks a different
port because `:3000` is taken (e.g. `:3002`), pin them to match:

```bash
# terminal 1 — API, allowing the dashboard's actual origin
UMBRA_FRONTEND_ORIGIN=http://localhost:3002 uv run uvicorn backend.main:app --reload
# terminal 2 — dashboard on that same port
cd frontend && npm run dev -- -p 3002
```

If the API isn't reachable, the dashboard shows an **"API unavailable — start the backend
on :8000"** banner and falls back to the clearly-labelled sample shift.

**Demo mode (zero setup, no keys, no network):**

```bash
UMBRA_DEMO_MODE=true uv run uvicorn backend.main:app --reload
```

**Live mode on Codex credits alone (no OpenAI API key):** authenticate the CLI once with `codex login`, then:

```bash
UMBRA_DEMO_MODE=false UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true \
  uv run uvicorn backend.main:app --reload

# Optional preflight (verifies codex/git + a real clone; add the reasoning probe):
UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true UMBRA_PREFLIGHT_REASONING=true \
  uv run python -m backend.preflight
```

Both the engineering and reasoning halves run through the Codex CLI. See
[docs/live-mode.md](docs/live-mode.md) for the full guide and provider ledger.

## Configuration

Copy the sample env files and fill what you need (everything is optional in demo mode):

- Root: [`.env.example`](.env.example) — core toggles (`UMBRA_DEMO_MODE`, `UMBRA_ENABLE_LIVE_REPOS`,
  `UMBRA_ENABLE_CLOUD_SCAN`, `UMBRA_CLONE_DEPTH`, `UMBRA_FOUNDER_IDS`, `SESSION_SECRET`,
  `UMBRA_FERNET_KEY`, OAuth client IDs/secrets).
- Backend: [`backend/.env.example`](backend/.env.example). Frontend: [`frontend/.env.example`](frontend/.env.example) (`NEXT_PUBLIC_API_URL`).

Autonomy / plugin extras (hosted): `UMBRA_PUBLIC_URL` (absolute base for the plugin manifest). PR
auto-review is an **install-once GitHub App**: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_WEBHOOK_SECRET`, and `GITHUB_APP_PRIVATE_KEY` (PEM or base64; prod mounts it from Secret
Manager). Reviews are posted by the App via a short-lived installation token — no per-repo webhooks and
no stored user token. Full setup in [docs/github-app.md](docs/github-app.md). `GITHUB_TOKEN` is optional
and read-only (a zero-scope token just raises the public-read rate limit).

## Tests

```bash
uv run pytest        # 230 tests (backend/tests)
```

Frontend: `cd frontend && npm run build` (must produce a clean static export to `out/`).

## Deploy a public URL

Single service (FastAPI serves the built dashboard) on Google Cloud Run — one URL, no CORS.
Step-by-step: [docs/deploy.md](docs/deploy.md).

## License

[MIT](LICENSE) © 2026 Binay Dalai.
