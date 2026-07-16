from pathlib import Path

from backend.remediation import bump_manifest, pick_fixed_version


def test_pick_fixed_version_smallest_greater_than_current():
    advisories = [
        {"affected": [{"ranges": [{"events": [{"introduced": "0"}, {"fixed": "1.2.3"}]}]}]},
        {"affected": [{"ranges": [{"events": [{"fixed": "2.0.0"}]}]}]},
    ]
    assert pick_fixed_version(advisories, "1.0.0") == "1.2.3"


def test_pick_fixed_version_none_when_no_fix_listed():
    advisories = [{"affected": [{"ranges": [{"events": [{"introduced": "0"}]}]}]}]
    assert pick_fixed_version(advisories, "1.0.0") is None


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
