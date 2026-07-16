from fastapi.testclient import TestClient

from backend.main import app, _STATIC_DIR


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


def test_investigate_stream_emits_result_and_done(monkeypatch):
    """The streaming Detective endpoint must emit a structured `result` frame and
    close with `done`, even in demo mode (no network/model call)."""
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    with client.stream("POST", "/api/investigate/stream", json={"repo_url": "https://github.com/expressjs/express", "error_log": "TypeError: boom"}) as response:
        body = "".join(response.iter_text())
    assert response.status_code == 200
    assert "event: result" in body
    assert "event: done" in body


def test_ask_stream_closes_with_done(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    with client.stream("GET", "/api/ask/stream", params={"repo_url": "https://github.com/expressjs/express", "question": "where is routing"}) as response:
        body = "".join(response.iter_text())
    assert response.status_code == 200
    assert "event: done" in body


def test_cron_rescan_requires_matching_key(monkeypatch):
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert client.post("/api/cron/rescan").status_code == 401  # disabled when unset
    monkeypatch.setenv("UMBRA_CRON_KEY", "s3cret")
    assert client.post("/api/cron/rescan", headers={"X-Umbra-Cron-Key": "wrong"}).status_code == 401
    ok = client.post("/api/cron/rescan", headers={"X-Umbra-Cron-Key": "s3cret"})
    assert ok.status_code == 200 and ok.json()["ok"] is True


def test_github_webhook_rejects_bad_signature(monkeypatch):
    monkeypatch.setenv("UMBRA_GITHUB_WEBHOOK_SECRET", "hook-secret")
    r = client.post("/api/webhooks/github", headers={"X-GitHub-Event": "pull_request", "X-Hub-Signature-256": "sha256=deadbeef"}, content=b"{}")
    assert r.status_code == 401


def test_github_webhook_accepts_valid_signature(monkeypatch):
    import hashlib
    import hmac as _hmac
    monkeypatch.setenv("UMBRA_GITHUB_WEBHOOK_SECRET", "hook-secret")
    body = b'{"zen":"hi"}'
    sig = "sha256=" + _hmac.new(b"hook-secret", body, hashlib.sha256).hexdigest()
    r = client.post("/api/webhooks/github", headers={"X-GitHub-Event": "ping", "X-Hub-Signature-256": sig}, content=body)
    assert r.status_code == 200 and r.json().get("ignored_event") == "ping"


def test_watched_repos_store_roundtrip():
    from backend.store import _MemoryStore
    s = _MemoryStore()
    s.put_watched_repos("github:1", ["a/b", "a/b", "c/d"])  # dedup + sort
    assert s.list_watched_repos("github:1") == ["a/b", "c/d"]
    assert s.list_watched_repos("github:2") == []
    assert "github:1" in set(s.all_user_keys())


def test_ai_plugin_manifest_is_served():
    """The classic ChatGPT plugin manifest must be served with no auth and point
    at the served OpenAPI + privacy page."""
    r = client.get("/.well-known/ai-plugin.json")
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == "v1"
    assert body["auth"]["type"] == "none"
    assert body["api"]["url"].endswith("/openapi-actions.yaml")
    assert body["legal_info_url"].endswith("/privacy")


def test_openapi_actions_schema_is_served():
    r = client.get("/openapi-actions.yaml")
    assert r.status_code == 200
    assert "openapi" in r.text and "scanRepo" in r.text


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


def test_static_cache_headers_revalidate_html_and_freeze_hashed_assets():
    """Entry HTML must revalidate (Cache-Control: no-cache) so a new deploy shows
    up on the next refresh instead of a browser-cached stale shell that points at
    old chunk hashes; content-hashed /_next/static assets are immutable. Vacuously
    passes when the static bundle isn't built (dev / fresh checkout)."""
    if not _STATIC_DIR.is_dir():
        return
    root = client.get("/")
    if root.status_code == 200:
        assert root.headers.get("cache-control") == "no-cache"
    assets = list(_STATIC_DIR.glob("_next/static/**/*.js"))
    if assets:
        rel = assets[0].relative_to(_STATIC_DIR).as_posix()
        resp = client.get("/" + rel)
        assert resp.status_code == 200
        assert "immutable" in resp.headers.get("cache-control", "")
