"""Emailed morning reports + one-click unsubscribe.

Sends a compact HTML report of a scheduled scan via Resend. Degrades gracefully:
when email isn't configured (no RESEND_API_KEY / From), :func:`send_report_email`
logs and returns False — the scan still saved and is visible in the dashboard.

The unsubscribe link carries a signed token (itsdangerous, keyed by the session
secret) so an email client can hit it unauthenticated; the endpoint sets the
user's notification opt-out. Every email also sends List-Unsubscribe headers so
Gmail shows its native one-click unsubscribe.
"""
from __future__ import annotations

import html
import logging
from typing import Any

from itsdangerous import BadSignature, URLSafeSerializer

from backend.settings import email_configured, email_from, resend_api_key, session_secret

logger = logging.getLogger("umbra.notifications")

_RESEND_URL = "https://api.resend.com/emails"

# Honest delivery-status vocabulary recorded on a schedule after each run and
# returned by the immediate-send endpoint. These describe exactly what happened —
# "accepted_for_delivery" means Resend ACCEPTED the message (returned True), NOT
# that it landed in an inbox. A failed email is one of the *_failed / *_rejected /
# *_unavailable states so it is always visible to the user, never silently OK.
DELIVERY_SCHEDULED = "scheduled"  # created, not yet run
DELIVERY_SCAN_FAILED = "scan_failed"  # the scan itself errored; no report to send
DELIVERY_EMAIL_UNAVAILABLE = "email_unavailable"  # no provider configured or no recipient
DELIVERY_EMAIL_REJECTED = "email_rejected"  # provider returned an error / send failed
DELIVERY_ACCEPTED = "accepted_for_delivery"  # Resend accepted (send_report_email → True)
DELIVERY_SKIPPED_OPTED_OUT = "skipped_opted_out"  # recipient has notifications off

DELIVERY_STATES = frozenset({
    DELIVERY_SCHEDULED,
    DELIVERY_SCAN_FAILED,
    DELIVERY_EMAIL_UNAVAILABLE,
    DELIVERY_EMAIL_REJECTED,
    DELIVERY_ACCEPTED,
    DELIVERY_SKIPPED_OPTED_OUT,
})


def _serializer() -> URLSafeSerializer:
    return URLSafeSerializer(session_secret(), salt="umbra-unsubscribe")


def make_unsub_token(user_key: str) -> str:
    return _serializer().dumps({"u": user_key, "p": "unsub"})


def read_unsub_token(token: str) -> str | None:
    """Return the user_key encoded in a valid unsubscribe token, else None."""
    try:
        data = _serializer().loads(token)
    except BadSignature:
        return None
    return data.get("u") if isinstance(data, dict) and data.get("p") == "unsub" else None


def _severity_counts(vulns: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for v in vulns:
        sev = str(v.get("severity", "unknown")).lower()
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def build_report_html(repo: str, result: dict[str, Any], view_url: str, unsubscribe_url: str) -> str:
    """A small, email-client-safe HTML report (inline styles, no external CSS)."""
    score = result.get("umbra_score")
    vulns = result.get("vulnerabilities") or []
    summary = html.escape(str(result.get("reasoning_summary") or "").strip())
    counts = _severity_counts(vulns)
    sev_line = " · ".join(f"{n} {s}" for s, n in counts.items()) or "no known advisories"
    top = "".join(
        f"<li style='margin:4px 0'><code>{html.escape(str(v.get('package','')))}@{html.escape(str(v.get('version','')))}</code> — "
        f"{html.escape(str(v.get('cve','')))} <span style='color:#b9822a'>({html.escape(str(v.get('severity','')))})</span></li>"
        for v in vulns[:5]
    )
    more = f"<p style='color:#6b6656;font-size:12px'>…and {len(vulns) - 5} more advisories.</p>" if len(vulns) > 5 else ""
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1915">
  <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6b6656;margin:0 0 4px">Umbra · night shift</p>
  <h1 style="font-size:22px;margin:0 0 2px">Morning report</h1>
  <p style="color:#6b6656;margin:0 0 18px"><code>{html.escape(repo)}</code></p>
  <div style="border:1px solid #e5e1d5;border-radius:14px;padding:20px;background:#fbfaf6">
    <div style="font-size:44px;font-weight:600;line-height:1">{score if isinstance(score, int) else "--"}<span style="font-size:15px;color:#6b6656"> / 100</span></div>
    <p style="margin:8px 0 0;color:#1a1915">{sev_line}</p>
    {f'<p style="margin:10px 0 0;color:#6b6656;font-size:13px;line-height:1.5">{summary}</p>' if summary else ''}
  </div>
  {f'<ul style="padding-left:18px;margin:16px 0 0;font-size:13px;color:#1a1915">{top}</ul>{more}' if top else ''}
  <p style="margin:22px 0 0">
    <a href="{html.escape(view_url)}" style="display:inline-block;background:#1a1915;color:#fbfaf6;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px">View full report →</a>
  </p>
  <p style="margin:18px 0 0;color:#6b6656;font-size:12px;line-height:1.5">
    Every finding is labelled by what produced it (OSV / Codex / reasoning) — never fabricated. Umbra opens branch-only PRs and <b>never merges</b>.
  </p>
  <hr style="border:none;border-top:1px solid #e5e1d5;margin:20px 0" />
  <p style="color:#6b6656;font-size:11px;margin:0">
    You're receiving this because you scheduled a report for this repo on Umbra.
    <a href="{html.escape(unsubscribe_url)}" style="color:#6b6656">Unsubscribe</a>.
  </p>
</div>"""


def send_report_email(to: str, repo: str, result: dict[str, Any], view_url: str, unsubscribe_url: str) -> bool:
    """Send the morning report. Returns True if accepted by the provider, else
    False (unconfigured, no recipient, or a provider error) — never raises."""
    if not email_configured():
        logger.info("email not configured; skipping report to %s for %s", to, repo)
        return False
    if not (to or "").strip():
        return False
    import httpx

    score = result.get("umbra_score")
    n = len(result.get("vulnerabilities") or [])
    subject = f"Umbra: {repo} — {score if isinstance(score, int) else '—'}/100, {n} finding{'' if n == 1 else 's'}"
    payload = {
        "from": email_from(),
        "to": [to],
        "subject": subject,
        "html": build_report_html(repo, result, view_url, unsubscribe_url),
        "headers": {
            "List-Unsubscribe": f"<{unsubscribe_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    }
    try:
        resp = httpx.post(_RESEND_URL, json=payload, headers={"Authorization": f"Bearer {resend_api_key()}"}, timeout=15)
        if resp.status_code >= 300:
            logger.warning("Resend rejected report to %s (%s): %s", to, resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001 - a mail failure must never crash the cron batch
        logger.warning("Resend send failed for %s: %s", to, exc)
        return False
