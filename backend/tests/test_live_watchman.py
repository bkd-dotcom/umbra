from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from backend.agents.watchman import Watchman
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.dependencies import discover_dependencies
from backend.reasoning import ReasoningResult


def test_dependency_discovery_reads_manifests(tmp_path: Path):
    (tmp_path / "package.json").write_text('{"dependencies":{"express":"^5.1.0"}}')
    (tmp_path / "requirements.txt").write_text("fastapi==0.139.0\n")
    assert discover_dependencies(tmp_path) == [
        {"name": "express", "version": "5.1.0", "ecosystem": "npm"},
        {"name": "fastapi", "version": "0.139.0", "ecosystem": "PyPI"},
    ]


def test_demo_watchman_is_explicitly_labelled_as_cached(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    result = __import__("asyncio").run(Watchman().run("https://github.com/expressjs/express"))
    assert result.replay.providers["engineering"] == "demo-cache"
    assert "no model or Codex request" in result.replay.reasoning


def test_disabled_codex_never_returns_a_fabricated_diff(monkeypatch):
    monkeypatch.delenv("UMBRA_DEMO_MODE", raising=False)
    monkeypatch.delenv("UMBRA_ENABLE_CODEX_CLI", raising=False)
    operation = CodexClient().propose("Inspect this", ["package.json"])
    assert operation.provider == "codex-cli-disabled"
    assert operation.diff == ""


def test_live_failure_falls_back_without_attempting_a_cli_task(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "configured")
    result = __import__("asyncio").run(Watchman().run("not-a-github-url"))
    assert result.replay.providers["engineering"] == "cache-fallback"
    assert "Live Watchman unavailable" in result.replay.reasoning


def test_live_watchman_uses_osv_reasoning_and_codex(monkeypatch, tmp_path: Path):
    (tmp_path / "package.json").write_text('{"dependencies":{"express":"5.1.0"}}')

    @contextmanager
    def checkout(_, __=None):
        yield tmp_path

    class FakeOSV:
        async def query(self, *_: str):
            return [{"id": "GHSA-live", "summary": "Live advisory", "database_specific": {"severity": "high"}}]

    class FakeCodex:
        def propose(self, prompt: str, repo_path: Path):
            return CodexOperation(prompt, "npm test passed", "diff --git a/package.json", True, ["package.json"], "codex-cli", datetime.now(UTC).isoformat())

    monkeypatch.setattr("backend.agents.watchman.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.watchman.reason", lambda *_args: ReasoningResult("Live threat analysis", "gpt-5.6-sol", "high", "responses-api"))
    agent = Watchman(codex=FakeCodex(), osv=FakeOSV())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = __import__("asyncio").run(agent.run("https://github.com/expressjs/express"))
    assert result.findings[0]["cve"] == "GHSA-live"
    assert result.replay.providers == {"vulnerabilities": "osv.dev", "reasoning": "responses-api", "engineering": "codex-cli"}
