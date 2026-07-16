"""Detective: local Git history, Codex repair survey, and xhigh root-cause reasoning."""
from __future__ import annotations

import asyncio
import os
import re
from time import perf_counter
from typing import Any

from backend.agents.base import CODEX_HOST_NOTE, AgentResult, Replay, codex_reasoning
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.history import recent_history
from backend.integrations.repository import checkout_public_repo, cloud_scan_enabled, live_repositories_enabled
from backend.reasoning import reason


class Detective:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, error_log: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        if self._live_enabled():
            try:
                return await self._run_live(repo_url, error_log, github_token, openai_key, allow_codex)
            except Exception as exc:
                return self._cached_result(f"Live Detective unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        # Codex CLI (ChatGPT login) supplies both the survey and reasoning; no API key required.
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and (CodexClient.enabled() or cloud_scan_enabled())

    async def _run_live(self, repo_url: str, error_log: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        with checkout_public_repo(repo_url, github_token) as repo_path:
            history_started = perf_counter()
            history = recent_history(repo_path)
            history_ms = int((perf_counter() - history_started) * 1000)
            codex_started = perf_counter()
            if allow_codex is False:
                operation = self._unavailable_operation(CODEX_HOST_NOTE)
            else:
                try:
                    operation = self.codex.propose(f"Investigate this incident against recent local commits and propose the smallest safe fix. Error log:\n{error_log}\nRecent history:\n{history}", repo_path=repo_path)
                except RuntimeError as exc:
                    operation = self._unavailable_operation(str(exc))
            codex_ms = int((perf_counter() - codex_started) * 1000)
        reasoning_started = perf_counter()
        developer = "You are Umbra Detective. Build a root-cause chain from the error log, verified local history, and Codex survey. Mention a commit SHA only if it is in the supplied history. Do not fabricate files, lines, or evidence."
        user = f"Error log:\n{error_log}\nHistory:\n{history}\nCodex survey:\n{operation.summary}\nDiff:\n{operation.diff}"
        try:
            analysis = await asyncio.to_thread(reason, "deep", developer, user, "xhigh", openai_key)
            reasoning, reasoning_provider = analysis.text, analysis.provider
        except RuntimeError as exc:
            if allow_codex is False:
                reasoning, reasoning_provider = f"GPT-5.6 reasoning unavailable: {exc}. Add your own OpenAI key to unlock live reasoning here.", "unavailable"
            else:
                reasoning, reasoning_provider = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
        postmortem = self._postmortem(error_log, history, operation, reasoning)
        return AgentResult("detective", f"Live Detective surveyed {len(history)} local commits.", [postmortem], Replay("detective", operation.prompt, operation.diff, operation.summary, reasoning, {"history_ms": history_ms, "codex_ms": codex_ms, "reasoning_ms": int((perf_counter() - reasoning_started) * 1000)}, {"history": "local-git", "reasoning": reasoning_provider, "engineering": operation.provider}))

    async def stream_events(self, repo_url: str, error_log: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None):
        """Fast SSE path: verified local history (fast) + streamed root-cause
        reasoning. Skips the ``codex.propose`` repair survey (its fields aren't
        rendered in the Detective panel) and drops reasoning effort from ``xhigh``
        to ``medium`` — together the two biggest latency costs. Yields
        ``{"type": "status"}``, then ``{"type": "text", "chunk": ...}`` deltas, then
        one ``{"type": "result", "result": <postmortem>}``.
        """
        if not self._live_enabled():
            yield {"type": "text", "chunk": "Demo Detective stream replayed from cache; no model or Codex request was made."}
            yield {"type": "result", "result": {**load_demo_cache()["postmortem"], "source": "demo-cache"}}
            return
        try:
            with checkout_public_repo(repo_url, github_token) as repo_path:
                history = recent_history(repo_path)
        except Exception as exc:  # noqa: BLE001 — never leak a stack trace to the stream
            yield {"type": "text", "chunk": f"Detective live stream unavailable: {exc}"}
            return
        hist_text = "\n".join(f"{str(h['sha'])[:10]}: {h['subject']}" for h in history) or "(no local history available)"
        yield {"type": "status", "message": f"Surveyed {len(history)} verified local commits — reasoning…"}
        developer = "You are Umbra Detective. Build a root-cause chain from the error log and the verified local commit history. Cite a commit SHA only if it appears in the supplied history. Never fabricate files, lines, commits, or evidence."
        user = f"Error log:\n{error_log}\n\nVerified recent commit history:\n{hist_text}"
        iterator = reason_stream("deep", developer, user, "medium", openai_key)
        reasoning, streamed = "", False
        try:
            while True:
                done, chunk = await asyncio.to_thread(self._next, iterator)
                if done:
                    break
                streamed = True
                reasoning += chunk
                yield {"type": "text", "chunk": chunk}
        except RuntimeError as exc:
            if not streamed:
                if allow_codex is False:
                    reasoning = f"GPT-5.6 reasoning unavailable: {exc}. Add your own OpenAI key to unlock live reasoning here."
                else:
                    reasoning, _ = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
                yield {"type": "text", "chunk": reasoning}
        yield {"type": "result", "result": self._stream_postmortem(error_log, history, reasoning)}

    @staticmethod
    def _next(iterator) -> tuple[bool, str]:
        try:
            return False, next(iterator)
        except StopIteration:
            return True, ""

    @staticmethod
    def _stream_postmortem(error_log: str, history: list[dict[str, object]], reasoning: str) -> dict[str, Any]:
        known = {str(item["sha"]) for item in history}
        mentions = re.findall(r"\b[0-9a-fA-F]{7,40}\b", reasoning)
        culprit = next((sha for sha in mentions if any(commit.startswith(sha) or sha.startswith(commit) for commit in known)), "unconfirmed")
        timeline = [f"{str(item['sha'])[:10]}: {item['subject']}" for item in history[:5]]
        return {"incident": error_log[:300], "root_cause_commit": culprit, "confidence": 0.75 if culprit != "unconfirmed" else 0.0, "timeline": timeline, "explanation": reasoning, "blast_radius": "Inspect the changed modules in the verified commit history.", "suggested_fix": "See the reasoning above.", "reasoning_chain": ["Surveyed verified local Git history.", "Streamed GPT-5.6 root-cause reasoning.", "Validated any cited commit against the verified history."], "source": "live-detective"}

    @staticmethod
    def _postmortem(error_log: str, history: list[dict[str, object]], operation: CodexOperation, reasoning: str) -> dict[str, Any]:
        known = {str(item["sha"]) for item in history}
        mentions = re.findall(r"\b[0-9a-fA-F]{7,40}\b", reasoning + "\n" + operation.summary)
        culprit = next((sha for sha in mentions if any(commit.startswith(sha) or sha.startswith(commit) for commit in known)), "unconfirmed")
        timeline = [f"{str(item['sha'])[:10]}: {item['subject']}" for item in history[:5]]
        return {"incident": error_log[:300], "root_cause_commit": culprit, "confidence": 0.75 if culprit != "unconfirmed" else 0.0, "timeline": timeline, "explanation": reasoning, "blast_radius": "Unconfirmed; inspect the changed modules in the verified commit history.", "suggested_fix": operation.summary, "reasoning_chain": ["Surveyed verified local Git history.", "Ran Codex against the disposable checkout.", "Validated any cited commit against the history before returning it."]}

    def _cached_result(self, note: str | None = None) -> AgentResult:
        postmortem = load_demo_cache()["postmortem"].copy()
        # No checkout here: `propose()` only returns a stub in demo mode; on the live
        # service it would raise, so use the honest cached replay instead.
        operation = self.codex.propose("Investigate an incident from local Git history.") if not note and os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true" else self.codex.cached_fallback("Investigate an incident from local Git history.", note=note or "Cached Detective replay; no live model or CLI call was made.")
        providers = {"history": "demo-cache", "reasoning": "demo-cache", "engineering": "cache-fallback" if note else operation.provider}
        return AgentResult("detective", "Cached Detective replay.", [postmortem], Replay("detective", operation.prompt, operation.diff, operation.summary, note or "Demo reasoning replayed from cache; no model or Codex request was made.", {"history_ms": 0, "codex_ms": 0, "reasoning_ms": 0}, providers))

    @staticmethod
    def _unavailable_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime
        return CodexOperation("Investigate incident", f"Codex CLI unavailable: {error}", "", None, [], "unavailable", datetime.now(UTC).isoformat(), error=error)
