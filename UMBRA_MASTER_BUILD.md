# 🌑 UMBRA — Master Codex Build Manual (paste this whole file into Codex)

> **You are Codex. This is your complete, self-contained build spec. Read it fully, then start at §11 "START HERE" and build in phase order.**
> Umbra is a submission for OpenAI Build Week 2026 — **Developer Tools** track. Deadline **Jul 21, 2026, 5 PM PT**. Optimize for a polished, coherent product and a bulletproof demo, not feature count.

---

## 0. How to use this manual

**For the human (set in the Codex UI before running):**
- Start on **`gpt-5.6-sol`**, reasoning effort **`high`** (use **`xhigh`** for §6 Phase 3 orchestration/Codex-integration work).
- After the skeleton is stable (end of Phase 2), switch to **`gpt-5.6-terra`** for routine feature/UI work to conserve credits; **`gpt-5.6-luna`** for boilerplate/docs.

**For you (Codex):** Work phase by phase. After each phase: commit, run tests, print a short status, continue. If a detail isn't specified, choose the simplest option that keeps the demo working and note it in the commit — never stall. Files in §10 must be created **verbatim** at their stated paths.

**Three pre-flight facts to verify from official docs (`developers.openai.com` / `learn.chatgpt.com/docs`) before wiring — do not assume:**
1. Exact current **Codex model ID** and the Codex SDK/CLI invocation.
2. Exact **Codex GitHub Action** name/version (`.github/workflows/umbra.yml` has a `TODO(verify)`).
3. The **Responses API** request shape for `gpt-5.6-*` reasoning models.
Isolate anything unconfirmed behind an adapter with a working stub + `TODO(verify)` so the app always runs.

---

## 1. Mission

Build **Umbra** — *"the AI engineer that works the night shift."* An autonomous system that watches a GitHub repo and, without human prompting, hunts vulnerabilities, reviews PRs, investigates incidents, and kills tech debt — then **drafts pull requests a human reviews in the morning.** A "mission control" dashboard visualizes everything it did.

**The whole thesis (implement it faithfully):**
- **Codex** (OpenAI Codex APIs/SDK/CLI at runtime) *does the engineering*: explores the repo, edits code, runs tests, drafts the diff/PR.
- **GPT‑5.6 via the Responses API** *does the reasoning*: severity, blast radius, root-cause chains, risk scores, plain-English explanations.

---

## 2. Operating rules

1. **Build incrementally.** One phase at a time; commit after each; keep `main` runnable at every commit.
2. **Verify API facts before wiring** (see §0). Isolate unconfirmed calls behind adapters with stubs.
3. **Never hardcode secrets.** All keys from env. Ship `.env.example`. Never commit a real key.
4. **Never auto-merge.** Umbra only opens branches/PRs; humans merge. Enforce in code.
5. **Everything degrades to a cached demo.** Every API-backed endpoint returns live data if available, else bundled `demo_cache.json` that never fails. The demo must work with zero network (`UMBRA_DEMO_MODE=true`).
6. **Use placeholders** for unknowns (`<YOUR_GITHUB_USERNAME>`, `<REPO>`). Don't block.
7. **Respect the cut line (§7).** Ship CORE before anything STRETCH.
8. **Write fast, offline tests** for the orchestrator, scoring math, and cache fallback (mock model calls).

---

## 3. Locked tech stack (do not deviate)

| Layer | Choice |
|-------|--------|
| Backend / orchestrator | **Python 3.11 + FastAPI** (async; SSE; auto OpenAPI for the Custom GPT) |
| Reasoning calls | **OpenAI Responses API** — `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` with `reasoning.effort` |
| Code operations | **OpenAI Codex** at runtime — behind `backend/codex_client.py` adapter |
| Vulnerability data | **OSV.dev API** |
| GitHub | `PyGithub` for reads; prefer Codex Cloud for PR creation |
| Frontend | **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Framer Motion**; Canvas radar; `d3-force` graph |
| Streaming | **SSE** from FastAPI → Agent Terminal + Ask Umbra |
| Deploy | Frontend **Vercel** (domain `umbra.engineer`), FastAPI on **Render/Railway/Fly** |
| Packaging | `pyproject.toml`; judge-facing `README.md` |

**Brand:** near-black canvas; accents **deep violet `#7C3AED`** + **pale cyan `#22D3EE`**; glassmorphism panels; aurora/spotlight background; `Inter`/`Geist`; UMBRA wordmark in wide-tracked all-caps. Motion: panel entrances, number count-ups, radar sweep, kill-chain draw-on.

---

## 4. Repository layout

```
umbra/
├─ README.md                     # judge quick-start (§10)
├─ .env.example                  # (§10)
├─ pyproject.toml
├─ backend/
│  ├─ main.py                    # FastAPI app, routes, SSE, OpenAPI
│  ├─ orchestrator.py            # schedules agents, emits events, caches
│  ├─ codex_client.py            # ADAPTER around Codex (Cloud/SDK/CLI)
│  ├─ reasoning.py               # Responses API wrapper + model routing (§5)
│  ├─ scoring.py                 # Umbra Score + Risk Score math (+ tests)
│  ├─ agents/  watchman.py reviewer.py detective.py janitor.py ask.py
│  ├─ integrations/  osv.py github.py
│  ├─ cache/ demo_cache.json     # fallback that never fails
│  └─ tests/
├─ frontend/                     # Next.js "Umbra HQ"
│  └─ app/  components/  lib/
├─ custom_gpt/  openapi.yaml  instructions.md   # (§10)
├─ .umbra/  nightshift.md                        # (§10)
└─ .github/workflows/umbra.yml                   # (§10)
```

---

## 5. Runtime model routing (implement `backend/reasoning.py`)

Reasoning models use `effort`, **not** `temperature`. Use the **Responses API**:

```python
# backend/reasoning.py
from openai import OpenAI
client = OpenAI()

MODELS = {
    "deep":  ("gpt-5.6-sol",   "high"),   # Detective/Watchman/Reviewer synthesis (xhigh for Detective)
    "work":  ("gpt-5.6-terra", "medium"), # default agent reasoning, Ask Umbra
    "fast":  ("gpt-5.6-luna",  "low"),    # summaries, commit msgs, digest, docstrings
}

def reason(tier, developer, user, effort=None):
    model, default_effort = MODELS[tier]
    resp = client.responses.create(
        model=model,
        reasoning={"effort": effort or default_effort},
        input=[
            {"role": "developer", "content": developer},
            {"role": "user", "content": user},
        ],
    )
    return resp.output_text
```

`backend/codex_client.py` is the adapter that performs **code operations** (read repo, produce diff, run tests, open PR) by delegating to Codex — prefer Codex Cloud task delegation, fall back to non-interactive CLI. Every call returns `{diff, summary, tests_passed, files[]}` and records the prompt + result for **Reasoning Replay**. Keep the exact invocation here with `TODO(verify)`.

---

## 6. Build order (phases + acceptance criteria)

**Phase 0 — Scaffold (start here):** repo layout (§4), `pyproject.toml`, `.env.example`, FastAPI `/api/health`, branded Next.js Umbra HQ shell. *Accept:* `uvicorn` serves `/api/health`; dashboard loads with the brand system.

**Phase 1 — Integration layer:** `reasoning.py` (§5), `codex_client.py` adapter, `integrations/osv.py`, `integrations/github.py`, `scoring.py` (+tests), orchestrator event bus with SSE + `demo_cache.json` fallback. *Accept:* SSE emits mock agent events; tests pass offline.

**Phase 2 — Core agents (the 5):** each returns structured results + a Reasoning-Replay record:
1. **Watchman** — OSV scan → Sol threat analysis + kill chain → Codex drafts version-bump fix PR.
2. **Reviewer** — Codex code review of a PR diff → GPT‑5.6 adds Risk Score (0–100), blast radius, missing-test detection.
3. **Detective** — error/stack trace → Codex surveys recent commits → Sol `xhigh` root-cause chain + fix PR.
4. **Janitor** — Codex Cloud full-repo dead-code/debt sweep → focused cleanup PRs; Terra prioritizes/explains.
5. **Ask Umbra** — Codex reads relevant files → Terra answers with `file:line` refs, streamed over SSE.
*Accept:* each runs end-to-end on a real public repo; output renders in the terminal + populates cache.

**Phase 3 — Dashboard core (xhigh effort):** Umbra Score hero (animated) · Threat Radar (Canvas) · Agent Terminal (live SSE) · **Reasoning Replay modal** (prompt → Codex diff → tests → GPT‑5.6 chain → per-step timing). *Accept:* every action inspectable via Reasoning Replay.

**Phase 4 — Signature features:** Kill Chain Viewer (animated) · Dependency Galaxy (`d3-force`) · Ask Umbra chat overlay · AI-vs-Human comparison · Secret Scanner (regex + GPT‑5.6 filters test fixtures) · ROI calculator · Benchmark mode (pre-computed). Fold OWASP tags onto Watchman findings.

**Phase 5 — Judge surfaces & autonomy:** create `custom_gpt/openapi.yaml`, `custom_gpt/instructions.md`, `.umbra/nightshift.md`, `.github/workflows/umbra.yml` (all verbatim from §10) + a seed script for the demo repo.

**Phase 6 — Harden & ship:** pre-cache all demo results · finalize README (§10) · Dockerfile(s) · deploy configs (Vercel + backend) · verify the full demo path runs offline from cache · run the demo path 10×.

---

## 7. Scope discipline

**CORE (first, in order):** 5 agents · dashboard core (Phase 3) · Kill Chain + Dependency Galaxy + Ask Umbra + Secret Scanner + ROI + Benchmark · Custom GPT + demo repo.

**STRETCH (only after CORE is deployed & demo-tested):** Scribe (docs PRs) · Forecaster (7-day risk weather panel) · Code Sonification easter egg · License/SBOM · Architecture-drift detector · Weekly Digest (static panel) · standalone CLI · GitHub App.

**CUT LINE (a complete product even if time runs out):** Watchman + Reviewer + Detective · dashboard core (Score/Radar/Terminal/Reasoning Replay) · Custom GPT · seeded demo repo. Protect this above all.

---

## 8. Environment & secrets

Refuse to start if `OPENAI_API_KEY` is missing unless `UMBRA_DEMO_MODE=true`. Load via env only.

---

## 9. Definition of done (per surface)

- **Dashboard:** zero-setup, pre-seeded, every action opens Reasoning Replay, works offline from cache.
- **Custom GPT:** `openapi.yaml` validates; a judge can `Scan https://github.com/expressjs/express` and get results.
- **Demo repo:** contains real Umbra PRs (CVE fix, cleanup, caught secret) visible on GitHub.
- **README:** three test surfaces, setup, sample data, and a paragraph on how Codex + GPT‑5.6 are used.

---

## 10. Files to create verbatim

> Create each of the following at its stated path exactly as given.

### 10.1 `backend/.env.example` (also root `.env.example`)

````bash
OPENAI_API_KEY=
GITHUB_TOKEN=
OSV_API_BASE=https://api.osv.dev/v1
UMBRA_DEMO_MODE=false        # true forces the cached fallback (safe demo)
````

### 10.2 `custom_gpt/openapi.yaml`
> Before deploying: replace the server URL with your deployed FastAPI host. Auth "None" for frictionless judge testing (rate-limit server-side).

````yaml
openapi: 3.1.0
info:
  title: Umbra Engineer API
  description: >
    Umbra is an autonomous AI engineering team. These actions scan a public
    GitHub repository for vulnerabilities, dead code, and leaked secrets;
    investigate a production incident to find its root cause; and answer
    natural-language questions about a codebase. Codex performs the code
    operations; GPT-5.6 performs the reasoning.
  version: "1.0.0"
servers:
  - url: https://api.umbra.engineer
    description: Umbra backend (replace with your deployed host)
paths:
  /api/scan:
    post:
      operationId: scanRepo
      summary: Scan a public GitHub repository for security and code-health issues.
      description: >
        Call this when the user pastes or names a GitHub repository and wants a
        health/security scan. Returns an Umbra Score (0-100), known CVEs in
        dependencies, dead code, leaked secrets, and a short risk forecast.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [repo_url]
              properties:
                repo_url:
                  type: string
                  description: Full URL of a public GitHub repository.
                agents:
                  type: array
                  description: Optional subset of agents. Defaults to all core agents.
                  items:
                    type: string
                    enum: [watchman, reviewer, janitor, detective]
      responses:
        "200":
          description: Scan results.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ScanResult"
  /api/investigate:
    post:
      operationId: investigateIncident
      summary: Investigate a production incident and find the root-cause commit.
      description: >
        Call this when the user provides an error message, stack trace, or
        symptom for a given repository. Returns a structured root-cause analysis
        with a suggested fix.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [repo_url, error_log]
              properties:
                repo_url: { type: string, description: Full URL of the public GitHub repository. }
                error_log: { type: string, description: Error message, stack trace, or symptom. }
      responses:
        "200":
          description: Root-cause analysis.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Postmortem"
  /api/ask:
    post:
      operationId: askUmbra
      summary: Ask a natural-language question about a codebase.
      description: >
        Call this when the user asks how a repository works, what would break if
        they change something, or where a behavior lives. Returns an answer
        grounded in specific file and line references.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [repo_url, question]
              properties:
                repo_url: { type: string, description: Full URL of the public GitHub repository. }
                question: { type: string, description: The user's question about the codebase. }
      responses:
        "200":
          description: Answer with code references.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Answer"
components:
  schemas:
    ScanResult:
      type: object
      properties:
        repo_url: { type: string }
        umbra_score: { type: integer, description: "0-100 (higher is better)." }
        vulnerabilities:
          type: array
          items:
            type: object
            properties:
              package: { type: string }
              version: { type: string }
              cve: { type: string }
              severity: { type: string, enum: [critical, high, medium, low] }
              owasp: { type: string }
              summary: { type: string }
        dead_code:
          type: array
          items:
            type: object
            properties:
              file: { type: string }
              symbol: { type: string }
              kind: { type: string, enum: [unused_function, unused_import, orphaned_env, dead_variable] }
        secrets:
          type: array
          items:
            type: object
            properties:
              file: { type: string }
              line: { type: integer }
              kind: { type: string }
              confidence: { type: number }
        missing_docs_count: { type: integer }
        risk_forecast: { type: string }
        reasoning_summary: { type: string }
    Postmortem:
      type: object
      properties:
        incident: { type: string }
        root_cause_commit: { type: string }
        confidence: { type: number }
        timeline: { type: array, items: { type: string } }
        explanation: { type: string }
        blast_radius: { type: string }
        suggested_fix: { type: string }
        reasoning_chain: { type: array, items: { type: string } }
    Answer:
      type: object
      properties:
        answer: { type: string }
        references:
          type: array
          items:
            type: object
            properties:
              file: { type: string }
              lines: { type: string }
              note: { type: string }
        blast_radius: { type: string }
````

### 10.3 `custom_gpt/instructions.md`
> Copy each field into ChatGPT → Create a GPT → Configure. Paste `openapi.yaml` under Actions → Schema.

`````markdown
## Name
Umbra Engineer 🌑

## Description
The AI engineer that works in the shadows. Paste any public GitHub repo and I'll
scan it for vulnerabilities, dead code, and leaked secrets, investigate incidents
to find the root-cause commit, and answer questions about the codebase — powered
by Codex + GPT-5.6.

## Instructions (system prompt)
You are Umbra Engineer — an autonomous AI engineering teammate. You help users
assess and understand GitHub repositories. Codex performs the code operations
behind your Actions; GPT-5.6 performs the reasoning. You never claim to merge or
deploy anything — you only analyze and suggest.

WHEN TO CALL EACH ACTION
- Repo + wants a scan/health check/security review → scanRepo.
- Error, stack trace, or "why is X failing" for a repo → investigateIncident.
- "How does this work" / "what breaks if I change X" → askUmbra.
- No repo URL present → ask for one first. Accept "owner/repo" and normalize to
  https://github.com/owner/repo.

HOW TO PRESENT A SCAN (fill from the response):
🌑 Umbra Scan — <repo>
📊 Umbra Score: <score>/100  <🟢 90+ / 🟡 70-89 / 🟠 40-69 / 🔴 <40>
🛡️ Vulnerabilities: <n>
   • <package> v<version> (<cve>) — <SEVERITY>  [<owasp>]
🧹 Dead code: <n> items
🔑 Secrets: <n> suspected  (list only confidence ≥ 0.6)
📝 Missing docs: <n> functions
🔮 Risk forecast: <risk_forecast>
Then 1-2 sentences from reasoning_summary. End by offering to investigate a
vulnerability, trace an incident, or answer a question.

INVESTIGATION: lead with root-cause commit + confidence, then timeline,
explanation, blast radius, suggested fix; show reasoning_chain as a short list.
ANSWER: answer first, then a References list of file:lines, then blast radius.

STYLE: concise, technical, calm. Use findings verbatim — never invent CVEs,
commits, files, or line numbers. Empty category → "none found". Action failure →
say so and suggest the live dashboard at umbra.engineer.

GUARDRAILS: read/analyze only; never approve, merge, deploy, or run code; never
fabricate results not returned by an Action.

## Conversation starters
Scan https://github.com/expressjs/express
Investigate: 500 errors on /api/users after yesterday's deploy
What would break if I change the database schema in this repo?
Scan facebook/react and show me the top security risks

## Capabilities
Web Browsing: Off · Code Interpreter: Off · Image generation: Off
(All data comes from Actions — deterministic for judges.)

## Actions
Authentication: None. Schema: paste openapi.yaml.
Privacy policy URL: https://umbra.engineer/privacy  (required to publish a GPT).

## Publish
Visibility: Anyone with the link. Put the link in the Devpost README.
`````

### 10.4 `.umbra/nightshift.md`
> The prompt the Codex GitHub Action runs autonomously (nightly + on PR).

`````markdown
You are **Umbra**, an autonomous AI engineering teammate running in CI on this
repository. You act without human prompting. Prime directive: **improve the
codebase while never merging, deploying, or breaking `main`.** You only open
branches and pull requests that a human reviews.

## Hard rules (never violate)
1. Never push to main/master; never merge/approve; never force-push.
2. Every change lives on a branch `umbra/<agent>/<slug>`.
3. Run the repo's tests on any branch you create. If they fail or can't run,
   open the PR as a Draft and say so.
4. Only open a PR when confidence is high; otherwise open an Issue.
5. Never commit secrets. If you find a leaked secret, reference it by file:line
   and kind only — never include the value.
6. Respect the Budgets below. Keep each PR small and focused.
7. Detect the stack and follow the project's existing conventions. Make the
   minimum change that achieves the goal.

## Mode A — on pull_request (Reviewer)
Post ONE review comment (do not approve/request-changes):

## 🌑 Umbra Review — PR #<n>
### Risk Score: <0-100>  <🟢 LOW / 🟡 MED / 🟠 HIGH / 🔴 CRITICAL>
**Blast radius:** <modules importing the changed code>
**Missing tests:** <uncovered lines/error paths, or "none">
**Pattern notes:** <inconsistencies vs the codebase, or "none">
**Security:** <risk introduced, or "none">
**Recommendation:** <merge / add tests first / needs discussion>

Risk = (files_changed*5)+(blast_radius*15)+(missing_tests*20)+(touches_auth*25)
+(touches_payments*25)+(pattern_violations*10), capped at 100. Cite file:line.
Don't restate the diff; don't nitpick what the linter already enforces.

## Mode B — nightly schedule (night shift)
Run in order; open a separate focused PR per category (skip empty categories):
1. Watchman (security): check deps against OSV; for confirmed CVEs bump to the
   nearest patched version, fix breaking changes, run tests, open PR
   `fix(security): patch <pkg> (<CVE>)` with severity, attack vector, blast
   radius, OWASP mapping.
2. Janitor (tech debt): remove dead code/unused imports/orphaned env vars without
   changing behavior, run tests, open PR `chore(cleanup): remove dead code` with
   a one-line reason per removal.
3. Secret scan: if a real credential is committed, open a security ISSUE (not a
   PR) titled "⚠️ possible leaked secret" referencing only file:line + kind.

## PR body template
## 🌑 Umbra — <agent> · <summary>
**What changed & why:** <plain English>
**Reasoning:** <the analysis that led here — audit trail>
**Tests:** <passed / failed / not run + why>
**Confidence:** <0-100>%
> Umbra opened this branch autonomously. It never merges — this needs your review.

Labels: `umbra` + one of `security`/`cleanup`/`docs`.

## Budgets (per nightly run)
Max 5 PRs total; max 1 security PR per distinct CVE; skip files >1500 lines
unless they're the direct subject of a fix; if nothing actionable, exit 0.

## Output
End with a one-paragraph summary of branches/PRs/issues opened, tests run, and
anything skipped and why (appears in the Action logs).
`````

### 10.5 `.github/workflows/umbra.yml`

````yaml
name: Umbra Night Shift
on:
  pull_request:
  schedule:
    - cron: "17 3 * * *"   # 03:17 nightly — the night shift
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
  issues: write
jobs:
  umbra:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Run Umbra (Codex)
        uses: openai/codex-action@v1        # TODO(verify) exact action name/version in Codex docs
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          model: gpt-5.6-sol
          prompt-file: .umbra/nightshift.md
````

### 10.6 `README.md` (judge-facing)

`````markdown
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
- **Codex** (Codex Cloud / SDK / GitHub Action / native code review) explores the
  repo, edits code, runs tests in a sandbox, and drafts the pull requests.
- **GPT-5.6 Sol** does the deep reasoning — root-cause chains, blast-radius, and
  threat modeling; **Terra** handles everyday reasoning and Ask Umbra; **Luna**
  handles summaries and docstrings.
- Built with Codex. Codex `/feedback` session ID: `<SESSION_ID>`

## 💻 Supported platforms
macOS · Linux · Windows (Python 3.11+). Any public GitHub repository.

## 🔧 Run from source
```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/umbra
cd umbra
cp backend/.env.example backend/.env      # add OPENAI_API_KEY (+ GITHUB_TOKEN)
pip install -e .
uvicorn backend.main:app --reload          # API at http://localhost:8000
cd frontend && npm install && npm run dev  # dashboard at http://localhost:3000
```
Set `UMBRA_DEMO_MODE=true` to run the fully cached demo with no API keys.
`````

---

## 11. START HERE

Begin **Phase 0**: create the repository layout in §4, initialize the FastAPI backend (`/api/health`) and a branded Next.js Umbra HQ shell (§3), add `.env.example` and a minimal test, commit as `chore: scaffold Umbra (Phase 0)`, print status, and proceed to Phase 1. Confirm the current Codex model ID and Responses API shape (§0) before writing `codex_client.py` / `reasoning.py`. Create the §10 files verbatim when you reach the phase that needs them. Respect the cut line (§7) at all times.
