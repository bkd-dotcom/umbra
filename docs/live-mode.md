# Live mode

Umbra is demo-safe by default (`UMBRA_DEMO_MODE=true` makes zero network, model,
or CLI calls). It has two independent live surfaces, and it will use whichever
credentials you actually have.

## The two model surfaces

| Surface | Auth | Used for | Provider label |
| --- | --- | --- | --- |
| **Codex CLI** (`codex exec`) | ChatGPT login (`codex login`) — **no API key needed** | Engineering work **and** the reasoning fallback | `codex-cli` |
| **Responses API** (`gpt-5.6-sol/terra/luna`) | `OPENAI_API_KEY` with GPT-5.6 model entitlement | Preferred reasoning tiers | `responses-api` / `responses-api-stream` |

The Codex CLI itself runs a GPT-5.6 model (e.g. `gpt-5.6-terra`), so when the
Responses API is unavailable Umbra still produces real GPT-5.6 reasoning — it
just reaches it through the Codex credit instead. Every fallback is labelled
`codex-cli` in the Reasoning Replay ledger; Umbra never presents Codex output as
the Responses API and never fabricates reasoning.

## Codex-only mode (no OpenAI API key required)

If you only have Codex credits (ChatGPT login), this is all you need:

```bash
UMBRA_DEMO_MODE=false
UMBRA_ENABLE_LIVE_REPOS=true
UMBRA_ENABLE_CODEX_CLI=true
# OPENAI_API_KEY is optional. Leaving it unset makes the Responses attempt fail
# instantly (before any network call) and fall straight through to Codex.
```

Confirm the CLI is authenticated with `codex login status` (expect
"Logged in using ChatGPT"). The live gate no longer requires `OPENAI_API_KEY`.

When both are configured, Umbra tries the Responses API first and falls back to
Codex only if that tier is denied or errors.

## What a live run does

Each agent clones the public repository into a disposable temporary directory and
removes its Git remote (so a push is impossible). Codex runs against that
disposable copy under a hard no-push/no-commit/no-merge/no-secret prompt. The
reasoning step runs the Responses API if entitled, otherwise a **read-only** Codex
call in a throwaway directory (no repo, no side effects). Providers, prompt,
diff, test status, and any failure are all retained in the Reasoning Replay.

| Agent | Codex sandbox (engineering) | Reasoning | Live operation |
| --- | --- | --- | --- |
| Watchman | `workspace-write` | Responses API → Codex | OSV advisory remediation |
| Reviewer | `read-only` | Responses API → Codex | PR-diff inspection |
| Detective | `workspace-write` | Responses API → Codex | incident fix proposal |
| Janitor | `workspace-write` | Responses API → Codex | behavior-preserving cleanup |
| Ask Umbra | `read-only` | Responses API (streamed) → Codex | grounded code retrieval |

**Credit note:** "reasoning via Codex" means roughly two Codex calls per agent
(one engineering, one reasoning). A three-agent scan is ~6 calls. Use demo mode
for zero-cost dry runs.

## Preflight

Run the non-blocking diagnostic before a live demo:

```bash
UMBRA_DEMO_MODE=false UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true \
uv run python -m backend.preflight
```

It verifies the CLI sandbox modes, Git, all three Responses tiers, and a
disposable public clone. A denied Responses entitlement is reported as
`unavailable` — that is expected in Codex-only mode and does not block live runs.
To additionally prove the Codex-backed reasoning fallback (spends a small amount
of credits):

```bash
UMBRA_PREFLIGHT_REASONING=true ... uv run python -m backend.preflight
```

## CLI compatibility

The client targets Codex CLI 0.144.x. `codex exec` is non-interactive (approval
policy is already `never`), so no `--ask-for-approval` flag is passed;
`--skip-git-repo-check` lets read-only reasoning run in a non-repo directory.
