"""Deterministic signature-feature helpers for the offline Umbra demo."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass


SECRET_PATTERNS: dict[str, re.Pattern[str]] = {
    "OpenAI API key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
}


@dataclass(frozen=True)
class SecretFinding:
    file: str
    line: int
    kind: str
    confidence: float


def scan_secrets(text: str, file: str = "unknown") -> list[dict[str, object]]:
    """Find likely credentials without retaining or returning their values."""
    findings: list[dict[str, object]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if any(marker in file.lower() for marker in ("fixture", "example", ".sample")):
            continue
        for kind, pattern in SECRET_PATTERNS.items():
            if pattern.search(line):
                findings.append(asdict(SecretFinding(file, line_number, kind, 0.92)))
    return findings


def roi_estimate(findings: int, review_minutes: int = 18, engineer_rate: int = 120) -> dict[str, int]:
    """Show a conservative, transparent estimate rather than a marketing claim."""
    hours_saved = max(0, findings) * review_minutes // 60
    return {"findings_automated": max(0, findings), "hours_saved": hours_saved, "estimated_value_usd": hours_saved * engineer_rate}


def dependency_galaxy(deps: list[dict[str, object]] | None = None, root: str = "repository") -> dict[str, object]:
    """Build a dependency graph for the dashboard map.

    With ``deps`` (Watchman's real discovered dependencies, each optionally
    flagged ``vulnerable``) the graph reflects the actual repo — vulnerable
    packages are grouped ``risk`` so the UI can light them up. Without it, the
    seeded demo shape is returned so the offline demo is unchanged.
    """
    if not deps:
        return {
            "nodes": [{"id": "express", "group": "app"}, {"id": "router", "group": "internal"}, {"id": "lodash", "group": "risk"}, {"id": "body-parser", "group": "dependency"}],
            "links": [{"source": "express", "target": "router"}, {"source": "express", "target": "body-parser"}, {"source": "body-parser", "target": "lodash"}],
        }
    nodes: list[dict[str, object]] = [{"id": root, "group": "app"}]
    links: list[dict[str, object]] = []
    seen: set[str] = {root}
    for dep in deps[:60]:  # bound the graph so a huge lockfile stays legible
        name = str(dep.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        nodes.append({"id": name, "group": "risk" if dep.get("vulnerable") else "dependency"})
        links.append({"source": root, "target": name})
    return {"nodes": nodes, "links": links}


def kill_chain() -> list[dict[str, str]]:
    return [
        {"stage": "Discovery", "detail": "OSV advisory matched a resolved dependency."},
        {"stage": "Exposure", "detail": "Parser path brings the vulnerable package into request handling."},
        {"stage": "Mitigation", "detail": "Codex drafted a constrained patched-version update."},
        {"stage": "Evidence", "detail": "Targeted regression replay passed; human review remains required."},
    ]
