# Umbra — OpenAI Build Week 2026 submission

> Working checklist mapped to the Devpost "What to submit" rules. One **`TODO`** remains:
> the **"Where Codex accelerated this build"** examples — fill with what Codex actually did.

## Category
**Developer Tools / Agents.** Umbra is an autonomous multi-agent engineering
teammate for GitHub repos, usable from a web app *and* from inside ChatGPT.
(Confirm against the exact category list on the submission form.)

## What it is / how it works
Umbra runs a crew of specialized agents against a GitHub repo:
- **Watchman** — resolves dependencies and checks them against **OSV.dev** for CVEs → an Umbra Score.
- **Reviewer** — scores blast-radius/risk on a pull request.
- **Detective** — traces an error/stack trace to a **root-cause commit** from real git history.
- **Janitor** — finds dead code / tech debt in a disposable checkout.
- **Ask Umbra** — answers questions about the codebase, grounded in real `file:line` references.

**Codex does the engineering** (`codex exec` in a disposable checkout — reads code, runs tests,
drafts diffs; never pushes/commits/merges). **GPT-5.6 does the reasoning** (Responses API tiers
Sol/Terra/Luna, or the Codex CLI's own GPT-5.6 model as fallback). Every result carries an **honesty
ledger** label naming what produced it; nothing is fabricated. Fix PRs are **branch-only** and only
opened on explicit request.

Surfaces:
- **Web app** — [umbra.engineer](https://umbra.engineer) (Cloud Run, single service).
- **ChatGPT plugin / GPT Action** — public read-only actions (`scanRepo`, `investigateIncident`,
  `askUmbra`).
- **Autonomous** — GitHub Actions night-shift (per-repo) + an **install-once GitHub App** (hosted): a
  user installs Umbra on their account/org (public or private repos) and every new PR gets an advisory
  review comment posted by the App via a short-lived installation token — comment-only, never merges.

## How Codex + GPT-5.6 were used (technical implementation)
- Live engineering: [`backend/codex_client.py`](backend/codex_client.py) — `codex exec --ephemeral -m <model>
  -c model_reasoning_effort=…` in a checkout with the origin remote removed; a hard no-push/no-merge prompt.
- Live reasoning: [`backend/reasoning.py`](backend/reasoning.py) — `client.responses.create/stream` with
  `reasoning={"effort": …}`; tiers `deep=gpt-5.6-sol`, `work=gpt-5.6-terra`, `fast=gpt-5.6-luna`.
- Streaming Ask/Detective: [`backend/agents/ask.py`](backend/agents/ask.py),
  [`backend/agents/detective.py`](backend/agents/detective.py) (first tokens in ~1–3s).

**Where Codex accelerated this build:** Codex wasn't a side copilot — it was the *primary engineer*.
Working from a single master build manual ([`UMBRA_MASTER_BUILD.md`](UMBRA_MASTER_BUILD.md)), Codex
built essentially the whole platform from scratch, phase by phase, committing and running tests after
each one to keep `main` runnable throughout:
- **Phases 0–2 — backend from zero:** the FastAPI app + async orchestrator/SSE event bus, all five
  agents ([`backend/agents/`](backend/agents/): watchman, reviewer, detective, janitor, ask), the
  Umbra/Risk scoring math with offline tests ([`backend/tests/test_scoring.py`](backend/tests/test_scoring.py)),
  the OSV + GitHub integrations, and the `demo_cache.json` never-fail fallback.
- **Phases 3–4 — the "mission control" dashboard:** the Next.js/Tailwind UI — animated Umbra Score
  dial, the Canvas [Threat Radar](frontend/components/Radar.tsx), the live SSE agent terminal, the
  Reasoning-Replay modal, and the dependency-graph / threat-scatter visualizations.
- **Phases 5–6 — judge surfaces + ship:** the Custom GPT [`openapi.yaml`](custom_gpt/openapi.yaml) +
  [`instructions.md`](custom_gpt/instructions.md), the [`.umbra/nightshift.md`](.umbra/nightshift.md)
  autonomy prompt + GitHub Actions workflow, then demo pre-caching, the Dockerfile, and deploy config.

Human work *after* that first Codex build was refinement, not authorship: fixing broken integrations,
UI polish, and broadening scope (the ChatGPT plugin surface, hosted autonomy, and multi-repo rollup).

**Codex `/feedback` session ID:** `019f66b8-a2ce-7103-aaed-2f60900d1aab`

## Code repository
<https://github.com/bkd-dotcom/umbra> — public, MIT licensed ([LICENSE](LICENSE)).
If kept private for judging, share with `testing@devpost.com` and `build-week-event@openai.com`.

## How judges test it (no rebuild needed)
1. **Web app:** open [umbra.engineer](https://umbra.engineer), sign in, scan a public repo (e.g.
   `github.com/expressjs/express`). Or use the **Public repo** tab without connecting GitHub.
2. **ChatGPT plugin / GPT Action:**
   - Manifest: <https://umbra.engineer/.well-known/ai-plugin.json>
   - OpenAPI: <https://umbra.engineer/openapi-actions.yaml>
   - In any paid ChatGPT (Plus/Team/Enterprise): **Create a GPT → Configure → Actions → Import from
     URL** → `https://umbra.engineer/openapi-actions.yaml` → Authentication **None** → paste
     [`custom_gpt/instructions.md`](custom_gpt/instructions.md) as the system prompt. The three actions
     validate against the live API immediately — no rebuild and no shared link needed.
   - Ask: *“Scan github.com/expressjs/express”*, *“Why did this break: <stack trace>”*, *“How does
     routing work in this repo?”*
3. **Autonomy:** add [`.github/workflows/umbra.yml`](.github/workflows/umbra.yml) to a repo with an
   `OPENAI_API_KEY` secret → open a PR to see the auto-review; the nightly cron opens branch-only fix PRs.

## Installation (plugin / dev tool)
- **Supported platforms:** any ChatGPT client that supports Actions; the API is language-agnostic
  HTTPS/JSON. Local dev: Python 3.11+, Node 20+ (see [README](README.md#-run-from-source)).
- **GPT Action setup:** ChatGPT → *Create a GPT* → *Actions* → *Import from URL* →
  `https://umbra.engineer/openapi-actions.yaml` → Authentication **None** → paste
  [`custom_gpt/instructions.md`](custom_gpt/instructions.md) as the system prompt.

## Demo video (<3 min) — script outline
1. **0:00–0:20** Hook: "Umbra is an AI engineering team that works the night shift." Show the dashboard.
2. **0:20–1:10** Live scan of a public repo → Umbra Score, real OSV advisories, dependency graph;
   call out the **honesty ledger** (say: *this is real OSV data, labelled `live-watchman`*).
3. **1:10–1:40** Ask Umbra + Detective **streaming** a grounded answer / root-cause commit in seconds.
4. **1:40–2:20** ChatGPT: open the Umbra GPT and *“Scan expressjs/express”* — same engine, inside ChatGPT.
5. **2:20–2:50** Autonomy: a PR gets an auto-review comment; mention nightly branch-only fix PRs.
6. **2:50–3:00** Close: **"Codex did the engineering, GPT-5.6 did the reasoning, I approve the merge."**
   Explicitly narrate where **Codex** and **GPT-5.6** were used (required by the rules).

## README with setup / sample data / running guidance
See [README.md](README.md) — uv setup, demo mode (zero-config sample results), live mode, env vars,
tests (`uv run pytest`), and deploy.
