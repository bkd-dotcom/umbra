"""FastAPI entrypoint for Umbra HQ."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from fastapi import BackgroundTasks, Header, Request

from backend import auth
from backend.codex_client import CodexClient
from backend.integrations.github import parse_public_repo
from backend.integrations.repository import cloud_scan_enabled, live_repositories_enabled
from backend.orchestrator import orchestrator
from backend.settings import cookie_secure, founder_ids, session_secret
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
    return await orchestrator.scan(request.repo_url, request.agents, request.pr_number, model=request.model, reasoning_effort=request.reasoning_effort, **_user_context(http))


class PullRequestRequest(BaseModel):
    repo_url: str
    mode: str = Field(default="bump", description="'bump' (deterministic dependency bump) or 'codex' (Codex-authored)")
    package: str | None = None
    version: str | None = None
    cve: str | None = None


@app.post("/api/my/pr", tags=["agents"])
async def open_fix_pr(request: PullRequestRequest, http: Request) -> dict[str, object]:
    """Open a fix PR on explicit user request. Requires a signed-in user with a
    GitHub token (write); branch-only, never merges. Codex-authored PRs are
    founder-gated on the hosted deploy so visitors can't spend Codex credits."""
    _validate_repo(request.repo_url)
    if not http.session.get("user"):
        raise HTTPException(status_code=401, detail="Sign in to open a pull request.")
    ctx = _user_context(http)
    token = ctx["github_token"]
    if not token:
        raise HTTPException(status_code=400, detail="Connect GitHub (with repo access) to open a pull request.")
    if request.mode == "codex" and ctx["allow_codex"] is False:
        raise HTTPException(status_code=403, detail="Codex-authored PRs are founder-only on the hosted demo — try a dependency-bump PR, or run Umbra locally.")
    try:
        return await orchestrator.open_fix_pr(request.repo_url, str(token), request.mode, request.package, request.version, request.cve, allow_codex=ctx["allow_codex"])
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not open the pull request: {exc}") from exc


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
        async for event in orchestrator.ask_stream_events(repo_url, question, **ctx):
            if event.get("type") == "references":
                yield f"event: references\ndata: {json.dumps({'references': event.get('references', []), 'source': event.get('source')})}\n\n"
            else:
                yield f"event: umbra\ndata: {json.dumps({'chunk': event.get('chunk', '')})}\n\n"
        yield "event: done\ndata: {}\n\n"

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


# --- Autonomy: scheduled watch + per-user PR auto-review webhook -------------
# Auto-review is fully multi-tenant: each user enables it on their own repos and
# every review is posted with THAT user's own OAuth token (see auth.py). There is
# no shared service PAT — a single-tenant global webhook was removed.
async def _run_webhook_review(repo_url: str, pr_number: int, token: str) -> None:
    """Background PR review (clone + reason take longer than GitHub's 10s ack
    window, so we ack immediately and do the work here). Never raises."""
    try:
        await orchestrator.review_pull_request(repo_url, pr_number, token)
    except Exception:  # noqa: BLE001 - a failed review must never crash the worker
        # Log (never raise): a swallowed error here is invisible, and a PR review
        # that silently no-ops looks identical to "auto-review isn't working".
        logging.getLogger("umbra.webhook").exception("PR auto-review failed for %s #%s", repo_url, pr_number)


@app.post("/api/webhooks/github/{hook_token}", tags=["webhooks"])
async def github_webhook_per_user(hook_token: str, request: Request, background: BackgroundTasks, x_github_event: str = Header(default=""), x_hub_signature_256: str = Header(default="")) -> dict[str, object]:
    """Multi-tenant PR auto-review: each user-enabled repo has its own opaque
    callback path + HMAC secret, and the review is posted with THAT user's own
    GitHub token. Comment-only; never merges. Acks fast, reviews in background."""
    rec = get_store().get_repo_hook(hook_token)
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown webhook.")
    body = await request.body()
    if not verify_github_signature(rec.get("secret"), body, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid or missing webhook signature.")
    if x_github_event != "pull_request":
        return {"ok": True, "ignored_event": x_github_event or "unknown"}
    payload = json.loads(body or b"{}")
    if payload.get("action") not in REVIEWABLE_ACTIONS:
        return {"ok": True, "ignored_action": payload.get("action")}
    pr = payload.get("pull_request") or {}
    repo_url = (payload.get("repository") or {}).get("html_url") or ""
    number = pr.get("number")
    token = get_store().get_github_token(rec.get("user_key"))
    if not (repo_url and number and token):
        return {"ok": True, "skipped": "missing repo, PR number, or the owner's GitHub connection"}
    background.add_task(_run_webhook_review, repo_url, int(number), str(token))
    return {"ok": True, "queued": {"pr": number}}


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
