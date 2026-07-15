"""Agent scheduling, replay collection, cached demo loading, and SSE events."""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Any, AsyncIterator

from backend.cache import load_demo_cache
from backend.features import dependency_galaxy, kill_chain, roi_estimate
from backend.scoring import umbra_score


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

    async def scan(self, repo_url: str, agents: list[str] | None = None, pr_number: int | None = None) -> dict[str, Any]:
        # Cache is intentionally the availability boundary: a demo never depends on third parties.
        from backend.agents import Janitor, Reviewer, Watchman

        payload = load_demo_cache()
        payload["repo_url"] = repo_url
        requested = set(agents or ["watchman", "reviewer", "janitor"])
        agent_runs = []
        if "watchman" in requested:
            agent_runs.append(await Watchman().run(repo_url))
        if "reviewer" in requested:
            agent_runs.append(await Reviewer().run(repo_url, pr_number=pr_number))
        if "janitor" in requested:
            agent_runs.append(await Janitor().run(repo_url))
        self.replays = [result.replay.__dict__ for result in agent_runs] or self.replays
        await self.replay_demo_events()
        response = {key: value for key, value in payload.items() if key not in {"events", "postmortem", "answer", "replays"}}
        watchman = next((result for result in agent_runs if result.agent == "watchman"), None)
        if watchman and watchman.replay.providers.get("vulnerabilities") == "osv.dev":
            # This is the one live, end-to-end source of truth. Do not blend it
            # with seeded categories and accidentally present a cache as a scan.
            response.update({
                "vulnerabilities": watchman.findings,
                "dead_code": [],
                "secrets": [],
                "missing_docs_count": 0,
                "umbra_score": umbra_score(watchman.findings),
                "risk_forecast": "Live Watchman scope: dependency advisories only.",
                "reasoning_summary": watchman.summary,
                "source": "live-watchman",
                "live_scope": ["OSV dependency scan", "GPT-5.6 threat analysis", "Codex disposable-checkout task"],
            })
        else:
            response["source"] = "demo-cache"
        reviewer = next((result for result in agent_runs if result.agent == "reviewer"), None)
        janitor = next((result for result in agent_runs if result.agent == "janitor"), None)
        if reviewer and reviewer.replay.providers.get("review") == "codex-cli":
            response["review"] = reviewer.findings[0] if reviewer.findings else {}
        if janitor and janitor.replay.providers.get("engineering") == "codex-cli":
            response["cleanup"] = janitor.findings
        live_agents = [result.agent for result in agent_runs if "codex-cli" in result.replay.providers.values()]
        if live_agents:
            response["source"] = f"live-{live_agents[0]}" if len(live_agents) == 1 else "live"
            response["live_agents"] = live_agents
        response["agent_results"] = [result.as_dict() for result in agent_runs]
        response["kill_chain"] = kill_chain()
        response["dependency_galaxy"] = dependency_galaxy()
        response["roi"] = roi_estimate(len(payload["vulnerabilities"]) + len(payload["dead_code"]))
        response["benchmark"] = {"mode": "precomputed", "baseline_minutes": 96, "umbra_minutes": 18, "coverage": "seeded express-style repository"}
        return response

    async def investigate(self, repo_url: str, error_log: str) -> dict[str, Any]:
        from backend.agents import Detective

        result = await Detective().run(repo_url, error_log)
        payload = result.findings[0]
        self.replays = [result.replay.__dict__]
        payload["source"] = "live-detective" if result.replay.providers.get("history") == "local-git" else "demo-cache"
        await self.bus.emit({"agent": "DETECTIVE", "message": "Live incident analysis complete" if payload["source"] == "live-detective" else "Incident replay assembled from verified cache", "level": "analysis"})
        return payload

    async def ask(self, repo_url: str, question: str) -> dict[str, Any]:
        from backend.agents import AskUmbra

        result = await AskUmbra().run(repo_url, question)
        self.replays = [result.replay.__dict__]
        payload = {"answer": result.summary, "references": result.findings, "blast_radius": "Grounded only in the listed retrieved references.", "source": "live-ask" if result.replay.providers.get("retrieval") == "local-git-grep" else "demo-cache"}
        await self.bus.emit({"agent": "ASK UMBRA", "message": f"Grounding answer for: {question[:80]}", "level": "info"})
        return payload

    async def ask_stream(self, repo_url: str, question: str) -> AsyncIterator[str]:
        from backend.agents import AskUmbra

        async for chunk in AskUmbra().stream(repo_url, question):
            yield chunk


orchestrator = Orchestrator()
