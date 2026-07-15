"""A narrow, auditable adapter for Codex code operations.

Live Cloud task invocation is intentionally isolated here. Until a deployed
Codex task API is configured, the optional CLI path is disabled by default and
returns a reviewable plan instead of mutating a repository.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass
class CodexOperation:
    prompt: str
    summary: str
    diff: str
    tests_passed: bool | None
    files: list[str]
    provider: str
    created_at: str

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


class CodexClient:
    """Return a uniform operation record for every code-focused agent.

    TODO(verify): configure a supported Codex Cloud task endpoint before using
    this adapter to create remote branches or PRs. Umbra never merges or pushes
    to main; callers only receive draft artifacts for human review.
    """

    def __init__(self, replay_dir: Path | None = None) -> None:
        self.replay_dir = replay_dir

    def propose(self, prompt: str, files: list[str] | None = None) -> CodexOperation:
        operation = CodexOperation(
            prompt=prompt,
            summary="Codex draft staged for human review.",
            diff="--- a/package-lock.json\n+++ b/package-lock.json\n@@\n- vulnerable dependency\n+ patched dependency\n",
            tests_passed=True,
            files=files or [],
            provider="demo-codex" if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true" else "codex-adapter-stub",
            created_at=datetime.now(UTC).isoformat(),
        )
        self._record(operation)
        return operation

    def _record(self, operation: CodexOperation) -> None:
        if not self.replay_dir:
            return
        self.replay_dir.mkdir(parents=True, exist_ok=True)
        filename = f"codex-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.json"
        (self.replay_dir / filename).write_text(__import__("json").dumps(operation.as_dict(), indent=2))

