"""FastAPI entrypoint for Umbra HQ."""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from fastapi import Request

from backend import auth
from backend.codex_client import CodexClient
from backend.integrations.github import parse_public_repo
from backend.integrations.repository import cloud_scan_enabled, live_repositories_enabled
from backend.orchestrator import orchestrator
from backend.settings import cookie_secure, founder_ids, session_secret
from backend.store import get_store


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
        async for chunk in orchestrator.ask_stream(repo_url, question, **ctx):
            yield f"event: umbra\ndata: {json.dumps({'chunk': chunk})}\n\n"
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


# --- Static dashboard (single-service deploy) -------------------------------
# When the Next.js dashboard is built as a static export (frontend/out), serve
# it from this same app so the whole product is one URL with no CORS. Mounted
# DEAD LAST (after every /api/* route) so the greedy "/" mount never shadows an
# API route. Absent in dev (dashboard runs on :3000 via `npm run dev`), so this
# mount is simply skipped there.
_STATIC_DIR = Path(
    os.getenv("UMBRA_STATIC_DIR", str(Path(__file__).resolve().parent.parent / "frontend" / "out"))
)
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")
