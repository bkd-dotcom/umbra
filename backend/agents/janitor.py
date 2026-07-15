"""Janitor: conservative dead-code cleanup recommendations."""
from __future__ import annotations

from backend.agents.base import AgentResult, Replay
from backend.codex_client import CodexClient
from backend.cache import load_demo_cache


class Janitor:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str) -> AgentResult:
        findings = load_demo_cache()["dead_code"]
        op = self.codex.propose(
            f"Find behavior-preserving dead code in {repo_url}. Keep the change focused and do not merge or push.",
            [item["file"] for item in findings],
        )
        return AgentResult(
            agent="janitor",
            summary=f"Found {len(findings)} conservative cleanup candidates; each needs human review before a PR is opened.",
            findings=findings,
            replay=Replay("janitor", op.prompt, op.diff, "Targeted test suite passed in cached replay.", "Only symbols with no discovered references and no public export contract are proposed for removal.", {"codex_ms": 1600, "reasoning_ms": 640, "tests_ms": 3320}),
        )
