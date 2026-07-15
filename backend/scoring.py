"""Deterministic scoring primitives shared by every Umbra agent."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


SEVERITY_WEIGHTS = {"critical": 28, "high": 16, "medium": 8, "low": 3}


@dataclass(frozen=True)
class RiskInputs:
    files_changed: int = 0
    blast_radius: int = 0
    missing_tests: int = 0
    touches_auth: bool = False
    touches_payments: bool = False
    pattern_violations: int = 0


def risk_score(inputs: RiskInputs) -> int:
    """Return the reviewer formula documented in .umbra/nightshift.md."""
    score = (
        inputs.files_changed * 5
        + inputs.blast_radius * 15
        + inputs.missing_tests * 20
        + int(inputs.touches_auth) * 25
        + int(inputs.touches_payments) * 25
        + inputs.pattern_violations * 10
    )
    return max(0, min(100, score))


def umbra_score(
    vulnerabilities: Iterable[dict[str, object]] = (),
    secrets: int = 0,
    dead_code: int = 0,
    missing_docs: int = 0,
    test_health: int = 100,
) -> int:
    """Return a stable 0–100 health score; higher means safer and healthier."""
    severity_penalty = sum(SEVERITY_WEIGHTS.get(str(item.get("severity", "low")).lower(), 3) for item in vulnerabilities)
    penalty = severity_penalty + secrets * 22 + min(dead_code * 2, 16) + min(missing_docs, 10)
    # Tests can contribute up to a 15 point loss if a suite is unhealthy.
    penalty += round((100 - max(0, min(100, test_health))) * 0.15)
    return max(0, min(100, 100 - penalty))

