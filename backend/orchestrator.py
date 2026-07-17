"""Agent scheduling, replay collection, cached demo loading, and SSE events."""
from __future__ import annotations

import asyncio
import os
import re
from collections import deque
from typing import Any, AsyncIterator

from backend.cache import load_demo_cache
from backend.features import dependency_galaxy, kill_chain, roi_estimate
from backend.scoring import umbra_score


class EventBus:
    def __init__(self, backlog: int = 120) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=backlog)
        self._listeners: set[asyncio.Queue[dict[str, Any]]] = set()

    async def emit(self, event: dict[str, Any]) -> None:
        self._events.append(event)
        for queue in tuple(self._listeners):
            queue.put_nowait(event)

    async def stream(self) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._listeners.add(queue)
        try:
            for item in self._events:
                yield item
            while True:
                yield await queue.get()
        finally:
            self._listeners.discard(queue)


class Orchestrator:
    def __init__(self, bus: EventBus | None = None) -> None:
        self.bus = bus or EventBus()
        self.replays: list[dict[str, Any]] = load_demo_cache()["replays"]

    async def replay_demo_events(self) -> None:
        for event in load_demo_cache()["events"]:
            await self.bus.emit(event)

    async def scan(self, repo_url: str, agents: list[str] | None = None, pr_number: int | None = None, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None, model: str | None = None, reasoning_effort: str | None = None) -> dict[str, Any]:
        # Cache is intentionally the availability boundary: a demo never depends on third parties.
        from backend.agents import Janitor, Reviewer, Watchman
        from backend.codex_client import CodexClient
        from backend.integrations.repository import checkout_public_repo, live_repositories_enabled, reset_checkout

        payload = load_demo_cache()
        payload["repo_url"] = repo_url
        requested = set(agents or ["watchman", "reviewer", "janitor"])
        # One Codex client for the whole scan carries the caller's speed choice
        # (lighter model / lower reasoning effort) to every agent it runs.
        codex = CodexClient(model=model, reasoning_effort=reasoning_effort)

        # Clone ONCE and share the checkout across agents. They run one at a time,
        # so peak memory stays at a single checkout (safe within the 4Gi /
        # concurrency-2 pin), while dropping a Full scan from 3 network clones to
        # 1. The clone runs in a thread so it never blocks the event loop / SSE,
        # and the tree is reset to its pristine cloned state before each agent so a
        # mutating agent (Watchman/Janitor) never sees another's edits in its diff.
        shared_cm = None
        repo_path = None
        if live_repositories_enabled() and os.getenv("UMBRA_DEMO_MODE", "false").lower() != "true":
            try:
                shared_cm = checkout_public_repo(repo_url, github_token)
                repo_path = await asyncio.to_thread(shared_cm.__enter__)
            except Exception:  # noqa: BLE001 - no shared checkout → agents fall back exactly as before
                shared_cm = repo_path = None

        agent_runs = []
        try:
            used_shared = False

            async def _run(agent: Any, **kwargs: Any) -> Any:
                nonlocal used_shared
                if repo_path is not None:
                    if used_shared:
                        await asyncio.to_thread(reset_checkout, repo_path)
                    used_shared = True
                return await agent.run(repo_url, repo_path=repo_path, **kwargs)

            if "watchman" in requested:
                agent_runs.append(await _run(Watchman(codex=codex), github_token=github_token, openai_key=openai_key, allow_codex=allow_codex))
            if "reviewer" in requested:
                agent_runs.append(await _run(Reviewer(codex=codex), pr_number=pr_number, github_token=github_token, openai_key=openai_key, allow_codex=allow_codex))
            if "janitor" in requested:
                agent_runs.append(await _run(Janitor(codex=codex), github_token=github_token, openai_key=openai_key, allow_codex=allow_codex))
        finally:
            if shared_cm is not None:
                await asyncio.to_thread(shared_cm.__exit__, None, None, None)
        self.replays = [result.replay.__dict__ for result in agent_runs] or self.replays
        await self.replay_demo_events()
        response = {key: value for key, value in payload.items() if key not in {"events", "postmortem", "answer", "replays"}}
        watchman = next((result for result in agent_runs if result.agent == "watchman"), None)
        live_watchman = bool(watchman and watchman.replay.providers.get("vulnerabilities") == "osv.dev")
        if live_watchman:
            # This is the one live, end-to-end source of truth. Do not blend it
            # with seeded categories and accidentally present a cache as a scan.
            response.update({
                "vulnerabilities": watchman.findings,
                "dependencies": watchman.dependencies,
                "dead_code": [],
                "secrets": [],
                "missing_docs_count": 0,
                "umbra_score": umbra_score(watchman.findings),
                "risk_forecast": "Live Watchman scope: dependency advisories only.",
                "reasoning_summary": watchman.summary,
                "source": "live-watchman",
                "live_scope": ["OSV dependency scan", "GPT-5.6 threat analysis", "Codex disposable-checkout task"],
            })
        else:
            response["source"] = "demo-cache"
        reviewer = next((result for result in agent_runs if result.agent == "reviewer"), None)
        janitor = next((result for result in agent_runs if result.agent == "janitor"), None)
        if reviewer and reviewer.replay.providers.get("review") == "codex-cli":
            response["review"] = reviewer.findings[0] if reviewer.findings else {}
        if janitor and janitor.replay.providers.get("engineering") == "codex-cli":
            response["cleanup"] = janitor.findings
        live_agents = [result.agent for result in agent_runs if "codex-cli" in result.replay.providers.values()]
        if live_agents:
            response["source"] = f"live-{live_agents[0]}" if len(live_agents) == 1 else "live"
            response["live_agents"] = live_agents
        response["agent_results"] = [result.as_dict() for result in agent_runs]
        live_deps = watchman.dependencies if live_watchman else None
        response["kill_chain"] = kill_chain() if response.get("vulnerabilities") else []
        response["dependency_galaxy"] = dependency_galaxy(live_deps)
        finding_count = len(response["vulnerabilities"]) + len(response.get("dead_code", [])) if live_watchman else len(payload["vulnerabilities"]) + len(payload["dead_code"])
        response["roi"] = roi_estimate(finding_count)
        response["benchmark"] = {"mode": "precomputed", "baseline_minutes": 96, "umbra_minutes": 18, "coverage": "seeded express-style repository"}
        return response

    async def investigate(self, repo_url: str, error_log: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> dict[str, Any]:
        from backend.agents import Detective

        result = await Detective().run(repo_url, error_log, github_token=github_token, openai_key=openai_key, allow_codex=allow_codex)
        payload = result.findings[0]
        self.replays = [result.replay.__dict__]
        payload["source"] = "live-detective" if result.replay.providers.get("history") == "local-git" else "demo-cache"
        await self.bus.emit({"agent": "DETECTIVE", "message": "Live incident analysis complete" if payload["source"] == "live-detective" else "Incident replay assembled from verified cache", "level": "analysis"})
        return payload

    async def ask(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> dict[str, Any]:
        from backend.agents import AskUmbra

        result = await AskUmbra().run(repo_url, question, github_token=github_token, openai_key=openai_key, allow_codex=allow_codex)
        self.replays = [result.replay.__dict__]
        payload = {"answer": result.summary, "references": result.findings, "blast_radius": "Grounded only in the listed retrieved references.", "source": "live-ask" if result.replay.providers.get("retrieval") == "local-git-grep" else "demo-cache"}
        await self.bus.emit({"agent": "ASK UMBRA", "message": f"Grounding answer for: {question[:80]}", "level": "info"})
        return payload

    async def ask_stream(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AsyncIterator[str]:
        from backend.agents import AskUmbra

        async for chunk in AskUmbra().stream(repo_url, question, github_token=github_token, openai_key=openai_key, allow_codex=allow_codex):
            yield chunk

    async def ask_stream_events(self, repo_url: str, question: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AsyncIterator[dict[str, Any]]:
        """Fast Ask Umbra SSE: retrieval-only grounding + streamed answer, with a
        leading references frame (no wasted codex.propose call)."""
        from backend.agents import AskUmbra

        async for event in AskUmbra().stream_events(repo_url, question, github_token=github_token, openai_key=openai_key, allow_codex=allow_codex):
            yield event

    async def investigate_stream(self, repo_url: str, error_log: str, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None) -> AsyncIterator[dict[str, Any]]:
        """Fast Detective SSE: verified history + streamed root-cause reasoning,
        then a final structured postmortem frame."""
        from backend.agents import Detective

        async for event in Detective().stream_events(repo_url, error_log, github_token=github_token, openai_key=openai_key, allow_codex=allow_codex):
            yield event

    async def review_pull_request(self, repo_url: str, pr_number: int, token: str) -> dict[str, Any]:
        """Webhook auto-review: run Reviewer read-only (no Codex spend) and post one
        grounded comment. Comment-only — never approves, blocks, or merges."""
        from backend.agents import Reviewer
        from backend.integrations.github import parse_public_repo
        from backend.integrations.github_write import create_issue_comment
        from backend.webhooks import format_review_comment

        # Pass the owner's token so the Reviewer can read the PR diff and clone the
        # repo even when it is private (allow_codex=False keeps it comment-only, so
        # the token never reaches the Codex child process).
        result = await Reviewer().run(repo_url, pr_number=pr_number, github_token=token, allow_codex=False)
        finding = result.findings[0] if result.findings else {}
        owner_repo = parse_public_repo(repo_url)
        posted = await asyncio.to_thread(create_issue_comment, owner_repo, token, pr_number, format_review_comment(finding, pr_number))
        await self.bus.emit({"agent": "REVIEWER", "message": f"Auto-reviewed PR #{pr_number} on {owner_repo}", "level": "analysis"})
        return {"reviewed": pr_number, "comment": posted, "finding": finding}

    async def open_fix_pr(self, repo_url: str, token: str, mode: str = "bump", package: str | None = None, version: str | None = None, cve: str | None = None, allow_codex: bool | None = None, diff: str | None = None, model: str | None = None, reasoning_effort: str | None = None) -> dict[str, Any]:
        """Open a fix PR on the user's explicit request. Branch-only, never merges.
        The write ``token`` is used only here (and inside github_write) — never
        passed to the Codex child process.

        ``apply_diff`` opens a PR from a diff Umbra already produced and the user
        reviewed on screen (Watchman's scan) — no second Codex run, so it is fast
        and spends no Codex credits. ``codex`` re-derives a fix from scratch on the
        caller's chosen model/effort. ``bump`` is the deterministic dependency bump."""
        from backend.integrations.github import parse_public_repo

        owner_repo = parse_public_repo(repo_url)
        if mode == "apply_diff":
            if not (diff or "").strip():
                raise ValueError("No proposed diff was provided to open a PR from.")
            return await asyncio.to_thread(self._apply_diff_pr, repo_url, owner_repo, token, diff)
        if mode == "codex":
            return await asyncio.to_thread(self._codex_pr, repo_url, owner_repo, token, allow_codex, model, reasoning_effort)
        return await asyncio.to_thread(self._bump_pr, repo_url, owner_repo, token, package, version, cve)

    @staticmethod
    def _bump_pr(repo_url: str, owner_repo: str, token: str, package: str | None, version: str | None, cve: str | None) -> dict[str, Any]:
        import os

        import httpx

        from backend.integrations.dependencies import discover_dependencies
        from backend.integrations.github_write import open_pull_request
        from backend.integrations.repository import checkout_public_repo
        from backend.remediation import bump_manifest, pick_fixed_version

        if not package:
            raise ValueError("A package name is required for a dependency-bump PR.")
        with checkout_public_repo(repo_url, token) as repo_path:
            deps = discover_dependencies(repo_path)
            dep = next((d for d in deps if d["name"].lower() == package.lower() and (not version or d["version"] == version)), None) \
                or next((d for d in deps if d["name"].lower() == package.lower()), None)
            if not dep:
                raise ValueError(f"'{package}' was not found in this repository's manifests.")
            ecosystem, current = dep["ecosystem"], dep["version"]
            base = os.getenv("OSV_API_BASE", "https://api.osv.dev/v1").rstrip("/")
            response = httpx.post(f"{base}/query", json={"package": {"name": package, "ecosystem": ecosystem}, "version": current}, timeout=15)
            response.raise_for_status()
            fixed = pick_fixed_version(response.json().get("vulns", []), current)
            if not fixed:
                raise ValueError(f"OSV lists no fixed version for {package} {current}, so no safe automatic bump is available.")
            edit = bump_manifest(repo_path, package, ecosystem, fixed)
            if not edit:
                raise ValueError(f"Could not locate {package} in the manifest to edit it.")
            manifest_path, new_content = edit
        branch = f"umbra/fix-{re.sub(r'[^a-zA-Z0-9._-]+', '-', package.lower())}-{fixed}"
        title = f"Bump {package} to {fixed}"
        body = (
            f"### Umbra dependency fix\n\n"
            f"Bumps **{package}** from `{current}` to `{fixed}` in `{manifest_path}`"
            + (f" to remediate **{cve}**" if cve else "")
            + " (fixed version per [OSV](https://osv.dev)).\n\n"
            "- Deterministic edit — no model or Codex involved.\n"
            "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        return open_pull_request(owner_repo, token, branch, title, body, {manifest_path: new_content})

    @staticmethod
    def _apply_diff_pr(repo_url: str, owner_repo: str, token: str, diff: str) -> dict[str, Any]:
        """Open a PR by applying a diff Umbra already produced and the user reviewed.

        No Codex run happens here: the diff (Watchman's proposed patch, shown on
        screen) is applied to a fresh disposable checkout with ``git apply``, and
        the resulting file contents become the PR. This is the fast path for the
        'auto-patch PR' action and spends no Codex credits. Branch-only; Umbra
        never merges."""
        import subprocess
        import tempfile
        from datetime import UTC, datetime
        from pathlib import Path

        from backend.integrations.github_write import open_pull_request
        from backend.integrations.repository import checkout_public_repo

        with checkout_public_repo(repo_url, token) as repo_path:
            with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as handle:
                handle.write(diff if diff.endswith("\n") else diff + "\n")
                patch_file = handle.name
            try:
                applied = subprocess.run(
                    ["git", "apply", "--whitespace=nowarn", patch_file],
                    cwd=repo_path, text=True, capture_output=True, check=False,
                )
            finally:
                Path(patch_file).unlink(missing_ok=True)
            if applied.returncode != 0:
                raise ValueError(
                    "The proposed diff no longer applies cleanly to the latest repo state — "
                    "re-run the scan to refresh it, or use a Codex fix PR."
                )
            changed = [line for line in subprocess.run(["git", "diff", "--name-only"], cwd=repo_path, text=True, capture_output=True, check=False).stdout.splitlines() if line]
            file_changes: dict[str, str] = {}
            for rel in changed:
                path = repo_path / rel
                if path.is_file():
                    file_changes[rel] = path.read_text(errors="replace")
            if not file_changes:
                raise ValueError("Applying the proposed diff produced no file changes to open a PR for.")
        branch = f"umbra/patch-{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
        body = (
            "### Umbra proposed patch\n\n"
            "Applies the fix Umbra proposed during the scan (the diff you reviewed) — "
            "no new model run was performed to open this PR.\n\n"
            "- Applied with `git apply` in a disposable checkout (origin stripped; nothing is pushed by the agent).\n"
            "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        return open_pull_request(owner_repo, token, branch, "Umbra: proposed patch", body, file_changes)

    @staticmethod
    def _codex_pr(repo_url: str, owner_repo: str, token: str, allow_codex: bool | None, model: str | None = None, reasoning_effort: str | None = None) -> dict[str, Any]:
        from datetime import UTC, datetime

        from backend.codex_client import CodexClient
        from backend.integrations.github_write import open_pull_request
        from backend.integrations.repository import checkout_public_repo

        if allow_codex is False:
            raise PermissionError("Codex-authored PRs are founder-only on the hosted demo.")
        codex = CodexClient(model=model, reasoning_effort=reasoning_effort)
        with checkout_public_repo(repo_url, token) as repo_path:
            operation = codex.propose(
                "Find and fix the single highest-value, behavior-preserving issue you can (a security fix, a clear bug, or dead-code removal). Make the smallest safe change and run relevant tests. Do not push, commit, or merge.",
                repo_path=repo_path,
            )
            file_changes: dict[str, str] = {}
            for rel in operation.files:
                path = repo_path / rel
                if path.is_file():
                    file_changes[rel] = path.read_text(errors="replace")
            if not file_changes:
                raise ValueError("Codex proposed no readable changes, so there is nothing to open a PR for.")
            summary = operation.summary
        branch = f"umbra/codex-fix-{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
        body = (
            f"### Umbra Codex fix\n\n{summary}\n\n"
            "- Authored by Codex in a disposable checkout (origin stripped; the agent never pushes or merges).\n"
            "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        return open_pull_request(owner_repo, token, branch, "Umbra Codex: proposed fix", body, file_changes)


orchestrator = Orchestrator()
