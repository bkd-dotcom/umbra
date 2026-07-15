"""Bundled cache used by every zero-network Umbra surface."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


CACHE_PATH = Path(__file__).parent / "cache" / "demo_cache.json"


def load_demo_cache() -> dict[str, Any]:
    return json.loads(CACHE_PATH.read_text())
