from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


def codex_reasoning(codex: Any, developer: str, user: str, error: Exception) -> tuple[str, str]:
    """Honest reasoning fallback when the Responses API is unavailable.

    The Codex CLI runs a GPT-5.6 model, so it can produce the same analysis the
    Responses API tier would have. The returned provider is always ``codex-cli``
    (never ``responses-api``); if Codex also fails or returns nothing, the
    reasoning degrades to a clearly labelled ``unavailable`` string rather than
    fabricating an explanation.
    """
    try:
        operation = codex.analyze(f"{developer}\n\n{user}")
    except Exception as exc:  # noqa: BLE001 - degrade honestly, never fabricate
        return f"GPT-5.6 reasoning unavailable ({error}); Codex reasoning also failed: {exc}", "unavailable"
    if operation.provider == "codex-cli" and operation.summary.strip():
        return operation.summary, "codex-cli"
    return f"GPT-5.6 reasoning unavailable: {error}", "unavailable"


@dataclass
class Replay:
    agent: str
    prompt: str
    codex_diff: str
    tests: str
    reasoning: str
    timings: dict[str, int]
    providers: dict[str, str] = field(default_factory=dict)


@dataclass
class AgentResult:
    agent: str
    summary: str
    findings: list[dict[str, Any]]
    replay: Replay

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
