"""Watchman: OSV scan → GPT threat analysis → Codex patch in a disposable clone."""
from __future__ import annotations

import asyncio
import json
import os
from time import perf_counter
from typing import Any

from backend.agents.base import CODEX_HOST_NOTE, AgentResult, Replay, codex_reasoning, reasoning_from_operation
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.dependencies import discover_dependencies
from backend.integrations.osv import OSVClient, severity_from_osv
from backend.integrations.repository import checkout_public_repo, cloud_scan_enabled, live_repositories_enabled
from backend.reasoning import reason


class Watchman:
    def __init__(self, codex: CodexClient | None = None, osv: OSVClient | None = None) -> None:
        self.codex = codex or CodexClient()
        self.osv = osv or OSVClient()

    async def run(self, repo_url: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        if self._live_enabled():
            try:
                return await self._run_live(repo_url, github_token, openai_key, allow_codex)
            except Exception as exc:
                # Availability must not masquerade as a successful live scan.
                return self._cached_result(f"Live Watchman unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        # No OPENAI_API_KEY requirement: the Codex CLI authenticates via ChatGPT
        # login and provides both the engineering work and the reasoning
        # fallback, so Umbra runs live on Codex credits alone.
        return (
            os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true"
            and live_repositories_enabled()
            and (CodexClient.enabled() or cloud_scan_enabled())
        )

    async def _run_live(self, repo_url: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        started = perf_counter()
        with checkout_public_repo(repo_url, github_token) as repo_path:
            dependencies = discover_dependencies(repo_path)
            advisory_lists = await asyncio.gather(
                *(self.osv.query(item["name"], item["version"], item["ecosystem"]) for item in dependencies),
                return_exceptions=True,
            )
            findings = self._normalize_advisories(dependencies, advisory_lists)
            scan_ms = int((perf_counter() - started) * 1000)
            # Engineering pass first, so on the keyless fast path its own
            # explanation can double as the reasoning (one Codex call, not two).
            codex_started = perf_counter()
            if allow_codex is False:
                operation = self._unavailable_codex_operation(CODEX_HOST_NOTE)
            else:
                try:
                    operation = self.codex.propose(
                        "Inspect confirmed OSV advisories. If a compatible patched version exists, make the smallest dependency-only fix, run focused tests, and leave the working tree reviewable.",
                        repo_path=repo_path,
                    )
                except RuntimeError as exc:
                    operation = self._unavailable_codex_operation(str(exc))
            codex_ms = int((perf_counter() - codex_started) * 1000)
            reasoning_started = perf_counter()
            developer = "You are Umbra Watchman. Assess concrete OSV advisories. Explain severity, likely blast radius, attack path, OWASP mapping, and the smallest safe remediation. Do not invent facts."
            user = json.dumps({"repository": repo_url, "dependencies_checked": dependencies, "advisories": findings}, indent=2)
            reasoning_text, reasoning_provider = await self._reason(developer, user, openai_key, allow_codex, operation)
            reasoning_ms = int((perf_counter() - reasoning_started) * 1000)
        summary = f"Live Watchman checked {len(dependencies)} manifest dependencies and found {len(findings)} OSV advisories. {reasoning_text}"
        return AgentResult(
            agent="watchman",
            summary=summary,
            findings=findings,
            replay=Replay(
                agent="watchman", prompt=operation.prompt, codex_diff=operation.diff,
                tests=operation.summary, reasoning=reasoning_text,
                timings={"osv_ms": scan_ms, "codex_ms": codex_ms, "reasoning_ms": reasoning_ms},
                providers={"vulnerabilities": "osv.dev", "reasoning": reasoning_provider, "engineering": operation.provider},
            ),
            dependencies=[
                {**dep, "vulnerable": any(f["package"] == dep["name"] and f["version"] == dep["version"] for f in findings)}
                for dep in dependencies
            ],
        )

    async def _reason(self, developer: str, user: str, openai_key: str | None, allow_codex: bool | None, operation: CodexOperation) -> tuple[str, str]:
        """Live reasoning via the caller's OpenAI key (BYO) or server key; on failure,
        reuse the Codex remediation's own explanation (one call) when available, else
        fall back to a dedicated Codex analyze — but only when Codex is permitted."""
        try:
            analysis = await asyncio.to_thread(reason, "deep", developer, user, None, openai_key)
            return analysis.text, analysis.provider
        except RuntimeError as exc:
            reused = reasoning_from_operation(operation)
            if reused:
                return reused
            if allow_codex is False:
                return f"GPT-5.6 reasoning unavailable: {exc}. Add your own OpenAI key to unlock live reasoning here.", "unavailable"
            return await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)

    @staticmethod
    def _unavailable_codex_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime

        return CodexOperation(
            prompt="Inspect confirmed OSV advisories.", summary=f"Codex CLI unavailable: {error}",
            diff="", tests_passed=None, files=[], provider="unavailable",
            created_at=datetime.now(UTC).isoformat(), error=error,
        )

    @staticmethod
    def _normalize_advisories(dependencies: list[dict[str, str]], responses: list[Any]) -> list[dict[str, str]]:
        findings: list[dict[str, str]] = []
        for dependency, response in zip(dependencies, responses, strict=True):
            if isinstance(response, Exception):
                continue
            for advisory in response:
                findings.append({
                    "package": dependency["name"], "version": dependency["version"],
                    "cve": advisory.get("id", "OSV-UNKNOWN"), "severity": severity_from_osv(advisory),
                    "owasp": "A06: Vulnerable and Outdated Components",
                    "summary": advisory.get("summary") or advisory.get("details", "No OSV summary supplied.")[:500],
                })
        return findings

    def _cached_result(self, fallback_note: str | None = None) -> AgentResult:
        cached = load_demo_cache()
        findings = cached["vulnerabilities"]
        operation = (
            self.codex.cached_fallback("Inspect dependency advisories and draft the smallest safe version bump.", ["package-lock.json"], fallback_note or "Demo mode")
            if fallback_note
            else self.codex.propose("Inspect dependency advisories and draft the smallest safe version bump.", ["package-lock.json"])
        )
        reason_note = "Demo reasoning is replayed from verified cache; no model or Codex request was made."
        if fallback_note:
            reason_note = f"{fallback_note}. Returning clearly labelled cached demo findings."
        return AgentResult(
            agent="watchman",
            summary="Cached Watchman replay: one seeded high-severity dependency advisory.",
            findings=findings,
            replay=Replay(
                agent="watchman", prompt=operation.prompt, codex_diff=operation.diff,
                tests="Cached test replay; no live test command was run.", reasoning=reason_note,
                timings={"codex_ms": 0, "reasoning_ms": 0, "tests_ms": 0},
                providers={"vulnerabilities": "demo-cache", "reasoning": "demo-cache", "engineering": operation.provider},
            ),
        )
