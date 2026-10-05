"""The owner's AI keys never reach a browser (2026-09-20).

Settings audit: /auth/me, sign-in and every settings save answered with the
whole tenant record, and `tenant.ai_keys` holds the owner's own provider keys
in plain text — so every member's browser held them, though the Workspace card
says keys are never shown in full. Proven on a throwaway database: a key the
owner saved came back whole in a Sales member's /auth/me.

Every tenant read that answers a browser now uses TENANT_PUBLIC, which leaves
`ai_keys` out. Only the /tenant/ai-keys endpoints read the raw map, and they
answer with a masked summary.
"""
import os
import re
from pathlib import Path

import pytest

import routers.auth as rauth
import routers.tenant_settings as ts
from models.tenant import TenantSettingsInput

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-keys"
SECRET = "sk-PROBE-never-in-a-browser-1234567890"
ROUTERS = Path(__file__).resolve().parents[1] / "routers"


def _patch(testdb, *mods):
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb

    def restore():
        for m, d in saved:
            m.db = d
    return restore


async def _seed(db):
    # lexicon / operating model / finance categories present, so /auth/me does
    # not reach for the AI to backfill them
    await db.tenants.insert_one({
        "id": TENANT, "name": "Keys Co", "industry": "Textiles",
        "lexicon": {"customer": {"singular": "Buyer", "plural": "Buyers"}},
        "operating_model": {"pipelines": [{"key": "sales", "label": "Sales", "stages": []}]},
        "finance_categories": {"expense": ["Other"], "asset": ["Other"]},
        "ai_keys": {"openai": SECRET},
    })


MEMBER = {"id": "u-sales", "tenant_id": TENANT, "name": "Priya", "role": "sales", "permissions": []}
OWNER = {"id": "u-owner", "tenant_id": TENANT, "name": "Rajesh", "role": "owner", "permissions": []}


def test_a_members_auth_me_carries_no_ai_keys(with_test_db):
    # /me reaches many modules now (permissions, setup claim): rebind them all,
    # or one binds the shared Mongo client to this test's loop and breaks the next.
    from tests.e2e_harness import e2e_env

    async def scenario(db):
        restore = _patch(db, rauth)          # routers.auth is not in the harness list
        try:
            with e2e_env(db):
                return await _me(db)
        finally:
            restore()

    async def _me(db):
        await _seed(db)
        # /me takes the request + response since B27 (CSRF token echo)
        from starlette.requests import Request
        from starlette.responses import Response
        req = Request({"type": "http", "method": "GET", "path": "/api/auth/me", "headers": []})
        return await rauth.me(req, Response(), user=MEMBER)

    out = with_test_db(scenario)
    assert out["tenant"]["name"] == "Keys Co", "the tenant still comes back"
    assert "ai_keys" not in out["tenant"]
    assert SECRET not in repr(out)


def test_a_settings_save_answers_without_the_keys(with_test_db):
    # A save logs the change (core.log_activity): with only tenant_settings
    # rebound, that write went to the real database, and failed outright once
    # any earlier test had bound the shared client to another event loop.
    from tests.e2e_harness import e2e_env

    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            saved = await ts.update_tenant_settings(TenantSettingsInput(high_value_threshold=75000), user=OWNER)
            summary = await ts.get_tenant_ai_keys(user=OWNER)
            return saved, summary

    saved, summary = with_test_db(scenario)
    assert saved["high_value_threshold"] == 75000
    assert "ai_keys" not in saved and SECRET not in repr(saved)
    # the AI keys card still knows a key is there — masked
    openai = next(p for p in summary["providers"] if p["provider"] == "openai")
    assert openai["has_tenant_key"] is True and SECRET not in repr(summary)


def test_no_router_sends_a_whole_tenant_record():
    """Guard: a new `find_one(..., {"_id": 0})` on tenants would bring the keys
    back. The /tenant/ai-keys endpoints are the one place allowed the raw map."""
    offenders = []
    for f in ROUTERS.glob("*.py"):
        lines = f.read_text(encoding="utf-8").split("\n")
        allowed = set()
        if f.name == "tenant_settings.py":
            start = next(i for i, l in enumerate(lines) if '"/tenant/ai-keys"' in l)
            end = next(i for i, l in enumerate(lines) if "owner-exclusions" in l and "@" in l)
            allowed = set(range(start, end))
        for i, l in enumerate(lines):
            if i not in allowed and re.search(r'db\.tenants\.find(_one)?\(.*\{"_id": ?0\}\)', l):
                offenders.append(f"{f.name}:{i + 1}")
    assert offenders == [], offenders
