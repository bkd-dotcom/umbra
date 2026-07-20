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

    async def scan(self, repo_url: str, agents: list[str] | None = None, pr_number: int | None = None, github_token: str | None = None, openai_key: str | None = None, allow_codex: bool | None = None, model: str | None = None, reasoning_effort: str | None = None, autonomy_level: int = 1) -> dict[str, Any]:
        # Cache is intentionally the availability boundary: a demo never depends on third parties.
        from backend.agents import Janitor, Reviewer, Watchman
        from backend.codex_client import CodexClient
        from backend.evidence import autonomy_metadata, canonical_hash, make_run_id, read_policy
        from backend.integrations.repository import checkout_public_repo, live_repositories_enabled, reset_checkout

        payload = load_demo_cache()
        payload["repo_url"] = repo_url
        requested = set(agents or ["watchman", "reviewer", "janitor"])
        # Autonomy level 0 = report only: never spend Codex on a propose, even for
        # a founder. Levels 1-3 keep the caller's resolved Codex permission; the
        # higher levels only change the metadata (Umbra never auto-merges at any
        # level — the actual PR/review still runs through an explicit endpoint).
        if autonomy_level == 0:
            allow_codex = False
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

        # Repository policy metadata, read while the checkout still exists (the
        # tree is deleted on __exit__). Default policy when there is no clone.
        policy_meta = read_policy(repo_path)

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
        # --- Auditable product layer: autonomy + policy + run_id + evidence_hash.
        # run_id/evidence_hash are added LAST so the hash covers every field above
        # (autonomy + policy included). evidence_hash is computed over the canonical
        # result minus the evidence_hash key itself, so a re-hash reproduces it.
        response["autonomy"] = autonomy_metadata(autonomy_level)
        response["policy"] = policy_meta
        response["run_id"] = make_run_id(repo_url, str(response.get("source", "")))
        response["evidence_hash"] = canonical_hash(response)
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

    async def open_fix_pr(self, repo_url: str, token: str, mode: str = "bump", package: str | None = None, version: str | None = None, cve: str | None = None, allow_codex: bool | None = None, diff: str | None = None, model: str | None = None, reasoning_effort: str | None = None, diffs: list[str] | None = None, preview: bool = False) -> dict[str, Any]:
        """Open a fix PR on the user's explicit request. Branch-only, never merges.
        The write ``token`` is used only here (and inside github_write) — never
        passed to the Codex child process.

        ``bump`` is the deterministic single-package dependency bump. ``bump_all``
        bumps every vulnerable dependency to a version clearing its OSV advisories
        in ONE PR (still deterministic — no Codex). ``apply_diff`` opens a PR from a
        diff Umbra already produced and the user reviewed on screen. ``combine``
        applies several reviewed diffs (e.g. Watchman + Janitor) into one PR,
        skipping any that conflict. ``codex`` re-derives a fix from scratch.

        Every mode is gated by the deterministic Reviewer assessment, embedded in
        the PR body and returned as ``review``. With ``preview=True`` the planned
        change (files + Reviewer assessment) is returned WITHOUT opening a PR, so
        the UI can show the Reviewer's verdict before the user confirms."""
        from backend.integrations.github import parse_public_repo

        owner_repo = parse_public_repo(repo_url)
        if mode == "apply_diff":
            if not (diff or "").strip():
                raise ValueError("No proposed diff was provided to open a PR from.")
            return await asyncio.to_thread(self._apply_diff_pr, repo_url, owner_repo, token, diff, preview)
        if mode == "bump_all":
            return await asyncio.to_thread(self._bump_all_pr, repo_url, owner_repo, token, preview)
        if mode == "combine":
            return await asyncio.to_thread(self._combined_pr, repo_url, owner_repo, token, diffs or [], preview)
        if mode == "codex":
            return await asyncio.to_thread(self._codex_pr, repo_url, owner_repo, token, allow_codex, model, reasoning_effort, preview)
        return await asyncio.to_thread(self._bump_pr, repo_url, owner_repo, token, package, version, cve, preview)

    async def admit(self, repo_url: str, token: str | None = None, fixture: str | None = None) -> dict[str, Any]:
        """Run the Agent Admission Test: does a coding agent obey THIS repo's rules?

        Two modes:
        - ``fixture`` names a committed, hermetic eval repo under ``evals/fixtures/``
          — fully offline/deterministic, so judges and CI can run it with no network
          and no credentials. This is the default demo path.
        - otherwise, clone a real public repository (requires UMBRA_ENABLE_LIVE_REPOS)
          and run the same pipeline against a live checkout with live OSV.

        Returns the AdmissionReport as a public dict (contract, trust boundary,
        verifier, earned authority). Never merges; never grants auto-merge."""
        from backend.admission import run_admission_live, run_admission_on_checkout

        if fixture:
            path = _fixture_path(fixture)
            if path is None:
                raise ValueError(f"Unknown admission fixture: {fixture!r}.")
            report = await asyncio.to_thread(lambda: run_admission_on_checkout(path, f"eval/{fixture}").to_public())
        else:
            report = await asyncio.to_thread(lambda: run_admission_live(repo_url, token).to_public())
        report["receipt"] = _sign_admission_receipt(report)
        return report


    @staticmethod
    def _bump_pr(repo_url: str, owner_repo: str, token: str, package: str | None, version: str | None, cve: str | None, preview: bool = False) -> dict[str, Any]:
        import os
        import shutil
        import subprocess

        import httpx

        from backend.agents.reviewer import Reviewer
        from backend.integrations.dependencies import discover_dependencies
        from backend.integrations.github_write import open_pull_request
        from backend.integrations.repository import checkout_public_repo
        from backend.remediation import _version_key, bump_manifest, pick_fixed_version

        if not package:
            raise ValueError("A package name is required for a dependency-bump PR.")
        lock_note = ""
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
            # Pick a version that TRULY escapes the advisory we name — not the global
            # smallest fix (which can land inside the target CVE's range, e.g. next
            # 14.2.7 leaving GHSA-h25m-26qc-wcjf, fixed only in 15.0.8, unremediated).
            fixed = pick_fixed_version(response.json().get("vulns", []), current, cve)
            if not fixed:
                target = f" remediating {cve}" if cve else ""
                raise ValueError(f"OSV lists no fixed version above {package} {current}{target}, so no safe automatic bump is available.")
            edit = bump_manifest(repo_path, package, ecosystem, fixed)
            if not edit:
                raise ValueError(f"Could not locate {package} in the manifest to edit it.")
            manifest_path, new_content = edit
            file_changes = {manifest_path: new_content}

            # Sync the lockfile so a clean install (`npm ci`) resolves the fixed
            # version rather than the old pin. Best-effort: write the edited manifest
            # to disk, then regenerate the lockfile from registry metadata only.
            # --ignore-scripts means the target repo's package code never executes
            # here; --package-lock-only writes no node_modules. The write token is
            # never handed to npm. If regeneration isn't possible we say so in the
            # body rather than ship a manifest/lock mismatch silently.
            if ecosystem == "npm":
                lock_path = repo_path / "package-lock.json"
                if lock_path.exists() and shutil.which("npm"):
                    (repo_path / manifest_path).write_text(new_content)
                    try:
                        subprocess.run(
                            ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps"],
                            cwd=repo_path, capture_output=True, timeout=120, check=True,
                        )
                        file_changes["package-lock.json"] = lock_path.read_text()
                        lock_note = "- Regenerated `package-lock.json` so a clean install resolves the fixed version.\n"
                    except (subprocess.SubprocessError, OSError):
                        lock_note = "- ⚠️ Could not regenerate `package-lock.json` automatically — run `npm install` on this branch to sync the lockfile before merging.\n"
                elif lock_path.exists():
                    lock_note = "- ⚠️ `package-lock.json` was not regenerated (npm unavailable) — run `npm install` on this branch to sync the lockfile before merging.\n"

        cross_major = _version_key(current)[:1] != _version_key(fixed)[:1]
        review = Reviewer.assess_change(list(file_changes))
        branch = f"umbra/fix-{re.sub(r'[^a-zA-Z0-9._-]+', '-', package.lower())}-{fixed}"
        title = f"Bump {package} to {fixed}"
        body = (
            f"### Umbra dependency fix\n\n"
            f"Bumps **{package}** from `{current}` to `{fixed}` in `{manifest_path}`"
            + (f" — the [OSV](https://osv.dev)-listed fix for **{cve}**" if cve else " — clears every OSV advisory affecting this version")
            + ".\n\n"
            "- Deterministic edit — no model or Codex involved.\n"
            + lock_note
            + ("- ⚠️ Crosses a major version — review app compatibility before merging.\n" if cross_major else "")
            + _review_block(review)
            + "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        if preview:
            return {"preview": True, "title": title, "files": sorted(file_changes), "review": review, "note": lock_note.strip()}
        result = open_pull_request(owner_repo, token, branch, title, body, file_changes)
        result["review"] = review
        return result

    @staticmethod
    def _apply_diff_pr(repo_url: str, owner_repo: str, token: str, diff: str, preview: bool = False) -> dict[str, Any]:
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

        from backend.agents.reviewer import Reviewer
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
        review = Reviewer.assess_change(list(file_changes))
        branch = f"umbra/patch-{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
        body = (
            "### Umbra proposed patch\n\n"
            "Applies the fix Umbra proposed during the scan (the diff you reviewed) — "
            "no new model run was performed to open this PR.\n\n"
            "- Applied with `git apply` in a disposable checkout (origin stripped; nothing is pushed by the agent).\n"
            + _review_block(review)
            + "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        if preview:
            return {"preview": True, "title": "Umbra: proposed patch", "files": sorted(file_changes), "review": review}
        result = open_pull_request(owner_repo, token, branch, "Umbra: proposed patch", body, file_changes)
        result["review"] = review
        return result

    @staticmethod
    def _codex_pr(repo_url: str, owner_repo: str, token: str, allow_codex: bool | None, model: str | None = None, reasoning_effort: str | None = None, preview: bool = False) -> dict[str, Any]:
        from datetime import UTC, datetime

        from backend.agents.reviewer import Reviewer
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
        review = Reviewer.assess_change(list(file_changes))
        branch = f"umbra/codex-fix-{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
        body = (
            f"### Umbra Codex fix\n\n{summary}\n\n"
            "- Authored by Codex in a disposable checkout (origin stripped; the agent never pushes or merges).\n"
            + _review_block(review)
            + "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        if preview:
            return {"preview": True, "title": "Umbra Codex: proposed fix", "files": sorted(file_changes), "review": review, "summary": summary}
        result = open_pull_request(owner_repo, token, branch, "Umbra Codex: proposed fix", body, file_changes)
        result["review"] = review
        return result

    @staticmethod
    def _bump_all_pr(repo_url: str, owner_repo: str, token: str, preview: bool = False) -> dict[str, Any]:
        """Consolidated remediation: bump EVERY vulnerable dependency to a version
        that clears its OSV advisories, in ONE deterministic PR. Loops the same
        primitives as ``_bump_pr`` (``pick_fixed_version`` + ``bump_manifest``),
        chaining edits into one commit. No Codex — available to any write-access
        user. Reviewer-gated + preview-aware like every other mode."""
        import os
        import shutil
        import subprocess

        import httpx

        from backend.agents.reviewer import Reviewer
        from backend.integrations.dependencies import discover_dependencies
        from backend.integrations.github_write import open_pull_request
        from backend.integrations.repository import checkout_public_repo
        from backend.remediation import _version_key, bump_manifest, pick_fixed_version

        base = os.getenv("OSV_API_BASE", "https://api.osv.dev/v1").rstrip("/")
        bumps: list[dict[str, Any]] = []
        touched: set[str] = set()
        lock_note = ""
        with checkout_public_repo(repo_url, token) as repo_path:
            for dep in discover_dependencies(repo_path):
                name, ecosystem, current = dep["name"], dep["ecosystem"], dep["version"]
                try:
                    resp = httpx.post(f"{base}/query", json={"package": {"name": name, "ecosystem": ecosystem}, "version": current}, timeout=15)
                    resp.raise_for_status()
                    vulns = resp.json().get("vulns", [])
                except Exception:  # noqa: BLE001 - one flaky OSV query must not abort the batch
                    continue
                if not vulns:
                    continue
                fixed = pick_fixed_version(vulns, current, None)  # clear ALL advisories on this package
                if not fixed or _version_key(fixed) <= _version_key(current):
                    continue
                edit = bump_manifest(repo_path, name, ecosystem, fixed)
                if not edit:
                    continue
                manifest_path, new_content = edit
                # Persist immediately so a second package in the SAME manifest edits
                # the already-updated content (chained into one commit).
                (repo_path / manifest_path).write_text(new_content)
                touched.add(manifest_path)
                bumps.append({"package": name, "current": current, "fixed": fixed, "advisories": len(vulns), "cross_major": _version_key(current)[:1] != _version_key(fixed)[:1]})
            if not bumps:
                raise ValueError("No dependency has an OSV-listed fixed version above its current pin, so there is nothing to bump.")
            file_changes: dict[str, str] = {mp: (repo_path / mp).read_text() for mp in touched}
            # One lockfile regen at the end (npm) — same safety as _bump_pr.
            if "package.json" in file_changes and (repo_path / "package-lock.json").exists():
                if shutil.which("npm"):
                    try:
                        subprocess.run(
                            ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps"],
                            cwd=repo_path, capture_output=True, timeout=180, check=True,
                        )
                        file_changes["package-lock.json"] = (repo_path / "package-lock.json").read_text()
                        lock_note = "- Regenerated `package-lock.json` so a clean install resolves the fixed versions.\n"
                    except (subprocess.SubprocessError, OSError):
                        lock_note = "- ⚠️ Could not regenerate `package-lock.json` automatically — run `npm install` on this branch before merging.\n"
                else:
                    lock_note = "- ⚠️ `package-lock.json` was not regenerated (npm unavailable) — run `npm install` on this branch before merging.\n"

        review = Reviewer.assess_change(list(file_changes))
        total_adv = sum(b["advisories"] for b in bumps)
        lines = "".join(f"- **{b['package']}** `{b['current']}` → `{b['fixed']}` — clears {b['advisories']} advisor{'y' if b['advisories'] == 1 else 'ies'}{' ⚠️ major bump' if b['cross_major'] else ''}\n" for b in bumps)
        title = f"Bump {len(bumps)} dependenc{'y' if len(bumps) == 1 else 'ies'} · clear {total_adv} advisor{'y' if total_adv == 1 else 'ies'}"
        body = (
            "### Umbra consolidated security fix\n\n"
            "Bumps every vulnerable dependency to a version that clears its OSV advisories, in one PR:\n\n"
            f"{lines}\n"
            "- Deterministic edits — no model or Codex involved.\n"
            + lock_note
            + _review_block(review)
            + "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        branch = f"umbra/fix-{total_adv}-advisories"
        if preview:
            return {"preview": True, "title": title, "files": sorted(file_changes), "review": review, "bumps": bumps, "note": lock_note.strip()}
        result = open_pull_request(owner_repo, token, branch, title, body, file_changes)
        result["review"] = review
        result["bumps"] = bumps
        return result

    @staticmethod
    def _combined_pr(repo_url: str, owner_repo: str, token: str, diffs: list[str], preview: bool = False) -> dict[str, Any]:
        """Combine several reviewed diffs (e.g. Watchman's dep fix + Janitor's
        cleanup) into ONE PR. Applies them sequentially in a disposable checkout;
        any diff that conflicts is skipped and noted honestly in the PR body (open
        it separately). No Codex run — the diffs were already produced. Reviewer-
        gated + preview-aware. Branch-only; Umbra never merges."""
        import subprocess
        import tempfile
        from datetime import UTC, datetime
        from pathlib import Path

        from backend.agents.reviewer import Reviewer
        from backend.integrations.github_write import open_pull_request
        from backend.integrations.repository import checkout_public_repo

        clean = [d for d in (diffs or []) if (d or "").strip()]
        if not clean:
            raise ValueError("No proposed diffs were provided to combine into a PR.")
        skipped = 0
        with checkout_public_repo(repo_url, token) as repo_path:
            for d in clean:
                with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as handle:
                    handle.write(d if d.endswith("\n") else d + "\n")
                    patch_file = handle.name
                try:
                    applied = subprocess.run(["git", "apply", "--whitespace=nowarn", patch_file], cwd=repo_path, text=True, capture_output=True, check=False)
                finally:
                    Path(patch_file).unlink(missing_ok=True)
                if applied.returncode != 0:
                    skipped += 1
            changed = [line for line in subprocess.run(["git", "diff", "--name-only"], cwd=repo_path, text=True, capture_output=True, check=False).stdout.splitlines() if line]
            file_changes: dict[str, str] = {}
            for rel in changed:
                path = repo_path / rel
                if path.is_file():
                    file_changes[rel] = path.read_text(errors="replace")
            if not file_changes:
                raise ValueError("None of the proposed diffs apply cleanly to the latest repo state — re-run the scan to refresh them.")

        review = Reviewer.assess_change(list(file_changes))
        skipped_note = f"- ⚠️ {skipped} proposed change(s) were omitted — they conflicted with the applied changes; open them as separate PRs.\n" if skipped else ""
        branch = f"umbra/combined-{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
        title = "Umbra: combined crew changes"
        body = (
            "### Umbra combined change\n\n"
            "Applies the crew's proposed changes (the diffs you reviewed on screen) in one PR.\n\n"
            "- Applied with `git apply` in a disposable checkout (origin stripped; nothing is pushed by the agent).\n"
            + skipped_note
            + _review_block(review)
            + "- Opened on a new branch; **Umbra never merges** — review and merge yourself.\n"
        )
        if preview:
            return {"preview": True, "title": title, "files": sorted(file_changes), "review": review, "skipped": skipped}
        result = open_pull_request(owner_repo, token, branch, title, body, file_changes)
        result["review"] = review
        result["skipped"] = skipped
        return result


def _review_block(review: dict[str, Any]) -> str:
    """Render the deterministic Reviewer verdict as a PR-body section — the same
    formula the Reviewer runs on real PRs, so every PR Umbra opens is gated by it."""
    return (
        "\n### Reviewer assessment (deterministic)\n\n"
        f"- Risk score: **{review['risk_score']}/100** ({review['severity']})\n"
        f"- Files changed: {review['files_changed']} · blast-radius {review['blast_radius']}/5\n"
        f"- {'Missing test coverage in changed paths' if review['missing_tests'] else 'Touches test paths'}\n"
        f"- Recommendation: **{review['recommendation']}** — human review required.\n\n"
    )


def _fixture_path(fixture: str):
    """Resolve a named admission fixture under ``evals/fixtures/``, safely.

    Rejects any name that escapes the fixtures directory (path traversal) or that
    doesn't exist. Returns a ``Path`` or None."""
    from pathlib import Path

    root = (Path(__file__).resolve().parent.parent / "evals" / "fixtures").resolve()
    candidate = (root / fixture).resolve()
    if root not in candidate.parents or not candidate.is_dir():
        return None
    return candidate


def _sign_admission_receipt(report: dict[str, Any]) -> dict[str, Any]:
    """Build a signed Remediation Receipt from an admission report — the
    proof-carrying, independently-verifiable record of the run."""
    from backend.receipt import build_receipt

    return build_receipt(
        repo=str(report.get("repo", "")),
        base_commit=report.get("base_commit"),
        contract=report.get("contract") or {},
        contract_result=report.get("contract_result") or {},
        verifier=report.get("verifier"),
        trust_boundary=report.get("trust_boundary"),
        proposed_change=report.get("proposed_change"),
        providers=report.get("providers"),
        authority_level=int(report.get("authority_level", 0)),
        authority=str(report.get("authority", "observe")),
        outcome=report.get("outcome"),
    )



orchestrator = Orchestrator()
