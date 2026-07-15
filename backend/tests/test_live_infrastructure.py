import subprocess
from pathlib import Path

from backend.codex_client import CodexClient
from backend.integrations.github import parse_pull_diff
from backend.integrations.history import recent_history
from backend.integrations.osv import severity_from_osv
from backend.reasoning import reason_stream


def test_reason_stream_demo_is_explicit(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    assert list(reason_stream("work", "developer", "user")) == ["Demo reasoning stream replayed from cache; no model request was made."]


def test_parse_pull_diff_filters_large_files():
    diff = "diff --git a/a.py b/a.py\n+++ b/a.py\n+new\n-old\ndiff --git a/huge.py b/huge.py\n" + "+x\n" * 1501
    assert parse_pull_diff(diff) == [{"file": "a.py", "additions": 1, "deletions": 1}]


def test_recent_history_reads_a_local_repository(tmp_path: Path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "umbra@example.test"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "Umbra Test"], cwd=tmp_path, check=True)
    (tmp_path / "thing.py").write_text("answer = 42\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-m", "add thing"], cwd=tmp_path, check=True, capture_output=True)
    assert recent_history(tmp_path)[0]["files"] == ["thing.py"]


def test_osv_cvss_severity_precedes_database_specific():
    advisory = {"severity": [{"type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}], "database_specific": {"severity": "low"}}
    assert severity_from_osv(advisory) == "critical"


def test_read_only_codex_command_uses_read_only_sandbox(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "", "")
    CodexClient(runner=runner).propose("Review only", repo_path=tmp_path, read_only=True)
    assert captured[captured.index("--sandbox") + 1] == "read-only"
    # 0.144.x rejects --ask-for-approval; --skip-git-repo-check is required for the reasoning path.
    assert "--ask-for-approval" not in captured
    assert "--skip-git-repo-check" in captured


def test_analyze_runs_read_only_codex_without_a_repository(monkeypatch):
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "Codex reasoning output", "")
    operation = CodexClient(runner=runner).analyze("Explain this advisory")
    assert captured[captured.index("--sandbox") + 1] == "read-only"
    assert "--skip-git-repo-check" in captured
    assert operation.provider == "codex-cli"
    assert operation.summary == "Codex reasoning output"


def test_analyze_is_disabled_without_the_flag(monkeypatch):
    monkeypatch.delenv("UMBRA_ENABLE_CODEX_CLI", raising=False)
    monkeypatch.delenv("UMBRA_DEMO_MODE", raising=False)
    assert CodexClient().analyze("Explain this").provider == "codex-cli-disabled"


def test_live_gate_does_not_require_openai_api_key(monkeypatch):
    from backend.agents.janitor import Janitor

    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert Janitor._live_enabled() is True
