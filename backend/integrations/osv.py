"""Small OSV.dev client with an explicit offline fallback boundary."""
from __future__ import annotations

import os
from typing import Any

import httpx


def severity_from_osv(advisory: dict[str, Any]) -> str:
    """Classify OSV CVSS vectors before less-specific database metadata."""
    for entry in advisory.get("severity") or []:
        vector = str(entry.get("score", "")).upper()
        impacts = sum(token in vector for token in ("/C:H", "/I:H", "/A:H"))
        if impacts == 3:
            return "critical"
        if impacts >= 2:
            return "high"
        if impacts == 1 or "/AV:N" in vector:
            return "medium"
    database_specific = advisory.get("database_specific") or {}
    return str(database_specific.get("severity", "unknown")).lower()


class OSVClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("OSV_API_BASE", "https://api.osv.dev/v1")).rstrip("/")

    async def query(self, package: str, version: str, ecosystem: str = "npm") -> list[dict[str, Any]]:
        if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
            return []
        payload = {"package": {"name": package, "ecosystem": ecosystem}, "version": version}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(f"{self.base_url}/query", json=payload)
            response.raise_for_status()
            return response.json().get("vulns", [])
