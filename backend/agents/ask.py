"""Ask Umbra: grounded read-only retrieval with Responses streaming."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
from contextlib import contextmanager
from time import perf_counter
from typing import AsyncIterator, Iterator

from backend.agents.base import CODEX_HOST_NOTE, AgentResult, Replay, codex_reasoning
from backend.cache import load_demo_cache
from backend.codex_client import CodexClient, CodexOperation
from backend.integrations.repository import checkout_public_repo, cloud_scan_enabled, live_repositories_enabled
from backend.reasoning import reason_stream


class AskUmbra:
    def __init__(self, codex: CodexClient | None = None) -> None:
        self.codex = codex or CodexClient()

    async def run(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        if self._live_enabled():
            try:
                return await self._run_live(repo_url, question, github_token, openai_key, allow_codex)
            except Exception as exc:
                return self._cached_result(f"Live Ask Umbra unavailable: {exc}")
        return self._cached_result()

    @staticmethod
    def _live_enabled() -> bool:
        # Codex CLI (ChatGPT login) supplies both retrieval-grounded answering and reasoning; no API key required.
        return os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true" and live_repositories_enabled() and (CodexClient.enabled() or cloud_scan_enabled())

    async def _run_live(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AgentResult:
        with checkout_public_repo(repo_url, github_token) as repo_path:
            context, references, operation, retrieval_ms, codex_ms = await self._prepare(repo_path, question, allow_codex)
            started = perf_counter()
            developer, user = self._developer_prompt(), self._user_prompt(question, context)
            try:
                answer = "".join(await self._collect(reason_stream("work", developer, user, None, openai_key)))
                provider = "responses-api-stream"
            except RuntimeError as exc:
                if allow_codex is False:
                    answer, provider = f"Grounded retrieval succeeded, but live reasoning is unavailable: {exc}. Add your own OpenAI key to unlock answers here.", "unavailable"
                else:
                    answer, provider = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
            reasoning_ms = int((perf_counter() - started) * 1000)
        return AgentResult("ask", answer, references, Replay("ask", operation.prompt, operation.diff, operation.summary, answer, {"retrieval_ms": retrieval_ms, "codex_ms": codex_ms, "reasoning_ms": reasoning_ms}, {"retrieval": "local-git-grep", "reasoning": provider, "engineering": operation.provider}))

    async def stream(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AsyncIterator[str]:
        """Yield grounded text chunks for FastAPI SSE; no demo stream uses network."""
        if not self._live_enabled():
            yield "Demo Ask Umbra stream replayed from cache; no model or Codex request was made."
            return
        developer = self._developer_prompt()
        try:
            with checkout_public_repo(repo_url, github_token) as repo_path:
                context, _, _, _, _ = await self._prepare(repo_path, question, allow_codex)
        except Exception as exc:
            yield f"Ask Umbra live stream unavailable: {exc}"
            return
        user = self._user_prompt(question, context)
        iterator = reason_stream("work", developer, user, None, openai_key)
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
            if allow_codex is False:
                yield f"Grounded retrieval succeeded, but live reasoning is unavailable: {exc}. Add your own OpenAI key to unlock answers here."
                return
            # Responses API unavailable before any token: fall back to Codex
            # reasoning (itself a GPT-5.6 model) delivered as a single chunk.
            text, _ = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
            yield text

    async def stream_events(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None):
        """Fast SSE path: retrieval-only grounding (git-grep + overview, sub-second),
        then streamed reasoning. Unlike ``run``/``stream`` this deliberately does NOT
        make a ``codex.propose`` survey call — that result is unused when streaming
        and cost the whole first-token latency. Yields typed dicts:
        ``{"type": "references", ...}`` once, then ``{"type": "text", "chunk": ...}``.
        """
        if not self._live_enabled():
            yield {"type": "text", "chunk": "Demo Ask Umbra stream replayed from cache; no model or Codex request was made."}
            return
        try:
            with checkout_public_repo(repo_url, github_token) as repo_path:
                references, context = self._retrieve(repo_path, question)
        except Exception as exc:  # noqa: BLE001 — never leak a stack trace to the stream
            yield {"type": "text", "chunk": f"Ask Umbra live stream unavailable: {exc}"}
            return
        yield {"type": "references", "references": references, "source": "live-ask"}
        developer, user = self._developer_prompt(), self._user_prompt(question, context)
        iterator = reason_stream("work", developer, user, None, openai_key)
        streamed = False
        try:
            while True:
                done, chunk = await asyncio.to_thread(self._next, iterator)
                if done:
                    break
                streamed = True
                yield {"type": "text", "chunk": chunk}
        except RuntimeError as exc:
            if streamed:
                yield {"type": "text", "chunk": f"\n[Ask Umbra stream interrupted: {exc}]"}
                return
            if allow_codex is False:
                yield {"type": "text", "chunk": f"Grounded retrieval succeeded, but live reasoning is unavailable: {exc}. Add your own OpenAI key to unlock answers here."}
                return
            text, _ = await asyncio.to_thread(codex_reasoning, self.codex, developer, user, exc)
            yield {"type": "text", "chunk": text}

    async def _prepare(self, repo_path, question: str, allow_codex: bool | None = None):
        retrieval_started = perf_counter()
        references, context = self._retrieve(repo_path, question)
        retrieval_ms = int((perf_counter() - retrieval_started) * 1000)
        codex_started = perf_counter()
        if allow_codex is False:
            operation = self._unavailable_operation(CODEX_HOST_NOTE)
        else:
            try:
                operation = self.codex.propose(f"Read-only codebase survey for this question: {question}. Identify only relevant files; do not edit anything.", repo_path=repo_path, read_only=True)
            except RuntimeError as exc:
                operation = self._unavailable_operation(str(exc))
        return context, references, operation, retrieval_ms, int((perf_counter() - codex_started) * 1000)

    # Common English/question words never make good code-search terms; they flood
    # the results with docs before the meaningful identifiers are ever grepped.
    _STOPWORDS = {"what", "when", "where", "which", "whether", "who", "whom", "why", "how", "the", "and", "for", "are", "was", "were", "this", "that", "these", "those", "with", "from", "does", "did", "doing", "work", "works", "change", "break", "has", "have", "had", "can", "could", "would", "should", "will", "into", "over", "about", "its", "their", "there", "here", "you", "your"}

    _CODE_EXTENSIONS = {".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".rb", ".c", ".h", ".hpp", ".cpp", ".cc", ".cs", ".php", ".swift", ".kt", ".scala", ".sql", ".sh"}

    # Files that describe a repo at a glance. Keyword git-grep can't answer broad
    # "what is this repo about?" questions — the terms never appear literally — so
    # we always seed the context with these real, grounded overview files.
    _README_NAMES = ("README.md", "README.rst", "README.txt", "README", "readme.md", "Readme.md", "docs/README.md")
    _MANIFESTS = ("package.json", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json", "pubspec.yaml", "Package.swift")

    @staticmethod
    def _read_head(path, limit: int) -> str:
        try:
            return path.read_text(encoding="utf-8", errors="replace")[:limit].strip()
        except OSError:
            return ""

    @staticmethod
    def _overview(repo_path) -> tuple[list[dict[str, object]], str]:
        """Grounded repo orientation: README head + primary manifest + top-level layout.

        Always included so high-level questions ("what's this about?") have real
        material to summarise, and every other answer is oriented. Every line here
        is read from actual files with real references — nothing is invented.
        """
        refs: list[dict[str, object]] = []
        blocks: list[str] = []
        for name in AskUmbra._README_NAMES:
            head = AskUmbra._read_head(repo_path / name, 1600)
            if head:
                refs.append({"file": name, "lines": "1", "note": "Project README (overview)."})
                blocks.append(f"# {name}\n{head}")
                break
        for name in AskUmbra._MANIFESTS:
            head = AskUmbra._read_head(repo_path / name, 700)
            if head:
                refs.append({"file": name, "lines": "1", "note": "Dependency / build manifest."})
                blocks.append(f"# {name}\n{head}")
                break
        try:
            entries = sorted(
                entry.name + ("/" if entry.is_dir() else "")
                for entry in repo_path.iterdir()
                if not entry.name.startswith(".")
            )[:40]
        except OSError:
            entries = []
        if entries:
            blocks.append("# Repository layout (top level)\n" + "  ".join(entries))
        return refs, "\n\n".join(blocks)

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
        # Always lead with a grounded repo overview so broad questions have material
        # to summarise even when no keyword matched; keyword hits follow.
        overview_refs, overview_ctx = AskUmbra._overview(repo_path)
        references: list[dict[str, object]] = list(overview_refs)
        snippets: list[str] = [overview_ctx] if overview_ctx else []
        seen: set[tuple[str, int]] = set()
        for _, _, path, number, text, keyword in matches:
            if (path, number) in seen:
                continue
            seen.add((path, number))
            references.append({"file": path, "lines": str(number), "note": f"Matched query term '{keyword}'."})
            snippets.append(f"{path}:{number}: {text[:300]}")
            if len(references) >= 8 + len(overview_refs):
                break
        return references, "\n\n".join(snippets)

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
        # No checkout here: `propose()` only returns a stub in demo mode; on the live
        # service it would raise, so use the honest cached replay instead.
        operation = self.codex.propose("Answer a codebase question read-only.") if not note and os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true" else self.codex.cached_fallback("Answer a codebase question read-only.", note=note or "Cached Ask Umbra replay; no live model or CLI call was made.")
        return AgentResult("ask", answer["answer"], answer["references"], Replay("ask", operation.prompt, operation.diff, operation.summary, note or "Demo reasoning replayed from cache; no model or Codex request was made.", {"retrieval_ms": 0, "codex_ms": 0, "reasoning_ms": 0}, {"retrieval": "demo-cache", "reasoning": "demo-cache", "engineering": "cache-fallback" if note else operation.provider}))

    @staticmethod
    def _unavailable_operation(error: str) -> CodexOperation:
        from datetime import UTC, datetime
        return CodexOperation("Read-only code survey", f"Codex CLI unavailable: {error}", "", None, [], "unavailable", datetime.now(UTC).isoformat(), error=error)
