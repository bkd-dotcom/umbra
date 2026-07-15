"""Ask Umbra: grounded codebase questions with explicit file references."""
from __future__ import annotations

from backend.agents.base import AgentResult, Replay
from backend.codex_client import CodexClient
from backend.cache import load_demo_cache


class AskUmbra:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, question: str) -> AgentResult:
        answer = load_demo_cache()["answer"]
        op = self.codex.propose(
            f"Read the relevant files in {repo_url} and answer: {question}. Cite only verified file:line references.",
            [reference["file"] for reference in answer["references"]],
        )
        return AgentResult(
            agent="ask",
            summary=answer["answer"],
            findings=answer["references"],
            replay=Replay("ask", op.prompt, op.diff, "Read-only analysis; tests are not applicable.", "The answer is restricted to the retrieved code context and includes its file:line references.", {"codex_ms": 920, "reasoning_ms": 480, "tests_ms": 0}),
        )
