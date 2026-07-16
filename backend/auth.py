"""Real OAuth sign-in (GitHub + Google) + per-user endpoints.

Auth is enforced here in the backend with an itsdangerous-signed session cookie,
so the static frontend stays a plain export served same-origin. The session
holds only the public profile; the GitHub access token lives server-side in the
store (backend/store.py), never in the cookie.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets as _secrets
from typing import Any

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend.integrations.github import list_user_repos
from backend.integrations.github_write import create_repo_webhook, delete_repo_webhook
from backend.settings import founder_ids, frontend_origin, github_oauth, google_oauth, oauth_redirect_base
from backend.store import get_store

_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

router = APIRouter()

_oauth = OAuth()
_registered: set[str] = set()
_PROVIDERS = {"github", "google"}


def _client(provider: str):
    """Return the OAuth client for a provider, registering it lazily from env
    (so config is read at call time and tests can monkeypatch). None if the
    provider is unknown or not configured."""
    if provider not in _PROVIDERS:
        return None
    if provider not in _registered:
        if provider == "github" and (creds := github_oauth()):
            _oauth.register(
                name="github",
                client_id=creds[0],
                client_secret=creds[1],
                access_token_url="https://github.com/login/oauth/access_token",
                authorize_url="https://github.com/login/oauth/authorize",
                api_base_url="https://api.github.com/",
                # `repo` grants read of private repos so users can scan their own
                # code. The token is used read-only (clone remote stripped after
                # checkout) and is NEVER passed to the Codex child process.
                client_kwargs={"scope": "read:user user:email repo"},
            )
            _registered.add("github")
        elif provider == "google" and (creds := google_oauth()):
            _oauth.register(
                name="google",
                client_id=creds[0],
                client_secret=creds[1],
                server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
                client_kwargs={"scope": "openid email profile"},
            )
            _registered.add("google")
    return _oauth.create_client(provider)


def _user_key(user: dict) -> str:
    return f"{user['provider']}:{user['sub']}"


@router.get("/auth/login/{provider}")
async def login(provider: str, request: Request):
    client = _client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail=f"Sign-in with '{provider}' is not configured.")
    request.session["oauth_mode"] = "login"
    redirect_uri = f"{oauth_redirect_base()}/auth/callback/{provider}"
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/auth/connect/github")
async def connect_github(request: Request):
    """Link a GitHub account to the CURRENT session user (e.g. someone signed in
    with Google) so they can list + scan their own repos. Reuses the single
    registered GitHub callback by flagging the mode in the session — GitHub
    OAuth Apps allow only one callback URL."""
    get_current_user(request)  # 401 if not signed in
    client = _client("github")
    if client is None:
        raise HTTPException(status_code=404, detail="GitHub sign-in is not configured.")
    request.session["oauth_mode"] = "connect"
    redirect_uri = f"{oauth_redirect_base()}/auth/callback/github"
    return await client.authorize_redirect(request, redirect_uri)


def _fallback_dest(request: Request, mode: str) -> str:
    """Where to send the browser when consent is denied / exchange fails."""
    if mode == "connect" and request.session.get("user"):
        return "/dashboard/"
    return "/"


@router.get("/auth/callback/{provider}")
async def callback(provider: str, request: Request):
    client = _client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail=f"Sign-in with '{provider}' is not configured.")
    mode = request.session.pop("oauth_mode", "login")
    # The user declined consent (or the provider returned an OAuth error): send
    # them back to the landing page (or the dashboard if they were connecting).
    if request.query_params.get("error"):
        return RedirectResponse(url=f"{frontend_origin()}{_fallback_dest(request, mode)}", status_code=303)
    try:
        token = await client.authorize_access_token(request)
    except Exception:  # noqa: BLE001 - abandoned/failed exchange falls back gracefully
        return RedirectResponse(url=f"{frontend_origin()}{_fallback_dest(request, mode)}", status_code=303)

    store = get_store()

    # CONNECT: attach the GitHub token to the existing session identity without
    # changing who the user is (Google account linking GitHub for repo access).
    if mode == "connect" and provider == "github" and request.session.get("user"):
        info = (await client.get("user", token=token)).json()
        current = dict(request.session["user"])
        key = _user_key(current)
        store.get_or_create_user(key, {"github_connected": True, "github_login": info.get("login")})
        if token.get("access_token"):
            store.put_github_token(key, token["access_token"])
        current.update({"github_connected": True, "github_login": info.get("login")})
        request.session["user"] = current
        return RedirectResponse(url=f"{frontend_origin()}/dashboard/", status_code=303)

    if provider == "github":
        info = (await client.get("user", token=token)).json()
        email = info.get("email")
        if not email:
            emails = (await client.get("user/emails", token=token)).json()
            primary = next((e for e in emails if e.get("primary")), None) or (emails[0] if emails else {})
            email = primary.get("email")
        user = {
            "sub": str(info["id"]),
            "provider": "github",
            "name": info.get("name") or info.get("login"),
            "email": email,
            "avatar": info.get("avatar_url"),
            "login": info.get("login"),
            "github_connected": True,
            "github_login": info.get("login"),
        }
        key = _user_key(user)
        store.get_or_create_user(key, {k: user[k] for k in ("name", "email", "avatar", "provider", "login", "github_connected", "github_login")})
        if token.get("access_token"):
            store.put_github_token(key, token["access_token"])
    else:  # google
        info = token.get("userinfo") or {}
        user = {
            "sub": str(info.get("sub")),
            "provider": "google",
            "name": info.get("name"),
            "email": info.get("email"),
            "avatar": info.get("picture"),
        }
        store.get_or_create_user(_user_key(user), {k: user.get(k) for k in ("name", "email", "avatar", "provider")})

    request.session["user"] = user
    return RedirectResponse(url=f"{frontend_origin()}/dashboard/", status_code=303)


@router.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


def get_current_user(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.get("/api/me")
async def me(request: Request):
    user = dict(get_current_user(request))
    key = _user_key(user)
    store = get_store()
    has_github = bool(user.get("github_connected") or store.get_github_token(key))
    # Never return the stored secrets themselves — only whether they exist.
    return {
        **user,
        "github_connected": has_github,
        "github_login": user.get("github_login"),
        "has_openai_key": bool(store.get_openai_key(key)),
        "is_founder": key in founder_ids(),
    }


@router.get("/api/my/repos")
async def my_repos(request: Request):
    user = get_current_user(request)
    # Works for any signed-in user who has a GitHub token on file — including a
    # Google account that linked GitHub via /auth/connect/github.
    token = get_store().get_github_token(_user_key(user))
    if not token:
        raise HTTPException(status_code=400, detail="Connect GitHub to list your repositories.")
    try:
        return await asyncio.to_thread(list_user_repos, token)
    except Exception as exc:  # noqa: BLE001
        # Distinct status codes let the UI tell "reconnect GitHub" (expired token /
        # missing scope) apart from a transient GitHub outage worth retrying.
        status = getattr(exc, "status", None)
        if status == 401:
            raise HTTPException(status_code=401, detail="Your GitHub connection expired — reconnect GitHub.") from exc
        if status == 403:
            raise HTTPException(status_code=403, detail="GitHub denied access (scope or rate limit) — reconnect GitHub.") from exc
        raise HTTPException(status_code=502, detail=f"GitHub repo listing is temporarily unavailable: {exc}") from exc


class OpenAIKeyBody(BaseModel):
    api_key: str = Field(min_length=20, max_length=300)


@router.post("/api/my/openai-key")
async def set_openai_key(request: Request, body: OpenAIKeyBody):
    user = get_current_user(request)
    api_key = body.api_key.strip()
    if not api_key.startswith("sk-"):
        raise HTTPException(status_code=422, detail="That doesn't look like an OpenAI API key (expected sk-…).")
    get_store().put_openai_key(_user_key(user), api_key)
    return {"ok": True}


@router.delete("/api/my/openai-key")
async def delete_openai_key(request: Request):
    user = get_current_user(request)
    get_store().clear_openai_key(_user_key(user))
    return {"ok": True}


class ScanSummary(BaseModel):
    repo_full_name: str = Field(min_length=1, max_length=200)
    umbra_score: int | None = None
    source: str | None = None
    vuln_count: int | None = None
    # Full scan report so a past scan can be re-viewed without re-scanning.
    report: dict[str, Any] | None = None


@router.get("/api/my/scans")
async def my_scans(request: Request):
    user = get_current_user(request)
    return get_store().list_scans(_user_key(user))


@router.post("/api/my/scans")
async def save_my_scan(request: Request, summary: ScanSummary):
    user = get_current_user(request)
    get_store().save_scan(_user_key(user), summary.model_dump())
    return {"ok": True}


@router.delete("/api/my/scans")
async def clear_my_scans(request: Request):
    """Delete every saved scan for the signed-in user — a privacy control. Only
    ever touches the caller's own records (keyed by their session identity)."""
    user = get_current_user(request)
    get_store().clear_scans(_user_key(user))
    return {"ok": True}


class AutoReviewBody(BaseModel):
    repo: str = Field(min_length=3, max_length=200, description="owner/name of a repo the user administers")
    enabled: bool = True


def _public_base(request: Request) -> str:
    """Absolute base URL for the webhook callback — pinned via UMBRA_PUBLIC_URL in
    prod, else derived from the request (local dev)."""
    return (os.getenv("UMBRA_PUBLIC_URL") or str(request.base_url)).rstrip("/")


@router.get("/api/my/auto-reviews")
async def my_auto_reviews(request: Request):
    """Repos the signed-in user has PR auto-review enabled on (repo names only)."""
    user = get_current_user(request)
    return get_store().list_repo_hooks_for_user(_user_key(user))


@router.post("/api/my/auto-review")
async def set_auto_review(request: Request, body: AutoReviewBody):
    """Enable/disable PR auto-review on ONE of the caller's own repos by
    registering (or removing) a GitHub webhook with the user's OWN token. The
    webhook posts advisory review comments only — it never merges. Each repo gets
    its own opaque callback path + HMAC secret (stored encrypted)."""
    user = get_current_user(request)
    key = _user_key(user)
    store = get_store()
    token = store.get_github_token(key)
    if not token:
        raise HTTPException(status_code=400, detail="Connect GitHub (with repo access) to enable auto-review.")
    repo = body.repo.strip().removeprefix("https://github.com/").strip("/")
    if not _REPO_RE.match(repo):
        raise HTTPException(status_code=422, detail="Expected a repository as 'owner/name'.")

    existing = store.find_repo_hook(key, repo)
    if body.enabled:
        if existing:
            return {"ok": True, "repo": repo, "enabled": True}  # idempotent
        hook_token = _secrets.token_urlsafe(24)
        secret = _secrets.token_hex(32)
        callback = f"{_public_base(request)}/api/webhooks/github/{hook_token}"
        try:
            result = await asyncio.to_thread(create_repo_webhook, repo, str(token), callback, secret)
        except Exception as exc:  # noqa: BLE001 - message is already token-scrubbed
            raise HTTPException(status_code=403, detail=f"Couldn't enable auto-review on {repo} — you need admin access on the repo and a current GitHub connection. ({exc})") from None
        store.put_repo_hook(hook_token, key, repo, int(result["id"]), secret)
        return {"ok": True, "repo": repo, "enabled": True}

    # disable: remove the GitHub hook (best-effort) then forget the mapping
    if existing:
        try:
            await asyncio.to_thread(delete_repo_webhook, repo, str(token), int(existing["hook_id"]))
        except Exception:  # noqa: BLE001 - leave no orphaned mapping even if the API call fails
            pass
        store.delete_repo_hook(existing["hook_token"])
    return {"ok": True, "repo": repo, "enabled": False}
