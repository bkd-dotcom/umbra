"""Required-checks runner — executes a contract's validation commands, safely.

The Change Contract can declare ``required_checks`` (e.g. ``npm test``). Declaring
them is not enough: this module actually *runs* them and gates authority on the
result. But a repository is untrusted, and its ``.umbra/admission.yaml`` could
declare an arbitrary command — so execution is constrained on three axes and the
*enforcement level actually achieved* is recorded honestly (never overclaimed):

1. **Command allowlist.** Only known, server-owned check *profiles* run
   (``npm test``, ``npm ci``, ``pytest``, ``true``/``false`` for evals, …). A
   declared command that doesn't match a profile is reported ``blocked`` and never
   executed. This is the primary control — a repo cannot run ``curl … | sh``.
2. **Scrubbed environment.** The child gets a minimal env with every Umbra/OpenAI/
   GitHub/cloud secret stripped, so a check can't read credentials.
3. **Network isolation (best-effort, recorded).** On Linux with user namespaces we
   run under ``unshare -rn`` (no network). Where that isn't available (e.g. macOS
   dev), we cannot technically cut the network, so we record enforcement as
   ``host-restricted`` — allowlisted + secret-stripped, network *declared* not cut.
   The report's ``enforcement`` field is the truthful status the UI/receipt shows.

CPU/memory/time limits are applied via a bounded timeout and (on POSIX) an
``resource``-based child preexec cap.
"""
from __future__ import annotations

import hashlib
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CHECK_TIMEOUT_S = 300
_MEM_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB address-space cap (POSIX)

# Allowlisted check profiles. A declared command must match one of these patterns
# (after normalizing whitespace) to be executed. Kept deliberately small and
# dependency-manifest/test oriented — the profiles a governed remediation needs.
_ALLOWED_PROFILES: tuple[re.Pattern[str], ...] = (
    re.compile(r"^true$"),
    re.compile(r"^false$"),
    re.compile(r"^npm (ci|install|test|run [a-z0-9:_-]+)( --[a-z-]+)*$", re.I),
    re.compile(r"^pnpm (install|test|run [a-z0-9:_-]+)$", re.I),
    re.compile(r"^yarn (install|test)$", re.I),
    re.compile(r"^pytest( -[a-zA-Z]+)*$"),
    re.compile(r"^python -m pytest( -[a-zA-Z]+)*$"),
    re.compile(r"^pip install -r requirements\.txt$"),
    re.compile(r"^go (build|test) \./\.\.\.$"),
    re.compile(r"^cargo (build|test)$"),
    re.compile(r"^make (test|check|lint)$"),
)

# Env-var name fragments whose values must never reach a check subprocess.
_SECRET_FRAGMENTS = ("OPENAI", "GITHUB", "UMBRA_FERNET", "UMBRA_SIGNING", "SESSION_SECRET",
                     "RESEND", "GOOGLE", "TOKEN", "SECRET", "PASSWORD", "API_KEY", "AWS", "GCP")


def _output_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256((text or "").encode("utf-8", "replace")).hexdigest()


@dataclass
class CheckResult:
    command: str
    status: str  # "passed" | "failed" | "blocked" | "unavailable"
    exit_code: int | None
    output_hash: str | None
    detail: str

    def to_public(self) -> dict[str, Any]:
        return {"command": self.command, "status": self.status, "exit_code": self.exit_code, "output_hash": self.output_hash, "detail": self.detail}


@dataclass
class ChecksReport:
    results: list[CheckResult] = field(default_factory=list)
    ran: bool = False           # at least one required check actually executed
    all_passed: bool = False    # every declared check ran and passed (none blocked/failed/unavailable)
    enforcement: str = "none"   # "sandboxed" | "host-restricted" | "none"

    def to_public(self) -> dict[str, Any]:
        return {
            "ran": self.ran,
            "all_passed": self.all_passed,
            "enforcement": self.enforcement,
            "results": [r.to_public() for r in self.results],
        }


def _profile_allowed(cmd: str) -> bool:
    norm = " ".join(cmd.split())
    return any(p.match(norm) for p in _ALLOWED_PROFILES)


def _scrubbed_env() -> dict[str, str]:
    """Minimal env with secrets removed — enough for npm/pytest to find a toolchain."""
    keep = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "NODE_PATH", "PYTHONPATH", "SHELL")
    env: dict[str, str] = {}
    for k in keep:
        if k in os.environ:
            env[k] = os.environ[k]
    # Defensive: never carry anything that looks like a credential.
    for k, v in os.environ.items():
        if k in env:
            continue
        if any(frag in k.upper() for frag in _SECRET_FRAGMENTS):
            continue
    env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    # Signal to well-behaved tools that this is an isolated, offline check.
    env["CI"] = "1"
    env["npm_config_offline"] = "false"  # allow package resolution only if network exists
    return env


def _network_sandbox_prefix() -> tuple[list[str], str]:
    """Return (argv-prefix, enforcement-level) for network isolation.

    Linux user namespaces (``unshare -rn``) give a real no-network jail with no
    root. Where unavailable (macOS/dev), we return no prefix and ``host-restricted``
    — we do NOT pretend the network was cut."""
    if shutil.which("unshare"):
        # -r map current user to root in the new ns; -n new (empty) network ns.
        return (["unshare", "-r", "-n"], "sandboxed")
    return ([], "host-restricted")


def _preexec_limits():  # pragma: no cover - POSIX-only, exercised at runtime
    """Cap CPU time and address space for the child (POSIX)."""
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (_CHECK_TIMEOUT_S, _CHECK_TIMEOUT_S))
        resource.setrlimit(resource.RLIMIT_AS, (_MEM_LIMIT_BYTES, _MEM_LIMIT_BYTES))
    except Exception:  # noqa: BLE001 - limits are best-effort
        pass


def run_required_checks(repo_path: Path | str, commands: list[str]) -> ChecksReport:
    """Run each declared check under the allowlist + scrubbed env + network jail.

    ``ran`` is True iff at least one command executed; ``all_passed`` is True iff
    every declared command ran and passed (a blocked/unavailable/failed check makes
    it False). ``enforcement`` records the isolation actually achieved. Never raises.
    """
    root = Path(repo_path)
    report = ChecksReport()
    if not commands:
        return report

    net_prefix, enforcement = _network_sandbox_prefix()
    report.enforcement = enforcement
    env = _scrubbed_env()
    preexec = _preexec_limits if os.name == "posix" else None

    executed_any = False
    every_ok = True
    for command in commands:
        cmd = (command or "").strip()
        if not cmd:
            continue
        # 1. Allowlist — a non-profile command is refused, never executed.
        if not _profile_allowed(cmd):
            report.results.append(CheckResult(cmd, "blocked", None, None, "Command is not an allowlisted check profile; refused (not executed)."))
            every_ok = False
            continue
        argv = shlex.split(cmd)
        if not shutil.which(argv[0]):
            report.results.append(CheckResult(cmd, "unavailable", None, None, f"`{argv[0]}` is not available in this environment."))
            every_ok = False
            continue
        try:
            completed = subprocess.run(
                [*net_prefix, *argv], cwd=root, text=True, capture_output=True,
                timeout=_CHECK_TIMEOUT_S, check=False, env=env, preexec_fn=preexec,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            # unshare can fail where namespaces are restricted — fall back honestly.
            if net_prefix:
                try:
                    completed = subprocess.run(argv, cwd=root, text=True, capture_output=True, timeout=_CHECK_TIMEOUT_S, check=False, env=env, preexec_fn=preexec)
                    report.enforcement = "host-restricted"
                except (subprocess.SubprocessError, OSError) as exc2:
                    report.results.append(CheckResult(cmd, "unavailable", None, None, f"Could not run `{cmd}`: {exc2}"))
                    every_ok = False
                    continue
            else:
                report.results.append(CheckResult(cmd, "unavailable", None, None, f"Could not run `{cmd}`: {exc}"))
                every_ok = False
                continue
        executed_any = True
        combined = (completed.stdout or "") + (completed.stderr or "")
        passed = completed.returncode == 0
        every_ok = every_ok and passed
        report.results.append(CheckResult(cmd, "passed" if passed else "failed", completed.returncode, _output_hash(combined), f"`{cmd}` exited {completed.returncode}."))

    report.ran = executed_any
    report.all_passed = executed_any and every_ok
    return report
