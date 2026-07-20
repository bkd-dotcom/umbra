"""Required-checks runner (P0#2): checks are executed, not assumed."""
from pathlib import Path

from backend.checks import run_required_checks


def test_no_commands_is_not_ran():
    report = run_required_checks(Path("."), [])
    assert report.ran is False and report.all_passed is False


def test_passing_command_runs_and_passes(tmp_path: Path):
    report = run_required_checks(tmp_path, ["true"])
    assert report.ran is True and report.all_passed is True
    r = report.results[0]
    assert r.status == "passed" and r.exit_code == 0 and r.output_hash.startswith("sha256:")


def test_failing_command_is_recorded_and_not_passed(tmp_path: Path):
    report = run_required_checks(tmp_path, ["false"])
    assert report.ran is True and report.all_passed is False
    assert report.results[0].status == "failed" and report.results[0].exit_code == 1


def test_missing_executable_is_unavailable_not_pass(tmp_path: Path):
    report = run_required_checks(tmp_path, ["umbra-nonexistent-cmd-xyz --run"])
    assert report.results[0].status == "unavailable"
    # An unavailable required check must NOT count as passed.
    assert report.all_passed is False


def test_mixed_commands_all_must_pass(tmp_path: Path):
    report = run_required_checks(tmp_path, ["true", "false"])
    assert report.ran is True and report.all_passed is False
    statuses = {r.command: r.status for r in report.results}
    assert statuses["true"] == "passed" and statuses["false"] == "failed"


def test_output_hash_is_deterministic(tmp_path: Path):
    a = run_required_checks(tmp_path, ["true"]).results[0].output_hash
    b = run_required_checks(tmp_path, ["true"]).results[0].output_hash
    assert a == b  # `true` produces empty output → stable hash
