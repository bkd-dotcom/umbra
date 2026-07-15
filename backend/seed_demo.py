"""Validate the bundled demo fixture before a judge-facing deploy."""
from __future__ import annotations

from backend.cache import load_demo_cache


def main() -> None:
    cache = load_demo_cache()
    required = {"repo_url", "umbra_score", "vulnerabilities", "postmortem", "answer", "events", "replays"}
    missing = required.difference(cache)
    if missing:
        raise SystemExit(f"Demo cache is incomplete: {', '.join(sorted(missing))}")
    print(f"Umbra demo cache ready: {cache['repo_url']} · score {cache['umbra_score']}/100")


if __name__ == "__main__":
    main()
