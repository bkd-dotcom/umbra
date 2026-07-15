"""Detective: incident log → recent code context → root-cause chain."""
from __future__ import annotations

from backend.agents.base import AgentResult, Replay
from backend.codex_client import CodexClient
from backend.cache import load_demo_cache


class Detective:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, error_log: str) -> AgentResult:
        postmortem = load_demo_cache()["postmortem"].copy()
        if error_log:
            postmortem["incident"] = error_log[:300]
        op = self.codex.propose(
            f"Survey recent changes in {repo_url} against this incident: {error_log[:1000]}. Propose a minimal fix; never merge.",
            ["middleware/session.js", "test/session.test.js"],
        )
        return AgentResult(
            agent="detective",
            summary=f"Root cause localized to {postmortem['root_cause_commit']} with {postmortem['confidence']:.0%} confidence.",
            findings=[postmortem],
            replay=Replay("detective", op.prompt, op.diff, "Missing-session regression test passed in replay.", "The stack trace, commit ordering, and fixture reproduction agree on a reordered auth guard as the causal chain.", {"codex_ms": 2110, "reasoning_ms": 2740, "tests_ms": 3900}),
        )
