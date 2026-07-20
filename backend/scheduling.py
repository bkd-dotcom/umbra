"""Pure schedule math for the morning-report feature — no I/O, fully testable.

A per-user schedule fires at ``hour:minute`` in the user's IANA timezone, either
every day or on weekdays only. The cron endpoint computes the next UTC firing
instant with :func:`compute_next_run` at create time and after each run, then a
periodic Cloud Scheduler tick asks the store for schedules whose ``next_run_at``
is due.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

VALID_CADENCES = ("daily", "weekdays")


def valid_timezone(tz: str) -> bool:
    try:
        ZoneInfo(tz)
        return True
    except Exception:  # noqa: BLE001 - any lookup failure means "not a valid IANA tz"
        return False


def compute_next_run(hour: int, minute: int, tz: str, cadence: str, after: datetime) -> str:
    """Next UTC ISO instant (strictly after ``after``) at ``hour:minute`` local time.

    ``after`` should be timezone-aware (assumed UTC if naive). ``cadence`` is
    ``"daily"`` or ``"weekdays"`` (Mon–Fri). Raises ValueError on invalid inputs."""
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("hour must be 0-23 and minute 0-59")
    if cadence not in VALID_CADENCES:
        raise ValueError(f"cadence must be one of {VALID_CADENCES}")
    try:
        zone = ZoneInfo(tz)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"unknown timezone: {tz}") from exc

    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    local = after.astimezone(zone)
    candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    if cadence == "weekdays":
        while candidate.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
            candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc).isoformat()
