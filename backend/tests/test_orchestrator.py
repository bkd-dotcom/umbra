import asyncio

from backend.agents.base import AgentResult, Replay
from backend.orchestrator import EventBus, Orchestrator


def test_demo_scan_works_without_network():
    result = asyncio.run(Orchestrator().scan("https://github.com/acme/demo"))
    assert result["repo_url"] == "https://github.com/acme/demo"
    assert result["umbra_score"] == 82
    assert result["vulnerabilities"]


def test_event_bus_replays_and_streams():
    async def scenario():
        bus = EventBus()
        await bus.emit({"message": "first"})
        stream = bus.stream()
        first = await anext(stream)
        await stream.aclose()
        return first

    assert asyncio.run(scenario()) == {"message": "first"}


def test_live_watchman_replaces_top_level_demo_findings(monkeypatch):
    class LiveWatchman:
        async def run(self, _: str):
            return AgentResult(
                "watchman", "Live result", [{"severity": "high", "cve": "GHSA-live"}],
                Replay("watchman", "prompt", "", "tests", "reasoning", {}, {"vulnerabilities": "osv.dev", "reasoning": "unavailable", "engineering": "codex-cli"}),
            )

    monkeypatch.setattr("backend.agents.Watchman", LiveWatchman)
    result = asyncio.run(Orchestrator().scan("https://github.com/acme/demo", ["watchman"]))
    assert result["source"] == "live-watchman"
    assert result["vulnerabilities"] == [{"severity": "high", "cve": "GHSA-live"}]
    assert result["dead_code"] == []


def test_ask_response_exposes_live_source(monkeypatch):
    class LiveAsk:
        async def run(self, *_):
            return AgentResult("ask", "Live answer", [{"file": "app.py", "lines": "3", "note": "verified"}], Replay("ask", "p", "", "", "", {}, {"retrieval": "local-git-grep", "reasoning": "responses-api-stream", "engineering": "codex-cli"}))
    monkeypatch.setattr("backend.agents.AskUmbra", LiveAsk)
    result = asyncio.run(Orchestrator().ask("https://github.com/acme/demo", "question"))
    assert result["source"] == "live-ask"
    assert result["references"][0]["file"] == "app.py"
