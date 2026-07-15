from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_scan_has_demo_fallback(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    response = client.post("/api/scan", json={"repo_url": "https://github.com/expressjs/express"})
    assert response.status_code == 200
    assert response.json()["umbra_score"] == 82


def test_rejects_non_github_repository():
    response = client.post("/api/scan", json={"repo_url": "https://example.com/not-a-repo"})
    assert response.status_code == 422


def test_ask_stream_has_demo_sse_frame(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    with client.stream("GET", "/api/ask/stream", params={"repo_url": "https://github.com/expressjs/express", "question": "Where is routing?"}) as response:
        body = "".join(response.iter_text())
    assert response.status_code == 200
    assert "Demo Ask Umbra stream replayed" in body
    assert "event: done" in body
