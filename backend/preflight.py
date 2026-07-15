"""Non-blocking diagnostics for Umbra's optional live-agent path."""
from __future__ import annotations

import json
import subprocess
from typing import Any

from backend.integrations.repository import checkout_public_repo
from backend.reasoning import reason


def _command(*args: str) -> dict[str, str]:
    result = subprocess.run(list(args), text=True, capture_output=True, check=False)
    return {"status": "ok" if result.returncode == 0 else "unavailable", "detail": (result.stdout or result.stderr).strip()[:500]}


def run_preflight(verify_clone: bool = True) -> dict[str, Any]:
    """Return diagnostics; intentionally never raises so demo deployments survive."""
    report: dict[str, Any] = {"codex": _command("codex", "--version"), "git": _command("git", "--version"), "models": {}, "clone": {"status": "skipped"}}
    help_result = _command("codex", "exec", "--help")
    flags = help_result["detail"]
    report["codex_flags"] = {"status": "ok" if "read-only" in flags and "workspace-write" in flags else "unavailable", "detail": "read-only and workspace-write sandbox modes checked"}
    for tier in ("fast", "work", "deep"):
        try:
            outcome = reason(tier, "Return exactly: preflight ok.", "Umbra preflight entitlement check.")
            report["models"][tier] = {"status": "ok", "model": outcome.model, "provider": outcome.provider}
        except RuntimeError as exc:
            report["models"][tier] = {"status": "unavailable", "detail": str(exc)}
    if verify_clone:
        try:
            with checkout_public_repo("https://github.com/octocat/Hello-World") as repo:
                report["clone"] = {"status": "ok", "detail": f"temporary checkout ready: {repo.name}"}
        except Exception as exc:
            report["clone"] = {"status": "unavailable", "detail": str(exc)}
    return report


if __name__ == "__main__":
    print(json.dumps(run_preflight(), indent=2))
