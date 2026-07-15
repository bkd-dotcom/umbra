import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from backend.agents.reviewer import Reviewer
from backend.codex_client import CodexOperation
from backend.reasoning import ReasoningResult


def test_demo_reviewer_is_labelled(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    result = asyncio.run(Reviewer().run("https://github.com/a/b"))
    assert result.replay.providers["review"] == "demo-cache"


def test_live_reviewer_wires_real_boundaries(monkeypatch, tmp_path: Path):
    @contextmanager
    def checkout(_: str): yield tmp_path
    class Codex:
        def propose(self, prompt: str, repo_path: Path, read_only: bool):
            assert read_only is True
            return CodexOperation(prompt, "No regression found", "", True, [], "codex-cli", datetime.now(UTC).isoformat())
    monkeypatch.setattr("backend.agents.reviewer.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.reviewer.fetch_pull_request", lambda *_: {"number": 7, "title": "Fix auth", "changed_files": [{"file": "auth.py", "additions": 1, "deletions": 0}], "diff": "diff --git a/auth.py b/auth.py\n+guard()"})
    monkeypatch.setattr("backend.agents.reviewer.reason", lambda *_: ReasoningResult("Blast radius is auth", "gpt-5.6-sol", "high", "responses-api"))
    agent = Reviewer(Codex())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b", pr_number=7))
    assert result.replay.providers == {"review": "codex-cli", "reasoning": "responses-api", "risk": "deterministic"}
    assert result.findings[0]["risk_score"] > 0
