"""Per-user scheduled morning-report CRUD + one-click email unsubscribe.

Scoped to the signed-in user (like every other ``/api/my/*`` route). The actual
scan+email is run by ``POST /api/cron/run-due-scans`` in main.py; here we only
manage the schedule records and the notification opt-out.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from backend.auth import _user_key, get_current_user
from backend.notifications import read_unsub_token
from backend.scheduling import VALID_CADENCES, compute_next_run, valid_timezone
from backend.store import get_store

router = APIRouter()


def _slug(repo: str) -> str:
    return repo.strip().replace("https://", "").replace("http://", "").replace("github.com/", "").replace(".git", "").strip("/")


class ScheduleBody(BaseModel):
    repo_full_name: str = Field(min_length=1, max_length=200)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    timezone: str = Field(min_length=1, max_length=64)
    cadence: str = Field(default="daily")
    email: str | None = Field(default=None, max_length=200)


@router.get("/api/my/schedules")
async def list_schedules(request: Request):
    """The signed-in user's scheduled reports."""
    user = get_current_user(request)
    return get_store().list_schedules(_user_key(user))


@router.post("/api/my/schedules")
async def create_schedule(request: Request, body: ScheduleBody):
    """Create a scheduled morning report. Defaults the recipient to the account
    email; computes the first UTC firing instant from the user's local time."""
    user = get_current_user(request)
    repo = _slug(body.repo_full_name)
    if "/" not in repo:
        raise HTTPException(status_code=422, detail="repo_full_name must look like owner/repo.")
    if body.cadence not in VALID_CADENCES:
        raise HTTPException(status_code=422, detail=f"cadence must be one of {list(VALID_CADENCES)}.")
    if not valid_timezone(body.timezone):
        raise HTTPException(status_code=422, detail=f"Unknown timezone: {body.timezone}.")
    email = (body.email or user.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=422, detail="No email on file — provide one to receive reports.")
    next_run = compute_next_run(body.hour, body.minute, body.timezone, body.cadence, datetime.now(timezone.utc))
    schedule = {
        "repo_full_name": repo,
        "hour": body.hour,
        "minute": body.minute,
        "timezone": body.timezone,
        "cadence": body.cadence,
        "email": email,
        "enabled": True,
        "next_run_at": next_run,
        "last_run_at": None,
        "last_scan_id": None,
    }
    return get_store().save_schedule(_user_key(user), schedule)


class ToggleBody(BaseModel):
    enabled: bool


@router.post("/api/my/schedules/{schedule_id}/toggle")
async def toggle_schedule(schedule_id: str, request: Request, body: ToggleBody):
    user = get_current_user(request)
    get_store().set_schedule_enabled(_user_key(user), schedule_id, body.enabled)
    return {"ok": True, "enabled": body.enabled}


@router.delete("/api/my/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, request: Request):
    user = get_current_user(request)
    get_store().delete_schedule(_user_key(user), schedule_id)
    return {"ok": True}


class NotifyBody(BaseModel):
    enabled: bool


@router.post("/api/my/notifications")
async def set_notifications(request: Request, body: NotifyBody):
    """Turn report emails on/off from the dashboard (the inverse of the opt-out
    flag the email unsubscribe link sets)."""
    user = get_current_user(request)
    get_store().set_notifications_opt_out(_user_key(user), not body.enabled)
    return {"ok": True, "enabled": body.enabled}


def _unsub_page(message: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Umbra · unsubscribe</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f0eee6;color:#1a1915;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:32px;text-align:center">
<p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6b6656">Umbra</p>
<h1 style="font-size:22px;margin:6px 0 12px">Email notifications</h1>
<p style="color:#6b6656;line-height:1.6">{message}</p>
<p style="margin-top:20px"><a href="/dashboard" style="color:#0e97b0">Open the dashboard →</a></p>
</div></body></html>"""


@router.api_route("/api/unsubscribe", methods=["GET", "POST"])
async def unsubscribe(request: Request):
    """One-click email unsubscribe (no session — hit directly from a mail client).
    Sets the user's notification opt-out; the cron send path then skips them."""
    token = request.query_params.get("token", "")
    user_key = read_unsub_token(token)
    if not user_key:
        return HTMLResponse(_unsub_page("This unsubscribe link is invalid or has expired."), status_code=400)
    get_store().set_notifications_opt_out(user_key, True)
    return HTMLResponse(_unsub_page("You've been unsubscribed from Umbra morning reports. You can re-enable them anytime from your dashboard."))
