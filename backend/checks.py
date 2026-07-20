"""Required-checks runner — executes a contract's declared validation commands.

The Change Contract can declare ``required_checks`` (e.g. ``npm test``). Declaring
them is not enough: this module actually *runs* them in the checkout, captures the
exit code and a hash of the output, and reports pass/fail/unavailable. The
admission pipeline uses the result to gate authority — a contract that requires
checks only earns branch-PR authority (Level 2) if those checks actually ran and
passed; a missing or failing required check caps authority at Level 1.

Safety: commands run inside the disposable checkout with a bounded timeout and no
network assumptions. Only the exact strings the repo's own contract declares are
run — Umbra never synthesizes commands. A command whose executable is absent is
reported ``unavailable`` (not a fabricated pass).
"""
from __future__ import annotations

import hashlib
import shlex
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CHECK_TIMEOUT_S = 300


def _output_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256((text or "").encode("utf-8", "replace")).hexdigest()


@dataclass
class CheckResult:
    command: str
    status: str  # "passed" | "failed" | "unavailable"
    exit_code: int | None
    output_hash: str | None
    detail: str

    def to_public(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "status": self.status,
            "exit_code": self.exit_code,
            "output_hash": self.output_hash,
            "detail": self.detail,
        }


@dataclass
class ChecksReport:
    results: list[CheckResult] = field(default_factory=list)
    ran: bool = False           # at least one required check actually executed
    all_passed: bool = False    # every required check that ran passed AND none were unavailable

    def to_public(self) -> dict[str, Any]:
        return {
            "ran": self.ran,
            "all_passed": self.all_passed,
            "results": [r.to_public() for r in self.results],
        }


def _executable_available(command: str) -> bool:
    try:
        argv = shlex.split(command)
    except ValueError:
        return False
    return bool(argv) and shutil.which(argv[0]) is not None


def run_required_checks(repo_path: Path | str, commands: list[str]) -> ChecksReport:
    """Run each declared check command in ``repo_path``; capture exit + output hash.

    Returns a ChecksReport where ``ran`` is True iff at least one command executed,
    and ``all_passed`` is True iff every command executed and exited 0 (a missing
    executable → ``unavailable`` → ``all_passed`` is False). Never raises.
    """
    root = Path(repo_path)
    report = ChecksReport()
    if not commands:
        return report

    executed_any = False
    every_ok = True
    for command in commands:
        cmd = (command or "").strip()
        if not cmd:
            continue
        if not _executable_available(cmd):
            report.results.append(CheckResult(cmd, "unavailable", None, None, f"`{cmd.split()[0]}` is not available in this environment."))
            every_ok = False
            continue
        try:
            completed = subprocess.run(
                shlex.split(cmd), cwd=root, text=True, capture_output=True,
                timeout=_CHECK_TIMEOUT_S, check=False,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            report.results.append(CheckResult(cmd, "unavailable", None, None, f"Could not run `{cmd}`: {exc}"))
            every_ok = False
            continue
        executed_any = True
        combined = (completed.stdout or "") + (completed.stderr or "")
        passed = completed.returncode == 0
        every_ok = every_ok and passed
        report.results.append(CheckResult(
            cmd,
            "passed" if passed else "failed",
            completed.returncode,
            _output_hash(combined),
            f"`{cmd}` exited {completed.returncode}.",
        ))

    report.ran = executed_any
    # all_passed requires that something ran, everything that ran passed, and
    # nothing was unavailable (an unavailable required check is not a pass).
    report.all_passed = executed_any and every_ok
    return report
