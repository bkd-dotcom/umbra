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
    def checkout(_, __=None): yield tmp_path
    class Codex:
        def propose(self, prompt: str, repo_path: Path, read_only: bool): return CodexOperation(prompt, "Read routes.py", "", True, [], "codex-cli", datetime.now(UTC).isoformat())
    monkeypatch.setattr("backend.agents.ask.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.ask.reason_stream", lambda *_: iter(["The route is defined in routes.py."]))
    agent = AskUmbra(Codex())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b", "Where is route user?"))
    assert result.findings[0]["file"] == "routes.py"
    assert result.replay.providers["reasoning"] == "responses-api-stream"


def test_live_ask_stream_falls_back_to_codex_when_responses_denied(monkeypatch, tmp_path: Path):
    subprocess = __import__("subprocess")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    (tmp_path / "routes.py").write_text("def route_user():\n    return 'ok'\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    @contextmanager
    def checkout(_, __=None): yield tmp_path
    class Codex:
        def propose(self, prompt: str, repo_path: Path, read_only: bool): return CodexOperation(prompt, "surveyed routes.py", "", True, [], "codex-cli", datetime.now(UTC).isoformat())
        def analyze(self, prompt: str): return CodexOperation(prompt, "Codex answer grounded in routes.py.", "", True, [], "codex-cli", datetime.now(UTC).isoformat())
    def denied_stream(*_):
        raise RuntimeError("team_model_access_denied")
        yield ""  # makes this a generator so the error surfaces on first iteration, like the real stream
    monkeypatch.setattr("backend.agents.ask.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.ask.reason_stream", denied_stream)
    agent = AskUmbra(Codex())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    chunks = asyncio.run(_collect(agent.stream("https://github.com/a/b", "where route")))
    assert chunks == ["Codex answer grounded in routes.py."]


def test_overview_grounds_broad_questions_without_keyword_matches(tmp_path: Path):
    subprocess = __import__("subprocess")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    (tmp_path / "README.md").write_text("# Course Scheduler\n\nBuilds conflict-free university timetables.\n")
    (tmp_path / "package.json").write_text('{"name": "course-scheduler", "version": "1.0.0"}\n')
    (tmp_path / "index.js").write_text("console.log('hi')\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    # "whats"/"repo" match nothing in the code — retrieval must still ground on the overview.
    references, context = AskUmbra._retrieve(tmp_path, "So whats the repo about?")
    files = [ref["file"] for ref in references]
    assert "README.md" in files and "package.json" in files
    assert "Course Scheduler" in context
    assert "Repository layout" in context


def test_stream_events_emits_references_then_streamed_answer(monkeypatch, tmp_path: Path):
    subprocess = __import__("subprocess")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    (tmp_path / "routes.py").write_text("def route_user():\n    return 'ok'\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    @contextmanager
    def checkout(_, __=None): yield tmp_path
    monkeypatch.setattr("backend.agents.ask.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.ask.reason_stream", lambda *_: iter(["The route ", "is in routes.py."]))
    agent = AskUmbra()
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    events = asyncio.run(_collect(agent.stream_events("https://github.com/a/b", "Where is route user?")))
    # First frame is the grounded references; the answer streams after.
    assert events[0]["type"] == "references"
    assert any(ref["file"] == "routes.py" for ref in events[0]["references"])
    text = "".join(e.get("chunk", "") for e in events if e["type"] == "text")
    assert "routes.py" in text


async def _collect(stream):
    return [chunk async for chunk in stream]
