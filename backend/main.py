"""FastAPI entrypoint for Umbra HQ."""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.integrations.github import parse_public_repo
from backend.orchestrator import orchestrator


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


@app.get("/api/health", tags=["system"])
async def health() -> dict[str, object]:
    demo_mode = os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true"
    configured = bool(os.getenv("OPENAI_API_KEY"))
    return {
        "status": "ok",
        "service": "umbra",
        "mode": "demo" if demo_mode else "live",
        "openai_configured": configured,
        "ready": demo_mode or configured,
    }


class ScanRequest(BaseModel):
    repo_url: str = Field(description="Full URL of a public GitHub repository")
    agents: list[str] | None = Field(default=None, description="Optional agent subset")
    pr_number: int | None = Field(default=None, ge=1, description="Optional pull request number for Reviewer")


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


@app.post("/api/scan", tags=["agents"])
async def scan_repo(request: ScanRequest) -> dict[str, object]:
    _validate_repo(request.repo_url)
    return await orchestrator.scan(request.repo_url, request.agents, request.pr_number)


@app.post("/api/investigate", tags=["agents"])
async def investigate_incident(request: InvestigateRequest) -> dict[str, object]:
    _validate_repo(request.repo_url)
    return await orchestrator.investigate(request.repo_url, request.error_log)


@app.post("/api/ask", tags=["agents"])
async def ask_umbra(request: AskRequest) -> dict[str, object]:
    _validate_repo(request.repo_url)
    return await orchestrator.ask(request.repo_url, request.question)


@app.get("/api/ask/stream", tags=["streaming"])
async def ask_umbra_stream(repo_url: str, question: str) -> StreamingResponse:
    _validate_repo(repo_url)

    async def generate():
        async for chunk in orchestrator.ask_stream(repo_url, question):
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
