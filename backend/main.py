"""FastAPI entrypoint for Umbra HQ."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


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

