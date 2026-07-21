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


def test_codex_sandbox_override_replaces_landlock_mode(monkeypatch, tmp_path: Path):
    # On gVisor (Cloud Run) Codex's own sandbox can't init, so the deploy overrides it.
    # The unsafe mode now requires an explicit second opt-in flag.
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_CODEX_SANDBOX", "danger-full-access")
    monkeypatch.setenv("UMBRA_ALLOW_UNSAFE_CODEX", "true")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "ok", "")
    CodexClient(runner=runner).propose("Fix it", repo_path=tmp_path)
    assert captured[captured.index("--sandbox") + 1] == "danger-full-access"


def test_codex_sandbox_bypass_uses_dedicated_flag(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_CODEX_SANDBOX", "bypass")
    monkeypatch.setenv("UMBRA_ALLOW_UNSAFE_CODEX", "true")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "ok", "")
    CodexClient(runner=runner).propose("Fix it", repo_path=tmp_path)
    assert "--dangerously-bypass-approvals-and-sandbox" in captured
    assert "--sandbox" not in captured


def test_codex_unsafe_sandbox_ignored_without_optin(monkeypatch, tmp_path: Path):
    # Without the explicit UMBRA_ALLOW_UNSAFE_CODEX opt-in, an unsafe override is
    # ignored and Codex falls back to a safe sandbox mode (never runs unsandboxed
    # by accident from a leaked/mis-set env var).
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_CODEX_SANDBOX", "bypass")
    monkeypatch.delenv("UMBRA_ALLOW_UNSAFE_CODEX", raising=False)
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "ok", "")
    CodexClient(runner=runner).propose("Fix it", repo_path=tmp_path)
    assert "--dangerously-bypass-approvals-and-sandbox" not in captured
    assert captured[captured.index("--sandbox") + 1] == "workspace-write"


def test_codex_failure_surfaces_reason(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    def runner(command, **_kwargs):
        return subprocess.CompletedProcess(command, 1, "", "landlock: operation not permitted")
    op = CodexClient(runner=runner).propose("Fix it", repo_path=tmp_path)
    assert op.tests_passed is False
    assert "landlock: operation not permitted" in op.summary  # real reason, not an opaque message


def test_live_gate_does_not_require_openai_api_key(monkeypatch):
    from backend.agents.janitor import Janitor

    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert Janitor._live_enabled() is True


def test_codex_auth_failure_gives_clean_message(monkeypatch, tmp_path: Path):
    # A 401 from Codex (e.g. a free ChatGPT plan with no Codex access) must surface
    # as an actionable message, never the raw Cloudflare/transport noise.
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    stderr = ("ERROR: unexpected status 401 Unauthorized: Missing bearer or basic "
              "authentication in header, url: https://api.openai.com/v1/responses, "
              "cf-ray: a1bd9228596f34d9-ORD")
    def runner(command, **_kwargs):
        return subprocess.CompletedProcess(command, 1, "", stderr)
    op = CodexClient(runner=runner).propose("Fix it", repo_path=tmp_path)
    assert op.tests_passed is False
    assert "authenticate" in op.summary.lower()
    assert "cf-ray" not in op.summary and "Missing bearer" not in op.summary
    assert stderr[-4000:] == op.error  # full stderr still preserved for debugging


def test_model_and_reasoning_effort_flags_are_passed(monkeypatch, tmp_path: Path):
    # The user-selected speed knobs must reach `codex exec` as -m / -c flags.
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "ok", "")
    CodexClient(runner=runner, model="gpt-5.6-luna", reasoning_effort="low").propose("x", repo_path=tmp_path, read_only=True)
    assert captured[captured.index("-m") + 1] == "gpt-5.6-luna"
    assert 'model_reasoning_effort="low"' in captured


def test_invalid_model_and_effort_fall_back_to_default(monkeypatch, tmp_path: Path):
    # Anything outside the whitelist is dropped (no flag) so a bad/hostile value
    # can never be injected into the CLI config and never breaks the scan.
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.delenv("UMBRA_CODEX_MODEL", raising=False)
    monkeypatch.delenv("UMBRA_CODEX_REASONING_EFFORT", raising=False)
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    captured: list[str] = []
    def runner(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "ok", "")
    CodexClient(runner=runner, model="evil; rm -rf /", reasoning_effort="ludicrous").propose("x", repo_path=tmp_path, read_only=True)
    assert "-m" not in captured and not any("model_reasoning_effort" in c for c in captured)


def test_model_effort_env_fallback(monkeypatch):
    monkeypatch.setenv("UMBRA_CODEX_MODEL", "gpt-5.6-terra")
    monkeypatch.setenv("UMBRA_CODEX_REASONING_EFFORT", "HIGH")  # case-insensitive
    client = CodexClient()
    assert client.model == "gpt-5.6-terra" and client.reasoning_effort == "high"


def test_checkout_defaults_to_depth_one_and_honors_env(monkeypatch):
    # Shallow clone: faster and (on Cloud Run's tmpfs) far less memory per scan.
    import os

    import backend.integrations.repository as repo

    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    seen: list[list[str]] = []
    def fake_run(cmd, **_kw):
        if cmd[:2] == ["git", "clone"]:
            seen.append(cmd)
            os.makedirs(cmd[-1], exist_ok=True)
        return subprocess.CompletedProcess(cmd, 0, "", "")
    monkeypatch.setattr(repo.subprocess, "run", fake_run)

    monkeypatch.delenv("UMBRA_CLONE_DEPTH", raising=False)
    with repo.checkout_public_repo("https://github.com/a/b"):
        pass
    assert seen[-1][seen[-1].index("--depth") + 1] == "1"

    monkeypatch.setenv("UMBRA_CLONE_DEPTH", "20")
    with repo.checkout_public_repo("https://github.com/a/b"):
        pass
    assert seen[-1][seen[-1].index("--depth") + 1] == "20"


def test_fetch_pull_request_uses_api_endpoint_with_correct_accept_and_token(monkeypatch):
    """Both the diff and the metadata are fetched from api.github.com (same host,
    so the Authorization survives — the github.com/<repo>/pull/N.diff URL 302s to
    a different host and drops the token), each with the right Accept, and the
    owner's token is sent as a Bearer. Regression: the metadata call once reused
    the *diff* Accept, so GitHub returned a diff and `.json()` raised, making EVERY
    webhook review silently fall back to a cached comment (public and private)."""
    import backend.integrations.github as gh

    calls: list[tuple[str, str, str, object]] = []  # url, accept, authorization, follow_redirects

    class _Resp:
        def __init__(self, text: str = "", data: dict | None = None) -> None:
            self.text = text
            self._data = data
        def raise_for_status(self) -> None:
            return None
        def json(self) -> dict:
            if self._data is None:  # mimic GitHub returning a diff (not JSON) to .json()
                raise ValueError("Expecting value")
            return self._data

    def fake_get(url: str, **kwargs):
        headers = kwargs.get("headers", {})
        calls.append((url, headers.get("Accept", ""), headers.get("Authorization", ""), kwargs.get("follow_redirects")))
        if headers.get("Accept") == gh._DIFF_ACCEPT:
            return _Resp(text="diff --git a/a.py b/a.py\n+x\n")
        return _Resp(data={"title": "t", "head": {"sha": "h"}, "base": {"sha": "b"}})

    monkeypatch.setattr(gh.httpx, "get", fake_get)
    result = gh.fetch_pull_request("https://github.com/o/r", 1, token="owner-tok")
    assert result["number"] == 1 and result["title"] == "t"
    assert all("api.github.com/repos/o/r/pulls/1" in url for url, *_ in calls)
    assert {accept for _, accept, _, _ in calls} == {gh._DIFF_ACCEPT, gh._JSON_ACCEPT}
    assert all(auth == "Bearer owner-tok" for _, _, auth, _ in calls)
    assert all(follow is True for *_, follow in calls)
