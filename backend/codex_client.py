"""Auditable Codex CLI adapter used for real, local engineering work."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable


@dataclass
class CodexOperation:
    prompt: str
    summary: str
    diff: str
    tests_passed: bool | None
    files: list[str]
    provider: str
    created_at: str
    command: list[str] | None = None
    stdout: str = ""
    error: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


Runner = Callable[..., subprocess.CompletedProcess[str]]


class CodexClient:
    """Delegate code work to ``codex exec`` and preserve an inspectable replay.

    The CLI is opt-in through ``UMBRA_ENABLE_CODEX_CLI=true``. It is always run
    against a disposable local checkout supplied by the caller; Codex receives a
    hard no-push/no-merge instruction and Umbra never supplies GitHub write
    credentials to the child process.
    """

    def __init__(self, replay_dir: Path | None = None, runner: Runner = subprocess.run) -> None:
        self.replay_dir = replay_dir
        self.runner = runner

    @staticmethod
    def enabled() -> bool:
        return os.getenv("UMBRA_ENABLE_CODEX_CLI", "false").lower() == "true"

    def propose(self, prompt: str, files: list[str] | None = None, repo_path: Path | None = None, read_only: bool = False) -> CodexOperation:
        if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
            return self._record(self._demo_operation(prompt, files or []))
        if not self.enabled():
            return self._record(self._disabled_operation(prompt, files or []))
        if repo_path is None or not repo_path.is_dir():
            raise RuntimeError("A checked-out repository is required when UMBRA_ENABLE_CODEX_CLI=true")
        return self._record(self._run_cli(prompt, repo_path, read_only=read_only))

    def analyze(self, prompt: str) -> CodexOperation:
        """Read-only Codex reasoning with no repository required.

        The Codex CLI itself runs a GPT-5.6 model, so this is Umbra's honest
        reasoning fallback when the Responses API is unavailable. The result is
        always labelled ``codex-cli`` in the provider ledger; it is never
        presented as the Responses API, and the read-only sandbox guarantees no
        file, network, or shell side effects.
        """
        if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
            return self._record(self._demo_operation(prompt, []))
        if not self.enabled():
            return self._record(self._disabled_operation(prompt, []))
        with tempfile.TemporaryDirectory(prefix="umbra-reason-") as work_dir:
            return self._record(self._run_cli(prompt, Path(work_dir), read_only=True, cli_prompt=self._reason_prompt(prompt)))

    def cached_fallback(self, prompt: str, files: list[str] | None = None, note: str = "") -> CodexOperation:
        """Record an honest non-live result after an integration failure."""
        operation = CodexOperation(
            prompt=prompt,
            summary=note or "Live Codex did not run; cached demo material is being shown.",
            diff="", tests_passed=None, files=files or [], provider="cache-fallback",
            created_at=datetime.now(UTC).isoformat(),
        )
        return self._record(operation)

    def _run_cli(self, prompt: str, repo_path: Path, read_only: bool = False, cli_prompt: str | None = None) -> CodexOperation:
        with tempfile.TemporaryDirectory(prefix="umbra-codex-") as temp_dir:
            final_message = Path(temp_dir) / "final-message.txt"
            # ``codex exec`` is non-interactive (approval policy is already
            # ``never``); the removed ``--ask-for-approval`` flag is rejected by
            # current CLI versions. ``--skip-git-repo-check`` lets read-only
            # reasoning run in a throwaway directory that is not a Git repo.
            command = [
                "codex", "exec", "--ephemeral", "--color", "never",
                "--sandbox", "read-only" if read_only else "workspace-write",
                "--skip-git-repo-check",
                "--output-last-message", str(final_message), "-C", str(repo_path),
                cli_prompt or self._safe_prompt(prompt),
            ]
            completed = self.runner(command, text=True, capture_output=True, timeout=900, check=False)
            diff = self._git(repo_path, ["diff", "--binary"])
            changed = [line for line in self._git(repo_path, ["diff", "--name-only"]).splitlines() if line]
            final = final_message.read_text(errors="replace") if final_message.exists() else completed.stdout
            summary = final.strip() or completed.stdout.strip()
            if not summary:
                summary = "Codex CLI completed successfully without a final text summary." if completed.returncode == 0 else "Codex CLI exited without a final text summary."
            operation = CodexOperation(
                prompt=prompt,
                summary=summary,
                diff=diff,
                tests_passed=completed.returncode == 0,
                files=changed,
                provider="codex-cli",
                created_at=datetime.now(UTC).isoformat(),
                command=command[:-1] + ["<agent prompt redacted from command replay>"],
                stdout=completed.stdout[-12000:],
                error=completed.stderr[-4000:] or None,
            )
        return operation

    @staticmethod
    def _git(repo_path: Path, args: list[str]) -> str:
        result = subprocess.run(["git", *args], cwd=repo_path, text=True, capture_output=True, check=False)
        return result.stdout

    @staticmethod
    def _safe_prompt(mission: str) -> str:
        return f"""You are Codex working for Umbra in a disposable local checkout.
Mission: {mission}

Hard rules: never push, commit, create a PR, merge, approve, deploy, force-push,
or expose a secret. You may inspect and edit only this checkout. Make the minimum
safe change, run relevant tests, and finish with a concise explanation of changed
files, exact tests run, and anything that prevented verification."""

    @staticmethod
    def _reason_prompt(mission: str) -> str:
        return f"""You are Codex acting as Umbra's reasoning analyst in a read-only, empty workspace.
Task:
{mission}

Rules: There is no repository here. Do not attempt to edit, create, run, push, or
inspect any files. Reason only from the text supplied in the task above. Never
invent files, line numbers, commit SHAs, CVEs, or behavior. If the supplied
context is insufficient, say so plainly. Respond with a concise, well-structured
analysis and nothing else."""

    @staticmethod
    def _demo_operation(prompt: str, files: list[str]) -> CodexOperation:
        return CodexOperation(prompt, "Demo Codex result replayed from cache; no CLI invocation was made.", "", None, files, "demo-cache", datetime.now(UTC).isoformat())

    @staticmethod
    def _disabled_operation(prompt: str, files: list[str]) -> CodexOperation:
        return CodexOperation(prompt, "Live Codex is disabled. Set UMBRA_ENABLE_CODEX_CLI=true to run a real disposable-checkout task.", "", None, files, "codex-cli-disabled", datetime.now(UTC).isoformat())

    def _record(self, operation: CodexOperation) -> CodexOperation:
        if self.replay_dir:
            self.replay_dir.mkdir(parents=True, exist_ok=True)
            name = f"codex-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.json"
            (self.replay_dir / name).write_text(json.dumps(operation.as_dict(), indent=2))
        return operation
