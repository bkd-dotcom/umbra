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


def github_oauth() -> tuple[str, str] | None:
    cid, secret = os.getenv("GITHUB_CLIENT_ID"), os.getenv("GITHUB_CLIENT_SECRET")
    return (cid, secret) if cid and secret else None


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


