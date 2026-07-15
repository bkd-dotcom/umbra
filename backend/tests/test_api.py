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


def test_static_ui_mount_never_shadows_api_routes():
    """The single-service deploy mounts the dashboard at '/'. That mount is
    greedy — if it is registered before any /api route, it silently swallows
    the API call (this once broke the /api/events SSE stream). Guard the order.
    Vacuously passes when the static bundle is absent (dev / fresh checkout)."""
    routes = app.router.routes
    mount_indices = [i for i, r in enumerate(routes) if getattr(r, "name", None) == "ui"]
    if not mount_indices:
        return  # frontend/out not built in this environment — nothing to shadow
    api_indices = [i for i, r in enumerate(routes) if getattr(r, "path", "").startswith("/api")]
    assert api_indices, "expected /api routes to be registered"
    assert max(api_indices) < min(mount_indices), (
        "the '/' UI mount is registered before an /api route and will shadow it"
    )
