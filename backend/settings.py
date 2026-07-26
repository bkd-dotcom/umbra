"""Thin, lazy config accessors for the auth / session / per-user layer.

Every accessor reads the environment at call time (matching the rest of the
backend) so importing this module never fails and demo mode needs nothing set.
"""
from __future__ import annotations

import base64
import hashlib
import os

# Insecure fallback used ONLY when SESSION_SECRET is unset (local dev, tests,
# demo mode). Production MUST set SESSION_SECRET — the deploy passes it via
# Secret Manager. This is a placeholder, not a real secret.
_DEV_SESSION_SECRET = "umbra-dev-insecure-session-key-set-SESSION_SECRET-in-prod"


def session_secret() -> str:
    return os.getenv("SESSION_SECRET") or _DEV_SESSION_SECRET


def founder_ids() -> set[str]:
    """Accounts allowed to spend the founder's Codex credits on the server.

    Comma-separated ``provider:sub`` values in ``UMBRA_FOUNDER_IDS`` (the same
    key shape the store uses). Empty by default → nobody is a founder, so the
    server-side Codex CLI is never triggered by a request.
    """
    raw = os.getenv("UMBRA_FOUNDER_IDS", "")
    return {part.strip() for part in raw.split(",") if part.strip()}


def fernet_key() -> bytes:
    """Symmetric key for encrypting stored secrets (GitHub tokens, OpenAI keys).

    Prod sets ``UMBRA_FERNET_KEY`` (a urlsafe-base64 32-byte Fernet key) via
    Secret Manager. The dev fallback is deterministic so local/tests round-trip;
    it is NOT a real secret and never protects production data.
    """
    provided = os.getenv("UMBRA_FERNET_KEY")
    if provided:
        return provided.encode()
    return base64.urlsafe_b64encode(hashlib.sha256(b"umbra-dev-insecure-fernet").digest())


def encrypt(value: str) -> str:
    """Encrypt a secret for at-rest storage. Returns urlsafe-base64 ciphertext."""
    from cryptography.fernet import Fernet

    return Fernet(fernet_key()).encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    """Inverse of :func:`encrypt`. Raises if the ciphertext is invalid/foreign."""
    from cryptography.fernet import Fernet

    return Fernet(fernet_key()).decrypt(token.encode()).decode()


def signing_seed() -> bytes:
    """32-byte Ed25519 private seed used to sign Remediation Receipts.

    Prod sets ``UMBRA_SIGNING_KEY`` (base64 of 32 raw bytes) via Secret Manager so
    receipts are verifiable against a stable public key across restarts/instances.
    The dev fallback is deterministic (like the Fernet dev key) so local/tests
    round-trip — it is NOT a real secret and receipts signed with it are only as
    trustworthy as the dev environment. The public key is served at
    ``/api/verify-key`` so anyone can verify a receipt independently.
    """
    provided = os.getenv("UMBRA_SIGNING_KEY")
    if provided:
        try:
            seed = base64.b64decode(provided)
            if len(seed) >= 32:
                return seed[:32]
        except Exception:  # noqa: BLE001 - malformed env → fall back to dev seed
            pass
    return hashlib.sha256(b"umbra-dev-insecure-signing-seed").digest()


def signing_key_is_ephemeral() -> bool:
    """True when signing uses the deterministic dev seed (no UMBRA_SIGNING_KEY).

    Surfaced honestly in the receipt so a reviewer knows whether the signature is
    backed by a managed production key or a dev fallback."""
    provided = os.getenv("UMBRA_SIGNING_KEY")
    if not provided:
        return True
    try:
        return len(base64.b64decode(provided)) < 32
    except Exception:  # noqa: BLE001
        return True


def github_oauth() -> tuple[str, str] | None:
    cid, secret = os.getenv("GITHUB_CLIENT_ID"), os.getenv("GITHUB_CLIENT_SECRET")
    return (cid, secret) if cid and secret else None


def dev_secrets_in_use() -> list[str]:
    """Names of security-critical secrets currently falling back to an insecure dev
    default. Empty in a correctly-configured production deploy. Used to emit a loud
    startup warning so a misconfigured prod never signs/encrypts with a placeholder
    silently."""
    missing: list[str] = []
    if not os.getenv("SESSION_SECRET"):
        missing.append("SESSION_SECRET")
    if not os.getenv("UMBRA_FERNET_KEY"):
        missing.append("UMBRA_FERNET_KEY")
    if signing_key_is_ephemeral():
        missing.append("UMBRA_SIGNING_KEY")
    return missing


def google_oauth() -> tuple[str, str] | None:
    cid, secret = os.getenv("GOOGLE_CLIENT_ID"), os.getenv("GOOGLE_CLIENT_SECRET")
    return (cid, secret) if cid and secret else None


def oauth_redirect_base() -> str:
    """Base URL the OAuth provider redirects back to (this backend)."""
    return os.getenv("OAUTH_REDIRECT_BASE", "http://localhost:8000").rstrip("/")


def frontend_origin() -> str:
    """Where to send the browser after login/logout (same origin in prod)."""
    return os.getenv("UMBRA_FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")


def cookie_secure() -> bool:
    # Default true (prod is HTTPS). Set UMBRA_COOKIE_SECURE=false for plain-http
    # local dev if your browser rejects the Secure cookie.
    return os.getenv("UMBRA_COOKIE_SECURE", "true").lower() == "true"


def auth_configured() -> bool:
    """True when at least one real OAuth provider is configured."""
    return github_oauth() is not None or google_oauth() is not None


# --- GitHub App (install-once PR auto-review) --------------------------------
# The App is created by the operator in GitHub's UI; these come from Secret
# Manager in prod. When unset, the App webhook returns 503 and the dashboard
# hides the install button — the rest of Umbra is unaffected.
def github_app_id() -> str | None:
    return os.getenv("GITHUB_APP_ID") or None


def github_app_webhook_secret() -> str | None:
    return os.getenv("GITHUB_APP_WEBHOOK_SECRET") or None


def github_app_slug() -> str | None:
    return os.getenv("GITHUB_APP_SLUG") or None


def github_app_private_key() -> str | None:
    """The App's RSA private key (PEM). Accepts either a raw PEM or a base64
    blob of one, so it survives env-var newline mangling on Cloud Run."""
    raw = os.getenv("GITHUB_APP_PRIVATE_KEY")
    if not raw:
        return None
    if "-----BEGIN" in raw:
        return raw
    try:
        return base64.b64decode(raw).decode()
    except Exception:  # noqa: BLE001 - not base64 either; hand back as-is
        return raw


def github_app_configured() -> bool:
    """True only when the App id, private key, and webhook secret are all set."""
    return bool(github_app_id() and github_app_private_key() and github_app_webhook_secret())


# --- Scheduled scans + emailed morning reports -------------------------------
# All optional: when unset the feature is simply inert (the cron endpoint 503s and
# the dashboard tells the user scheduling/email isn't enabled). No worker process.
def cron_key() -> str | None:
    """LEGACY / local-dev fallback only. A shared secret the scheduler may send in
    the ``X-Umbra-Cron-Key`` header to authorize ``POST /api/cron/run-due-scans``.

    Production should authenticate the scheduler with a Google OIDC token instead
    (see :func:`scheduler_oidc_audience` / :func:`scheduler_service_account`), which
    keeps no shared secret in the scheduler job config. This key remains supported
    for local development and backwards compatibility; when it is set the header
    path still works, but OIDC is preferred and checked first."""
    return os.getenv("UMBRA_CRON_KEY") or None


def scheduler_service_account() -> str | None:
    """The email of the dedicated service account Cloud Scheduler uses to mint its
    OIDC token (e.g. ``umbra-scheduler@PROJECT.iam.gserviceaccount.com``). When set,
    ``/api/cron/run-due-scans`` accepts a Google OIDC token ONLY from this identity."""
    return (os.getenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT") or "").strip() or None


def scheduler_oidc_audience() -> str | None:
    """The expected ``aud`` of the scheduler's OIDC token — normally the Cloud Run
    service URL (the endpoint the scheduler targets). Defaults to UMBRA_PUBLIC_URL
    when unset so the common single-URL deploy needs no extra config."""
    aud = (os.getenv("UMBRA_SCHEDULER_OIDC_AUDIENCE") or os.getenv("UMBRA_PUBLIC_URL") or "").strip()
    return aud or None


def scheduler_oidc_enabled() -> bool:
    """OIDC scheduler auth is active ONLY when the configuration is complete: both a
    dedicated scheduler service account AND an expected OIDC audience are set. A
    service account without an audience is incomplete configuration (fail closed),
    not an enabled mode — verification must always assert a concrete audience."""
    return bool(scheduler_service_account() and scheduler_oidc_audience())


def resend_api_key() -> str | None:
    return os.getenv("RESEND_API_KEY") or None


def email_from() -> str:
    """The From address for report emails. Must be on a Resend-verified domain in
    prod; defaults to a placeholder that only works once a domain is verified."""
    return os.getenv("UMBRA_EMAIL_FROM", "Umbra <reports@umbra.engineer>")


def app_base_url() -> str:
    """Where report emails link back to (the dashboard). Falls back to the
    frontend origin so a deep-link works even if unset."""
    return os.getenv("UMBRA_APP_URL", frontend_origin()).rstrip("/")


def email_configured() -> bool:
    """True when report emails can actually be sent (Resend key + From present)."""
    return bool(resend_api_key() and email_from())


def slack_webhook_url() -> str | None:
    """Optional Slack Incoming Webhook URL for admission/brake notifications.

    Unset → Slack delivery degrades gracefully (recorded as unavailable, never a
    fake success). Must be a Slack-hosted https webhook; any other value is
    ignored (fail-closed) so a misconfiguration can't POST governed data elsewhere."""
    url = (os.getenv("UMBRA_SLACK_WEBHOOK_URL") or "").strip()
    if url.startswith("https://hooks.slack.com/"):
        return url
    return None


def scheduling_configured() -> bool:
    """True when scheduled scans can actually run — i.e. the due-scan endpoint has a
    working authentication mechanism: either complete Google OIDC scheduler
    configuration (production-preferred) OR the explicit legacy local-dev cron key."""
    return scheduler_oidc_enabled() or (cron_key() is not None)


