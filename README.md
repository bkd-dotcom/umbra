# 🌑 Umbra — The AI engineer that works the night shift

Umbra is an autonomous AI engineering team for your GitHub repo. Five agents run
without prompting — hunting CVEs, reviewing PRs, tracing incidents, and killing
tech debt — then draft pull requests you review in the morning. **Codex does the
engineering; GPT-5.6 does the reasoning; you approve the merge.**

Built for **OpenAI Build Week 2026**. Recommended submission category: **Developer
Tools / Agents** (see [SUBMISSION.md](SUBMISSION.md)).

## 🧑‍⚖️ Test it (no rebuild required)

- **Live site:** [umbra.engineer](https://umbra.engineer) — hosted on Google Cloud Run. Sign in with
  **GitHub or Google**, then point the night crew at one of your own repos (public or private).
  Findings are **real** — OSV CVEs, dependency graph, git-history root-cause — and every result is
  labelled with what produced it.
- **In ChatGPT (plugin / GPT Action):** the read-only actions are public (no auth). Try the shared
  **Umbra Engineer** GPT, or wire it up yourself from the served schema:
  - Plugin manifest: <https://umbra.engineer/.well-known/ai-plugin.json>
  - OpenAPI (actions): <https://umbra.engineer/openapi-actions.yaml>
  - Build instructions: [`custom_gpt/`](custom_gpt/instructions.md) → e.g. *“Scan github.com/expressjs/express”*
- **Autonomous ("works while you sleep"):** drop [`.github/workflows/umbra.yml`](.github/workflows/umbra.yml)
  into any repo (add an `OPENAI_API_KEY` secret) — Umbra reviews every PR and runs a nightly scan
  that opens branch-only fix PRs. Or, on the hosted app, **Watch** a repo for scheduled rescans.

## 🤖 How Codex + GPT-5.6 are used

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

## 💻 Supported platforms

macOS · Linux · Windows (Python 3.11+, Node 20+). Any public GitHub repository. The ChatGPT plugin /
GPT Action works anywhere ChatGPT Actions are supported.

## 🔧 Run from source

The repo standardizes on [**uv**](https://docs.astral.sh/uv/):

```bash
git clone https://github.com/bkd-dotcom/umbra
cd umbra
uv sync --extra dev                        # backend deps + test tooling
uv run uvicorn backend.main:app --reload   # API at http://localhost:8000
cd frontend && npm install && npm run dev  # dashboard at http://localhost:3000
```

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

## ⚙️ Configuration

Copy the sample env files and fill what you need (everything is optional in demo mode):

- Root: [`.env.example`](.env.example) — core toggles (`UMBRA_DEMO_MODE`, `UMBRA_ENABLE_LIVE_REPOS`,
  `UMBRA_ENABLE_CLOUD_SCAN`, `UMBRA_CLONE_DEPTH`, `UMBRA_FOUNDER_IDS`, `SESSION_SECRET`,
  `UMBRA_FERNET_KEY`, OAuth client IDs/secrets).
- Backend: [`backend/.env.example`](backend/.env.example) · Frontend: [`frontend/.env.example`](frontend/.env.example) (`NEXT_PUBLIC_API_URL`).

Autonomy / plugin extras (hosted): `UMBRA_PUBLIC_URL` (absolute base for the plugin manifest),
`UMBRA_CRON_KEY` (guards the scheduled-rescan endpoint), `UMBRA_GITHUB_WEBHOOK_SECRET` +
`GITHUB_TOKEN` (PR auto-review webhook).

## ✅ Tests

```bash
uv run pytest        # 86+ tests (backend/tests)
```

Frontend: `cd frontend && npm run build` (must produce a clean static export to `out/`).

## 🚀 Deploy a public URL

Single service (FastAPI serves the built dashboard) on Google Cloud Run — one URL, no CORS.
Step-by-step: [docs/deploy.md](docs/deploy.md).

## 📄 License

[MIT](LICENSE) © 2026 Binay Dalai.
