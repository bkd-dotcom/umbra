from backend.scoring import RiskInputs, risk_score, umbra_score


def test_reviewer_risk_formula_is_capped():
    assert risk_score(RiskInputs(files_changed=4, blast_radius=2, missing_tests=1, touches_auth=True)) == 95
    assert risk_score(RiskInputs(files_changed=99)) == 100


def test_umbra_score_penalizes_severity_and_secrets():
    healthy = umbra_score()
    risky = umbra_score([{"severity": "critical"}], secrets=1)
    assert healthy == 100
    assert risky < healthy

