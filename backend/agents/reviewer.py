"""Reviewer: real PR diff review, deterministic risk, and GPT synthesis."""
from __future__ import annotations

import asyncio
import os
from time import perf_counter
from typing import Any

from backend.agents.base import CODEX_HOST_NOTE, AgentResult, Replay, codex_reasoning, reasoning_from_operation
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.github import fetch_pull_request, latest_open_pull_request
from backend.integrations.repository import checkout_public_repo, cloud_scan_enabled, live_repositories_enabled
from backend.reasoning import reason
from backend.scoring import RiskInputs, risk_score


class Reviewer:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, diff: str = "", pr_number: int | None = None, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        if self._live_enabled():
            try:
                number = pr_number or await asyncio.to_thread(latest_open_pull_request, repo_url)
                if number is None:
                    return self._cached_result("No open pull request was available for live review.")
                return await self._run_live(repo_url, number, github_token, openai_key, allow_codex)
            except Exception as exc:
                return self._cached_result(f"Live Reviewer unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        # Codex CLI (ChatGPT login) supplies both review and reasoning; no API key required.
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and (CodexClient.enabled() or cloud_scan_enabled())

    async def _run_live(self, repo_url: str, pr_number: int, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        started = perf_counter()
        pull = await asyncio.to_thread(fetch_pull_request, repo_url, pr_number)
        changed_files: list[dict[str, Any]] = pull["changed_files"]
        diff = str(pull["diff"])
        paths = [str(item["file"]) for item in changed_files]
        inputs = RiskInputs(
            files_changed=len(paths), blast_radius=max(0, min(5, len(paths) // 2)),
            missing_tests=int(not any("test" in path.lower() for path in paths)),
            touches_auth=any(any(word in path.lower() for word in ("auth", "session", "permission")) for path in paths),
            touches_payments=any(any(word in path.lower() for word in ("payment", "billing", "checkout")) for path in paths),
        )
        score = risk_score(inputs)
        fetch_ms = int((perf_counter() - started) * 1000)
        with checkout_public_repo(repo_url, github_token) as repo_path:
            codex_started = perf_counter()
            if allow_codex is False:
                operation = self._unavailable_operation(CODEX_HOST_NOTE)
            else:
                try:
                    operation = self.codex.propose(
                        f"Review PR #{pr_number} ({pull['title']}). Read this diff and identify concrete regressions, security risks, and missing tests. Do not edit any files.\n\n{diff}",
                        repo_path=repo_path, read_only=True,
                    )
                except RuntimeError as exc:
                    operation = self._unavailable_operation(str(exc))
            codex_ms = int((perf_counter() - codex_started) * 1000)
        reasoning_started = perf_counter()
        developer = "You are Umbra Reviewer. Based only on the supplied PR diff and Codex notes, give a concise blast-radius, missing-test, security, and merge-recommendation assessment. Do not invent file paths or line references."
        user = f"Risk score: {score}/100\nChanged files: {paths}\nCodex notes: {operation.summary}\nDiff:\n{diff}"
        try:
            analysis = await asyncio.to_thread(reason, "deep", developer, user, None, openai_key)
            reasoning, reasoning_provider = analysis.text, analysis.provider
        except RuntimeError as exc:
            # Responses API unavailable: the read-only Codex pass above already IS
            # the review, so reuse it as the reasoning (one call) instead of a
            # second analyze. Non-founders get the honest "add your key" nudge.
            reused = reasoning_from_operation(operation)
            if reused:
                reasoning, reasoning_provider = reused
            elif allow_codex is False:
                reasoning, reasoning_provider = f"GPT-5.6 reasoning unavailable: {exc}. Add your own OpenAI key to unlock live reasoning here.", "unavailable"
            else:
                reasoning, reasoning_provider = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
        finding = {"risk_score": score, "severity": "critical" if score >= 85 else "high" if score >= 70 else "medium" if score >= 40 else "low", "blast_radius": reasoning, "missing_tests": "Missing test coverage in changed paths" if inputs.missing_tests else "Test path changed", "recommendation": "needs discussion" if score >= 70 else "add tests first" if inputs.missing_tests else "merge after human review"}
        return AgentResult("reviewer", f"Live review of PR #{pr_number}: deterministic Risk Score {score}/100.", [finding], Replay("reviewer", operation.prompt, operation.diff, operation.summary, reasoning, {"fetch_ms": fetch_ms, "codex_ms": codex_ms, "reasoning_ms": int((perf_counter() - reasoning_started) * 1000)}, {"review": operation.provider, "reasoning": reasoning_provider, "risk": "deterministic"}))

    def _cached_result(self, note: str | None = None) -> AgentResult:
        cached = load_demo_cache()
        operation = self.codex.cached_fallback("Review a pull request diff without editing.", note=note or "Cached Reviewer replay; no live PR, model, or CLI request was made.") if note else self.codex.propose("Review a pull request diff without editing.")
        providers = {"review": "cache-fallback" if note else operation.provider, "reasoning": "demo-cache", "risk": "deterministic"}
        finding = {"risk_score": 45, "severity": "medium", "blast_radius": "Cached replay only.", "missing_tests": "unknown", "recommendation": "human review required"}
        return AgentResult("reviewer", "Cached Reviewer replay.", [finding], Replay("reviewer", operation.prompt, operation.diff, operation.summary, "Demo reasoning replayed from cache; no model or Codex request was made." if not note else note, {"codex_ms": 0, "reasoning_ms": 0}, providers))

    @staticmethod
    def _unavailable_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime
        return CodexOperation("Review PR", f"Codex CLI unavailable: {error}", "", None, [], "unavailable", datetime.now(UTC).isoformat(), error=error)
