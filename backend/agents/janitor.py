"""Janitor: a conservative, live cleanup sweep in a disposable checkout."""
from __future__ import annotations

import asyncio
import os
from contextlib import nullcontext
from pathlib import Path
from time import perf_counter

from backend.agents.base import AgentResult, Replay, codex_reasoning, reasoning_from_operation
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.repository import checkout_public_repo, live_repositories_enabled
from backend.reasoning import reason


class Janitor:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None, repo_path: Path | None = None) -> AgentResult:
        # Janitor's only real work is a Codex edit, so when Codex is not permitted
        # for this request (non-founder on the hosted deploy) it stays on the clean
        # cached replay rather than spending the founder's credits.
        if allow_codex is False:
            return self._cached_result()
        if self._live_enabled():
            try:
                return await self._run_live(repo_url, github_token, openai_key, repo_path)
            except Exception as exc:
                return self._cached_result(f"Live Janitor unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        # Codex CLI (ChatGPT login) supplies both the cleanup and reasoning; no API key required.
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and CodexClient.enabled()

    async def _run_live(self, repo_url: str, github_token: str | None = None, openai_key: str | None = None, repo_path: Path | None = None) -> AgentResult:
        # Reuse the orchestrator's shared checkout when supplied; else clone our own.
        checkout = nullcontext(repo_path) if repo_path is not None else checkout_public_repo(repo_url, github_token)
        with checkout as repo_path:
            codex_started = perf_counter()
            try:
                operation = await asyncio.to_thread(self.codex.propose, "Find behavior-preserving dead code, unused imports, and orphaned environment variables. Make one smallest focused cleanup change, run relevant tests, and do not push, commit, or merge.", repo_path=repo_path)
            except RuntimeError as exc:
                operation = self._unavailable_operation(str(exc))
            codex_ms = int((perf_counter() - codex_started) * 1000)
        findings = [{"file": path, "symbol": None, "kind": self._kind(operation.diff)} for path in operation.files]
        reasoning_started = perf_counter()
        developer = "You are Umbra Janitor. Explain only the concrete cleanup diff and its expected behavior-preserving risk. Do not invent files or symbols."
        user = f"Codex summary:\n{operation.summary}\nChanged files: {operation.files}\nDiff:\n{operation.diff}"
        try:
            analysis = await asyncio.to_thread(reason, "work", developer, user, None, openai_key)
            reasoning, reasoning_provider = analysis.text, analysis.provider
        except RuntimeError as exc:
            # Responses API unavailable (the codex-only deploy): reuse Codex's own
            # explanation of the cleanup — one call instead of a second analyze —
            # and only fall back to a dedicated analyze if propose gave nothing usable.
            reused = reasoning_from_operation(operation)
            if reused:
                reasoning, reasoning_provider = reused
            else:
                reasoning, reasoning_provider = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
        return AgentResult("janitor", f"Live Janitor produced {len(operation.files)} changed files.", findings, Replay("janitor", operation.prompt, operation.diff, operation.summary, reasoning, {"codex_ms": codex_ms, "reasoning_ms": int((perf_counter() - reasoning_started) * 1000)}, {"engineering": operation.provider, "reasoning": reasoning_provider}))

    @staticmethod
    def _kind(diff: str) -> str:
        lowered = diff.lower()
        if "import " in lowered:
            return "unused_import"
        if "function" in lowered or "def " in lowered:
            return "unused_function"
        return "cleanup"

    def _cached_result(self, note: str | None = None) -> AgentResult:
        findings = load_demo_cache()["dead_code"]
        # No checkout exists here, so `propose()` only returns a stub in demo mode;
        # on the live service (UMBRA_ENABLE_CODEX_CLI=true) it raises for lack of a
        # repo, so fall back to the honest cached replay instead of crashing.
        operation = self.codex.propose("Sweep for behavior-preserving cleanup.") if not note and os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true" else self.codex.cached_fallback("Sweep for behavior-preserving cleanup.", note=note or "Cached Janitor replay; no live model or CLI call was made.")
        return AgentResult("janitor", "Cached Janitor replay.", findings, Replay("janitor", operation.prompt, operation.diff, operation.summary, note or "Demo reasoning replayed from cache; no model or Codex request was made.", {"codex_ms": 0, "reasoning_ms": 0}, {"engineering": "cache-fallback" if note else operation.provider, "reasoning": "demo-cache"}))

    @staticmethod
    def _unavailable_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime
        return CodexOperation("Cleanup sweep", f"Codex CLI unavailable: {error}", "", None, [], "unavailable", datetime.now(UTC).isoformat(), error=error)
