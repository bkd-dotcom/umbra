"""Ask Umbra: grounded read-only retrieval with Responses streaming."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
from contextlib import contextmanager
from time import perf_counter
from typing import AsyncIterator, Iterator

from backend.agents.base import AgentResult, Replay, codex_reasoning
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.repository import checkout_public_repo, cloud_scan_enabled, live_repositories_enabled
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
        # Codex CLI (ChatGPT login) supplies both retrieval-grounded answering and reasoning; no API key required.
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and (CodexClient.enabled() or cloud_scan_enabled())

    async def _run_live(self, repo_url: str, question: str) -> AgentResult:
        with checkout_public_repo(repo_url) as repo_path:
            context, references, operation, retrieval_ms, codex_ms = await self._prepare(repo_path, question)
            started = perf_counter()
            developer, user = self._developer_prompt(), self._user_prompt(question, context)
            try:
                answer = "".join(await self._collect(reason_stream("work", developer, user)))
                provider = "responses-api-stream"
            except RuntimeError as exc:
                answer, provider = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
            reasoning_ms = int((perf_counter() - started) * 1000)
        return AgentResult("ask", answer, references, Replay("ask", operation.prompt, operation.diff, operation.summary, answer, {"retrieval_ms": retrieval_ms, "codex_ms": codex_ms, "reasoning_ms": reasoning_ms}, {"retrieval": "local-git-grep", "reasoning": provider, "engineering": operation.provider}))

    async def stream(self, repo_url: str, question: str) -> AsyncIterator[str]:
        """Yield grounded text chunks for FastAPI SSE; no demo stream uses network."""
        if not self._live_enabled():
            yield "Demo Ask Umbra stream replayed from cache; no model or Codex request was made."
            return
        developer = self._developer_prompt()
        try:
            with checkout_public_repo(repo_url) as repo_path:
                context, _, _, _, _ = await self._prepare(repo_path, question)
        except Exception as exc:
            yield f"Ask Umbra live stream unavailable: {exc}"
            return
        user = self._user_prompt(question, context)
        iterator = reason_stream("work", developer, user)
        streamed = False
        try:
            while True:
                done, chunk = await asyncio.to_thread(self._next, iterator)
                if done:
                    break
                streamed = True
                yield chunk
        except RuntimeError as exc:
            if streamed:
                yield f"\n[Ask Umbra stream interrupted: {exc}]"
                return
            # Responses API unavailable before any token: fall back to Codex
            # reasoning (itself a GPT-5.6 model) delivered as a single chunk.
            text, _ = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
            yield text

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

    # Common English/question words never make good code-search terms; they flood
    # the results with docs before the meaningful identifiers are ever grepped.
    _STOPWORDS = {"what", "when", "where", "which", "whether", "who", "whom", "why", "how", "the", "and", "for", "are", "was", "were", "this", "that", "these", "those", "with", "from", "does", "did", "doing", "work", "works", "change", "break", "has", "have", "had", "can", "could", "would", "should", "will", "into", "over", "about", "its", "their", "there", "here", "you", "your"}

    _CODE_EXTENSIONS = {".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".rb", ".c", ".h", ".hpp", ".cpp", ".cc", ".cs", ".php", ".swift", ".kt", ".scala", ".sql", ".sh"}

    @staticmethod
    def _path_rank(path: str) -> int:
        """Prefer source code (0) over other files (1) over docs/changelogs (2).

        ``git grep`` returns matches in alphabetical path order, so docs and
        CHANGES files precede ``src/`` — without this a question about code gets
        answered from the changelog. A question about the code wants the code.
        """
        lowered = path.lower()
        if os.path.splitext(lowered)[1] in AskUmbra._CODE_EXTENSIONS:
            return 0
        if lowered.endswith((".md", ".rst", ".txt")) or "changelog" in lowered or "changes" in lowered or lowered.startswith("docs/"):
            return 2
        return 1

    @staticmethod
    def _retrieve(repo_path, question: str) -> tuple[list[dict[str, object]], str]:
        words = [word for word in re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", question) if word.lower() not in AskUmbra._STOPWORDS]
        # Search the most specific terms first (identifiers/longer tokens); a broad
        # word can never crowd out the real answer.
        keywords = sorted(dict.fromkeys(words), key=lambda word: (-len(word), word.lower()))[:5]
        matches: list[tuple[int, int, str, int, str, str]] = []
        for order, keyword in enumerate(keywords or ["TODO"]):
            result = subprocess.run(["git", "grep", "-n", "-i", "-e", keyword], cwd=repo_path, text=True, capture_output=True, check=False)
            for raw in result.stdout.splitlines():
                try:
                    path, line, text = raw.split(":", 2)
                    number = int(line)
                except ValueError:
                    continue
                if not (repo_path / path).is_file():
                    continue
                matches.append((AskUmbra._path_rank(path), order, path, number, text, keyword))
        # Rank code files ahead of docs, and more specific terms ahead of broad ones.
        matches.sort(key=lambda match: (match[0], match[1]))
        references: list[dict[str, object]] = []
        snippets: list[str] = []
        seen: set[tuple[str, int]] = set()
        for _, _, path, number, text, keyword in matches:
            if (path, number) in seen:
                continue
            seen.add((path, number))
            references.append({"file": path, "lines": str(number), "note": f"Matched query term '{keyword}'."})
            snippets.append(f"{path}:{number}: {text[:300]}")
            if len(references) >= 8:
                break
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
