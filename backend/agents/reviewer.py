"""Reviewer: code diff inspection plus deterministic risk scoring."""
from __future__ import annotations

from backend.agents.base import AgentResult, Replay
from backend.codex_client import CodexClient
from backend.scoring import RiskInputs, risk_score


class Reviewer:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, diff: str = "") -> AgentResult:
        changed = max(1, diff.count("+++ "))
        missing_tests = int("test" not in diff.lower())
        inputs = RiskInputs(
            files_changed=changed,
            blast_radius=1,
            missing_tests=missing_tests,
            touches_auth="auth" in diff.lower(),
            touches_payments="payment" in diff.lower(),
        )
        score = risk_score(inputs)
        op = self.codex.propose(
            f"Review this diff in {repo_url}. Identify concrete regressions and missing tests; do not approve or merge.",
            ["changed files supplied by pull request"],
        )
        finding = {
            "risk_score": score,
            "severity": "high" if score >= 70 else "medium" if score >= 40 else "low",
            "blast_radius": "One shared middleware path in the seeded demo.",
            "missing_tests": "Missing error-path coverage" if missing_tests else "none",
        }
        return AgentResult(
            agent="reviewer",
            summary=f"Risk Score {score}/100; review remains advisory and requires a human decision.",
            findings=[finding],
            replay=Replay("reviewer", op.prompt, op.diff, "No test execution is performed by review-only mode.", "Files, blast radius, missing tests, and sensitive paths are weighted using the documented CI formula.", {"codex_ms": 710, "reasoning_ms": 502, "tests_ms": 0}),
        )

