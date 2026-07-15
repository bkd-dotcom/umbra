from backend.features import dependency_galaxy, kill_chain, roi_estimate, scan_secrets


def test_secret_scanner_never_returns_secret_values():
    findings = scan_secrets("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456", "config.py")
    assert findings == [{"file": "config.py", "line": 1, "kind": "OpenAI API key", "confidence": 0.92}]
    assert "abcdef" not in str(findings)


def test_fixture_paths_are_filtered_and_demo_features_are_shaped():
    assert not scan_secrets("sk-abcdefghijklmnopqrstuvwxyz123456", "test/fixtures/example.env")
    assert roi_estimate(3)["findings_automated"] == 3
    assert len(dependency_galaxy()["nodes"]) >= 3
    assert len(kill_chain()) == 4
