"""Real OAuth sign-in (GitHub + Google) + per-user endpoints.

Auth is enforced here in the backend with an itsdangerous-signed session cookie,
so the static frontend stays a plain export served same-origin. The session
holds only the public profile; the GitHub access token lives server-side in the
store (backend/store.py), never in the cookie.
"""
from __future__ import annotations

import asyncio

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend.integrations.github import list_user_repos
from backend.settings import frontend_origin, github_oauth, google_oauth, oauth_redirect_base
from backend.store import get_store

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
                client_kwargs={"scope": "read:user user:email"},
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
    redirect_uri = f"{oauth_redirect_base()}/auth/callback/{provider}"
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback/{provider}")
async def callback(provider: str, request: Request):
    client = _client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail=f"Sign-in with '{provider}' is not configured.")
    try:
        token = await client.authorize_access_token(request)
    except Exception as exc:  # noqa: BLE001 - surface a clean error, don't 500
        raise HTTPException(status_code=400, detail=f"OAuth exchange failed: {exc}") from exc

    store = get_store()
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
        }
        key = _user_key(user)
        store.get_or_create_user(key, {k: user[k] for k in ("name", "email", "avatar", "provider", "login")})
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
    return get_current_user(request)


@router.get("/api/my/repos")
async def my_repos(request: Request):
    user = get_current_user(request)
    if user.get("provider") != "github":
        raise HTTPException(status_code=400, detail="Sign in with GitHub to list your repositories.")
    token = get_store().get_github_token(_user_key(user))
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token on file — sign in with GitHub again.")
    try:
        return await asyncio.to_thread(list_user_repos, token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"GitHub repo listing failed: {exc}") from exc


class ScanSummary(BaseModel):
    repo_full_name: str = Field(min_length=1, max_length=200)
    umbra_score: int | None = None
    source: str | None = None
    vuln_count: int | None = None


@router.get("/api/my/scans")
async def my_scans(request: Request):
    user = get_current_user(request)
    return get_store().list_scans(_user_key(user))


@router.post("/api/my/scans")
async def save_my_scan(request: Request, summary: ScanSummary):
    user = get_current_user(request)
    get_store().save_scan(_user_key(user), summary.model_dump())
    return {"ok": True}
