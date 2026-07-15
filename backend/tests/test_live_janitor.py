import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from backend.agents.janitor import Janitor
from backend.codex_client import CodexOperation
from backend.reasoning import ReasoningResult


def test_demo_janitor_is_labelled(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    assert asyncio.run(Janitor().run("https://github.com/a/b")).replay.providers["engineering"] == "demo-cache"


def test_live_janitor_returns_real_diff_metadata(monkeypatch, tmp_path: Path):
    @contextmanager
    def checkout(_: str): yield tmp_path
    class Codex:
        def propose(self, prompt: str, repo_path: Path): return CodexOperation(prompt, "pytest passed", "diff --git a/old.py b/old.py\n-def stale(): pass", True, ["old.py"], "codex-cli", datetime.now(UTC).isoformat())
    monkeypatch.setattr("backend.agents.janitor.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.janitor.reason", lambda *_: ReasoningResult("Safe cleanup", "gpt-5.6-terra", "medium", "responses-api"))
    agent = Janitor(Codex())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b"))
    assert result.findings == [{"file": "old.py", "symbol": None, "kind": "unused_function"}]
    assert result.replay.providers == {"engineering": "codex-cli", "reasoning": "responses-api"}
