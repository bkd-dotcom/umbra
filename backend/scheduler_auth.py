"""Scheduler authentication for ``POST /api/cron/run-due-scans``.

Two accepted mechanisms, OIDC preferred:

1. **Google OIDC (production).** Cloud Scheduler calls the endpoint with an
   ``Authorization: Bearer <id_token>`` minted by a *dedicated* scheduler service
   account. We verify the token with the official ``google-auth`` library against
   Google's public certs — issuer, signature, expiry — then check the audience and
   the caller's ``email`` matches the expected scheduler service account. No shared
   secret is stored in the scheduler job config.

2. **Legacy shared key (local dev / backwards-compat).** An ``X-Umbra-Cron-Key``
   header equal to ``UMBRA_CRON_KEY``. Only honored when that env var is set;
   clearly a fallback, not the production path.

The endpoint is never publicly triggerable: with neither OIDC configured nor a
cron key set, it refuses (the caller surfaces a 503). An absent/invalid token is
rejected (401).
"""
from __future__ import annotations

import logging

from backend.settings import (
    cron_key,
    scheduler_oidc_audience,
    scheduler_oidc_enabled,
    scheduler_service_account,
)

logger = logging.getLogger("umbra.scheduler-auth")

_GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}


class SchedulerAuthResult:
    def __init__(self, ok: bool, *, method: str = "", reason: str = "") -> None:
        self.ok = ok
        self.method = method  # "oidc" | "legacy-key" | ""
        self.reason = reason

    def __bool__(self) -> bool:  # convenience
        return self.ok


def _verify_google_oidc(bearer: str) -> SchedulerAuthResult:
    """Verify a Google-issued OIDC id_token from the scheduler service account.

    Checks (via google-auth): signature against Google's certs, issuer, expiry, and
    the audience; then that the token's verified ``email`` is the expected dedicated
    scheduler service account (and that Google marked it verified)."""
    try:
        # Imported lazily so environments without google-auth (should not happen —
        # it's a declared dependency) still import this module.
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token as g_id_token
    except Exception as exc:  # noqa: BLE001
        logger.error("google-auth unavailable for OIDC verification: %s", exc)
        return SchedulerAuthResult(False, reason="oidc-unavailable")

    audience = scheduler_oidc_audience()
    expected_sa = scheduler_service_account()
    # Fail closed: never verify without a concrete audience. (scheduler_oidc_enabled
    # already requires both, so this only guards against misuse.)
    if not audience or not expected_sa:
        return SchedulerAuthResult(False, reason="oidc-incomplete-config")
    try:
        # verify_oauth2_token validates signature (Google certs), issuer, exp, and
        # the aud claim (audience is always a non-empty string here). Raises on any
        # failure.
        claims = g_id_token.verify_oauth2_token(bearer, g_requests.Request(), audience=audience)
    except Exception as exc:  # noqa: BLE001 - invalid/expired/wrong-audience token
        logger.warning("Rejected scheduler OIDC token: %s", exc)
        return SchedulerAuthResult(False, reason="oidc-invalid")

    if claims.get("iss") not in _GOOGLE_ISSUERS:
        return SchedulerAuthResult(False, reason="oidc-bad-issuer")
    # Identity check: the token must be from the dedicated scheduler service account.
    email = (claims.get("email") or "").strip().lower()
    if not claims.get("email_verified"):
        return SchedulerAuthResult(False, reason="oidc-email-unverified")
    if not expected_sa or email != expected_sa.strip().lower():
        return SchedulerAuthResult(False, reason="oidc-wrong-identity")
    return SchedulerAuthResult(True, method="oidc")


def authenticate_scheduler(authorization: str, cron_key_header: str) -> SchedulerAuthResult:
    """Authenticate a scheduler request. Returns a truthy result on success.

    Order: OIDC (production-preferred) when configured, else the legacy shared key.
    When neither mechanism is configured on the server, returns ``unconfigured`` so
    the caller can 503 (never publicly triggerable)."""
    oidc_on = scheduler_oidc_enabled()
    legacy = cron_key()

    if not oidc_on and not legacy:
        return SchedulerAuthResult(False, reason="unconfigured")

    # 1. Prefer OIDC when configured and a bearer token is present.
    if oidc_on:
        token = ""
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if token:
            res = _verify_google_oidc(token)
            if res.ok:
                return res
            # If OIDC is the only configured mechanism, a bad token is a hard reject.
            if not legacy:
                return res
        elif not legacy:
            return SchedulerAuthResult(False, reason="oidc-missing-token")

    # 2. Legacy shared-key fallback (local dev / backwards-compat).
    if legacy:
        if cron_key_header and cron_key_header == legacy:
            return SchedulerAuthResult(True, method="legacy-key")
        return SchedulerAuthResult(False, reason="legacy-key-mismatch")

    return SchedulerAuthResult(False, reason="unauthenticated")
