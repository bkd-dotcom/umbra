import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from backend.agents.ask import AskUmbra
from backend.codex_client import CodexOperation


def test_demo_ask_stream_is_labelled(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    assert asyncio.run(_collect(AskUmbra().stream("https://github.com/a/b", "where route"))) == ["Demo Ask Umbra stream replayed from cache; no model or Codex request was made."]


def test_live_ask_retrieves_existing_file_references(monkeypatch, tmp_path: Path):
    subprocess = __import__("subprocess")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    (tmp_path / "routes.py").write_text("def route_user():\n    return 'ok'\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    @contextmanager
    def checkout(_: str): yield tmp_path
    class Codex:
        def propose(self, prompt: str, repo_path: Path, read_only: bool): return CodexOperation(prompt, "Read routes.py", "", True, [], "codex-cli", datetime.now(UTC).isoformat())
    monkeypatch.setattr("backend.agents.ask.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.ask.reason_stream", lambda *_: iter(["The route is defined in routes.py."]))
    agent = AskUmbra(Codex())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b", "Where is route user?"))
    assert result.findings[0]["file"] == "routes.py"
    assert result.replay.providers["reasoning"] == "responses-api-stream"


async def _collect(stream):
    return [chunk async for chunk in stream]
