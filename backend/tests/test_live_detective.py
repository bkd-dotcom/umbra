import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from backend.agents.detective import Detective
from backend.codex_client import CodexOperation
from backend.reasoning import ReasoningResult


def test_demo_detective_is_labelled(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    assert asyncio.run(Detective().run("https://github.com/a/b", "boom")).replay.providers["history"] == "demo-cache"


def test_detective_discards_unverified_model_sha(monkeypatch, tmp_path: Path):
    @contextmanager
    def checkout(_, __=None): yield tmp_path
    class Codex:
        def propose(self, prompt: str, repo_path: Path): return CodexOperation(prompt, "survey", "", True, [], "codex-cli", datetime.now(UTC).isoformat())
    monkeypatch.setattr("backend.agents.detective.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.detective.recent_history", lambda _: [{"sha": "abc123456789", "subject": "actual commit", "files": ["app.py"]}])
    monkeypatch.setattr("backend.agents.detective.reason", lambda *_args: ReasoningResult("Culprit deadbeef", "gpt-5.6-sol", "xhigh", "responses-api"))
    agent = Detective(Codex())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b", "boom"))
    assert result.findings[0]["root_cause_commit"] == "unconfirmed"
    assert result.replay.providers["history"] == "local-git"
