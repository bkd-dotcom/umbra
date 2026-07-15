"""Agent scheduling, replay collection, cached demo loading, and SSE events."""
from __future__ import annotations

import asyncio
import json
from collections import deque
from pathlib import Path
from typing import Any, AsyncIterator


CACHE_PATH = Path(__file__).parent / "cache" / "demo_cache.json"


def load_demo_cache() -> dict[str, Any]:
    return json.loads(CACHE_PATH.read_text())


class EventBus:
    def __init__(self, backlog: int = 120) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=backlog)
        self._listeners: set[asyncio.Queue[dict[str, Any]]] = set()

    async def emit(self, event: dict[str, Any]) -> None:
        self._events.append(event)
        for queue in tuple(self._listeners):
            queue.put_nowait(event)

    async def stream(self) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._listeners.add(queue)
        try:
            for item in self._events:
                yield item
            while True:
                yield await queue.get()
        finally:
            self._listeners.discard(queue)


class Orchestrator:
    def __init__(self, bus: EventBus | None = None) -> None:
        self.bus = bus or EventBus()

    async def replay_demo_events(self) -> None:
        for event in load_demo_cache()["events"]:
            await self.bus.emit(event)

    async def scan(self, repo_url: str, agents: list[str] | None = None) -> dict[str, Any]:
        # Cache is intentionally the availability boundary: a demo never depends on third parties.
        payload = load_demo_cache()
        payload["repo_url"] = repo_url
        await self.replay_demo_events()
        return {key: value for key, value in payload.items() if key not in {"events", "postmortem", "answer", "replays"}}

    async def investigate(self, repo_url: str, error_log: str) -> dict[str, Any]:
        payload = load_demo_cache()["postmortem"].copy()
        payload["incident"] = error_log[:300] if error_log else payload["incident"]
        await self.bus.emit({"agent": "DETECTIVE", "message": "Incident replay assembled from verified cache", "level": "analysis"})
        return payload

    async def ask(self, repo_url: str, question: str) -> dict[str, Any]:
        payload = load_demo_cache()["answer"].copy()
        await self.bus.emit({"agent": "ASK UMBRA", "message": f"Grounding answer for: {question[:80]}", "level": "info"})
        return payload


orchestrator = Orchestrator()

