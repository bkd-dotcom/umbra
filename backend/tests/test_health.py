import asyncio

from backend.main import health


def test_health_is_available_without_secrets(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    result = asyncio.run(health())
    assert result["status"] == "ok"
    assert result["mode"] == "demo"
    assert result["ready"] is True


def test_health_is_ready_in_codex_only_live_mode(monkeypatch):
    # Codex CLI (ChatGPT login) supplies both halves live, with no OpenAI API key.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    result = asyncio.run(health())
    assert result["mode"] == "live"
    assert result["openai_configured"] is False
    assert result["codex_cli_enabled"] is True
    assert result["ready"] is True

