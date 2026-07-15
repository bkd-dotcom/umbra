# 🌑 Umbra — The AI engineer that works the night shift

Umbra is an autonomous AI engineering team for your GitHub repo. Five agents run
without prompting — hunting CVEs, reviewing PRs, tracing incidents, and killing
tech debt — then draft pull requests you review in the morning. Codex does the
engineering; GPT-5.6 does the reasoning; you approve the merge.

## 🧑‍⚖️ Test it 3 ways (no rebuild required)

**1 — Custom GPT (in ChatGPT):** open **Umbra Engineer** → `Scan https://github.com/expressjs/express`
**2 — Live dashboard (0 setup):** https://umbra.engineer
**3 — Demo repo (real PRs):** https://github.com/<YOUR_GITHUB_USERNAME>/umbra-demo-target/pulls

## 🤖 How Codex + GPT-5.6 are used
- **Codex** (`codex exec`, ChatGPT login) explores a disposable checkout, edits
  code, runs tests in a sandbox, and drafts the change — no push, commit, or merge.
- **Reasoning** runs on **GPT-5.6**: the entitled Responses API (Sol/Terra/Luna)
  when available, otherwise the Codex CLI itself (which runs a GPT-5.6 model).
  Umbra runs live on **Codex credits alone — no OpenAI API key required.**
- **Honesty ledger:** every run labels each half with what actually served it
  (`codex-cli` / `osv.dev` / `local-git` / `responses-api` / `demo-cache` /
  `unavailable`). Reasoning is never fabricated. See [docs/live-mode.md](docs/live-mode.md).
- Built with Codex. Codex `/feedback` session ID: `<SESSION_ID>`

## 💻 Supported platforms
macOS · Linux · Windows (Python 3.11+). Any public GitHub repository.

## 🔧 Run from source
```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/umbra
cd umbra
pip install -e .
uvicorn backend.main:app --reload          # API at http://localhost:8000
cd frontend && npm install && npm run dev  # dashboard at http://localhost:3000
```

**Demo mode (zero setup, no keys, no network):**
```bash
UMBRA_DEMO_MODE=true uvicorn backend.main:app --reload
```

**Live mode on Codex credits alone (no OpenAI API key):** authenticate the CLI
once with `codex login`, then:
```bash
UMBRA_DEMO_MODE=false UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true \
  uvicorn backend.main:app --reload

# Optional preflight (verifies codex/git + a real clone; add the reasoning probe):
UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true UMBRA_PREFLIGHT_REASONING=true \
  python -m backend.preflight
```
Both the engineering and reasoning halves run through the Codex CLI. See
[docs/live-mode.md](docs/live-mode.md) for the full guide and provider ledger.
