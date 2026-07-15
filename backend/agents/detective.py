"""Detective: local Git history, Codex repair survey, and xhigh root-cause reasoning."""
from __future__ import annotations

import asyncio
import os
import re
from time import perf_counter
from typing import Any

from backend.agents.base import AgentResult, Replay, codex_reasoning
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.history import recent_history
from backend.integrations.repository import checkout_public_repo, cloud_scan_enabled, live_repositories_enabled
from backend.reasoning import reason


class Detective:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, error_log: str) -> AgentResult:
        if self._live_enabled():
            try:
                return await self._run_live(repo_url, error_log)
            except Exception as exc:
                return self._cached_result(f"Live Detective unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        # Codex CLI (ChatGPT login) supplies both the survey and reasoning; no API key required.
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and (CodexClient.enabled() or cloud_scan_enabled())

    async def _run_live(self, repo_url: str, error_log: str) -> AgentResult:
        with checkout_public_repo(repo_url) as repo_path:
            history_started = perf_counter()
            history = recent_history(repo_path)
            history_ms = int((perf_counter() - history_started) * 1000)
            codex_started = perf_counter()
            try:
                operation = self.codex.propose(f"Investigate this incident against recent local commits and propose the smallest safe fix. Error log:\n{error_log}\nRecent history:\n{history}", repo_path=repo_path)
            except RuntimeError as exc:
                operation = self._unavailable_operation(str(exc))
            codex_ms = int((perf_counter() - codex_started) * 1000)
        reasoning_started = perf_counter()
        developer = "You are Umbra Detective. Build a root-cause chain from the error log, verified local history, and Codex survey. Mention a commit SHA only if it is in the supplied history. Do not fabricate files, lines, or evidence."
        user = f"Error log:\n{error_log}\nHistory:\n{history}\nCodex survey:\n{operation.summary}\nDiff:\n{operation.diff}"
        try:
            analysis = await asyncio.to_thread(reason, "deep", developer, user, "xhigh")
            reasoning, reasoning_provider = analysis.text, analysis.provider
        except RuntimeError as exc:
            reasoning, reasoning_provider = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
        postmortem = self._postmortem(error_log, history, operation, reasoning)
        return AgentResult("detective", f"Live Detective surveyed {len(history)} local commits.", [postmortem], Replay("detective", operation.prompt, operation.diff, operation.summary, reasoning, {"history_ms": history_ms, "codex_ms": codex_ms, "reasoning_ms": int((perf_counter() - reasoning_started) * 1000)}, {"history": "local-git", "reasoning": reasoning_provider, "engineering": operation.provider}))

    @staticmethod
    def _postmortem(error_log: str, history: list[dict[str, object]], operation: CodexOperation, reasoning: str) -> dict[str, Any]:
        known = {str(item["sha"]) for item in history}
        mentions = re.findall(r"\b[0-9a-fA-F]{7,40}\b", reasoning + "\n" + operation.summary)
        culprit = next((sha for sha in mentions if any(commit.startswith(sha) or sha.startswith(commit) for commit in known)), "unconfirmed")
        timeline = [f"{str(item['sha'])[:10]}: {item['subject']}" for item in history[:5]]
        return {"incident": error_log[:300], "root_cause_commit": culprit, "confidence": 0.75 if culprit != "unconfirmed" else 0.0, "timeline": timeline, "explanation": reasoning, "blast_radius": "Unconfirmed; inspect the changed modules in the verified commit history.", "suggested_fix": operation.summary, "reasoning_chain": ["Surveyed verified local Git history.", "Ran Codex against the disposable checkout.", "Validated any cited commit against the history before returning it."]}

    def _cached_result(self, note: str | None = None) -> AgentResult:
        postmortem = load_demo_cache()["postmortem"].copy()
        operation = self.codex.cached_fallback("Investigate an incident from local Git history.", note=note or "Cached Detective replay; no live model or CLI call was made.") if note else self.codex.propose("Investigate an incident from local Git history.")
        providers = {"history": "demo-cache", "reasoning": "demo-cache", "engineering": "cache-fallback" if note else operation.provider}
        return AgentResult("detective", "Cached Detective replay.", [postmortem], Replay("detective", operation.prompt, operation.diff, operation.summary, note or "Demo reasoning replayed from cache; no model or Codex request was made.", {"history_ms": 0, "codex_ms": 0, "reasoning_ms": 0}, providers))

    @staticmethod
    def _unavailable_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime
        return CodexOperation("Investigate incident", f"Codex CLI unavailable: {error}", "", None, [], "unavailable", datetime.now(UTC).isoformat(), error=error)
