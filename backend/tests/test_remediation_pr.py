"""Consolidated + Reviewer-gated PR flow (Workstream E)."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.agents.reviewer import Reviewer
from backend.main import app
from backend.orchestrator import Orchestrator, _review_block

client = TestClient(app)


def test_assess_change_is_deterministic_and_scales():
    small = Reviewer.assess_change(["package.json"])
    big = Reviewer.assess_change([f"src/mod{i}.py" for i in range(12)])
    assert small["provider"] == "deterministic"
    # More files / blast-radius → higher risk. Auth/payment paths push it further.
    assert big["risk_score"] >= small["risk_score"]
    auth = Reviewer.assess_change(["src/auth/session.py"])
    assert auth["risk_score"] > Reviewer.assess_change(["docs/readme.md"])["risk_score"]
    # A changed test path clears the missing-tests penalty.
    assert Reviewer.assess_change(["tests/test_x.py"])["missing_tests"] is False


def test_review_block_renders_verdict():
    block = _review_block(Reviewer.assess_change(["package.json", "package-lock.json"]))
    assert "Reviewer assessment (deterministic)" in block
    assert "Risk score:" in block and "human review required" in block


def test_combined_pr_requires_diffs():
    # Raises before any checkout/network when no usable diffs are supplied.
    with pytest.raises(ValueError):
        Orchestrator._combined_pr("https://github.com/a/b", "a/b", "tok", ["", "   "])


def test_pr_and_preview_endpoints_require_auth():
    for mode in ("bump", "bump_all", "combine"):
        assert client.post("/api/my/pr", json={"repo_url": "https://github.com/a/b", "mode": mode}).status_code == 401
        assert client.post("/api/my/pr/preview", json={"repo_url": "https://github.com/a/b", "mode": mode}).status_code == 401
