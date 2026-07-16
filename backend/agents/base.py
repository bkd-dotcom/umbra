from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

# Shown when a request is not permitted to spend server-side Codex credits
# (i.e. anyone who is not the founder on the hosted deploy).
CODEX_HOST_NOTE = (
    "Live Codex diffs are founder-only on the hosted demo. Run Umbra locally with your "
    "own `codex login`, or connect your own OpenAI key for live reasoning."
)


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
    # Only treat it as real reasoning when Codex actually succeeded (rc 0) and
    # returned text — a failed run (rc≠0) carries an error string, not analysis,
    # so it degrades to a clean ``unavailable`` state rather than masquerading.
    if operation.provider == "codex-cli" and operation.tests_passed and operation.summary.strip():
        return operation.summary, "codex-cli"
    return f"GPT-5.6 reasoning unavailable: {error}", "unavailable"


def reasoning_from_operation(operation: Any) -> tuple[str, str] | None:
    """Reuse a successful live Codex ``propose`` as the reasoning.

    Codex's own prompt already asks it to explain the change it made, so the
    operation summary IS a genuine (``codex-cli``) analysis — reusing it lets an
    agent make **one** Codex call instead of two (propose + a separate analyze),
    which is the single biggest per-scan speedup. Returns ``None`` when the
    operation is not a usable live result (disabled, failed, or empty), so the
    caller falls back to a dedicated reasoning pass and never fabricates.
    """
    if operation.provider == "codex-cli" and operation.tests_passed and operation.summary.strip():
        return operation.summary, "codex-cli"
    return None


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
    # Optional per-agent context surfaced to the UI (e.g. Watchman's discovered
    # dependency list so the dashboard's map/radar reflect the real repo).
    dependencies: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
