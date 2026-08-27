"""Regenerate the committed API-parity baseline (Epic 8 Sprint 10 -- U8-10.1).

Run from backend/ ONLY when an API route change is intentional (a new feature
endpoint, a deliberate removal). Commit the regenerated fixture in the same
change so the diff is reviewed, never silent:

    python tests/regen_api_baseline.py

Then `pytest tests/test_api_parity.py` will be green again.
"""
import hashlib
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_BASELINE = os.path.join(_HERE, "fixtures", "api_route_baseline.json")

if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def main():
    import server
    rows = []
    for r in server.app.routes:
        methods = sorted(getattr(r, "methods", []) or [])
        path = getattr(r, "path", getattr(r, "path_format", "?"))
        for m in (methods or ["*"]):
            rows.append(f"{m} {path}")
    rows.sort()
    mids = [m.cls.__name__ for m in server.app.user_middleware]
    sha = hashlib.sha256("\n".join(rows).encode()).hexdigest()
    os.makedirs(os.path.dirname(_BASELINE), exist_ok=True)
    with open(_BASELINE, "w") as f:
        json.dump({"count": len(rows), "sha": sha, "middleware": mids, "routes": rows}, f, indent=2)
    print(f"baseline regenerated: {len(rows)} route-rows, sha={sha[:16]}, middleware={mids}")


if __name__ == "__main__":
    main()
