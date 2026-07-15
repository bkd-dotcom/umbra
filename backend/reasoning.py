"""Responses API adapter for Umbra's reasoning layer.

The request shape below follows the current Responses API. No temperature is sent
to reasoning models; callers select an explicit reasoning effort instead.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from collections.abc import Iterator


MODELS: dict[str, tuple[str, str]] = {
    "deep": ("gpt-5.6-sol", "high"),
    "work": ("gpt-5.6-terra", "medium"),
    "fast": ("gpt-5.6-luna", "low"),
}


@dataclass(frozen=True)
class ReasoningResult:
    text: str
    model: str
    effort: str
    provider: str


def reason(tier: str, developer: str, user: str, effort: str | None = None) -> ReasoningResult:
    """Run a Responses request or produce a deterministic, safe demo explanation."""
    if tier not in MODELS:
        raise ValueError(f"Unknown reasoning tier: {tier}")
    model, default_effort = MODELS[tier]
    selected_effort = effort or default_effort
    if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
        return ReasoningResult(
            text="Demo reasoning is replayed from Umbra's verified cache; no model request was made.",
            model=model,
            effort=selected_effort,
            provider="demo-cache",
        )
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required unless UMBRA_DEMO_MODE=true")
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model,
            reasoning={"effort": selected_effort},
            input=[
                {"role": "developer", "content": developer},
                {"role": "user", "content": user},
            ],
        )
    except Exception as exc:  # caller falls back to cached material at the boundary
        raise RuntimeError(f"Reasoning request failed: {exc}") from exc
    return ReasoningResult(response.output_text, model, selected_effort, "responses-api")


def reason_stream(tier: str, developer: str, user: str, effort: str | None = None) -> Iterator[str]:
    """Yield Responses text deltas, with the same no-fabrication boundary as ``reason``."""
    if tier not in MODELS:
        raise ValueError(f"Unknown reasoning tier: {tier}")
    model, default_effort = MODELS[tier]
    selected_effort = effort or default_effort
    if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
        yield "Demo reasoning stream replayed from cache; no model request was made."
        return
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required unless UMBRA_DEMO_MODE=true")
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        with client.responses.stream(
            model=model,
            reasoning={"effort": selected_effort},
            input=[{"role": "developer", "content": developer}, {"role": "user", "content": user}],
        ) as stream:
            for event in stream:
                if event.type == "response.output_text.delta":
                    yield event.delta
    except Exception as exc:
        raise RuntimeError(f"Reasoning stream failed: {exc}") from exc
