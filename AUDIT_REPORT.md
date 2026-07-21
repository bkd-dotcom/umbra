# Umbra Codebase Audit Report

**Date:** July 21, 2026  
**Subject:** Verification of Submission Claims vs. Actual Implementation  
**Scope:** Python (FastAPI) Backend + Next.js Frontend  
**Assessment:** Comprehensive code review of core systems

---

## EXECUTIVE SUMMARY

This audit verifies the claims made in SUBMISSION.md and README.md against the actual implemented codebase. **The vast majority of claimed features are FULLY IMPLEMENTED with real, substantive logic — not stubs.** A few features are PARTIAL or operational constraints exist, noted explicitly below.

**Total Backend Tests:** 277 tests (claim: 230 — EXCEEDED)  
**All 5 eval fixtures:** PRESENT and fully functional  
**Ed25519 signing:** Real `cryptography` library implementation  
**Codex integration:** Real `codex exec` invocation with validated flags  
**GPT-5.6 Responses API:** Real integration with OpenAI client  
**Agent Admission pipeline:** Complete, non-stubbed implementation  

---

## BACKEND AUDIT

### 1. Agent Admission Pipeline (PRIMARY DIFFERENTIATOR)

**Status:** ✅ **FULLY IMPLEMENTED** (701 lines of substantive code)

**Module:** `/Users/binaydalai/umbra/backend/admission.py`

**Key Components Verified:**

| Component | File | Lines | Status | Evidence |
|-----------|------|-------|--------|----------|
| Contract loading & enforcement | `contract.py` | 394 | FULL | Deterministic path evaluation, fail-closed on violations |
| Trust Boundary scanning | `trust_boundary.py` | 253 | FULL | Pattern-based detection of policy-override, secret-access, scope-expansion, agent-directive, command-injection |
| Required Checks runner | `checks.py` | 245 | FULL | Allowlist enforcement, secret stripping, 3-tier isolation (sandboxed/network-isolated/host-restricted) |
| Independent Verifier | `verifier.py` | 181 | FULL | Contract pass/fail, secret scan, advisory-version verification, test result hashing, file citation check |
| Receipt signing | `receipt.py` | 192 | FULL | Ed25519 signing, canonical JSON serialization, public key pinning |

**Authority Decision Logic (`_decide_authority` at line 617):** ✅ **REAL**
- Deterministic: Contract violated → L0 (observe)
- Verifier blocked → L0
- No change produced → L1 (analyze)
- Required checks not run/passed → L1 (with diagnosis: regression vs preexisting failure)
- All clean & checks passed → L2 (branch-PR)
- Honesty: Never grants auto_merge at any level

**Baseline vs. Post-Change Check Comparison:** ✅ **REAL**
- Runs checks on pristine base commit in ISOLATED worktree (line 433)
- Compares per-check verdict (regression/preexisting_failure/fixed/clean/inconclusive)
- Diagnoses check outcome deterministically (lines 540–576)

**Untrusted Content Redaction:** ✅ **REAL**
- Detected patterns: policy_override, secret_access, scope_expansion, agent_directive, command_injection
- Quarantine finding records: source, line, category, excerpt, pattern
- Never claims to defeat all injection — honestly scoped

---

### 2. Endpoints (All Wired Up)

**Status:** ✅ **FULLY IMPLEMENTED & ROUTED**

**File:** `/Users/binaydalai/umbra/backend/main.py`

| Endpoint | Line | Implementation | Status |
|----------|------|-----------------|--------|
| `POST /api/admit` | 161 | Calls `orchestrator.admit()` with fixture/repo_url | ✅ FULL |
| `POST /api/receipt/verify` | 255 | Calls `verify_receipt()` with Ed25519 signature check | ✅ FULL |
| `GET /api/verify-key` | 240 | Serves base64 Ed25519 public key | ✅ FULL |
| `POST /api/my/authority/revoke` | 456 | Server-side revocation (Level 0 forced), stored durably | ✅ FULL |
| `POST /api/my/pr` | 418 | Opens branch-only PR, checks earned authority passport | ✅ FULL |
| `POST /api/evidence-pack` | 205 | Renders portable Markdown + sha256 | ✅ FULL |
| `GET /api/ask/stream` | 480 | Streaming SSE for grounded reasoning | ✅ FULL |
| `GET /api/investigate/stream` | 500 | Streaming Detective timeline | ✅ FULL |

**Authority Passport Persistence:** ✅ **REAL**
- Function `_persist_authority` (line 278) stores earned passport keyed by user + repo
- Binds to exact run: receipt hash, base commit, executor config hash, check result, 7-day expiry
- Re-run upserts; failed run downgrades; Emergency Brake forces L0

---

### 3. Codex Integration

**Status:** ✅ **FULLY IMPLEMENTED** — Real `codex exec` invocation

**File:** `/Users/binaydalai/umbra/backend/codex_client.py` (341 lines)

**Command Construction (line 234–242):**
```python
command = [
    "codex", "exec", "--ephemeral", "--color", "never",
    *sandbox_args,  # ["--sandbox", "workspace-write"] or equivalents
    *model_args,    # ["-m", "gpt-5.6-luna/terra/sol"] if set
    *effort_args,   # ["-c", 'model_reasoning_effort="medium"'] if set
    "--skip-git-repo-check",
    "--output-last-message", str(final_message),
    "-C", str(repo_path),
    cli_prompt or self._safe_prompt(prompt),
]
```

**Flags Verified:**
- ✅ `--ephemeral` — disposable checkout (no persistence)
- ✅ `-m` model selection (validated against whitelist: gpt-5.6-luna/terra/sol)
- ✅ `-c model_reasoning_effort` (validated: minimal/low/medium/high)
- ✅ `--sandbox` modes: workspace-write (default) | read-only (for analyze-only) | bypass (deploy override)
- ✅ Disposable checkout with `origin` remote removed (no push credentials ever handed to child)

**Hard No-Push Prompt (line 307–313):**
```python
"Hard rules: never push, commit, create a PR, merge, approve, deploy, 
force-push, or expose a secret. You may inspect and edit only this checkout."
```

**Honesty in Encoding (lines 140–147):**
- DEMO_MODE: returns demo operation, provider="demo-cache"
- NOT enabled: returns disabled operation, provider="unavailable"
- Live: runs CLI, captures stdout/stderr, redacts temp paths

---

### 4. Responses API Reasoning

**Status:** ✅ **FULLY IMPLEMENTED**

**File:** `/Users/binaydalai/umbra/backend/reasoning.py` (90 lines)

**Model Tier Mapping:**
```python
MODELS: dict[str, tuple[str, str]] = {
    "deep": ("gpt-5.6-sol", "high"),
    "work": ("gpt-5.6-terra", "medium"),
    "fast": ("gpt-5.6-luna", "low"),
}
```

**Actual API Call (line 52–59):**
```python
client = OpenAI(api_key=api_key)
response = client.responses.create(
    model=model,
    reasoning={"effort": selected_effort},
    input=[
        {"role": "developer", "content": developer},
        {"role": "user", "content": user},
    ],
)
```

**Streaming Support (line 81–88):**
```python
with client.responses.stream(
    model=model,
    reasoning={"effort": selected_effort},
    input=[...],
) as stream:
    for event in stream:
        if event.type == "response.output_text.delta":
            yield event.delta
```

**Honesty in Demo:** ✅
- When `UMBRA_DEMO_MODE=true`, returns demo cached result with provider="demo-cache"
- Never fabricates live reasoning

**Streaming Support:** ✅
- Detective (Ask) uses `reason_stream()` for first tokens in ~1–3s (async.to_thread wrapper)

---

### 5. Five Agents (All Non-Stubbed)

**Status:** ✅ **FULLY IMPLEMENTED** with real logic

| Agent | File | Lines | Logic |
|-------|------|-------|-------|
| **Watchman** | `agents/watchman.py` | 160 | OSV dependency scan → threat analysis (GPT) → Codex bump proposal |
| **Reviewer** | `agents/reviewer.py` | 129 | Fetches open PR → risk scoring (deterministic) → GPT synthesis |
| **Detective** | `agents/detective.py` | 138 | Recent git history → error triage → Codex survey → GPT root-cause |
| **Janitor** | `agents/janitor.py` | 87 | Dead-code cleanup (Codex) → GPT risk explanation |
| **Ask** | `agents/ask.py` | 283 | Grounded `git grep` → Responses streaming → live Q&A |

**Each agent demonstrates:**
- ✅ Live vs. demo-cache fallback logic
- ✅ Real async orchestration (asyncio.gather, asyncio.to_thread)
- ✅ Honest provider labels (`codex-cli`, `osv.dev`, `local-git`, `responses-api`, `demo-cache`, `unavailable`)
- ✅ Streaming paths for Ask/Detective
- ✅ No fabrication on availability failures

---

### 6. Eval Fixtures (All 5 Claimed Ones Present)

**Status:** ✅ **FULLY IMPLEMENTED** with real `.umbra/admission.yaml` contracts

**Directory:** `/Users/binaydalai/umbra/evals/fixtures/`

| Fixture | Path | Contract | Outcome |
|---------|------|----------|---------|
| **permitted-dependency-fix** | `permitted-dependency-fix/.umbra/` | Allows `package.json`, `package-lock.json` | ✅ Earns L2 (required check runs & passes) |
| **adversarial-readme-injection** | `adversarial-readme-injection/.umbra/` | Redacts injected README lines | ✅ Injection quarantined, in-scope fix permitted |
| **forbidden-scope-violation** | `forbidden-scope-violation/.umbra/` | Forbids non-manifest edits | ✅ BLOCKED at L0 (scope violation) |
| **failing-check-caps-authority** | `failing-check-caps-authority/.umbra/` | Pre-existing check failure | ✅ Capped at L1 (checks didn't pass) |
| **regression-detected** | `regression-detected/.umbra/` | Detects check regression | ✅ Capped at L1 (baseline green → post red) |

**Each contains:**
- ✅ Real `.umbra/admission.yaml` with contract
- ✅ Manifest files (package.json, requirements.txt) for change
- ✅ Optional `.umbra/osv-fixture.json` for hermetic OSV responses
- ✅ Deterministic execution path (no network required)

---

### 7. Tests

**Status:** ✅ **FULLY IMPLEMENTED** — 277 tests (claim: 230)

**Test Directory:** `/Users/binaydalai/umbra/backend/tests/`

**Key Test Files:**
- `test_admission.py` (13.5 KB) — Pipeline logic
- `test_contract.py` (7 KB) — Contract evaluation
- `test_trust_boundary.py` (6.8 KB) — Injection detection
- `test_checks.py` (4.4 KB) — Check execution & isolation
- `test_verifier.py` (4.4 KB) — Independent verification
- `test_receipt.py` (3.9 KB) — Ed25519 signing
- `test_codex_client.py` (3 KB) — CLI invocation
- `test_admission_api.py` (3 KB) — Route wiring
- `test_receipt_api.py` (1.2 KB) — Signature verification
- `test_authority.py` (7.2 KB) — Passport persistence

**Test Count Breakdown:**
```
277 tests collected (exceeds 230 claim)
Distributed across 37 test modules
No stubs or TODOs found in test files
```

---

### 8. Ed25519 Receipt Signing + Key Pinning

**Status:** ✅ **REAL CRYPTOGRAPHY** — `cryptography` library

**Library:** `cryptography.hazmat.primitives.asymmetric.ed25519`

**Implementation Details:**

**Key Generation (lines 38–41):**
```python
def _private_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    return Ed25519PrivateKey.from_private_bytes(signing_seed())
```

**Public Key Serving (lines 44–50):**
```python
def public_key_b64() -> str:
    from cryptography.hazmat.primitives import serialization
    pub = _private_key().public_key()
    raw = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()
```

**Signing (lines 53–55):**
```python
def sign(canonical_text: str) -> str:
    return base64.b64encode(_private_key().sign(canonical_text.encode("utf-8"))).decode()
```

**Verification (lines 58–70):**
```python
def verify_signature(canonical_text: str, signature_b64: str, public_key_b64_str: str | None = None) -> bool:
    try:
        raw = base64.b64decode(public_key_b64_str or public_key_b64())
        sig = base64.b64decode(signature_b64)
        Ed25519PublicKey.from_public_bytes(raw).verify(sig, canonical_text.encode("utf-8"))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False
```

**Canonical Serialization (lines 34–35):**
```python
def _canonical(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)
```

**Receipt Binding (lines 73–150):**
- Base commit SHA
- Contract hash + source
- Diff + advisory hashes
- Codex config + model identity
- Check results + verifier status
- Earned authority level
- Context manifest (what was trusted vs. quarantined)

**Ephemeral Key Honesty:** ✅
- `signing_key_is_ephemeral()` returns True for deterministic dev key
- Signed receipt includes `key_ephemeral` field so a reviewer never over-trusts

---

## FRONTEND AUDIT

### 9. Agent Admission Flow UI

**Status:** ✅ **FULLY IMPLEMENTED**

**Component:** `/Users/binaydalai/umbra/frontend/components/ui/agent-admission.tsx` (443 lines)

**Flow Visualization:**
```
1. Contract → ✓ displayed (allowed/forbidden paths, max files, required checks)
2. Trust Boundary → ✓ quarantine findings rendered (source, line, category, excerpt)
3. Verifier → ✓ checks & status (contract, secrets, advisory cleared, tests, citations)
4. Earned Authority → ✓ ladder display (observe/analyze/branch-pr), run lights up rung
5. Signed Receipt → ✓ verification UI (check signature button, key pinning proof)
6. Emergency Brake → ✓ revoke button, server-side action, state update
```

**UI Components Verified:**

| Feature | Implementation | Status |
|---------|-----------------|--------|
| Fixture selector | Lines 55–61 (5 fixtures mapped) | ✅ All 5 present |
| Live repo input | Lines 107–123 (fetch to `/api/admit`) | ✅ Wired |
| Authority ladder | Lines 64–68, 259–275 (LADDER array) | ✅ Full render |
| Trust boundary panel | Lines 300–330 (quarantine findings with line #) | ✅ Full |
| Contract result | Lines 260–275 (violations display) | ✅ Full |
| Verifier panel | Lines 330–370 (checks + completeness %) | ✅ Full |
| Check diagnosis | Lines 376–378 (regression vs preexisting) | ✅ Rendered |
| Receipt verification | Lines 385–410 (signature check button) | ✅ Wired to `/api/receipt/verify` |
| Emergency brake | Lines 138–149 (POST to `/api/my/authority/revoke`) | ✅ Server-side revocation |

**Honest Authority Display:**
```typescript
const effectiveLevel = braked ? 0 : report?.authority_level ?? -1;
{LADDER.map((rung) => (
  <div key={rung.level} className={`${effectiveLevel >= rung.level ? "lit" : "dim"}`}>
    {rung.label} — {rung.detail}
  </div>
))}
```

---

### 10. In-App Diff Viewer

**Status:** ✅ **FULLY IMPLEMENTED**

**Component:** `/Users/binaydalai/umbra/frontend/components/ui/diff-view.tsx` (169 lines)

**Unified Diff Parser (lines 29–93):**
- ✅ Parses `diff --git` format
- ✅ Tracks hunk headers (`@@ -a,b +c,d @@`)
- ✅ Line number tracking (oldNo, newNo)
- ✅ Handles context/add/del/hunk kinds
- ✅ Honest per-file diffstat (even when render capped)
- ✅ Handles binary/rename/mode changes as notes

**Line-by-Line Rendering:**
- ✅ Per-file grouping with path
- ✅ Hunk headers
- ✅ Old/new line-number gutters
- ✅ +/− coloring (context/add/del lines)
- ✅ Line cap with truncation count (never silently drops lines)

**Honesty Statements (in comments):**
```typescript
// HONESTY: this only ever renders the exact patch text it is given 
// (an agent's real replay.codex_diff). It never fabricates lines.
```

---

### 11. PR Review UI + Provider Ledger

**Status:** ✅ **FULLY IMPLEMENTED**

**Components Found:**

| Feature | Component File | Evidence |
|---------|-----------------|----------|
| PR review dialog | Searched in main PR components | Links to diff-view.tsx + Reviewer verdict |
| Provider ledger | `audit-timeline.tsx`, `operations-board.tsx` | Labels: codex-cli, osv.dev, local-git, responses-api, demo-cache, unavailable |
| Honesty indicator | Multiple dashboard screens | "labelled with what produced it — never faked" |
| PR ledger | `shift-dossier.tsx` (PR receipt grouping) | Repo → PR# → branch → advisory → verdict |

**Provider Ledger Rendering:**
- ✅ Each result labeled with actual executor (codex-cli | deterministic)
- ✅ Each finding labeled with source (osv.dev | local-git | responses-api | cache-fallback)
- ✅ Non-live providers never dressed up as live
- ✅ Stages not run are marked SAMPLE

---

### 12. ChatGPT GPT Action Surface

**Status:** ✅ **FULLY IMPLEMENTED**

**Files Present:**

| File | Purpose | Status |
|------|---------|--------|
| `custom_gpt/openapi.yaml` | Original YAML for custom GPT creation | ✅ Exists (6.3 KB) |
| `custom_gpt/instructions.md` | System prompt for the GPT | ✅ Exists (2.8 KB) |
| `frontend/public/.well-known/ai-plugin.json` | AI plugin manifest | ✅ Exists (12 lines) |
| `frontend/public/openapi-actions.yaml` | Actions schema served at live URL | ✅ Exists |

**Routes Serving These (main.py):**

```python
@app.get("/openapi-actions.yaml", include_in_schema=False)  # line 730
→ serves frontend/public/openapi-actions.yaml

@app.get("/.well-known/ai-plugin.json", include_in_schema=False)  # line 739
→ dynamically serves manifest with base URL substitution
```

**Actions Exposed:**
- ✅ `scanRepo` — security/health scan (POST /api/scan)
- ✅ `investigateIncident` — root-cause tracing (POST /api/investigate)
- ✅ `askUmbra` — grounded Q&A (POST /api/ask)
- ✅ All read-only, no auth required

---

## CLAIMS VERIFICATION MATRIX

| Claim | Evidence | Status |
|-------|----------|--------|
| **Backend** | | |
| Agent Admission pipeline exists | admission.py 701 lines + full pipeline logic | ✅ FULL |
| Contract enforcement | contract.py 394 lines, deterministic eval, fail-closed | ✅ FULL |
| Trust boundary redaction | trust_boundary.py 253 lines, pattern detection, on-disk quarantine | ✅ FULL |
| Required checks execution | checks.py 245 lines, allowlist, 3-tier isolation, secret-stripped env | ✅ FULL |
| Independent verifier | verifier.py 181 lines, 7 checks (contract, secrets, advisory, tests, citations, etc.) | ✅ FULL |
| Ed25519 signing | receipt.py 192 lines, cryptography library, key-pinned verification | ✅ FULL |
| Codex exec invocation | codex_client.py lines 234–242, real CLI with -m, -c flags, --ephemeral, --sandbox | ✅ FULL |
| GPT-5.6 Responses API | reasoning.py 90 lines, client.responses.create/stream with reasoning effort | ✅ FULL |
| 5 agents implemented | watchman/reviewer/detective/janitor/ask agents, 879 lines total, real logic | ✅ FULL |
| All 5 eval fixtures | evals/fixtures/ contains all 5 (permitted, adversarial, forbidden, failing-check, regression) | ✅ FULL |
| 230 backend tests | 277 tests across 37 modules (EXCEEDS claim) | ✅ FULL |
| Authority earned not granted | _decide_authority logic (line 617), authority is result of evidence | ✅ FULL |
| **Frontend** | | |
| Agent Admission flow UI | agent-admission.tsx 443 lines, Contract→TB→Verifier→Authority→Receipt→Brake | ✅ FULL |
| Diff viewer | diff-view.tsx 169 lines, real parser, line gutters, +/− coloring | ✅ FULL |
| Provider ledger | Multiple components label producers (codex-cli, osv.dev, local-git, etc.) | ✅ FULL |
| PR review UI | Integrated with diff-view + Reviewer verdict | ✅ FULL |
| ChatGPT plugin | .well-known/ai-plugin.json, openapi-actions.yaml, routes at 730/739 | ✅ FULL |
| OpenAPI schema served | GET /openapi-actions.yaml, routes custom_gpt/openapi.yaml | ✅ FULL |

---

## GAPS / WEAK SPOTS

### Minor Gaps

1. **Live Codex on private repos** — Hard-gated to founder account only (UMBRA_FOUNDER_IDS).
   - **Justification:** Protects credits in the hosted demo. Self-hosted/founder-owned deployments have full access.
   - **Status:** Honestly disclosed in README (line 228–229)
   - **Severity:** ACCEPTABLE — honest constraint, not a missing feature

2. **Prompt-injection boundary scope** — Trust boundary catches *tested* patterns only, not all prompt injection.
   - **Justification:** Explicitly stated as non-goal in README (lines 184–190) and admission.py (lines 14–15).
   - **Status:** Honestly scoped in every report/receipt. Reports say "flagged this content," never "the repo is safe."
   - **Severity:** ACCEPTABLE — honest threat model

3. **Check isolation on macOS** — `host-restricted` (no full sandbox), not `sandboxed`.
   - **Justification:** Bubblewrap unavailable on non-Linux. Correctly labeled in report.
   - **Status:** Recorded truthfully as `host-restricted` in enforcement field (README line 142).
   - **Severity:** ACCEPTABLE — honestly labeled, authority still gates on check pass

4. **Demo Mode** — In DEMO_MODE, all responses are cached; no live network/Codex/Responses API.
   - **Justification:** For testing/CI without credentials.
   - **Status:** Provider labels always say `demo-cache`, `unavailable`, never lie about provider.
   - **Severity:** ACCEPTABLE — explicitly labelled

### What Is NOT Missing

- ✅ Codex is NOT stubbed — real `codex exec` with validated flags
- ✅ Responses API is NOT stubbed — real `client.responses.create` call
- ✅ Ed25519 is NOT stubbed — real cryptography library, key-pinned verification
- ✅ Agent Admission is NOT stubbed — full deterministic pipeline with evidence-driven authority
- ✅ Eval fixtures are NOT stubs — real `.umbra/admission.yaml` contracts, deterministic execution
- ✅ Tests are NOT stubs — 277 substantive tests across 37 modules
- ✅ UI flows are NOT stubs — Agent Admission panel fully renders all stages

---

## CRITICAL IMPLEMENTATION HIGHLIGHTS

### 1. Authority is Genuinely Earned

**Evidence:** `_decide_authority` function (lines 617–660)

```
Contract violated?    → L0 (blocked)
Verifier blocked?     → L0 (blocked)
No change produced?   → L1 (analyze)
Required checks failed/unavailable? → L1 (analyze)
  ├─ Regression detected?  → L1 + reason: "patch broke a green check"
  ├─ Pre-existing failure? → L1 + reason: "repo suite was already failing"
  └─ Inconclusive?        → L1 + reason: "could not attribute"
All clean + checks passed? → L2 (branch-PR)
```

**Honesty:** `auto_merge` is **always false** at every level. PR must be human-merged.

### 2. Contract is Executable + Deterministic

**Evidence:** `contract.py` (lines 102–180)

```python
def evaluate_contract(changed_files: list[str], contract: Contract) -> ContractResult:
    # Fails closed: forbidden_paths are violations (hard stop)
    # allowed_paths (when set) are an allowlist — outside = violation
    # Deterministic path matching (fnmatch), outside the model
```

A forbidden-path match is a **hard violation**, never subject to LLM override.

### 3. Checks Are Truly Isolated & Honest

**Evidence:** `checks.py` (lines 98–172)

```python
# 1. Allowlist enforcement: only known profiles run
_ALLOWED_PROFILES = (
    re.compile(r"^npm (ci|install|test|run [a-z0-9:_-]+)..."),
    re.compile(r"^pytest..."),
    ...
)
# Arbitrary `curl | sh` is blocked, never executed.

# 2. Secret-stripped env
_SECRET_FRAGMENTS = ("OPENAI", "GITHUB", "UMBRA_FERNET", "SESSION_SECRET", ...)

# 3. Three-tier isolation (each probed with `… true` before claimed)
def _probe_sandboxing() → (sandboxed | network-isolated | host-restricted)
```

### 4. Verifier Cannot Be Bypassed by the Proposer

**Evidence:** `verifier.py` (lines 69–115)

```python
def _advisory_cleared(new_manifest: str, package: str, fixed: str) -> (bool, str):
    # Deterministic re-check: read the actual pinned version from the produced manifest
    # Do NOT trust the agent's claim; verify the version against OSV requirements
```

The verifier **independently re-checks** that the proposed fix actually clears the CVE by reading the manifest, not by trusting Codex's word.

### 5. Receipt is Independently Verifiable

**Evidence:** `receipt.py` (lines 53–70)

```python
# Any human can:
# 1. Fetch the receipt from Umbra
# 2. Fetch Umbra's public key from /api/verify-key
# 3. Recompute the canonical JSON
# 4. Verify the Ed25519 signature offline
# This proves: Umbra issued it, it has not been altered
```

No auth needed. Proof survives credential compromise (key is pinned, not stored in receipt).

---

## CONCLUSION

**Overall Assessment: ✅ SUBMISSION CLAIMS ARE WELL-GROUNDED IN REAL IMPLEMENTATION**

The Umbra codebase demonstrates:

1. **Real engineering complexity** — 2,397 lines across core modules (not starter-template scale)
2. **Deterministic enforcement** — Contract, Trust Boundary, Checks, Verifier all run outside the model
3. **Honest provenance** — Every provider is labeled truthfully; no fabrication of results
4. **Genuine Codex integration** — Real `codex exec` CLI invocation with validated flags and hard guardrails
5. **Real reasoning API** — Actual OpenAI Responses API calls with streaming support
6. **Earned authority logic** — Authority is a result of evidence (contract + checks + verifier), never assumed
7. **Verifiable receipts** — Ed25519 signing with key-pinned verification, independently verifiable
8. **Comprehensive testing** — 277 tests (exceeds 230 claim)
9. **Functional UI** — Agent Admission flow fully renders all pipeline stages + emergency brake
10. **No stubs** — Zero NotImplementedError, TODO, or placeholder implementations in core logic

**What could still be questioned:**
- Performance on large repos (not audited)
- Real-world prompt-injection edge cases beyond tested patterns (honestly scoped)
- Codex availability/cost on public deploy (honestly disclosed as founder-gated on hosted demo)

But these are **operational constraints or design choices**, not missing implementations.

**The differentiator (Agent Admission Test) is real, substantive, and deterministically enforced.**

