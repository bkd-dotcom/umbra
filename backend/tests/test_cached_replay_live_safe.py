"""Regression: the no-note cached replay must never call `propose()` without a
checkout.

On the live service (`UMBRA_DEMO_MODE=false` + `UMBRA_ENABLE_CODEX_CLI=true`) a
non-founder scan hits `_cached_result()` with no note; the old code then called
`self.codex.propose(...)` with no `repo_path`, which raises
`RuntimeError("A checked-out repository is required …")` and 500s the whole scan.
It only survived in demo mode because there `propose()` returns a stub. These
tests lock in the crash-free, honestly-labelled `cache-fallback` behaviour.
"""
import asyncio

from backend.agents.ask import AskUmbra
from backend.agents.detective import Detective
from backend.agents.janitor import Janitor
from backend.agents.reviewer import Reviewer
from backend.agents.watchman import Watchman


def _live(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")


def test_janitor_non_founder_scan_does_not_crash(monkeypatch):
    """The exact production path: allow_codex=False on the live service returns a
    clean cached replay labelled cache-fallback instead of raising."""
    _live(monkeypatch)
    result = asyncio.run(Janitor().run("https://github.com/a/b", allow_codex=False))
    assert result.replay.providers["engineering"] == "cache-fallback"


def test_all_agents_cached_replay_is_live_safe(monkeypatch):
    """No agent's no-note cached replay may raise when Codex CLI is enabled but no
    checkout exists (the shared `... if note else propose()` landmine)."""
    _live(monkeypatch)
    # Each returns an AgentResult without touching the CLI (cached_fallback builds
    # the operation in-process; no subprocess is spawned).
    assert Janitor()._cached_result().replay.providers["engineering"] == "cache-fallback"
    assert Reviewer()._cached_result().replay.providers["review"] == "cache-fallback"
    assert Watchman()._cached_result().replay.providers["engineering"] == "cache-fallback"
    assert AskUmbra()._cached_result().replay.providers["engineering"] == "cache-fallback"
    assert Detective()._cached_result().replay.providers["engineering"] == "cache-fallback"
