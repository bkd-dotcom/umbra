"""Independent Verifier (Phase 2.2): the deterministic second opinion.

Pins that the verifier blocks on hard safety failures (contract, secret), never
fabricates a test pass, actually confirms the advisory-clearing version out of
the produced manifest, and reports honest evidence completeness.
"""
from backend.contract import contract_from_dict, evaluate_contract
from backend.verifier import verify_change


def _clean_contract_result(files):
    c = contract_from_dict({"allowed_paths": ["package.json", "package-lock.json"], "max_files_changed": 3})
    return evaluate_contract(files, c)


def test_reviewable_when_all_hard_checks_pass():
    changes = {"package.json": '{"dependencies": {"next": "14.2.33"}}', "package-lock.json": "{}"}
    cr = _clean_contract_result(list(changes))
    report = verify_change(changes, cr, package="next", fixed_version="14.2.33", cve="GHSA-x",
                           test_command="npm test", test_exit_code=0, claimed_files=["package.json", "package-lock.json"])
    assert report.status == "reviewable" and not report.blocked
    # Every check resolved (no unavailable) → full completeness.
    assert report.evidence_completeness == 100
    names = {c.name: c.status for c in report.checks}
    assert names["contract"] == "pass" and names["secret_scan"] == "pass"
    assert names["advisory_cleared"] == "pass" and names["tests"] == "pass" and names["citations"] == "pass"


def test_blocked_on_contract_violation():
    changes = {"deploy/prod.yaml": "x: 1"}
    c = contract_from_dict({"allowed_paths": ["package.json"], "forbidden_paths": ["deploy/**"], "max_files_changed": 2})
    cr = evaluate_contract(list(changes), c)
    report = verify_change(changes, cr)
    assert report.blocked and report.status == "blocked"
    assert any(c.name == "contract" and c.status == "fail" for c in report.checks)


def test_blocked_on_introduced_secret():
    changes = {"package.json": 'const k = "sk-abcdefghijklmnopqrstuvwx1234567890"'}
    cr = _clean_contract_result(list(changes))
    report = verify_change(changes, cr)
    assert report.blocked
    assert report.secrets_found >= 1
    assert any(c.name == "secret_scan" and c.status == "fail" for c in report.checks)


def test_advisory_cleared_detects_insufficient_bump():
    # Pinned at 14.2.5 but the required fix is 14.2.33 → advisory NOT cleared.
    changes = {"package.json": '{"dependencies": {"next": "14.2.5"}}'}
    cr = _clean_contract_result(list(changes))
    report = verify_change(changes, cr, package="next", fixed_version="14.2.33")
    assert any(c.name == "advisory_cleared" and c.status == "fail" for c in report.checks)
    # A version-scope failure is NOT a hard block (it's advisory), but a reviewer sees it.
    assert report.status == "reviewable"


def test_advisory_cleared_accepts_sufficient_bump_pypi():
    changes = {"requirements.txt": "flask==2.3.3\n"}
    cr = contract_from_dict({"allowed_paths": ["requirements.txt"], "max_files_changed": 2})
    report = verify_change(changes, evaluate_contract(list(changes), cr), package="flask", fixed_version="2.3.0")
    assert any(c.name == "advisory_cleared" and c.status == "pass" for c in report.checks)


def test_tests_unavailable_never_faked():
    changes = {"package.json": "{}"}
    cr = _clean_contract_result(list(changes))
    report = verify_change(changes, cr)  # no test_command supplied
    tests = next(c for c in report.checks if c.name == "tests")
    assert tests.status == "unavailable" and "human validation required" in tests.detail.lower()
    # Missing soft evidence lowers completeness but stays reviewable.
    assert report.status == "reviewable" and report.evidence_completeness < 100


def test_citations_detects_phantom_file():
    changes = {"package.json": "{}"}
    cr = _clean_contract_result(list(changes))
    report = verify_change(changes, cr, claimed_files=["package.json", "src/ghost.py"])
    cit = next(c for c in report.checks if c.name == "citations")
    assert cit.status == "fail" and "ghost.py" in cit.detail


def test_report_is_json_serializable_shape():
    changes = {"package.json": "{}"}
    cr = _clean_contract_result(list(changes))
    pub = verify_change(changes, cr).to_public()
    assert set(pub) >= {"status", "blocked", "evidence_completeness", "changed_files", "secrets_found", "checks"}
    assert isinstance(pub["checks"], list) and all("name" in c and "status" in c for c in pub["checks"])
