"""Non-blocking diagnostics for Umbra's optional live-agent path."""
from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from backend.integrations.repository import checkout_public_repo
from backend.reasoning import reason


def _command(*args: str) -> dict[str, str]:
    result = subprocess.run(list(args), text=True, capture_output=True, check=False)
    return {"status": "ok" if result.returncode == 0 else "unavailable", "detail": (result.stdout or result.stderr).strip()[:500]}


def run_preflight(verify_clone: bool = True, verify_reasoning: bool = False) -> dict[str, Any]:
    """Return diagnostics; intentionally never raises so demo deployments survive."""
    report: dict[str, Any] = {"codex": _command("codex", "--version"), "git": _command("git", "--version"), "models": {}, "clone": {"status": "skipped"}}
    help_process = subprocess.run(["codex", "exec", "--help"], text=True, capture_output=True, check=False)
    flags = help_process.stdout + help_process.stderr
    report["codex_flags"] = {"status": "ok" if "read-only" in flags and "workspace-write" in flags else "unavailable", "detail": "read-only and workspace-write sandbox modes checked"}
    for tier in ("fast", "work", "deep"):
        try:
            outcome = reason(tier, "Return exactly: preflight ok.", "Umbra preflight entitlement check.")
            report["models"][tier] = {"status": "ok", "model": outcome.model, "provider": outcome.provider}
        except RuntimeError as exc:
            report["models"][tier] = {"status": "unavailable", "detail": str(exc)}
    if verify_reasoning:
        # Opt-in because it spends Codex credits. Proves the Codex-backed
        # reasoning fallback works when the Responses API is unentitled.
        from backend.codex_client import CodexClient

        try:
            operation = CodexClient().analyze("Return exactly: preflight ok.")
            report["codex_reasoning"] = {"status": "ok" if operation.provider == "codex-cli" else "unavailable", "provider": operation.provider, "detail": operation.summary.strip()[:200]}
        except Exception as exc:
            report["codex_reasoning"] = {"status": "unavailable", "detail": str(exc)}
    if verify_clone:
        try:
            with checkout_public_repo("https://github.com/octocat/Hello-World") as repo:
                report["clone"] = {"status": "ok", "detail": f"temporary checkout ready: {repo.name}"}
        except Exception as exc:
            report["clone"] = {"status": "unavailable", "detail": str(exc)}
    return report


if __name__ == "__main__":
    # UMBRA_PREFLIGHT_REASONING=true adds a live Codex reasoning probe (spends credits).
    verify_reasoning = os.getenv("UMBRA_PREFLIGHT_REASONING", "false").lower() == "true"
    print(json.dumps(run_preflight(verify_reasoning=verify_reasoning), indent=2))
