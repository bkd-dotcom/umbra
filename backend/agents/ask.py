"""Ask Umbra: grounded read-only retrieval with Responses streaming."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
from contextlib import contextmanager
from time import perf_counter
from typing import AsyncIterator, Iterator

from backend.agents.base import AgentResult, Replay
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.repository import checkout_public_repo, live_repositories_enabled
from backend.reasoning import reason_stream


class AskUmbra:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, question: str) -> AgentResult:
        if self._live_enabled():
            try:
                return await self._run_live(repo_url, question)
            except Exception as exc:
                return self._cached_result(f"Live Ask Umbra unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and CodexClient.enabled() and bool(os.getenv("OPENAI_API_KEY"))

    async def _run_live(self, repo_url: str, question: str) -> AgentResult:
        with checkout_public_repo(repo_url) as repo_path:
            context, references, operation, retrieval_ms, codex_ms = await self._prepare(repo_path, question)
            started = perf_counter()
            try:
                answer = "".join(await self._collect(reason_stream("work", self._developer_prompt(), self._user_prompt(question, context))))
                provider = "responses-api-stream"
            except RuntimeError as exc:
                answer, provider = f"GPT-5.6 reasoning unavailable: {exc}", "unavailable"
            reasoning_ms = int((perf_counter() - started) * 1000)
        return AgentResult("ask", answer, references, Replay("ask", operation.prompt, operation.diff, operation.summary, answer, {"retrieval_ms": retrieval_ms, "codex_ms": codex_ms, "reasoning_ms": reasoning_ms}, {"retrieval": "local-git-grep", "reasoning": provider, "engineering": operation.provider}))

    async def stream(self, repo_url: str, question: str) -> AsyncIterator[str]:
        """Yield grounded text chunks for FastAPI SSE; no demo stream uses network."""
        if not self._live_enabled():
            yield "Demo Ask Umbra stream replayed from cache; no model or Codex request was made."
            return
        try:
            with checkout_public_repo(repo_url) as repo_path:
                context, _, _, _, _ = await self._prepare(repo_path, question)
                iterator = reason_stream("work", self._developer_prompt(), self._user_prompt(question, context))
                while True:
                    done, chunk = await asyncio.to_thread(self._next, iterator)
                    if done:
                        break
                    yield chunk
        except Exception as exc:
            yield f"Ask Umbra live stream unavailable: {exc}"

    async def _prepare(self, repo_path, question: str):
        retrieval_started = perf_counter()
        references, context = self._retrieve(repo_path, question)
        retrieval_ms = int((perf_counter() - retrieval_started) * 1000)
        codex_started = perf_counter()
        try:
            operation = self.codex.propose(f"Read-only codebase survey for this question: {question}. Identify only relevant files; do not edit anything.", repo_path=repo_path, read_only=True)
        except RuntimeError as exc:
            operation = self._unavailable_operation(str(exc))
        return context, references, operation, retrieval_ms, int((perf_counter() - codex_started) * 1000)

    @staticmethod
    def _retrieve(repo_path, question: str) -> tuple[list[dict[str, object]], str]:
        keywords = [word for word in re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", question.lower()) if word not in {"what", "would", "where", "this", "that", "with", "from", "does", "work", "change", "break"}][:5]
        references: list[dict[str, object]] = []
        snippets: list[str] = []
        for keyword in keywords or ["TODO"]:
            result = subprocess.run(["git", "grep", "-n", "-i", "-e", keyword], cwd=repo_path, text=True, capture_output=True, check=False)
            for raw in result.stdout.splitlines()[:12]:
                try:
                    path, line, text = raw.split(":", 2)
                    number = int(line)
                except ValueError:
                    continue
                candidate = repo_path / path
                if not candidate.is_file():
                    continue
                reference = {"file": path, "lines": str(number), "note": f"Matched query term '{keyword}'."}
                if reference not in references:
                    references.append(reference)
                    snippets.append(f"{path}:{number}: {text[:300]}")
                if len(references) >= 8:
                    return references, "\n".join(snippets)
        return references, "\n".join(snippets)

    @staticmethod
    def _next(iterator: Iterator[str]) -> tuple[bool, str]:
        try:
            return False, next(iterator)
        except StopIteration:
            return True, ""

    @staticmethod
    async def _collect(iterator: Iterator[str]) -> list[str]:
        chunks: list[str] = []
        while True:
            done, chunk = await asyncio.to_thread(AskUmbra._next, iterator)
            if done:
                return chunks
            chunks.append(chunk)

    @staticmethod
    def _developer_prompt() -> str:
        return "You are Ask Umbra. Answer only from the retrieved code snippets. If context is insufficient, say so. Never invent file paths, lines, commits, or behavior."

    @staticmethod
    def _user_prompt(question: str, context: str) -> str:
        return f"Question: {question}\n\nVerified retrieved context:\n{context}"

    def _cached_result(self, note: str | None = None) -> AgentResult:
        answer = load_demo_cache()["answer"]
        operation = self.codex.cached_fallback("Answer a codebase question read-only.", note=note or "Cached Ask Umbra replay; no live model or CLI call was made.") if note else self.codex.propose("Answer a codebase question read-only.")
        return AgentResult("ask", answer["answer"], answer["references"], Replay("ask", operation.prompt, operation.diff, operation.summary, note or "Demo reasoning replayed from cache; no model or Codex request was made.", {"retrieval_ms": 0, "codex_ms": 0, "reasoning_ms": 0}, {"retrieval": "demo-cache", "reasoning": "demo-cache", "engineering": "cache-fallback" if note else operation.provider}))

    @staticmethod
    def _unavailable_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime
        return CodexOperation("Read-only code survey", f"Codex CLI unavailable: {error}", "", None, [], "unavailable", datetime.now(UTC).isoformat(), error=error)
