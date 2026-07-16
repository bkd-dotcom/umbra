"""GitHub App auth — mint short-lived installation tokens from the App's private key.

The App is installed once on an account/org (any repo it can reach), and every PR
event arrives at one app-level webhook. To act on an event we exchange the App's
private key (a JWT, handled by PyGithub) for a short-lived **installation access
token** scoped to that installation. That token is used read-only to fetch the PR
diff / clone and comment-only to post the review — it is NEVER handed to the Codex
child process. The private key is a secret: it is never logged and is scrubbed from
any raised error.
"""
from __future__ import annotations

from backend.settings import (
    github_app_configured,
    github_app_id,
    github_app_private_key,
    github_app_slug,
)


def app_configured() -> bool:
    return github_app_configured()


def install_url() -> str | None:
    """Public install link for the App (None until the slug is configured)."""
    slug = github_app_slug()
    return f"https://github.com/apps/{slug}/installations/new" if slug else None


def installation_token(installation_id: int) -> str:
    """Mint a short-lived installation access token for ``installation_id``.

    Raises RuntimeError (with the private key scrubbed) if the App is not
    configured or GitHub rejects the request.
    """
    key = github_app_private_key()
    app_id = github_app_id()
    if not (key and app_id):
        raise RuntimeError("GitHub App is not configured on this server.")

    def _scrub(message: str) -> str:
        return message.replace(key, "***") if key else message

    try:
        from github import Auth, GithubIntegration

        integration = GithubIntegration(auth=Auth.AppAuth(app_id, key))
        return integration.get_access_token(int(installation_id)).token
    except Exception as exc:  # noqa: BLE001 - scrub the private key before it can surface
        raise RuntimeError(_scrub(str(exc))) from None
