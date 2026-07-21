# Umbra — Devpost "About the project" (paste into the story field)

> Review and tweak in your own voice before pasting — judges can spot untouched AI text.
> This is written from the real build; edit any line that doesn't sound like you.

## Inspiration

Coding agents can now change your repository. Codex opens PRs, Claude Code edits
files, Devin ships branches. But when I actually tried to let an agent loose on a
repo, the question that stopped me wasn't "can it write the fix?" — it was "how do I
let it change my code and *prove* it stayed in bounds?" There was no repeatable
answer. Branch protection doesn't scale to agent volume, review bots only comment,
and the agent grades its own homework. Prompt injection through a poisoned README
and over-broad agent authority are both in the OWASP LLM Top 10, and adoption is
running ahead of the controls. I wanted to build the control.

## What it does

Umbra is a change-control plane for coding agents. Before an agent is trusted *with*
authority in a repo, Umbra tests whether it can be trusted *in* that repo — the
**Agent Admission Test**, one governed pipeline that runs before any PR:

- an **executable contract** (`.umbra/admission.yaml`) bounds the change (allowed
  paths, diff budget, required checks) and is evaluated outside the model, fail-closed;
- untrusted repository text (README / AGENTS.md / …) is **redacted on disk** before
  the agent runs, so injection can't reach it;
- required checks run in an isolated sandbox;
- an **independent verifier** the patch-writer can't bypass re-checks scope, secrets,
  and that a dependency bump actually clears the cited CVE;
- the run earns an **authority level** (0 observe / 1 analyze / 2 branch-PR) that's
  revocable and bound to the exact run, with a server-side emergency brake;
- everything is sealed in an **Ed25519-signed receipt**, verifiable against Umbra's
  own pinned public key.

Umbra never merges — PRs are branch-only. Around that core is a crew (CVE scanning
via OSV.dev, PR risk scoring, git-history root-cause, dead-code cleanup, grounded
Q&A), a ChatGPT GPT Action surface, and emailed morning reports.

## How we built it

FastAPI + an async orchestrator on the backend, Next.js 15 + Tailwind on the front.
**Codex was the primary engineer** — working from a build manual, it wrote the
platform phase by phase (the contract/verifier/trust-boundary spine, the sandbox
tiers, the signed receipts), committing and running the test suite after each phase.
At runtime, **Codex** (`codex exec` in a disposable, origin-stripped checkout) reads
code, runs tests, and drafts diffs — never pushing or merging — while **GPT-5.6** via
the Responses API (tiers gpt-5.6-sol / terra / luna) does the reasoning: blast-radius,
root cause, grounded answers. Every output is labelled with what produced it, so
nothing is presented as live when it isn't. Deployed as a single service on Google
Cloud Run; 290 backend tests; committed offline fixtures anyone can reproduce.

## Challenges we ran into

- **Making the trust boundary honest.** Regex injection detection is trivially
  bypassed, so the real guarantee had to be architectural: redact on disk, restore,
  then recompute the signed diff from git on the final tree — so a redaction never
  appears in the diff, and even a missed pattern still runs under the contract +
  verifier + authority cap. Saying this plainly (mitigation, not proof) was part of
  the work.
- **A remediation that didn't actually remediate.** A reviewer bot flagged a bump PR
  Umbra opened (`next 14.2.5 → 14.2.7`) — still inside the advisory's vulnerable
  range. The version picker was choosing the global smallest fix, blind to the named
  CVE. We made it CVE-aware and taught it to regenerate the lockfile. That bug became
  the rule the whole project enforces: never claim a fix it can't stand behind.
- **Sandboxing that tells the truth.** bubblewrap/unshare don't exist on macOS or in
  every container, so we preflight each isolation tier and record the one actually
  achieved (sandboxed / network-isolated / host-restricted) rather than overclaiming.
- **A judge-safe demo without burning credits.** A genuine Codex run spends credits
  and takes minutes, so the default judge path is a real captured proof (instant,
  verifiable), deterministic live scans are per-visitor rate-limited, and genuine
  Codex is founder-only — no anonymous dead-ends.

## Accomplishments that we're proud of

- The admission gate is real and deterministic: fixtures prove permitted → L2,
  forbidden → L0, failing-check → L1, and injection quarantined-yet-permitted.
- Receipts genuinely verify against a pinned key — and a tampered receipt visibly
  fails, live.
- An honest posture throughout: captured vs live, deterministic vs Codex, and a
  provider ledger on every result. Nothing fabricated.
- A complete, runnable product across web, ChatGPT, and GitHub — not a proof of
  concept.

## What we learned

For anything touching trust, boring and proven beats clever. The value wasn't a new
primitive — it was assembling policy-as-code, an independent verifier, scoped
authority, and signed attestation into one decision an agent has to pass, and being
scrupulously honest in the UI about what each layer does and doesn't guarantee. The
hardest, most valuable engineering was resisting the urge to overclaim.

## What's next for Umbra

Real design-partner teams rolling out Codex across their repos; richer policy
signing (today policy ownership is declared, not cryptographically signed); more
sandbox coverage; and turning the earned-authority passport into something a security
team can hand to an auditor as evidence that every agent change was governed.
