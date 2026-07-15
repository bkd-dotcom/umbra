import asyncio

from backend.main import health


def test_health_is_available_without_secrets(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    result = asyncio.run(health())
    assert result["status"] == "ok"
    assert result["mode"] == "demo"
    assert result["ready"] is True

