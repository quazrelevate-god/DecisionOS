"""API-parity contract gate (Epic 8 Sprint 10 -- U8-10.1).

The whole Epic 8 refactor promised ZERO change to external API behaviour. This
test is that promise, made executable and permanent: it asserts the app's route
surface (every method+path) and middleware stack match a committed baseline.

Any structural change -- an endpoint moved, renamed, dropped, or a middleware
reordered -- fails here with an explicit added/removed diff. When a change is
*intended* (a genuinely new feature endpoint), regenerate the baseline:

    python tests/regen_api_baseline.py

and commit it in the same change, so the diff is reviewed, never silent.

This runs without a database: importing `server` builds the app with a lazy
Mongo client, so no network is touched.
"""
import hashlib
import json
import os

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BASELINE = os.path.join(_HERE, "fixtures", "api_route_baseline.json")


def _current():
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
    return {"count": len(rows), "sha": sha, "middleware": mids, "routes": rows}


@pytest.fixture(scope="module")
def baseline():
    with open(_BASELINE) as f:
        return json.load(f)


def test_route_count_matches(baseline):
    cur = _current()
    assert cur["count"] == baseline["count"], (
        f"route count drifted: baseline {baseline['count']} -> current {cur['count']}"
    )


def test_route_set_matches(baseline):
    cur = _current()
    added = sorted(set(cur["routes"]) - set(baseline["routes"]))
    removed = sorted(set(baseline["routes"]) - set(cur["routes"]))
    assert not added and not removed, (
        "API route surface changed -- regenerate the baseline if intended:\n"
        + "".join(f"  + {a}\n" for a in added)
        + "".join(f"  - {r}\n" for r in removed)
    )


def test_fingerprint_sha_matches(baseline):
    cur = _current()
    assert cur["sha"] == baseline["sha"], (
        f"route fingerprint sha drifted: {baseline['sha'][:16]} -> {cur['sha'][:16]}"
    )


def test_middleware_stack_matches(baseline):
    cur = _current()
    # Starlette reverses add-order: CORS added first, CSRF second -> [CSRF, CORS].
    assert cur["middleware"] == baseline["middleware"], (
        f"middleware stack changed: {baseline['middleware']} -> {cur['middleware']}"
    )
