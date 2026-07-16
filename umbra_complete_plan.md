# 🌑 UMBRA — Refined Project Plan (v2)

> **The AI engineer that works in the shadows.**
> *You sleep. It ships.*
>
> OpenAI Build Week 2026 · **Developer Tools** track
> Submission deadline: **Tue Jul 21, 2026 · 5:00 PM PT**
> Codex credits request deadline: **Fri Jul 17, 2026 · 12:00 PM PT**

---

## 0. What changed from the Phantom plan (read this first)

This is a refinement of `phantom_complete_plan.md`. The original was strong on ambition and weak on the two things that actually win this hackathon: **depth of Codex use** and **a finished, coherent product** (not a broad-but-shallow tech demo). Here's the delta:

| # | Change | Why it raises the score |
|---|--------|-------------------------|
| 1 | **Rebrand Phantom → Umbra** | "Phantom" collides with the Phantom crypto wallet (owns search, hurts "Quality of Idea" distinctiveness). *Umbra* = Latin "shadow" → ties 1:1 to the "invisible engineer" pitch, no collision. |
| 2 | **Codex reframed from "a chat model I call" → the agentic engine that does the engineering** | Judging explicitly weights *"depth and skill of Codex use."* The old plan used `chat.completions` — that's just a model, not Codex. See §3. This is the single biggest lever. |
| 3 | **Correct, real model lineup + Responses API** | `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` with `reasoning.effort`. The old `temperature=0.2` chat pattern is wrong for 5.6 reasoning models. See §4. |
| 4 | **Scope cut to a balanced, solo-shippable core** (5 agents, 6 features, 5 panels) with an explicit **cut line** | Design is judged as *"a complete, coherent product experience — not a proof of concept."* Their own #1 loss reason is a broken demo. 5 things flawless > 20 things flaky. See §5. |
| 5 | **Narrative contradiction fixed** | Old pitch said "you never prompt it" but shipped a giant interactive dashboard + chat. New framing: Umbra runs **autonomously** (GitHub Action + Codex Cloud); the dashboard is **mission control** — the window into what it did overnight. |
| 6 | **Judge-testing surfaces cut 5 → 3** and sequenced | Live dashboard + Custom GPT + seeded demo repo. GitHub App/webhooks + standalone CLI demoted to stretch (each is an infra rabbit hole for a solo builder). |
| 7 | **Tooling stack to move fast solo** (FastAPI, shadcn/Tailwind/Framer, Vercel, Screen Studio…) | See §9. FastAPI auto-emits the OpenAPI schema the Custom GPT Action needs — free win. |
| 8 | **Timeline recomputed for Jul 15→21 (6 days)** with credits-deadline guardrail | See §11. |
| 9 | **Every section mapped to the 4 judging criteria** | See §1. Nothing ships unless it moves a criterion. |

> [!IMPORTANT]
> **Do two things in the next hour:** (1) request Codex credits (Resources tab on the Devpost page — deadline **Jul 17 noon PT**), and (2) install the **Devpost Hackathons Plugin** inside ChatGPT (required). These gate everything else.

---

## 1. The scoring rubric — and how Umbra targets each criterion

Four equally-weighted criteria. Design every deliverable to hit one:

| Criterion | What judges look for | Umbra's answer |
|-----------|---------------------|----------------|
| **Technological Implementation** | *Depth & skill of Codex use; a working, non-trivial implementation.* | Codex Cloud/SDK/CLI/GitHub Action/native-review all used as the **execution engine** (§3). We **dogfood Codex to build Umbra** and submit that session ID. |
| **Design** | *A complete, coherent product — not a proof of concept.* | One polished "Umbra HQ" mission-control dashboard, one bulletproof live path, premium UI system (§7, §9). |
| **Potential Impact** | *A credible, specific case for a real audience.* | Sharp ICP: **solo maintainers & small teams** who can't afford Snyk + CodeRabbit + an SRE. ROI calculator + benchmark make it concrete (§6). |
| **Quality of the Idea** | *Creativity + genuine understanding of the problem.* | "Invisible teammate that works the night shift" is a fresh framing; Kill-Chain viz + Reasoning Replay show real problem insight (§6). |

**The one-liner for judges:** *"Umbra is a team of AI engineers that work the night shift. It runs autonomously on your repo via Codex — hunting CVEs, reviewing PRs, tracing incidents, and killing tech debt — and every morning you open mission control to review the pull requests it drafted while you slept. Codex does the engineering; GPT‑5.6 does the reasoning; you approve the merge."*

---

## 2. Architecture (refined)

```
┌──────────────────────────────────────────────────────────────┐
│                       UMBRA HQ  (Mission Control)              │
│        Next.js/React · Tailwind + shadcn/ui · Framer Motion    │
│  Umbra Score · Threat Radar · Agent Terminal · Kill Chain ·    │
│  Dependency Galaxy · Ask Umbra · Reasoning Replay              │
└───────────────────────────────┬──────────────────────────────┘
                                 │  REST + SSE (streaming)
┌───────────────────────────────┴──────────────────────────────┐
│                     UMBRA ORCHESTRATOR  (FastAPI, Python)      │
│        Schedules agents · streams events · caches results      │
│                                                                │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │ Watchman │ │ Reviewer │ │Detective │ │ Janitor  │  + Ask │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  Umbra  │
└────────┼────────────┼────────────┼────────────┼───────────────┘
         │            │            │            │
   ┌─────┴───────┐  ┌─┴────────────┴──┐   ┌─────┴──────┐
   │  GPT‑5.6    │  │     CODEX        │   │  OSV.dev / │
   │  Responses  │  │  Cloud · SDK ·   │   │  GitHub    │
   │  API        │  │  CLI · Action ·  │   │  API       │
   │ (reasoning) │  │  native review   │   │            │
   └─────────────┘  └──────────────────┘   └────────────┘
       ▲                    ▲
   the "why"          the "engineering"
 (Sol/Terra/Luna)   (reads repos, writes
                     fixes, runs tests,
                     opens PRs)
```

**Division of labor (memorize this — it's your demo narration):**
- **Codex** = *does the work on the code*: explores the repo, understands structure, edits files, runs tests in its sandbox, drafts the PR.
- **GPT‑5.6 (Responses API)** = *reasons about the work*: severity, blast radius, root-cause chains, risk scores, plain-English explanations.

---

## 3. ⭐ How Umbra uses Codex (the deep-integration section — this wins the tech score)

The old plan called `client.chat.completions.create(model="gpt-5.6-sol", ...)`. **That is not "using Codex" — that's using a chat model.** Judges scoring "depth of Codex use" will see through it. Umbra instead treats **Codex as the agent that performs code operations**, across five surfaces:

### 3.1 Codex Cloud — delegated, sandboxed engineering tasks
Umbra's backend hands each heavy job to **Codex Cloud** as a delegated task. Codex spins up an isolated environment, clones the repo, explores it, edits files, runs the test suite, and **opens a PR directly**. Umbra orchestrates and visualizes; Codex is the engineer.

- Janitor → *"Remove dead code and unused imports repo‑wide; keep behavior identical; run tests; open a focused PR per category."*
- Watchman fix step → *"Bump `cookie` to a patched version, resolve the breaking change in `session.js`, run tests, open a PR."*
- Scribe (stretch) → *"Add docstrings to all public functions in `src/`; update the README API section; open a docs PR."*

This is the "full usage of powerful Codex tasks" you asked for: long-running, autonomous, multi-file, test-verified, PR-producing.

### 3.2 Codex SDK / non-interactive mode — programmatic agent runs
For synchronous, in-app runs (the live demo scan), invoke Codex non-interactively and capture structured output (diff + summary) to render in the dashboard.

```python
# Codex performs the code operation — reads repo, writes fix, runs tests.
# NOTE: confirm exact CLI/SDK invocation + model id against the current
# Codex docs (learn.chatgpt.com/docs). Shape shown; flags may differ.
import subprocess, json

proc = subprocess.run(
    ["codex", "exec", "--json",
     "Find unused functions, dead imports, and orphaned env vars across the "
     "repo. Produce a unified diff that removes them without changing behavior, "
     "run the test suite, and emit a JSON summary of what changed and why."],
    cwd=repo_path, capture_output=True, text=True, timeout=900,
)
codex_result = json.loads(proc.stdout)   # { diff, summary, tests_passed, files[] }
```

### 3.3 Codex GitHub Action — the "always watching" autonomous trigger
This is what makes Umbra *invisible/autonomous* (resolves the narrative contradiction). On `pull_request` and a nightly `schedule`, the Codex Action runs the agents with no human prompting.

```yaml
# .github/workflows/umbra.yml
name: Umbra Night Shift
on:
  pull_request:
  schedule:
    - cron: "17 3 * * *"   # 03:17 nightly — the night shift
jobs:
  umbra:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: openai/codex-action@v1          # verify action name/version in docs
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          prompt-file: .umbra/nightshift.md    # the agent instructions
```

### 3.4 Codex native code review — the Reviewer stands on Codex's shoulders
Don't reinvent code review. The **Reviewer** agent invokes Codex's built-in review, then Umbra layers its differentiator on top: a **0–100 Risk Score + blast-radius map + missing-test detection** computed from Codex's findings + the import graph.

### 3.5 Codex CLI / IDE — the dev-loop surface (and dogfooding)
`umbra scan` wraps the Codex CLI for local runs. **More importantly: build Umbra itself with Codex** (CLI + IDE extension), and submit **that** `/feedback` Codex Session ID — judges reward evidence you actually built the core with Codex.

> [!TIP]
> **Reasoning Replay (§6) is your proof.** For every agent action, store and display the Codex task prompt, the diff Codex produced, the tests it ran, and the GPT‑5.6 reasoning chain. This literally *is* the artifact the tech-implementation criterion asks for — surface it, don't bury it.

---

## 4. Model lineup & correct API usage (verified July 2026)

Three GPT‑5.6 tiers — use the cheapest that clears the bar. All are **reasoning models**: use the **Responses API** with `reasoning.effort`, not chat-completions with `temperature`.

| Model ID | Role in Umbra | Effort | Approx price (in/out per MTok) |
|----------|---------------|--------|-------------------------------|
| `gpt-5.6-sol` | Hardest reasoning: Detective root-cause chains, Watchman threat modeling, Reviewer risk synthesis | `high` / `xhigh` | $5 / $30 |
| `gpt-5.6-terra` | **Default worker**: most agent reasoning, Ask Umbra answers | `medium` | $2.50 / $15 |
| `gpt-5.6-luna` | Fast/cheap: summaries, commit messages, digest, docstrings | `low` | $1 / $6 |
| *(Codex model)* | Code operations via Codex surfaces (§3) | — | verify in Codex docs |
| `gpt-image-2` | (Nice touch) OG/social preview images, agent avatars | — | — |

Context 1.05M · max output 128K · knowledge cutoff Feb 16 2026 · effort levels `none/low/medium/high/xhigh/max`.

**Correct call shape (replaces the old `chat.completions` + `temperature` sample):**

```python
from openai import OpenAI
client = OpenAI()

resp = client.responses.create(
    model="gpt-5.6-sol",
    reasoning={"effort": "high"},          # reasoning models use effort, not temperature
    input=[
        {"role": "developer",
         "content": "You are a senior security engineer. For the vulnerability, "
                    "return: severity, attack vector, blast radius, remediation."},
        {"role": "user",
         "content": f"CVE: {cve_id}\nPackage: {pkg} v{version}\nAdvisory:\n{advisory}"},
    ],
)
threat_analysis = resp.output_text
```

> [!WARNING]
> I confirmed the three `gpt-5.6-*` IDs and the Codex surfaces from OpenAI's docs, but the **exact Codex model ID string, `codex exec` flags, and Action name** redirected behind pages I couldn't fully read. Verify those against `developers.openai.com` / `learn.chatgpt.com/docs` on Day 1 before hardcoding.

---

## 5. Scope — balanced core with an explicit cut line (solo, 6 days)

Ruthlessly prioritized. **Build top-to-bottom. If you hit the cut line, you still have a complete, coherent product.**

### ✅ CORE — 5 agents (must ship)
| Agent | Codex does | GPT‑5.6 does | Why it's in the core |
|-------|-----------|--------------|----------------------|
| 🛡️ **Watchman** (CVE hunter) | Applies version bump + fixes breaking change, runs tests, opens PR | Sol: threat analysis, severity, kill chain | ~90% ported from PatchGhost; most visual (Kill Chain) |
| 🔎 **Reviewer** (PR risk) | Native code review of the diff | Sol: risk score, blast radius, missing tests | Pairs directly with Codex's review — best "depth" story |
| 🔬 **Detective** (root cause) | Explores commits/diffs for the culprit | Sol `xhigh`: multi-step reasoning chain | Best Reasoning-Replay showcase for GPT‑5.6 |
| 🧹 **Janitor** (tech debt) | Full-repo dead-code/debt sweep → cleanup PRs | Terra: prioritize + explain | Best Codex Cloud showcase (autonomous, multi-file) |
| 💬 **Ask Umbra** (Q&A) | Reads relevant files for the question | Terra: answer w/ file:line refs, streamed | Makes the demo interactive & live |

### 🔶 STRETCH agents (only after core demo is bulletproof)
6. 📝 **Scribe** (docs PRs) — overlaps Janitor's Codex flow, cheap to add. 7. 🔮 **Forecaster** (7-day weather-style risk) — great visual, but heuristics are hard to make credible; add the *visual* even if the model is simple.

### ✅ CORE — 6 features
1. **Reasoning Replay** *(highest priority — it's a judging artifact, see §3/§6)*
2. **Security Kill Chain Visualization** *(signature wow)*
3. **AI-vs-Human review comparison** *(concrete impact, cheap)*
4. **Secret Scanner** *(high real-world value: regex + GPT‑5.6 to filter test fixtures)*
5. **Cost-Savings / ROI calculator** *(impact story for VC/PM judges)*
6. **Benchmark mode** *(pre-computed repo-health vs React/Next/Express — context + gamification)*
   - *Fold in for free:* OWASP tags on Watchman findings (just labels).

### 🔶 STRETCH features
License/SBOM · Architecture-drift detector · **Code Sonification** (the memorable easter egg — add if a day is free) · Multi-repo org scanner · PR-impact "what-if" simulator · Weekly Digest (ship as a static rendered panel, not a live pipeline).

### ✅ CORE dashboard — 5 panels + 2 overlays
Umbra Score (hero) · Threat Radar (Canvas) · Agent Terminal (live SSE feed) · Kill Chain Viewer · Dependency Galaxy (one force-graph). Overlays: **Ask Umbra chat** + **Reasoning Replay modal**.
🔶 Stretch panels: Code DNA genome · Tech Debt Clock · Risk Forecast.

### ✂️ THE CUT LINE (if Jul 20 arrives and you're behind)
Ship: **Watchman + Reviewer + Detective**, the **dashboard core (Score/Radar/Terminal/Reasoning Replay)**, the **Custom GPT**, and the **seeded demo repo**. That is still a complete, coherent, submittable product that hits all four criteria. Everything below the line is upside.

---

## 6. Signature features (kept, with the impact/idea angle)

- **Reasoning Replay** — modal on every agent action: the Codex task prompt → the diff Codex wrote → tests it ran → GPT‑5.6 reasoning chain → time per step. *Directly satisfies the "show how Codex + GPT‑5.6 were used" requirement.*
- **Security Kill Chain** — animated attack-path flowchart (`Attacker → crafted request → CRLF injection → header smuggling → session hijack → exfiltration`). GPT‑5.6 reasons the real path from the CVE. Nobody visualizes the *how*.
- **AI-vs-Human comparison** — side-by-side table of what Umbra caught vs what a human review typically catches. Makes value undeniable.
- **Secret Scanner** — detects committed keys/tokens/creds; GPT‑5.6 distinguishes real secrets from test fixtures.
- **ROI calculator** — hours saved × blended rate vs ~$45/mo API cost. Judges (often PMs/VCs) love the number.
- **Benchmark mode** — your repo's health bar vs famous OSS, pre-computed.

**Impact wedge (say this in the video):** *"Snyk is $$$, CodeRabbit is $$, an on-call SRE is $$$$. A solo maintainer or a 3-person startup can't buy all three. Umbra is one autonomous teammate that covers all of it — for the price of a few dollars of tokens a night."*

---

## 7. Umbra HQ — the high-end UI (Design criterion)

**Brand:** UMBRA wordmark, all-caps, wide letter-spacing. Near-black canvas, **deep violet `#7C3AED` + pale cyan `#22D3EE`** accents, subtle aurora/spotlight background, glassmorphism panels, `Inter` (or `Geist`) type. Motion: Framer Motion for panel entrances, number count-ups, radar sweep, kill-chain draw-on.

**Fastest path to a premium look, solo:**
- **shadcn/ui + Tailwind** for the component base (accessible, clean, fast).
- **Aceternity UI / Magic UI** for the "expensive" animated bits (spotlight cards, aurora bg, animated beams for the agent pipeline).
- **Framer Motion** for choreography; **Recharts/visx** for charts, **D3-force** only for the Dependency Galaxy, **Canvas** for the Threat Radar.
- **v0.dev** to scaffold panels from a prompt, then hand-refine.

**Layout (mission control):** left rail = 5 agent status chips (✅ done / 🔄 working / 💤 idle) + "Ask Umbra"; main grid = Score hero, Threat Radar, Agent Terminal, Kill Chain, Dependency Galaxy. Reasoning Replay opens as a modal from any action.

**Umbra Score** = `100 − 0.30·security − 0.25·quality − 0.20·test_gaps − 0.15·doc_gaps − 0.10·dep_staleness`. Giant animated number with color glow (90+ 🟢 / 70–89 🟡 / 40–69 🟠 / <40 🔴).

---

## 8. Judge testing — 3 frictionless surfaces (down from 5)

Plugins/dev tools **must** ship install instructions, supported platforms, and a way to test without rebuilding. Umbra offers:

1. **Live dashboard** at `https://umbra.engineer` — pre-seeded with real scan results; no login, no keys. *This is the demo.*
2. **Custom GPT "Umbra Engineer"** in ChatGPT — judges type `Scan https://github.com/expressjs/express` and get results without leaving ChatGPT. Powered by Actions pointed at the FastAPI backend (**FastAPI auto-generates the OpenAPI schema the Action needs — free**).
3. **Seeded demo repo** `github.com/<you>/umbra-demo-target` — deliberately messy (vulnerable deps, dead code, undocumented fns, committed secret) with Umbra's **real PRs and review comments** visible.

🔶 Stretch surfaces: one-command CLI (`pipx install umbra`), GitHub App (webhooks + hosting is a rabbit hole — defer).

---

## 9. Tooling & plugins to move fast (solo) 

| Need | Use | Why |
|------|-----|-----|
| Core engine | **Codex CLI + Codex Cloud + Codex IDE extension** | The product *and* your build tool — dogfood it |
| Required | **Devpost Hackathons Plugin** (in ChatGPT) | Mandatory for submission |
| Backend | **FastAPI** (not Flask) | Async, native SSE streaming for Ask Umbra, **auto OpenAPI → Custom GPT Action** |
| Vuln data | **OSV.dev API** / `osv-scanner` | Real CVE data |
| GitHub | Let **Codex Cloud** open PRs; `PyGithub` for reads | Less code to own |
| Frontend | **Next.js + Tailwind + shadcn/ui + Framer Motion + Aceternity/Magic UI** | Premium look, fast |
| Scaffold UI | **v0.dev** | Prompt → components |
| Hosting | **Vercel** (frontend + domain) · **Render/Railway/Fly** (FastAPI) | Elegant, instant, custom domain |
| Persistence | JSON cache for demo; **Supabase** only if needed | Don't over-engineer |
| Demo video | **Screen Studio** (Mac) for premium screen-capture; narrate live or **ElevenLabs** VO | Video polish attracts judges |
| Diagrams/README | **Excalidraw / tldraw**, `gpt-image-2` for OG image | Visual README |
| Domain | **Cloudflare / Namecheap** — buy `umbra.engineer` (fallback `getumbra.dev`) | Verify availability first |

---

## 10. Trust architecture (kept — judges reward responsible AI)

Never auto-merges (PRs only) · shows its work (full reasoning in every PR) · Reasoning Replay · full audit log · per-agent kill switches · read-heavy/write-light (always on branches) · tests its own fixes (Codex runs the suite) · acts only above a confidence threshold, else flags for human.

> *"Umbra is designed like a junior engineer, not an admin: it reads everything, but can only **suggest** changes — never deploy them. Every action is logged, explained, and needs your approval."*

---

## 11. Timeline — Jul 15 → Jul 21 (6 days, solo)

> [!IMPORTANT]
> **Today (Jul 15) before anything else:** request Codex credits (deadline Jul 17 noon PT) + install the Devpost plugin + buy `umbra.engineer`.

| Day | Focus | Deliverables |
|-----|-------|-------------|
| **Jul 15** | Foundation | Credits requested · plugin installed · repo scaffold · Codex CLI/SDK + GPT‑5.6 wired · **Watchman** ported from PatchGhost (Gemini→GPT‑5.6, add Codex fix step) |
| **Jul 16** | Core agents | **Reviewer** (on Codex native review) + **Detective** (Sol `xhigh` reasoning chain) · Codex Cloud task delegation proven end-to-end |
| **Jul 17** | Agents + backend | **Janitor** (Codex Cloud sweep) + **Ask Umbra** (SSE) · FastAPI + OpenAPI · *confirm credits landed before noon* |
| **Jul 18** | Dashboard core | Umbra Score · Threat Radar · Agent Terminal · **Reasoning Replay modal** · brand/UI system |
| **Jul 19** | Dashboard wow + Custom GPT | Kill Chain · Dependency Galaxy · Ask Umbra chat · **Custom GPT** live · seed demo repo with real PRs |
| **Jul 20** | Deploy + harden + film | Deploy (Vercel + backend) · **pre-cache all demo results** · record demo video (Screen Studio) · README · **run the demo path 10×** |
| **Jul 21 AM** | Submit early | Buffer for breakage · Devpost submission + `/feedback` session ID · **submit well before 5 PM PT** |

---

## 12. Demo hardening (the #1 loss reason is a broken demo)

1. **Pre-cache everything.** `/api/status` returns live results if present, else a `demo_cache.json` fallback that *never* fails.
2. **One bulletproof live path.** Pick a single repo you've scanned dozens of times for the live moment; everything else is pre-seeded.
3. **Record a perfect backup video.** If the live demo breaks, you still have the film.
4. **Rate-limit defense.** Cache GPT‑5.6 responses; use `luna` for non-critical text; pre-generate all threat analyses/postmortems.
5. **Test the exact demo flow 10×** before submitting; fix anything flaky.

---

## 13. Demo video script (3 min, must narrate BOTH Codex and GPT‑5.6)

- **0:00–0:10 Hook** — "Meet Umbra — the AI engineer that works the night shift. You sleep; it ships."
- **0:10–0:30 Reveal** — Umbra HQ mission control. "5 autonomous agents, one health score, zero prompting."
- **0:30–1:00 Watchman** — real PR: "**Codex** wrote this CVE patch and ran the tests; **GPT‑5.6 Sol** produced this threat analysis." Show Kill Chain.
- **1:00–1:30 Reviewer** — PR risk 73/100: "Built on **Codex's** code review; GPT‑5.6 adds blast radius + missing-test detection." Show AI-vs-Human.
- **1:30–2:00 Detective** — paste an error; watch the Reasoning Replay trace commits to the root cause. "This is **GPT‑5.6 Sol** at `xhigh` effort, reasoning over what **Codex** found."
- **2:00–2:30 Janitor + ROI** — "**Codex Cloud** swept the repo and opened these cleanup PRs while I slept." Show ROI number.
- **2:30–2:50 Custom GPT** — "Judges can test this now: open ChatGPT, find *Umbra Engineer*, scan any repo."
- **2:50–3:00 Close** — "Umbra. Codex does the engineering. GPT‑5.6 does the reasoning. You approve the merge."

---

## 14. Devpost / credits form answer (rewritten for Umbra)

> **Developer Tools track.** Umbra is an autonomous AI engineering team that works the night shift on your GitHub repo. Five agents run without prompting — hunting CVEs (with kill-chain attack visualization), reviewing PRs with architectural risk scoring, investigating incident root causes with transparent reasoning replay, and killing tech debt — then draft pull requests you review each morning. **Codex is the engine**: via Codex Cloud, the SDK, the GitHub Action, and its native code review, it explores repositories, edits code, runs the test suite in a sandbox, and opens PRs. **GPT‑5.6 Sol** does the deep reasoning — root-cause chains, blast-radius analysis, and threat modeling — while Terra and Luna handle everyday reasoning and summaries. I built Umbra itself with Codex. Judges can test it three ways: a live dashboard at umbra.engineer, a Custom GPT inside ChatGPT, or a seeded demo repo full of Umbra's real PRs.

---

## 15. Open items to confirm on Day 1
- [ ] Exact **Codex model ID** + `codex exec`/SDK invocation + **Action name/version** (docs redirected during planning).
- [ ] How the **`/feedback` Codex Session ID** is captured for submission.
- [ ] **Country eligibility** for the hackathon (entrant must be in a listed territory).
- [ ] Verify **`umbra.engineer`** (or `getumbra.dev`) is actually available at the registrar.
- [ ] Confirm Custom GPT **Actions** can reach your deployed FastAPI (CORS + public HTTPS).
