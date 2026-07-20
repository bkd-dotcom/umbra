"""Executable Change Contract (Phase 2.1): parsing, scope enforcement, diff budget.

The contract is the deterministic, offline boundary that gates every PR Umbra
opens. These tests pin its fail-closed behavior: forbidden paths always violate,
allowed_paths is a strict allowlist, and the diff budget is enforced.
"""
from pathlib import Path

from backend.contract import (
    Contract,
    contract_from_dict,
    default_contract,
    evaluate_contract,
    load_contract,
)


def test_default_contract_allows_dependency_files_only():
    c = default_contract()
    assert c.source == "default"
    ok = evaluate_contract(["package.json", "package-lock.json"], c)
    assert ok.passed and ok.status == "pass" and not ok.violations


def test_forbidden_path_is_always_a_violation():
    c = default_contract()
    res = evaluate_contract(["package.json", ".github/workflows/deploy.yml"], c)
    assert not res.passed
    assert any("forbidden" in v.lower() for v in res.violations)


def test_allowlist_blocks_out_of_scope_files():
    c = contract_from_dict({"allowed_paths": ["package.json", "package-lock.json"], "max_files_changed": 5})
    res = evaluate_contract(["package.json", "src/app.py"], c)
    assert not res.passed
    assert any("outside the allowed scope" in v for v in res.violations)
    # And a purely in-scope change passes.
    assert evaluate_contract(["package.json"], c).passed


def test_diff_budget_enforced():
    c = contract_from_dict({"allowed_paths": ["**"], "max_files_changed": 2})
    assert evaluate_contract(["a", "b"], c).passed
    over = evaluate_contract(["a", "b", "c"], c)
    assert not over.passed and any("exceeding the max" in v for v in over.violations)


def test_glob_patterns_match_nested_and_bare():
    c = contract_from_dict({
        "allowed_paths": ["**"],
        "forbidden_paths": ["deploy/**", "**/*secret*", "**/.env*"],
        "max_files_changed": 0,
    })
    assert not evaluate_contract(["deploy/prod/values.yaml"], c).passed
    assert not evaluate_contract(["config/app_secret.txt"], c).passed
    assert not evaluate_contract([".env.production"], c).passed
    assert evaluate_contract(["src/main.py"], c).passed


def test_contract_hash_is_stable_and_scope_sensitive():
    a = contract_from_dict({"allowed_paths": ["package.json"], "max_files_changed": 2})
    b = contract_from_dict({"allowed_paths": ["package.json"], "max_files_changed": 2})
    c = contract_from_dict({"allowed_paths": ["package.json"], "max_files_changed": 3})
    assert a.hash() == b.hash()  # same rules → same hash
    assert a.hash() != c.hash()  # different budget → different hash
    assert a.hash().startswith("sha256:")


def test_load_contract_reads_repo_yaml(tmp_path: Path):
    umbra = tmp_path / ".umbra"
    umbra.mkdir()
    (umbra / "admission.yaml").write_text(
        "version: 1\n"
        "task_type: dependency-remediation\n"
        "allowed_paths:\n"
        "  - package.json\n"
        "  - package-lock.json\n"
        "forbidden_paths:\n"
        "  - deploy/**\n"
        "max_files_changed: 2\n"
        "required_checks:\n"
        "  - npm test\n"
        "network: deny\n"
        "authority_on_success: branch_pr_only\n"
    )
    c = load_contract(tmp_path)
    assert c.source == "repo"
    assert "package.json" in c.allowed_paths and "deploy/**" in c.forbidden_paths
    assert c.max_files_changed == 2 and c.required_checks == ("npm test",)
    # Enforces exactly what the file declared.
    assert evaluate_contract(["package.json", "package-lock.json"], c).passed
    assert not evaluate_contract(["deploy/x.yml"], c).passed


def test_load_contract_missing_file_returns_default(tmp_path: Path):
    c = load_contract(tmp_path)  # no .umbra/admission.yaml
    assert c.source == "default"
    assert c.allowed_paths  # default has a scope


def test_load_contract_none_is_default():
    assert load_contract(None).source == "default"


def test_mini_yaml_fallback_parses_without_pyyaml(monkeypatch):
    # Force the PyYAML import to fail so the tolerant mini-parser is exercised.
    import builtins

    real_import = builtins.__import__

    def _no_yaml(name, *args, **kwargs):
        if name == "yaml":
            raise ImportError("simulated: pyyaml unavailable")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_yaml)
    from backend.contract import _parse_admission_text

    parsed = _parse_admission_text(
        "version: 1\nallowed_paths:\n  - package.json\nmax_files_changed: 2\nnetwork: deny\n"
    )
    assert parsed["version"] == 1
    assert parsed["allowed_paths"] == ["package.json"]
    assert parsed["max_files_changed"] == 2
    assert parsed["network"] == "deny"
