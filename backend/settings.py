"""Thin, lazy config accessors for the auth / session / per-user layer.

Every accessor reads the environment at call time (matching the rest of the
backend) so importing this module never fails and demo mode needs nothing set.
"""
from __future__ import annotations

import os

# Insecure fallback used ONLY when SESSION_SECRET is unset (local dev, tests,
# demo mode). Production MUST set SESSION_SECRET — the deploy passes it via
# Secret Manager. This is a placeholder, not a real secret.
_DEV_SESSION_SECRET = "umbra-dev-insecure-session-key-set-SESSION_SECRET-in-prod"


def session_secret() -> str:
    return os.getenv("SESSION_SECRET") or _DEV_SESSION_SECRET


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
