"""Small, transparent dependency manifest discovery for Watchman."""
from __future__ import annotations

import json
import re
from pathlib import Path


def discover_dependencies(repo_path: Path, limit: int = 40) -> list[dict[str, str]]:
    """Extract pinned npm and PyPI dependencies without executing project code."""
    dependencies: list[dict[str, str]] = []
    package_json = repo_path / "package.json"
    if package_json.exists():
        try:
            manifest = json.loads(package_json.read_text())
            for section in ("dependencies", "optionalDependencies"):
                for name, version in manifest.get(section, {}).items():
                    clean = str(version).lstrip("^~=<> ")
                    if clean and "*" not in clean:
                        dependencies.append({"name": name, "version": clean, "ecosystem": "npm"})
        except (OSError, json.JSONDecodeError):
            pass
    requirements = repo_path / "requirements.txt"
    if requirements.exists():
        for line in requirements.read_text(errors="ignore").splitlines():
            match = re.match(r"^\s*([A-Za-z0-9_.-]+)\s*==\s*([A-Za-z0-9_.+-]+)", line)
            if match:
                dependencies.append({"name": match.group(1), "version": match.group(2), "ecosystem": "PyPI"})
    return dependencies[:limit]
