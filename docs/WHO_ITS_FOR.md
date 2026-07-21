# Who Umbra is for

> The "Potential Impact" answer: a specific persona with an acute, present-day pain —
> not a vague "developers."

## The persona

**The platform / developer-productivity / security lead who is rolling out a coding
agent (OpenAI Codex, Claude Code, Devin, Cursor) across their org's repositories.**

Titles that map to this: Head of Platform Engineering, Staff/Principal Platform
Engineer, Application Security lead, Developer Experience lead, Engineering Manager
owning "safe AI adoption."

## Their acute pain (today, not hypothetical)

Their leadership has told them to adopt coding agents. The agents are good enough to
open PRs. But this person is now personally accountable for a question they cannot
answer with a repeatable process:

> "How do I let an autonomous agent change our code **and prove to security, to an
> auditor, and to myself that it stayed within bounds** — that it didn't touch a
> forbidden path, didn't get prompt-injected by a poisoned README, and didn't earn
> more authority than the change deserved?"

Today they cobble this together from:

- branch protection + required human review (doesn't scale to agent volume, and the
  human is now the bottleneck the agent was supposed to remove),
- an AI review bot that **comments** but doesn't **decide** (advisory, not a gate),
- the agent's own sandbox (the agent grading its own homework),
- and hope.

There is **no artifact** they can hand to security that says "this agent change was
admitted under these rules, verified independently, and here is a signed receipt."

## What Umbra gives them

A **change-control plane**: a coding agent must pass an **admission test** before it's
trusted with write authority — an executable contract (fail-closed), untrusted-content
quarantine, isolated required checks, an **independent verifier the writer can't
bypass**, an **earned + revocable authority level** bound to the exact run, and an
**Ed25519-signed receipt** they can archive and verify offline. Umbra never merges.

## The "would you be upset if it vanished?" test

If Umbra disappeared, this person goes back to **manually reviewing every agent PR** (or
turning agents off) and **cannot produce evidence** that any agent change was governed.
The signed receipt and the earned-authority passport are the exact artifacts they need
for an internal security review or an external audit — there is no drop-in replacement
that decides authority and proves it.

## Why this is credible impact *now*

The two risks Umbra contains are named in the **OWASP Top 10 for LLM Applications (2025)**:

- **[LLM01 · Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)** → Umbra's trust boundary redacts injection in instruction files on disk before the agent runs.
- **[LLM06 · Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)** → Umbra's earned, revocable, run-bound authority passport is a direct mitigation.

Adoption is happening ahead of the controls. Umbra is the control.
