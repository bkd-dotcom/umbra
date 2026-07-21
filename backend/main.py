"""FastAPI entrypoint for Umbra HQ."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from fastapi import BackgroundTasks, Header, Request

from backend import auth, schedules, triage
from backend.auth import _user_key
from backend.codex_client import CodexClient
from backend.integrations.github import parse_public_repo
from backend.integrations.github_app import installation_token
from backend.integrations.repository import cloud_scan_enabled, live_repositories_enabled
from backend.notifications import (
    DELIVERY_ACCEPTED,
    DELIVERY_EMAIL_REJECTED,
    DELIVERY_EMAIL_UNAVAILABLE,
    DELIVERY_SCAN_FAILED,
    DELIVERY_SKIPPED_OPTED_OUT,
    make_unsub_token,
    send_report_email,
)
from backend.orchestrator import orchestrator
from backend.scheduling import compute_next_run
from backend.settings import cookie_secure, cron_key, email_configured, founder_ids, frontend_origin, github_app_configured, github_app_webhook_secret, session_secret
from backend.store import get_store
from backend.webhooks import REVIEWABLE_ACTIONS, verify_github_signature


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Live integrations are instantiated lazily; demo mode intentionally needs no key.
    if not os.getenv("OPENAI_API_KEY") and os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true":
        # Do not raise here: health checks need to explain missing configuration.
        pass
    yield


app = FastAPI(
    title="Umbra Engineer API",
    version="0.1.0",
    description="The AI engineer that works the night shift.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("UMBRA_FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Signed session cookie for OAuth sign-in. SameSite=Lax is required so the
# cookie survives the provider's top-level redirect back to /auth/callback.
app.add_middleware(
    SessionMiddleware,
    secret_key=session_secret(),
    same_site="lax",
    https_only=cookie_secure(),
)
# Auth + per-user routes. Registered before the static mount below so /auth/*
# and /api/* always match ahead of the greedy "/" UI mount.
app.include_router(auth.router)
app.include_router(triage.router)
app.include_router(schedules.router)


@app.get("/api/health", tags=["system"])
async def health() -> dict[str, object]:
    demo_mode = os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true"
    openai_configured = bool(os.getenv("OPENAI_API_KEY"))
    codex_cli_enabled = CodexClient.enabled()
    cloud_scan = cloud_scan_enabled()
    # The Codex CLI (ChatGPT login) is a full live provider for both halves, so
    # readiness never requires an OpenAI key. Cloud-scan mode also counts as live:
    # real findings (OSV / git history / git-grep) run without Codex. Demo mode is
    # always ready (zero external dependencies).
    live_ready = live_repositories_enabled() and (codex_cli_enabled or cloud_scan)
    return {
        "status": "ok",
        "service": "umbra",
        "mode": "demo" if demo_mode else "live",
        "openai_configured": openai_configured,
        "codex_cli_enabled": codex_cli_enabled,
        "cloud_scan_enabled": cloud_scan,
        "ready": demo_mode or openai_configured or live_ready,
    }


class ScanRequest(BaseModel):
    repo_url: str = Field(description="Full URL of a public GitHub repository")
    agents: list[str] | None = Field(default=None, description="Optional agent subset")
    pr_number: int | None = Field(default=None, ge=1, description="Optional pull request number for Reviewer")
    model: str | None = Field(default=None, description="Codex model (gpt-5.6-luna=fast, gpt-5.6-terra=balanced); invalid values fall back to the default")
    reasoning_effort: str | None = Field(default=None, description="Codex reasoning effort: minimal/low/medium/high; invalid values fall back to the default")
    autonomy_level: int = Field(default=1, ge=0, le=3, description="0=report only (no Codex propose), 1=prepare diff (default), 2=branch PR via /api/my/pr, 3=request review. Never auto-merges.")


class InvestigateRequest(BaseModel):
    repo_url: str
    error_log: str = Field(min_length=1, max_length=30_000)


class AskRequest(BaseModel):
    repo_url: str
    question: str = Field(min_length=1, max_length=10_000)


def _validate_repo(repo_url: str) -> str:
    try:
        return parse_public_repo(repo_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _user_context(request: Request) -> dict[str, object]:
    """Resolve per-user scan inputs from the session (all optional):

    - ``github_token`` — clone the user's own (incl. private) repos, read-only.
    - ``openai_key`` — the user's own key for live reasoning, billed to them.
    - ``allow_codex`` — True ONLY for a founder account when the server CLI is
      enabled, so visitors can never spend the founder's Codex credits. When no
      founder allowlist is configured (local dev), this is ``None`` so the CLI's
      own env gate applies and nothing changes for a solo local user.
    """
    founders = founder_ids()
    gating_on = bool(founders)
    user = request.session.get("user")
    if not user:
        return {"github_token": None, "openai_key": None, "allow_codex": False if gating_on else None}
    key = f"{user.get('provider')}:{user.get('sub')}"
    store = get_store()
    allow_codex = (CodexClient.enabled() and key in founders) if gating_on else None
    return {"github_token": store.get_github_token(key), "openai_key": store.get_openai_key(key), "allow_codex": allow_codex}


@app.post("/api/scan", tags=["agents"])
async def scan_repo(request: ScanRequest, http: Request) -> dict[str, object]:
    _validate_repo(request.repo_url)
    return await orchestrator.scan(request.repo_url, request.agents, request.pr_number, model=request.model, reasoning_effort=request.reasoning_effort, autonomy_level=request.autonomy_level, **_user_context(http))


class AdmissionRequest(BaseModel):
    repo_url: str | None = Field(default=None, description="Public repo to run the admission test against (live mode; requires UMBRA_ENABLE_LIVE_REPOS)")
    fixture: str | None = Field(default=None, max_length=100, description="Name of a committed hermetic eval fixture under evals/fixtures/ (offline, deterministic)")


@app.post("/api/admit", tags=["agents"])
async def agent_admission(request: AdmissionRequest, http: Request) -> dict[str, object]:
    """Agent Admission Test — does a coding agent obey THIS repository's rules?

    Runs a bounded task in a disposable checkout, treats repository text as
    untrusted, evaluates the changeset against the executable Change Contract,
    verifies it independently, and grants only the authority the run earned.
    Never merges; never grants auto-merge at any level.

    - ``fixture``: an offline, deterministic eval repo (no auth, no network) — the
      default demo path judges can reproduce.
    - ``repo_url``: a real public repo (live clone + live OSV) — needs the user's
      context for private repos.
    """
    if request.fixture:
        try:
            return await orchestrator.admit(repo_url="", fixture=request.fixture)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not request.repo_url:
        raise HTTPException(status_code=422, detail="Provide a fixture name or a repo_url.")
    _validate_repo(request.repo_url)
    ctx = _user_context(http)
    try:
        report = await orchestrator.admit(request.repo_url, token=ctx["github_token"])
    except RuntimeError as exc:  # live repos disabled on this server
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Admission test failed: {exc}") from exc
    # Persist the earned-authority passport for a signed-in user so it durably
    # gates that repo's PR capability (and is revoked/downgraded on a later run).
    user = http.session.get("user")
    if user:
        _persist_authority(user, report)
    return report


class EvidencePackRequest(BaseModel):
    result: dict = Field(description="A scan result to certify into an Evidence Pack")
    mode: str = Field(default="live", description="Run type label: 'live', 'captured', or 'demo'")


@app.post("/api/evidence-pack", tags=["agents"])
async def evidence_pack(request: EvidencePackRequest) -> dict[str, object]:
    """Render a scan result into a portable, hashable Evidence Pack (Markdown +
    sha256). No auth — public/captured results are meant to be shared. The pack
    sanitizes every temp path and restates that Umbra never auto-merges."""
    from backend.evidence import build_evidence_pack

    return build_evidence_pack(request.result, request.mode)


class EvidenceVerifyRequest(BaseModel):
    result: dict = Field(description="A scan result (ideally carrying evidence_hash) to independently verify")


@app.post("/api/evidence-pack/verify", tags=["agents"])
async def evidence_pack_verify(request: EvidenceVerifyRequest) -> dict[str, object]:
    """Independently recompute the canonical hash of a result and compare it to the
    ``evidence_hash`` the result claims. This is the reviewer-side check: it proves
    the result was not altered after Umbra recorded it. No auth — verification of a
    shared/captured pack must be possible by anyone. Note: this is a canonical
    integrity hash, not a cryptographic signature."""
    from backend.evidence import canonical_hash

    result = request.result
    claimed = result.get("evidence_hash")
    computed = canonical_hash(result)
    has_claim = bool(claimed)
    return {
        "has_claim": has_claim,
        "claimed_hash": claimed,
        "computed_hash": computed,
        "verified": bool(has_claim and claimed == computed),
    }


@app.get("/api/verify-key", tags=["agents"])
async def verify_key() -> dict[str, object]:
    """The Ed25519 public key used to sign Remediation Receipts, so anyone can
    verify a receipt's signature independently (offline). ``ephemeral`` is true
    when the server is using the deterministic dev key rather than a managed one."""
    from backend.receipt import public_key_b64
    from backend.settings import signing_key_is_ephemeral

    return {"algorithm": "Ed25519", "public_key": public_key_b64(), "ephemeral": signing_key_is_ephemeral()}


class ReceiptVerifyRequest(BaseModel):
    envelope: dict = Field(description="A signed Remediation Receipt envelope {receipt, signature, public_key, ...}")


@app.post("/api/receipt/verify", tags=["agents"])
async def receipt_verify(request: ReceiptVerifyRequest) -> dict[str, object]:
    """Independently verify a signed Remediation Receipt: recompute its canonical
    hash and check the Ed25519 signature **against Umbra's own pinned public key**
    (so it proves Umbra issued the receipt, not merely that some key signed it).
    No auth — a receipt is meant to be verifiable by anyone."""
    from backend.receipt import verify_receipt

    return verify_receipt(request.envelope)


class PullRequestRequest(BaseModel):
    repo_url: str
    mode: str = Field(default="bump", description="'bump' (deterministic dependency bump), 'apply_diff' (open a PR from a diff Umbra already produced), or 'codex' (Codex-authored)")
    package: str | None = None
    version: str | None = None
    cve: str | None = None
    diff: str | None = Field(default=None, max_length=200_000, description="For mode='apply_diff': the reviewed diff to apply and open a PR from")
    diffs: list[str] | None = Field(default=None, description="For mode='combine': the reviewed diffs to consolidate into one PR")
    model: str | None = Field(default=None, description="For mode='codex': Codex model; invalid values fall back to the default")
    reasoning_effort: str | None = Field(default=None, description="For mode='codex': reasoning effort; invalid values fall back to the default")


def _persist_authority(user: dict | None, report: dict[str, object]) -> None:
    """Record the earned-authority passport from an admission run, keyed by repo.

    Binds the passport tightly to the exact admission that earned it — the signed
    receipt hash, base commit, executor + Codex config hash, last check result, and
    an expiry — so a later PR can be traced to precisely this admission. Best-effort;
    never raises."""
    from datetime import UTC, datetime, timedelta

    try:
        if not user or not report.get("repo"):
            return
        receipt_env = report.get("receipt") or {}
        checks = report.get("checks") or {}
        codex_config = report.get("codex_config") or {}
        now = datetime.now(UTC)
        get_store().save_authority(_user_key(user), str(report["repo"]), {
            "authority_level": report.get("authority_level", 0),
            "authority": report.get("authority", "observe"),
            "authority_label": report.get("authority_label", ""),
            "outcome": report.get("outcome", ""),
            "contract_hash": (report.get("contract_result") or {}).get("contract_hash"),
            "task_type": report.get("task_type"),
            # Tight bindings to the exact admission run.
            "executor": report.get("executor"),
            "base_commit": report.get("base_commit"),
            "diff_hash": report.get("diff_hash"),
            "advisory_hash": report.get("advisory_hash"),
            "codex_config_hash": codex_config.get("config_hash"),
            "receipt_hash": receipt_env.get("canonical_hash"),
            "checks_enforcement": checks.get("enforcement"),
            "checks_all_passed": checks.get("all_passed"),
            "admitted_at": now.isoformat(),
            "expires_at": (now + timedelta(days=7)).isoformat(),
        })
    except Exception:  # noqa: BLE001 - authority persistence is best-effort
        logging.getLogger("umbra.authority").exception("Failed to persist authority passport")


def _persist_opened_pr(user: dict | None, request: PullRequestRequest, opened: dict[str, object]) -> None:
    """Best-effort: record a real opened PR into the per-user ledger so it becomes
    a durable receipt. Skips previews (no url/number) and unauthenticated calls;
    never raises — a ledger write must never fail the PR open itself."""
    try:
        if not user:
            return
        if not (opened.get("url") and opened.get("number")):
            return  # preview-shaped or write-less result — nothing to record
        get_store().save_pr(_user_key(user), {
            "repo_url": request.repo_url,
            "number": opened.get("number"),
            "url": opened.get("url"),
            "branch": opened.get("branch"),
            "base": opened.get("base"),
            "mode": request.mode,
            "package": request.package,
            "cve": request.cve,
            "review": opened.get("review"),
        })
    except Exception:  # noqa: BLE001 - ledger persistence is best-effort
        logging.getLogger("umbra.pr").exception("Failed to persist opened PR receipt")


def _require_admission() -> bool:
    """Strict mode: when UMBRA_REQUIRE_ADMISSION=true, an agent-created PR requires a
    current branch-PR passport for the repo (no admission → no PR). Default off, so
    admission "governs enrolled repositories" and existing crew flows are unaffected
    until a repo opts into the governed workflow."""
    return os.getenv("UMBRA_REQUIRE_ADMISSION", "false").lower() == "true"


def _enforce_pr_authority(user: dict, repo_url: str) -> None:
    """Gate a PR open on the repo's earned-authority passport.

    Always blocks a revoked passport (Emergency Brake), one below branch-PR, or an
    expired one. In strict mode (UMBRA_REQUIRE_ADMISSION=true) a repo with NO
    passport is also blocked — the fully governed workflow. Otherwise a repo that
    never ran admission is unaffected (admission governs *enrolled* repositories)."""
    from datetime import UTC, datetime

    from backend.integrations.github import parse_public_repo

    try:
        label = parse_public_repo(repo_url)
    except ValueError:
        return
    passport = get_store().get_authority(_user_key(user), label)
    if not passport:
        if _require_admission():
            raise HTTPException(status_code=403, detail="This repository has not been admitted. Run the Agent Admission Test to earn branch-PR authority before opening a PR (strict mode).")
        return  # not enrolled → gate does not apply
    if passport.get("revoked"):
        raise HTTPException(status_code=403, detail="Authority for this repository was revoked (Emergency Brake). Re-run the Agent Admission Test to re-earn branch-PR authority before opening a PR.")
    if int(passport.get("authority_level", 0)) < 2:
        raise HTTPException(status_code=403, detail=f"This repository's agent has not earned branch-PR authority (current: {passport.get('authority', 'observe')}). Re-run the Agent Admission Test.")
    expires_at = passport.get("expires_at")
    if expires_at:
        try:
            if datetime.fromisoformat(expires_at) < datetime.now(UTC):
                raise HTTPException(status_code=403, detail="This repository's admission has expired. Re-run the Agent Admission Test to re-earn branch-PR authority.")
        except (ValueError, TypeError):
            pass


async def _open_fix_pr(request: PullRequestRequest, http: Request, preview: bool) -> dict[str, object]:
    """Shared handler for /api/my/pr and /api/my/pr/preview. Branch-only, never
    merges. Codex-authored PRs are founder-gated on the hosted deploy so visitors
    can't spend Codex credits; 'apply_diff'/'combine' open a PR from diffs Umbra
    already produced (no Codex run), so they are not gated. On a real (non-preview)
    open, the result is recorded to the user's PR ledger."""
    _validate_repo(request.repo_url)
    user = http.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to open a pull request.")
    ctx = _user_context(http)
    token = ctx["github_token"]
    if not token:
        raise HTTPException(status_code=400, detail="Connect GitHub (with repo access) to open a pull request.")
    # Earned-authority gate: if this repo has run the Agent Admission Test, its
    # passport must currently grant branch-PR authority. A revoked passport
    # (Emergency Brake) or one below Level 2 blocks the open — a real server-side
    # enforcement of the earned authority, not a UI hint. Repos that have never run
    # admission are unaffected (the gate only tightens once a passport exists).
    if not preview:
        _enforce_pr_authority(user, request.repo_url)
    if request.mode == "codex" and ctx["allow_codex"] is False:
        raise HTTPException(status_code=403, detail="Codex-authored PRs are founder-only on the hosted demo — try a dependency-bump PR, or run Umbra locally.")
    try:
        result = await orchestrator.open_fix_pr(request.repo_url, str(token), request.mode, request.package, request.version, request.cve, allow_codex=ctx["allow_codex"], diff=request.diff, model=request.model, reasoning_effort=request.reasoning_effort, diffs=request.diffs, preview=preview)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not open the pull request: {exc}") from exc
    if not preview:
        _persist_opened_pr(user, request, result)
    return result


@app.post("/api/my/pr", tags=["agents"])
async def open_fix_pr(request: PullRequestRequest, http: Request) -> dict[str, object]:
    """Open a fix PR on explicit user request. Requires a signed-in user with a
    GitHub token (write); branch-only, never merges."""
    return await _open_fix_pr(request, http, preview=False)


@app.post("/api/my/pr/preview", tags=["agents"])
async def preview_fix_pr(request: PullRequestRequest, http: Request) -> dict[str, object]:
    """Preview the planned PR — the title, changed files, and the Reviewer's
    deterministic verdict — without opening anything. Same auth as the open path."""
    return await _open_fix_pr(request, http, preview=True)


@app.get("/api/my/prs", tags=["agents"])
async def my_prs(http: Request) -> list[dict[str, object]]:
    """The signed-in user's durable branch-only PR receipts."""
    user = http.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return get_store().list_prs(_user_key(user))


@app.get("/api/my/authority", tags=["agents"])
async def my_authority(http: Request) -> list[dict[str, object]]:
    """The signed-in user's earned-authority passports (one per repo that has run
    the Agent Admission Test). auto_merge is always false."""
    user = http.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return get_store().list_authority(_user_key(user))


class AuthorityRevokeRequest(BaseModel):
    repo: str = Field(min_length=1, max_length=200, description="Repo label whose earned authority to revoke (e.g. 'owner/name')")
    reason: str | None = Field(default=None, max_length=500)


@app.post("/api/my/authority/revoke", tags=["agents"])
async def revoke_authority(request: AuthorityRevokeRequest, http: Request) -> dict[str, object]:
    """Emergency brake: durably revoke a repo's earned authority to Level 0. This is
    a real server-side action — a subsequent admission-gated PR for that repo is
    blocked until the Agent Admission Test is re-run and re-earns authority."""
    user = http.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    rec = get_store().revoke_authority(_user_key(user), request.repo.strip(), request.reason)
    return {"ok": True, "authority": rec}


@app.post("/api/investigate", tags=["agents"])
async def investigate_incident(request: InvestigateRequest, http: Request) -> dict[str, object]:
    _validate_repo(request.repo_url)
    return await orchestrator.investigate(request.repo_url, request.error_log, **_user_context(http))


@app.post("/api/ask", tags=["agents"])
async def ask_umbra(request: AskRequest, http: Request) -> dict[str, object]:
    _validate_repo(request.repo_url)
    return await orchestrator.ask(request.repo_url, request.question, **_user_context(http))


@app.get("/api/ask/stream", tags=["streaming"])
async def ask_umbra_stream(repo_url: str, question: str, http: Request) -> StreamingResponse:
    _validate_repo(repo_url)
    ctx = _user_context(http)

    async def generate():
        reasoning = None
        async for event in orchestrator.ask_stream_events(repo_url, question, **ctx):
            etype = event.get("type")
            if etype == "references":
                yield f"event: references\ndata: {json.dumps({'references': event.get('references', []), 'source': event.get('source')})}\n\n"
            elif etype == "done":
                reasoning = event.get("reasoning")  # true reasoning provider, surfaced in the final event
            else:
                yield f"event: umbra\ndata: {json.dumps({'chunk': event.get('chunk', '')})}\n\n"
        yield f"event: done\ndata: {json.dumps({'reasoning': reasoning})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/investigate/stream", tags=["streaming"])
async def investigate_incident_stream(request: InvestigateRequest, http: Request) -> StreamingResponse:
    """Streaming Detective (POST because the error log can be long): streams the
    root-cause reasoning as it is produced, then a final structured postmortem."""
    _validate_repo(request.repo_url)
    ctx = _user_context(http)

    async def generate():
        async for event in orchestrator.investigate_stream(request.repo_url, request.error_log, **ctx):
            etype = event.get("type")
            if etype == "status":
                yield f"event: status\ndata: {json.dumps({'message': event.get('message', '')})}\n\n"
            elif etype == "result":
                yield f"event: result\ndata: {json.dumps(event.get('result', {}))}\n\n"
            else:
                yield f"event: umbra\ndata: {json.dumps({'chunk': event.get('chunk', '')})}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/replays", tags=["agents"])
async def list_replays() -> list[dict[str, object]]:
    return orchestrator.replays


@app.get("/api/events", tags=["streaming"])
async def event_stream() -> StreamingResponse:
    async def generate():
        # Send a comment so proxies establish the SSE response immediately.
        yield ": umbra stream connected\n\n"
        async for event in orchestrator.bus.stream():
            yield f"event: umbra\ndata: {json.dumps(event)}\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- Scheduled morning reports: cron runner ---------------------------------
# A periodic external tick (Cloud Scheduler) hits this endpoint with the shared
# cron key. For every due schedule we run a scan, save it to the owner's history,
# email the report (unless they opted out), and advance next_run_at. Auth is a
# shared secret header, not a user session — it acts on behalf of many users.
def _schedule_owner_key(schedule: dict) -> str | None:
    key = schedule.get("user_key") or schedule.get("owner")
    return str(key) if key else None


@app.post("/api/cron/run-due-scans", tags=["system"], include_in_schema=False)
async def run_due_scans(x_umbra_cron_key: str = Header(default="")) -> dict[str, object]:
    """Run every schedule whose next_run_at is due. Guarded by the shared cron key
    (503 if the server has none configured, 401 on mismatch). Never auto-merges —
    this only runs scans and sends reports."""
    configured = cron_key()
    if not configured:
        raise HTTPException(status_code=503, detail="Scheduler is not configured on this server.")
    if x_umbra_cron_key != configured:
        raise HTTPException(status_code=401, detail="Invalid cron key.")

    store = get_store()
    now = datetime.now(timezone.utc)
    due = store.list_due_schedules(now.isoformat())
    ran = 0
    emailed = 0
    for schedule in due:
        owner = _schedule_owner_key(schedule)
        repo = schedule.get("repo_full_name") or ""
        if not (owner and repo):
            continue
        repo_url = f"https://github.com/{repo}"
        # Advance next_run_at regardless of outcome so a failing repo doesn't wedge
        # the schedule; compute it up front so every early-continue still advances.
        try:
            next_run = compute_next_run(int(schedule.get("hour", 0)), int(schedule.get("minute", 0)), schedule.get("timezone", "UTC"), schedule.get("cadence", "daily"), now)
        except Exception:  # noqa: BLE001 - a bad schedule shouldn't break the batch
            logging.getLogger("umbra.cron").exception("Failed to compute next run for schedule %s", schedule.get("id"))
            next_run = schedule.get("next_run_at") or now.isoformat()

        try:
            result = await orchestrator.scan(repo_url)
        except Exception as exc:  # noqa: BLE001 - one repo failing must not stop the batch
            logging.getLogger("umbra.cron").exception("Scheduled scan failed for %s", repo)
            # Record the failure honestly: no report was produced, so nothing was sent.
            store.update_schedule_run(
                schedule.get("id"), now.isoformat(), next_run, None,
                delivery_status=DELIVERY_SCAN_FAILED, delivery_detail=f"Scan failed: {exc}"[:300],
            )
            continue
        ran += 1
        store.save_scan(owner, {
            "repo_full_name": repo,
            "umbra_score": result.get("umbra_score"),
            "source": result.get("source", "scheduled"),
            "vuln_count": len(result.get("vulnerabilities") or []),
            "report": result,
        })
        # Find the id we just saved so the schedule can deep-link to this report.
        recent = store.list_scans(owner, limit=1)
        scan_id = recent[0].get("scan_id") if recent else None

        # Determine the honest delivery outcome.
        recipient = (schedule.get("email") or "").strip()
        if store.notifications_opt_out(owner):
            delivery_status = DELIVERY_SKIPPED_OPTED_OUT
            delivery_detail = "Recipient has notifications turned off."
        elif not recipient or not email_configured():
            delivery_status = DELIVERY_EMAIL_UNAVAILABLE
            delivery_detail = "No recipient on file." if not recipient else "Email delivery is not configured on this server."
        else:
            base = os.getenv("UMBRA_PUBLIC_URL") or frontend_origin()
            view_url = f"{base}/dashboard" + (f"?scan={scan_id}" if scan_id else "")
            unsub_url = f"{base}/api/unsubscribe?token={make_unsub_token(owner)}"
            if send_report_email(recipient, repo, result, view_url, unsub_url):
                emailed += 1
                delivery_status = DELIVERY_ACCEPTED
                delivery_detail = f"Accepted for delivery to {recipient}."
            else:
                delivery_status = DELIVERY_EMAIL_REJECTED
                delivery_detail = "The email provider rejected the report."

        # Advance the schedule in place + persist the honest delivery outcome so a
        # failed email is visible in GET /api/my/schedules, never silently OK.
        store.update_schedule_run(
            schedule.get("id"), now.isoformat(), next_run, scan_id,
            delivery_status=delivery_status, delivery_detail=delivery_detail,
        )
    return {"ran": ran, "emailed": emailed, "due": len(due)}


# --- Autonomy: install-once GitHub App PR auto-review -----------------------
# One app-level webhook receives PR events for every installation (any account,
# public or private repo). We mint a short-lived installation token from the
# App's private key, review comment-only, and never merge. No per-repo webhooks,
# no stored user token — the review is posted as the App itself.
def _installation_repo_names(payload: dict) -> list[str]:
    return [str(r.get("full_name")) for r in (payload.get("repositories") or []) if r.get("full_name")]


async def _run_app_review(installation_id: int, repo_url: str, pr_number: int) -> None:
    """Background PR review: mint the installation token here (off the ack path)
    then review. Never raises — logs failures so they are visible in the logs."""
    try:
        token = await asyncio.to_thread(installation_token, installation_id)
        await orchestrator.review_pull_request(repo_url, pr_number, token)
    except Exception:  # noqa: BLE001 - a failed review must never crash the worker
        logging.getLogger("umbra.webhook").exception("App PR auto-review failed for %s #%s (installation %s)", repo_url, pr_number, installation_id)


@app.post("/api/github/app/webhook", tags=["webhooks"])
async def github_app_webhook(request: Request, background: BackgroundTasks, x_github_event: str = Header(default=""), x_hub_signature_256: str = Header(default="")) -> dict[str, object]:
    """The Umbra GitHub App's single webhook. Verifies the app-level HMAC secret,
    tracks installations, and (on a reviewable PR event) mints an installation
    token and posts one advisory review comment. Acks fast, reviews in background."""
    if not github_app_configured():
        raise HTTPException(status_code=503, detail="GitHub App is not configured on this server.")
    body = await request.body()
    if not verify_github_signature(github_app_webhook_secret(), body, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid or missing webhook signature.")
    payload = json.loads(body or b"{}")
    store = get_store()
    installation = payload.get("installation") or {}
    installation_id = installation.get("id")

    if x_github_event == "installation":
        account = installation.get("account") or {}
        if payload.get("action") == "deleted":
            if installation_id is not None:
                store.delete_installation(int(installation_id))
            return {"ok": True, "installation": "deleted"}
        if installation_id is not None:
            store.put_installation(int(installation_id), account.get("login") or "", account.get("type") or "", _installation_repo_names(payload))
        return {"ok": True, "installation": payload.get("action")}

    if x_github_event == "installation_repositories":
        if installation_id is not None:
            rec = store.get_installation(int(installation_id)) or {}
            repos = set(rec.get("repos") or [])
            repos |= {str(r.get("full_name")) for r in (payload.get("repositories_added") or []) if r.get("full_name")}
            repos -= {str(r.get("full_name")) for r in (payload.get("repositories_removed") or []) if r.get("full_name")}
            store.set_installation_repos(int(installation_id), sorted(repos))
        return {"ok": True, "installation_repositories": payload.get("action")}

    if x_github_event != "pull_request":
        return {"ok": True, "ignored_event": x_github_event or "unknown"}
    if payload.get("action") not in REVIEWABLE_ACTIONS:
        return {"ok": True, "ignored_action": payload.get("action")}
    pr = payload.get("pull_request") or {}
    repo_url = (payload.get("repository") or {}).get("html_url") or ""
    number = pr.get("number")
    if not (installation_id and repo_url and number):
        return {"ok": True, "skipped": "missing installation, repo, or PR number"}
    background.add_task(_run_app_review, int(installation_id), repo_url, int(number))
    return {"ok": True, "queued": {"pr": number}}


@app.get("/api/github/app/setup", tags=["webhooks"], include_in_schema=False)
async def github_app_setup(request: Request, installation_id: int | None = None, setup_action: str = "") -> RedirectResponse:
    """GitHub's post-install redirect (Setup URL). If the browser has a signed-in
    Umbra session, link the installation to that user so the dashboard can show
    the repos it now auto-reviews. Then bounce back to the dashboard."""
    if installation_id is not None:
        user = (request.session or {}).get("user")
        if user:
            get_store().link_installation_user(int(installation_id), f"{user['provider']}:{user['sub']}")
    return RedirectResponse(url=f"{frontend_origin()}/dashboard", status_code=303)


# --- ChatGPT plugin / GPT Action surface ------------------------------------
# The scan/investigate/ask endpoints are anonymous + JSON, so they work as a GPT
# Action or a classic ChatGPT plugin with no auth. We serve BOTH the curated
# OpenAPI (trimmed to the 3 public actions, server pinned) and a classic plugin
# manifest. Registered BEFORE the static mount so the greedy "/" mount can't
# shadow them, and it sidesteps StaticFiles' hidden-dotfile handling.
_ACTIONS_OPENAPI = Path(__file__).resolve().parent.parent / "custom_gpt" / "openapi.yaml"


def _public_base(request: Request) -> str:
    """Absolute base URL for manifest links — pinned in prod via UMBRA_PUBLIC_URL,
    else derived from the request (works in local dev)."""
    return (os.getenv("UMBRA_PUBLIC_URL") or str(request.base_url)).rstrip("/")


@app.get("/openapi-actions.yaml", include_in_schema=False)
async def actions_openapi() -> Response:
    try:
        spec = _ACTIONS_OPENAPI.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=404, detail="Action schema unavailable.") from exc
    return Response(content=spec, media_type="application/yaml")


@app.get("/.well-known/ai-plugin.json", include_in_schema=False)
async def ai_plugin_manifest(request: Request) -> dict[str, object]:
    base = _public_base(request)
    return {
        "schema_version": "v1",
        "name_for_human": "Umbra Engineer",
        "name_for_model": "umbra",
        "description_for_human": "Scan any public GitHub repo for CVEs, investigate incidents to a root-cause commit, and ask grounded questions about a codebase.",
        "description_for_model": "Umbra analyzes public GitHub repositories. Use scanRepo to find dependency CVEs and a 0-100 health score; investigateIncident to trace an error or stack trace to a root-cause commit; askUmbra to answer questions about a codebase grounded in real file/line references. Every result is grounded in real OSV/git data, is never fabricated, and carries a 'source' label describing what produced it.",
        "auth": {"type": "none"},
        "api": {"type": "openapi", "url": f"{base}/openapi-actions.yaml"},
        "logo_url": f"{base}/icon.svg",
        "contact_email": "binaydalai2024@gmail.com",
        "legal_info_url": f"{base}/privacy",
    }


# --- Static dashboard (single-service deploy) -------------------------------
# When the Next.js dashboard is built as a static export (frontend/out), serve
# it from this same app so the whole product is one URL with no CORS. Mounted
# DEAD LAST (after every /api/* route) so the greedy "/" mount never shadows an
# API route. Absent in dev (dashboard runs on :3000 via `npm run dev`), so this
# mount is simply skipped there.
class _CachedStaticFiles(StaticFiles):
    """StaticFiles with correct cache headers for a hashed static export.

    Vanilla StaticFiles sends etag/last-modified but no Cache-Control, so
    browsers *heuristically* cache the entry HTML — and that stale HTML still
    points at the previous build's chunk hashes, making fresh deploys look like
    "nothing changed" until a hard refresh. Fix: content-hashed assets under
    /_next/static/ are immutable (safe to cache forever — the filename changes
    when the content does); everything else (HTML, favicon) must revalidate, so
    a new deploy shows up on the next normal refresh. etag keeps revalidation a
    cheap 304.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if path.startswith("_next/static/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


_STATIC_DIR = Path(
    os.getenv("UMBRA_STATIC_DIR", str(Path(__file__).resolve().parent.parent / "frontend" / "out"))
)
if _STATIC_DIR.is_dir():
    app.mount("/", _CachedStaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")
