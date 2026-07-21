"""Single source of truth for the judge-facing public-repo catalog.

Both the API (`/api/admit/public-live/repos`) and the frontend render from THIS
catalog, so the UI can never offer a "run" button for a repo the backend will
reject. Each entry declares its mode, availability, whether it consumes a quota,
and (for captured entries) the proof id the frontend hydrates.

Modes:
- ``captured``          — a recorded, view-only snapshot (no clone, no Codex, no
                          rate limit). The frontend renders it from bundled proof
                          data and verifies its signed receipt. Judge-safe default.
- ``deterministic_live``— a real clone + live OSV, deterministic executor (no Codex
                          credits). Rate-limited per visitor.
- ``founder_codex``     — a genuine bounded ``codex exec`` (spends credits). Not an
                          anonymous CTA; founder-only / strict daily cap.
- ``unavailable``       — declared but disabled (with a reason); never runnable.
"""
from __future__ import annotations

from typing import Any

from backend.codex_client import CodexClient
from backend.integrations.repository import live_repositories_enabled


# Captured, view-only proofs. Only list a repo here if a REAL captured record +
# signed receipt exist in the frontend bundle (frontend/lib/proof-scan.ts). Do not
# invent a capture. Today exactly one genuine capture exists: CalHacks.
_CAPTURED = [
    {
        "repo_id": "calhacks",
        "repo_url": "https://github.com/Pranav-Karra-3301/calhacks-12",
        "name": "Pranav-Karra-3301/calhacks-12",
        "captured_proof_id": "calhacks",
        "captured_at": "2026-07-17",
    },
]

# Repos enabled for a live deterministic clone (no Codex). One allowlist, shared.
_DETERMINISTIC_LIVE = [
    ("expressjs/express", "expressjs/express"),
    ("pallets/flask", "pallets/flask"),
    ("psf/requests", "psf/requests"),
    ("lodash/lodash", "lodash/lodash"),
    ("axios/axios", "axios/axios"),
]

# The set the live endpoint accepts (canonical "github.com/owner/repo"), derived
# from the same list the catalog advertises — one allowlist, no drift.
DETERMINISTIC_ALLOWLIST: set[str] = {f"github.com/{slug}" for slug, _ in _DETERMINISTIC_LIVE}

# Rate limits (declared here so the catalog can advertise them honestly).
DETERMINISTIC_PER_IP_PER_HOUR = 5
DETERMINISTIC_GLOBAL_PER_HOUR = 40
CODEX_PER_IP_PER_DAY = 1
CODEX_GLOBAL_PER_DAY = 8


def build_catalog() -> dict[str, Any]:
    """The full catalog the API returns and the UI renders from."""
    live_on = live_repositories_enabled()
    codex_on = CodexClient.enabled()

    entries: list[dict[str, Any]] = []

    # 1. Captured (always available — view-only, no infra needed).
    for c in _CAPTURED:
        entries.append({
            "repo_id": c["repo_id"],
            "repo_url": c["repo_url"],
            "name": c["name"],
            "mode": "captured",
            "available": True,
            "disabled_reason": None,
            "consumes_quota": False,
            "captured_proof_id": c["captured_proof_id"],
            "captured_at": c["captured_at"],
        })

    # 2. Deterministic live (real clone + OSV, no Codex). Available only when the
    #    server has live repos enabled; otherwise declared-but-unavailable.
    for slug, name in _DETERMINISTIC_LIVE:
        entries.append({
            "repo_id": f"det:{slug}",
            "repo_url": f"https://github.com/{slug}",
            "name": name,
            "mode": "deterministic_live" if live_on else "unavailable",
            "available": live_on,
            "disabled_reason": None if live_on else "Live repositories are disabled on this server.",
            "consumes_quota": False,  # deterministic runs never spend Codex credits
            "captured_proof_id": None,
        })

    return {
        "entries": entries,
        "limits": {
            "deterministic_per_ip_per_hour": DETERMINISTIC_PER_IP_PER_HOUR,
            "deterministic_global_per_hour": DETERMINISTIC_GLOBAL_PER_HOUR,
            "codex_per_ip_per_day": CODEX_PER_IP_PER_DAY,
            "codex_global_per_day": CODEX_GLOBAL_PER_DAY,
        },
        "codex_available": codex_on,
        "live_enabled": live_on,
        # Back-compat: the old flat shape some callers/tests used.
        "repos": sorted(DETERMINISTIC_ALLOWLIST),
        "per_ip_per_hour": DETERMINISTIC_PER_IP_PER_HOUR,
        "codex_per_ip_per_day": CODEX_PER_IP_PER_DAY,
    }
