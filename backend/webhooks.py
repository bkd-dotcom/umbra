"""GitHub webhook helpers — signature verification + review comment formatting.

The webhook path is a *read + comment* surface only: it verifies the HMAC, runs
the Reviewer on the PR, and posts one comment. It never merges, approves, or
edits code, and it never hands a token to Codex.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Any

# PR actions worth a fresh review (ignore label/assignee/etc. noise).
REVIEWABLE_ACTIONS = {"opened", "reopened", "synchronize", "ready_for_review"}


def verify_github_signature(secret: str | None, body: bytes, signature_header: str | None) -> bool:
    """Constant-time check of GitHub's ``X-Hub-Signature-256`` (sha256=…)."""
    if not secret or not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


_SEV_EMOJI = {"critical": "🔴 CRITICAL", "high": "🟠 HIGH", "medium": "🟡 MEDIUM", "low": "🟢 LOW"}


def format_review_comment(finding: dict[str, Any], pr_number: int) -> str:
    """Render the Reviewer finding as a single grounded PR comment. Honest about
    what's unavailable rather than inventing detail."""
    score = finding.get("risk_score", "—")
    severity = str(finding.get("severity", "")).lower()
    band = _SEV_EMOJI.get(severity, severity.upper() or "—")
    blast = finding.get("blast_radius") or "not determined"
    missing = finding.get("missing_tests")
    missing_line = "none noted" if not missing else (", ".join(missing) if isinstance(missing, list) else str(missing))
    rec = finding.get("recommendation") or "review manually"
    return (
        f"## 🌑 Umbra Review — PR #{pr_number}\n"
        f"### Risk Score: {score}  {band}\n"
        f"**Blast radius:** {blast}\n"
        f"**Missing tests:** {missing_line}\n"
        f"**Recommendation:** {rec}\n\n"
        f"> Umbra reviewed this PR automatically. It never approves, requests "
        f"changes, or merges — this is advisory, grounded in the diff.\n"
    )
