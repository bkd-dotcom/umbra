"""Agent scheduling, replay collection, cached demo loading, and SSE events."""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Any, AsyncIterator

from backend.cache import load_demo_cache


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
        self.replays: list[dict[str, Any]] = load_demo_cache()["replays"]

    async def replay_demo_events(self) -> None:
        for event in load_demo_cache()["events"]:
            await self.bus.emit(event)

    async def scan(self, repo_url: str, agents: list[str] | None = None) -> dict[str, Any]:
        # Cache is intentionally the availability boundary: a demo never depends on third parties.
        from backend.agents import Janitor, Reviewer, Watchman

        payload = load_demo_cache()
        payload["repo_url"] = repo_url
        requested = set(agents or ["watchman", "reviewer", "janitor"])
        agent_runs = []
        if "watchman" in requested:
            agent_runs.append(await Watchman().run(repo_url))
        if "reviewer" in requested:
            agent_runs.append(await Reviewer().run(repo_url))
        if "janitor" in requested:
            agent_runs.append(await Janitor().run(repo_url))
        self.replays = [result.replay.__dict__ for result in agent_runs] or self.replays
        await self.replay_demo_events()
        response = {key: value for key, value in payload.items() if key not in {"events", "postmortem", "answer", "replays"}}
        response["agent_results"] = [result.as_dict() for result in agent_runs]
        return response

    async def investigate(self, repo_url: str, error_log: str) -> dict[str, Any]:
        from backend.agents import Detective

        result = await Detective().run(repo_url, error_log)
        payload = result.findings[0]
        self.replays = [result.replay.__dict__]
        await self.bus.emit({"agent": "DETECTIVE", "message": "Incident replay assembled from verified cache", "level": "analysis"})
        return payload

    async def ask(self, repo_url: str, question: str) -> dict[str, Any]:
        from backend.agents import AskUmbra

        result = await AskUmbra().run(repo_url, question)
        cached = load_demo_cache()["answer"].copy()
        self.replays = [result.replay.__dict__]
        payload = cached
        await self.bus.emit({"agent": "ASK UMBRA", "message": f"Grounding answer for: {question[:80]}", "level": "info"})
        return payload


orchestrator = Orchestrator()
