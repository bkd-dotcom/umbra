from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class Replay:
    agent: str
    prompt: str
    codex_diff: str
    tests: str
    reasoning: str
    timings: dict[str, int]


@dataclass
class AgentResult:
    agent: str
    summary: str
    findings: list[dict[str, Any]]
    replay: Replay

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

