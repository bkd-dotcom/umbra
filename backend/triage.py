"""Per-user finding triage lifecycle.

Each finding (keyed ``repo:package@version`` — package-group granularity, so one
decision covers all of a package's advisories) carries a triage status that
persists across nightly shifts. A user can snooze or accept-risk a finding —
both require a reason, so a suppressed advisory becomes an *auditable* act
(surfaced in the activity timeline + evidence pack), never a silent hide.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.auth import _user_key, get_current_user
from backend.store import get_store

router = APIRouter()

# Statuses a human may set here. ``pr_drafted`` is recorded when a PR is actually
# opened; ``fixed`` is reserved for a rescan that verifies the advisory is gone —
# never a manual claim — so neither is settable through this endpoint.
USER_STATUSES = {"open", "snoozed", "accepted_risk"}
REASON_REQUIRED = {"snoozed", "accepted_risk"}


class TriageBody(BaseModel):
    finding_key: str = Field(min_length=1, max_length=400)
    status: str = Field(min_length=1, max_length=32)
    reason: str | None = Field(default=None, max_length=500)
    repo: str | None = Field(default=None, max_length=200)


@router.get("/api/my/triage")
async def list_triage(request: Request):
    """Every triage decision for the signed-in user (across repos and shifts)."""
    user = get_current_user(request)
    return get_store().list_triage(_user_key(user))


@router.post("/api/my/triage")
async def set_triage(request: Request, body: TriageBody):
    """Set a finding's triage status. Snooze / accept-risk require a reason so the
    suppression is auditable rather than a silent hide."""
    user = get_current_user(request)
    if body.status not in USER_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(USER_STATUSES)}.")
    reason = (body.reason or "").strip()
    if body.status in REASON_REQUIRED and not reason:
        raise HTTPException(status_code=422, detail="A reason is required to snooze or accept the risk of a finding.")
    return get_store().set_triage(_user_key(user), body.finding_key, body.status, reason or None, body.repo)
