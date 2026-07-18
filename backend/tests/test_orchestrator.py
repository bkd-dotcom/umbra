import asyncio

from backend.agents.base import AgentResult, Replay
from backend.orchestrator import EventBus, Orchestrator


def test_demo_scan_works_without_network():
    result = asyncio.run(Orchestrator().scan("https://github.com/acme/demo"))
    assert result["repo_url"] == "https://github.com/acme/demo"
    assert result["umbra_score"] == 82
    assert result["vulnerabilities"]


def test_scan_result_carries_auditable_metadata():
    result = asyncio.run(Orchestrator().scan("https://github.com/acme/demo"))
    # Autonomy defaults to level 1 (prepare diff) and never auto-merges.
    assert result["autonomy"] == {"level": 1, "label": "Prepare diff", "auto_merge": False, "human_review_required": True}
    # No checkout in demo mode → default safety policy.
    assert result["policy"]["loaded"] is False
    # run_id + reproducible evidence hash.
    assert result["run_id"].startswith("umbra_")
    assert result["evidence_hash"].startswith("sha256:")


def test_scan_autonomy_level_zero_reports_only():
    result = asyncio.run(Orchestrator().scan("https://github.com/acme/demo", autonomy_level=0))
    assert result["autonomy"]["level"] == 0
    assert result["autonomy"]["label"] == "Report only"
    assert result["autonomy"]["auto_merge"] is False


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
        def __init__(self, **__):  # orchestrator injects a shared codex client
            pass

        async def run(self, _: str, **__):
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
        async def run(self, *_, **__):
            return AgentResult("ask", "Live answer", [{"file": "app.py", "lines": "3", "note": "verified"}], Replay("ask", "p", "", "", "", {}, {"retrieval": "local-git-grep", "reasoning": "responses-api-stream", "engineering": "codex-cli"}))
    monkeypatch.setattr("backend.agents.AskUmbra", LiveAsk)
    result = asyncio.run(Orchestrator().ask("https://github.com/acme/demo", "question"))
    assert result["source"] == "live-ask"
    assert result["references"][0]["file"] == "app.py"
