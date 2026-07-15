from backend.preflight import run_preflight


def test_preflight_never_blocks_demo(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    report = run_preflight(verify_clone=False)
    assert set(report["models"]) == {"fast", "work", "deep"}
    assert report["clone"]["status"] == "skipped"
