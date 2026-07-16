# 🌑 UMBRA — Live Agents Build Manual (paste this whole file into Codex)

> **You are Codex. This is a self-contained, incremental build spec. Read it fully, then start at §12 "START HERE" and build in phase order.**
> Goal: extend the **real, guarded live-execution pattern** that already works for **Watchman** to the four remaining agents — **Reviewer, Detective, Janitor, Ask Umbra** — so that Umbra's core thesis ("Codex does the engineering; GPT‑5.6 does the reasoning") is *actually executed at runtime for every agent*, not replayed from a cache.
>
> **Non-negotiable:** demo mode stays offline and honest; nothing is ever fabricated; failures are labelled, never disguised as success. If a step can't be verified live, report it truthfully.

---

## 0. How to use this manual

**For the human (set in the Codex UI before running):**
- Model **`gpt-5.6-sol`**, reasoning effort **`high`** (**`xhigh`** for Phase 3 Detective work).
- After the shared infrastructure is stable (end of Phase 1), switch to **`gpt-5.6-terra`** for routine work to conserve credits.

**For you (Codex):** Work phase by phase. After each phase: run the full offline test suite (`UMBRA_DEMO_MODE=true`), commit, print a short status, continue. If a detail isn't specified, choose the simplest option that keeps the demo working and note it in the commit — never stall.

**Verify before wiring (do not assume — confirm against `codex --help` and the OpenAI Responses API docs):**
1. Exact `codex exec` flags for a **read-only** sandbox (this manual assumes `--sandbox read-only`; the existing write path uses `--sandbox workspace-write`).
2. The **Responses API streaming** shape for `client.responses` (this manual assumes a streaming iterator; confirm the exact method + event names).
3. That the configured API project actually has **entitlement to `gpt-5.6-sol/terra/luna`** (see §11 pre-flight; a `team_model_access_denied` 403 must degrade to `reasoning: unavailable`, never to a substituted model or fabricated text).

---

## 1. Current state (read before changing anything)

The repo already contains a **working, honest live path for Watchman only.** Study it first — it is the template you will replicate:

- `backend/codex_client.py` — `CodexClient.propose(prompt, files, repo_path)` shells out to `codex exec` (`--ephemeral --sandbox workspace-write --ask-for-approval never --output-last-message ... -C <checkout>`), captures the real `git diff`, and returns a `CodexOperation`. Guarded by `UMBRA_ENABLE_CODEX_CLI=true`. Demo/disabled/fallback paths return **empty diffs** with honest providers (`demo-cache`, `codex-cli-disabled`, `cache-fallback`).
- `backend/integrations/repository.py` — `checkout_public_repo(repo_url)` clones a public repo `--depth 1` into a temp dir and **removes the `origin` remote** so pushing is impossible. Guarded by `UMBRA_ENABLE_LIVE_REPOS=true`.
- `backend/integrations/dependencies.py` — `discover_dependencies(repo_path)` parses `package.json` / `requirements.txt` without executing code.
- `backend/integrations/osv.py` — `OSVClient.query(package, version, ecosystem)`.
- `backend/reasoning.py` — `reason(tier, developer, user, effort)` → `ReasoningResult`. Tiers: `deep`→sol/high, `work`→terra/medium, `fast`→luna/low. Demo mode returns a labelled `demo-cache` result; a failed request raises `RuntimeError` (caller degrades).
- `backend/agents/base.py` — `AgentResult(agent, summary, findings, replay)` and `Replay(agent, prompt, codex_diff, tests, reasoning, timings, providers)`. **`providers` is the honesty ledger** — `{"vulnerabilities": ..., "reasoning": ..., "engineering": ...}`.
- `backend/agents/watchman.py` — the reference implementation. `run()` → `_live_enabled()` gate → `_run_live()` (clone → OSV → `reason("deep")` → `codex.propose(repo_path=...)`, each provider labelled, failures caught individually) → `_cached_result(note)` on any exception.
- `backend/orchestrator.py` — `scan()` promotes a live Watchman result to the **top-level** response (`source: live-watchman`) when `providers["vulnerabilities"] == "osv.dev"`, else `source: demo-cache`.

**Still cached façades (this manual makes them live):** `backend/agents/reviewer.py`, `detective.py`, `janitor.py`, `ask.py` — they load `demo_cache.json` and return hardcoded reasoning with a stubbed `codex.propose()` (no `repo_path`). No live model/Codex call happens in any of them today.

**The four env flags that gate liveness (all must be true, checked by each agent's `_live_enabled()`):**
```
UMBRA_DEMO_MODE=false
UMBRA_ENABLE_LIVE_REPOS=true
UMBRA_ENABLE_CODEX_CLI=true
OPENAI_API_KEY=<entitled key>
```

---

## 2. The pattern every agent must follow (the contract)

Each agent gets the same shape as Watchman. **Copy this structure exactly:**

```python
class <Agent>:
    def __init__(self, codex=None, ...):
        self.codex = codex or CodexClient()
        # + any integration clients

    async def run(self, ...):
        if self._live_enabled():
            try:
                return await self._run_live(...)
            except Exception as exc:
                return self._cached_result(f"Live <Agent> unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        return (
            os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true"
            and live_repositories_enabled()
            and CodexClient.enabled()
            and bool(os.getenv("OPENAI_API_KEY"))
        )
```

**Rules for `_run_live` (all agents):**
1. Do real work inside `checkout_public_repo(...)` (disposable clone, no remote).
2. Call `reason(tier, developer, user)` for the reasoning half; catch its `RuntimeError` and set `reasoning_provider="unavailable"` with the error text — **never** substitute a model or invent text.
3. Call `self.codex.propose(prompt, repo_path=repo_path, read_only=<bool>)` for the engineering half; catch failure → provider `"unavailable"`.
4. Record wall-clock timings per phase (`perf_counter`).
5. Populate `Replay.providers` with the true provider of each half.
6. `_cached_result(note)` uses `codex.cached_fallback(...)` and clearly labels the result as cached (never blends live + cache silently).

**Read vs write sandbox per agent:**
| Agent | Codex sandbox | Why |
|-------|---------------|-----|
| Watchman | `workspace-write` | produces a dependency-bump diff |
| Janitor | `workspace-write` | produces a cleanup diff |
| Detective | `workspace-write` | may produce a minimal fix diff |
| Reviewer | `read-only` | reviews a diff; must not edit |
| Ask Umbra | `read-only` | answers questions; must not edit |

---

## 3. Shared infrastructure to build first (Phase 1)

Before touching the agents, add these reusable pieces. Keep each small and tested offline.

### 3.1 `CodexClient.propose(..., read_only: bool = False)`
Add a `read_only` parameter. When true, invoke `codex exec` with `--sandbox read-only` (verify flag) and set `provider="codex-cli"` still, but the captured `git diff` is expected to be empty (assert/allow empty). Update `_run_cli` to branch the `--sandbox` value. Preserve the redaction of the agent prompt from the recorded `command`.

### 3.2 `reasoning.py` — streaming for Ask Umbra
Add:
```python
def reason_stream(tier, developer, user, effort=None) -> Iterator[str]:
    """Yield text chunks. Demo mode yields one labelled cached sentence.
    On failure, yield nothing and raise RuntimeError (caller degrades)."""
```
Use the Responses API streaming interface (verify exact shape). In demo mode, yield a single labelled `demo-cache` sentence. Keep the non-streaming `reason()` unchanged.

### 3.3 `integrations/github.py` — PR diff reads (for Reviewer)
Add read-only helpers (no write scopes ever):
```python
def fetch_pull_request(repo_url: str, pr_number: int) -> dict:
    """Return {number, title, head_sha, base_sha, changed_files:[...], diff:str}.
    Prefer the public patch endpoint (https://github.com/<owner>/<repo>/pull/<n>.diff)
    so it works without a token; use GITHUB_TOKEN when present for rate limits."""

def latest_open_pull_request(repo_url: str) -> int | None:
    """Return the newest open PR number, or None. Requires GITHUB_TOKEN or the
    public API; return None (not an error) when unavailable."""
```
Cap the diff at a sane size (e.g. 200 KB) and skip files > 1500 lines, matching `.umbra/nightshift.md` budgets.

### 3.4 `integrations/history.py` — local git history (for Detective, token-free)
```python
def recent_history(repo_path: Path, limit: int = 20) -> list[dict]:
    """Run `git log`/`git show --stat` inside the disposable checkout and return
    [{sha, subject, files:[...]}]. No network, no token — reads the local clone."""
```
Prefer this over the GitHub API for Detective: the repo is already cloned, so history is free and offline-capable within the checkout.

### 3.5 OSV severity fix (correctness, carried from audit)
In `watchman._normalize_advisories`, read severity from the OSV `severity` array (CVSS vector → bucket) first, then fall back to `database_specific.severity`, then `"unknown"`. Add a unit test with a realistic OSV payload.

*Accept Phase 1:* full offline suite green; `reason_stream` yields a labelled sentence in demo mode; `fetch_pull_request` parses a saved `.diff` fixture; `recent_history` reads a tiny git repo created in `tmp_path`.

---

## 4. Phase 2 — Reviewer (live)

**Live inputs:** a PR to review. Add an optional `pr_number` to the scan request (see §8); if absent, try `latest_open_pull_request`; if still none, return the cached reviewer result labelled as such (do **not** fabricate a review).

**`_run_live(repo_url, pr_number)`:**
1. `fetch_pull_request(repo_url, pr_number)` → diff + changed files.
2. `checkout_public_repo(repo_url)`; (optionally checkout the PR head — if not feasible offline, review the diff text directly).
3. Compute the deterministic `risk_score(RiskInputs(...))` from the real diff (files_changed, missing_tests, touches_auth/payments detected from paths) — this math already exists in `scoring.py`, keep it.
4. `codex.propose(<review prompt>, repo_path=repo_path, read_only=True)` — ask Codex to identify concrete regressions, missing tests, and pattern violations in the diff. Capture its summary (no diff expected).
5. `reason("deep", ...)` — GPT‑5.6 Sol synthesizes: blast radius (modules importing the changed code), missing-test narrative, security note, and a merge recommendation. Feed it the diff + Codex's review notes.
6. Findings: `{risk_score, severity, blast_radius, missing_tests, recommendation}`. Providers: `{review:"codex-cli", reasoning:"responses-api", risk:"deterministic"}`.

*Accept:* on a repo with an open PR, Reviewer returns a real Risk Score + Codex review notes + GPT‑5.6 blast-radius narrative; with no PR it returns a clearly-labelled cached review.

---

## 5. Phase 3 — Detective (live, `xhigh` — the GPT‑5.6 showcase)

**Live inputs:** `repo_url` + `error_log`.

**`_run_live(repo_url, error_log)`:**
1. `checkout_public_repo(repo_url)`.
2. `recent_history(repo_path)` — local `git log`/`git show --stat` (token-free).
3. `codex.propose(<survey prompt: correlate the error with recent commits/diffs; identify the most likely culprit commit; propose the minimal fix>, repo_path=repo_path, read_only=False)` — Codex may produce a minimal fix diff.
4. `reason("deep", ..., effort="xhigh")` — GPT‑5.6 Sol builds the root-cause **chain**: `root_cause_commit`, `confidence`, `timeline[]`, `explanation`, `blast_radius`, `suggested_fix`, `reasoning_chain[]`. Feed it the error log + history + Codex's findings/diff.
5. Findings shape must match the `Postmortem` schema in `custom_gpt/openapi.yaml` (so `/api/investigate` stays contract-compatible). Providers: `{history:"local-git", reasoning:"responses-api", engineering:"codex-cli"}`.
6. Guard: if the model returns a commit SHA not present in `recent_history`, discard it and mark `root_cause_commit: "unconfirmed"` — never surface a fabricated SHA.

*Accept:* on a real repo + a plausible error, Detective returns a root-cause chain whose cited commit exists in the clone; the `xhigh` reasoning is visible in the replay.

---

## 6. Phase 4 — Janitor (live — the natural real-diff demonstration)

**Live inputs:** `repo_url` only. This is the easiest agent to prove a **real Codex diff**, because dead code almost always exists.

**`_run_live(repo_url)`:**
1. `checkout_public_repo(repo_url)`.
2. `codex.propose(<sweep prompt: find behavior-preserving dead code / unused imports / orphaned env vars; make the smallest focused change; run available tests; do not push/merge>, repo_path=repo_path, read_only=False)` — Codex produces a real cleanup diff + test result.
3. Parse the changed files from the operation; build `findings` as `[{file, symbol?, kind}]` (derive `kind` from the diff where possible, else `"cleanup"`).
4. `reason("work", ...)` — GPT‑5.6 Terra prioritizes and explains the cleanup in plain English.
5. Providers: `{engineering:"codex-cli", reasoning:"responses-api"}`. The replay's `codex_diff` is the **real** diff and `tests` is Codex's actual final message.

*Accept:* on a real repo, Janitor's replay contains a non-empty diff produced by Codex and a Terra explanation; with Codex disabled it returns a labelled cached sweep.

---

## 7. Phase 5 — Ask Umbra (live + streamed)

**Live inputs:** `repo_url` + `question`.

**`_run_live(repo_url, question)`:**
1. `checkout_public_repo(repo_url)`.
2. Locate relevant files (ripgrep/`git grep` for question keywords, or `codex.propose(..., read_only=True)` to have Codex identify + read the relevant files). Capture `references: [{file, lines, note}]`.
3. Stream the answer with `reason_stream("work", ...)`, feeding the retrieved file context. Emit each chunk over SSE (see §8) so the dashboard terminal shows it live; assemble the full text for the response body.
4. Answer must be grounded only in retrieved context; every `file:line` reference must exist in the clone (drop any that don't). Providers: `{retrieval:"codex-cli" or "ripgrep", reasoning:"responses-api-stream"}`.

*Accept:* asking a real question about a real repo streams a grounded answer with valid file:line refs; demo mode streams one labelled cached sentence.

---

## 8. API & orchestrator changes

- `backend/main.py`:
  - `ScanRequest`: add optional `pr_number: int | None` (drives live Reviewer).
  - Add **`GET /api/ask/stream`** (or `POST` with SSE response) that yields `reason_stream` chunks as `event: umbra` frames, then a final `done` frame. Keep `POST /api/ask` returning the assembled answer for the Custom GPT (non-streaming callers).
- `backend/orchestrator.py`: replicate the Watchman top-level promotion for each live agent:
  - `scan()` → when live Reviewer/Janitor ran, set `source: live-<agent>` and surface their real findings at the top level (don't blend with `demo_cache`). If multiple live agents ran, `source: "live"` and attach each under `agent_results` with its own providers.
  - `investigate()` → return the live Detective postmortem at the top level with `source: live-detective`; cached → `source: demo-cache`.
  - `ask()` → return the live answer with `source: live-ask`.
  - **Make `replays` cumulative per scan** (currently overwritten): collect one replay per agent that ran so `/api/replays` reflects the whole run, not just the last agent.
- **Contract stability:** live findings must keep the exact field names in `custom_gpt/openapi.yaml` (`ScanResult`, `Postmortem`, `Answer`) so the Custom GPT and dashboard keep working.

---

## 9. Guardrails (reaffirm — never violate)

Carried verbatim from the Watchman path and `.umbra/nightshift.md`:
1. Every Codex run is inside a **disposable checkout with no `origin` remote**. Never push, commit to a remote, open a PR, merge, approve, deploy, force-push, or output a secret value. The `_safe_prompt` wrapper in `codex_client.py` already states these — reuse it for every agent.
2. Never pass `GITHUB_TOKEN` write scopes into the Codex child process. GitHub is **read-only** here; PR creation stays out of scope (Codex Cloud / the GitHub Action owns that, still behind `TODO(verify)`).
3. Reasoning or Codex failure → labelled `unavailable` provider + honest note; **never** fabricate reasoning, diffs, CVEs, commits, or file:line refs.
4. Any model-returned artifact (commit SHA, file path, line ref) must be **verified to exist in the clone** before it's surfaced.
5. Demo mode (`UMBRA_DEMO_MODE=true`) makes zero network/model/CLI calls and every provider reads `demo-cache`.

---

## 10. Tests to add (offline, mock the boundary — mirror `test_live_watchman.py`)

For **each** of Reviewer, Detective, Janitor, Ask add:
1. **Demo-labelled:** `UMBRA_DEMO_MODE=true` → providers all `demo-cache`, reasoning note says no model/CLI call was made.
2. **Disabled-no-fabrication:** flags off → Codex provider is `codex-cli-disabled` / cached, diff is `""`.
3. **Live-failure fallback:** live flags on but the checkout/PR/model fails → `providers[...] == "cache-fallback"` and reasoning contains `"Live <Agent> unavailable"`.
4. **Live-wiring (mocked):** monkeypatch `checkout_public_repo`, `reason`/`reason_stream`, `CodexClient`, and any GitHub/history helper; assert the real branch runs, providers are the live values, and findings come from the mocked live source (not the cache).
5. Detective-specific: a mocked model returning a **non-existent SHA** yields `root_cause_commit: "unconfirmed"`.
6. Orchestrator: each live agent replaces its top-level demo category and sets the right `source`; `replays` is cumulative.

Keep the full suite runnable with `UMBRA_DEMO_MODE=true uv run pytest -q` and green after every phase.

---

## 11. Pre-flight verification (run once, before Phase 2)

Add `backend/preflight.py` (or extend `seed_demo.py`) that, in live mode, checks and **prints** — never blocks the demo:
1. `codex --version` and that `codex exec` accepts the required flags.
2. A tiny `reason("fast", ...)` call to confirm `gpt-5.6-luna` entitlement; on 403 print a clear `reasoning: unavailable` warning and the exact error. Do the same for `sol`/`terra`.
3. `git --version` and that `checkout_public_repo` can clone a small public repo.

Document required env in `docs/live-mode.md` (already exists — extend it with the per-agent flags and the read-only vs write sandbox table from §2).

---

## 12. START HERE — build order & commits

Build top-to-bottom; commit after each phase; keep `main` runnable and the offline suite green at every commit.

1. **Phase 1 — shared infra** (`read_only` sandbox, `reason_stream`, `fetch_pull_request`/`latest_open_pull_request`, `recent_history`, OSV severity fix + tests). Commit: `feat(live): shared infrastructure for live agents`.
2. **Phase 2 — Reviewer live.** Commit: `feat(live): guarded live Reviewer on real PR diffs`.
3. **Phase 3 — Detective live (`xhigh`).** Commit: `feat(live): guarded live Detective root-cause chain`.
4. **Phase 4 — Janitor live (real cleanup diff).** Commit: `feat(live): guarded live Janitor cleanup sweep`.
5. **Phase 5 — Ask Umbra live + streaming.** Commit: `feat(live): streamed live Ask Umbra with grounded refs`.
6. **Phase 6 — orchestrator + API contract** (top-level `source: live-*`, cumulative replays, `/api/ask/stream`, `pr_number`). Commit: `feat(live): expose all live agents at the API boundary`.
7. **Phase 7 — pre-flight + docs + full-run verification.** Commit: `chore(live): preflight checks and live-mode docs`.

After Phase 6, run a real end-to-end proof on **two demonstration targets** and record the results in the PR/commit message:
- A repo with a **known-vulnerable pinned dependency** → prove Watchman produces a real bump diff.
- Any moderately-sized repo → prove Janitor produces a real cleanup diff and Detective cites a real commit.
(These close the audit's "Codex ran but never produced a diff" and "reasoning never returned" gaps — assuming an entitled key.)

---

## 13. Definition of done

- All five agents have a `_run_live` path guarded by the four flags, following the §2 contract.
- Every live result carries truthful `providers`; every failure is labelled `unavailable`/`cache-fallback`; nothing is fabricated.
- `/api/scan`, `/api/investigate`, `/api/ask` surface live results at the top level with the correct `source`, and stay schema-compatible with `custom_gpt/openapi.yaml`.
- Offline suite is green; demo mode makes zero external calls.
- A recorded end-to-end run shows, on an entitled key, a real Codex diff and a real GPT‑5.6 reasoning response.

## 14. Out of scope (separate follow-ups — do NOT start here)

- Dashboard rendering of the missing CORE panels (Kill Chain, Dependency Galaxy, Ask chat overlay, AI-vs-Human, Secret Scanner, ROI, Benchmark) and wiring the Reasoning Replay modal to `/api/replays`.
- Creating the seeded demo repo with real Umbra PRs, and capturing the Codex `/feedback` session ID.
- Codex Cloud / GitHub Action remote PR creation (stays behind `TODO(verify)`).
