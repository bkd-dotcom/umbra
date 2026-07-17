from pathlib import Path

from backend.remediation import bump_manifest, pick_fixed_version


def test_pick_fixed_version_clears_every_advisory_not_the_smallest():
    # Two advisories both affect 1.0.0, fixed at 1.2.3 and 2.0.0. Bumping to 1.2.3
    # (the old global-minimum behaviour) still leaves the package vulnerable to the
    # 2.0.0 advisory — so the safe answer clears BOTH: 2.0.0.
    advisories = [
        {"affected": [{"ranges": [{"events": [{"introduced": "0"}, {"fixed": "1.2.3"}]}]}]},
        {"affected": [{"ranges": [{"events": [{"fixed": "2.0.0"}]}]}]},
    ]
    assert pick_fixed_version(advisories, "1.0.0") == "2.0.0"


def test_pick_fixed_version_none_when_no_fix_listed():
    advisories = [{"affected": [{"ranges": [{"events": [{"introduced": "0"}]}]}]}]
    assert pick_fixed_version(advisories, "1.0.0") is None


# A next@14.2.5-shaped fixture: one advisory is fixed inside the 14.x line, another
# (the one we actually target) is only fixed in 15.x. Picking the global smallest
# (14.2.7) would leave the targeted advisory unremediated — the real reviewer bug.
_NEXT_LIKE = [
    {"id": "GHSA-g77x-44xx-532m", "aliases": ["CVE-2024-47831"],
     "affected": [{"ranges": [{"events": [{"introduced": "0"}, {"fixed": "14.2.7"}]}]}]},
    {"id": "GHSA-h25m-26qc-wcjf", "aliases": [],
     "affected": [{"ranges": [{"events": [{"introduced": "13.0.0"}, {"fixed": "15.0.8"}]}]}]},
]


def test_pick_fixed_version_targets_named_advisory_by_id():
    # The remediation queue names GHSA-h25m-26qc-wcjf → its fix is 15.0.8, NOT the
    # unrelated global-minimum 14.2.7.
    assert pick_fixed_version(_NEXT_LIKE, "14.2.5", cve="GHSA-h25m-26qc-wcjf") == "15.0.8"


def test_pick_fixed_version_targets_named_advisory_by_alias():
    # A caller passing the CVE alias instead of the GHSA id still resolves correctly.
    assert pick_fixed_version(_NEXT_LIKE, "14.2.5", cve="cve-2024-47831") == "14.2.7"


def test_pick_fixed_version_no_cve_clears_all_advisories():
    # With no specific CVE, the bump must escape every advisory affecting current.
    assert pick_fixed_version(_NEXT_LIKE, "14.2.5") == "15.0.8"


def test_pick_fixed_version_unmatched_cve_falls_back_to_clear_all():
    # A CVE that matches no advisory falls back to the safe clear-all version
    # rather than opening a PR that improves nothing.
    assert pick_fixed_version(_NEXT_LIKE, "14.2.5", cve="CVE-9999-0000") == "15.0.8"


def test_bump_manifest_npm_preserves_range_and_siblings(tmp_path: Path):
    (tmp_path / "package.json").write_text('{\n  "dependencies": {\n    "lodash": "^4.17.20",\n    "left-pad": "1.0.0"\n  }\n}\n')
    result = bump_manifest(tmp_path, "lodash", "npm", "4.17.21")
    assert result is not None
    path, content = result
    assert path == "package.json"
    assert '"lodash": "^4.17.21"' in content  # range operator preserved
    assert '"left-pad": "1.0.0"' in content   # siblings untouched


def test_bump_manifest_pypi(tmp_path: Path):
    (tmp_path / "requirements.txt").write_text("flask==2.0.0\nrequests==2.25.0\n")
    result = bump_manifest(tmp_path, "flask", "PyPI", "2.0.1")
    assert result is not None
    path, content = result
    assert path == "requirements.txt"
    assert "flask==2.0.1" in content
    assert "requests==2.25.0" in content


def test_bump_manifest_missing_package_returns_none(tmp_path: Path):
    (tmp_path / "package.json").write_text('{"dependencies": {"a": "1.0.0"}}')
    assert bump_manifest(tmp_path, "nonexistent", "npm", "2.0.0") is None
