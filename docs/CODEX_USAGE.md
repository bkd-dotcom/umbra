# How Codex + GPT-5.6 built Umbra

> Evidence for the "Technological Implementation" and "Quality of the Idea" criteria:
> where Codex was the *primary engineer*, and where GPT-5.6 does the *reasoning* — with
> real commit hashes you can verify in `git log`.

**Codex `/feedback` session ID:** `019f66b8-a2ce-7103-aaed-2f60900d1aab`
**Build window:** 2026-07-15 → 2026-07-20 · **91 commits** · **277 backend tests**.

Umbra was not hand-written with a copilot on the side. Working from a single master
build manual ([`UMBRA_MASTER_BUILD.md`](../UMBRA_MASTER_BUILD.md)), **Codex built the
platform phase by phase**, committing and running the test suite after each phase to keep
`main` runnable throughout. Human work after that first build was refinement — fixing
integrations, broadening scope, and rebuilding the dashboard — not authorship.

---

## Where Codex wrote the core (verifiable commits)

Run `git show <hash>` on any of these to see the Codex-authored change.

| Area | What Codex built | Commit(s) |
|------|------------------|-----------|
| **Deterministic admission foundations** | The executable Change Contract, the independent Verifier, and the Trust Boundary — the differentiator's spine. | `39a4b52` — *feat: deterministic admission foundations — contract, verifier, trust boundary* |
| **Closing the 4 P0 integrity gaps** | Real execution, enforced required checks, gated (earned) authority, and receipts bound to the exact run. | `7342b85` — *fix(admission): close 4 P0 integrity gaps* |
| **Real sandboxing + real trust boundary for Codex** | Required checks executed in an isolated sandbox; the trust boundary made real against a live Codex run. | `e2ee1ce` — *fix(admission): sandbox required checks + make the trust boundary real for Codex* |
| **Honest sandbox tiers** | Preflighted isolation tiers (sandboxed / network-isolated / host-restricted); the changeset recomputed from `git` after redaction is restored. | `f12b05c` — *fix(admission): honest sandbox tiers + preflighted isolation + diff recomputed after restore* |
| **Baseline-vs-post check diagnosis** | Regression vs. pre-existing-failure attribution that caps authority correctly. | `e184544`, `b47c77b` |
| **Truthful provenance binding** | Model provenance + trusted-context manifest sealed into the receipt. | `263a815` — *feat(admission): bind truthful model provenance and trusted-context manifest* |
| **Live Codex client** | `codex exec` invocation in a disposable, origin-stripped checkout; disposable-path stripping from output. | `650be56`, `85d0b94` |
| **Live agent infrastructure + GPT-5.6 reasoning** | Shared live infrastructure and the grounded agents. | `61188e4`, `85d0b94` |

---

## Where GPT-5.6 does the reasoning (not Codex)

Two engines, deliberately separated — and every output is labelled with which produced it
(the "honesty ledger").

- **Engineering → Codex.** [`backend/codex_client.py`](../backend/codex_client.py) runs
  `codex exec --ephemeral -m <model> -c model_reasoning_effort=…` in a checkout with the
  origin remote removed and a hard no-push / no-merge prompt. It reads code, runs tests,
  and drafts diffs; it never pushes, commits, or merges.
- **Reasoning → GPT-5.6 via the Responses API.**
  [`backend/reasoning.py`](../backend/reasoning.py) calls `client.responses.create/stream`
  with `reasoning={"effort": …}` across three tiers — `deep = gpt-5.6-sol`,
  `work = gpt-5.6-terra`, `fast = gpt-5.6-luna` — with the Codex CLI's own GPT-5.6 model as
  a fallback. Ask Umbra and Detective stream grounded answers (first tokens in ~1–3s), each
  backed by a real `file:line` reference.

---

## The honesty story Codex is proud of

An external reviewer bot requested changes on a bump PR Umbra had opened
(`next 14.2.5 → 14.2.7`, "to remediate GHSA-h25m-26qc-wcjf"). `14.2.7` is **still inside**
that advisory's vulnerable range — a genuine defect: `pick_fixed_version` had chosen the
*global* smallest fix across every advisory, blind to the CVE it named. We traced it and
made version selection **CVE-aware** (target the named advisory's actual fix — `15.0.8` —
or clear every advisory when none is named) and taught the bump to **regenerate the
lockfile**, with new tests grounded against live OSV data. This is the rule the whole
project enforces: *never claim a remediation it can't stand behind.*

---

## How to verify these claims yourself

```bash
git log --oneline -- backend/admission.py backend/contract.py backend/verifier.py
git show 39a4b52   # deterministic admission foundations
git show 7342b85   # 4 P0 integrity gaps closed
uv run pytest -q   # 277 backend tests
```
