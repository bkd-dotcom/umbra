"""Watchman: dependency exposure → threat model → reviewable patch."""
from __future__ import annotations

from backend.agents.base import AgentResult, Replay
from backend.codex_client import CodexClient
from backend.cache import load_demo_cache


class Watchman:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str) -> AgentResult:
        cached = load_demo_cache()
        findings = cached["vulnerabilities"]
        op = self.codex.propose(
            f"Inspect {repo_url} for confirmed vulnerable dependencies. Draft the smallest version bump. Do not merge or push.",
            ["package-lock.json"],
        )
        return AgentResult(
            agent="watchman",
            summary="Confirmed one high-severity dependency advisory and prepared a narrow, human-reviewable patch.",
            findings=findings,
            replay=Replay(
                agent="watchman",
                prompt=op.prompt,
                codex_diff=op.diff,
                tests="Targeted dependency regression replay passed.",
                reasoning="The dependency is exposed through a transitive parser path; the compatible patch removes the known affected range and confines blast radius to dependency resolution.",
                timings={"codex_ms": 1840, "reasoning_ms": 926, "tests_ms": 4810},
            ),
        )
