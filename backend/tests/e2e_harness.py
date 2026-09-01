"""Shared harness for Epic 10 Sprint 12 in-process E2E persona journeys.

Every router/service does `from core import db` at import, binding its OWN
module-level `db` name to the one production AsyncMongoClient. To drive a real
journey against an isolated `with_test_db` Mongo we must rebind `THATMODULE.db`
for every module the call graph awaits on, and replace (no-op / stub) the
fire-and-forget writers + LLM/transport leaves so nothing touches a production
client bound to a foreign event loop.

Usage (inside ONE with_test_db scenario -> one asyncio loop):

    with e2e_env(testdb, stubs={"services.ai.extraction.ai_extract": my_fake}):
        await decisions.approve_decision("dec1", user=owner)

Keep everything on the single loop `with_test_db` provides; these tests are
single-process (skipif PYTEST_XDIST_WORKER) because they reach shared clients.
"""
import contextlib
import importlib

# modules that hold a `db` global the journey call-graph awaits on
_DB_MODULES = [
    # every module that does `from database import db` binds its OWN name -> patch each
    "database", "core", "core.deps", "core.ai_keys", "core.security", "core.usage",
    "routers.decisions", "routers.tasks", "routers.ledger", "routers.operating_score",
    "routers.contacts", "routers.crm", "routers.complaints", "routers.captures",
    "routers.voice_notes", "routers.team", "routers.calendar", "routers.workflows",
    "routers.whatsapp", "routers.brief",
    "services.tasks", "services.operating_score", "services.workflow_engine",
    "services.voice", "services.captures", "services.whatsapp", "services.ingestion",
    "services.inbox", "services.leave", "services.enrich", "services.notifications",
    "services.ai.generators", "services.ai.brain_context",
]

# fire-and-forget writers to neutralise: (module, attr, kind) where kind is
# "noop" (async -> None) or "identity" (async(d, ...) -> d).
_NEUTRALISE = [
    ("services.ai.brain_context", "record_context", "noop"),
    ("core", "add_decision_event", "noop"),
    ("core", "log_activity", "noop"),
    ("services.notifications", "push_notification", "noop"),
    ("services.enrich", "enrich_decision", "identity"),
    ("services.enrich", "enrich_decisions", "identity_list"),
]


async def _noop(*a, **k):
    return None


async def _identity(d, *a, **k):
    return d


async def _identity_list(items, *a, **k):
    return items


@contextlib.contextmanager
def e2e_env(testdb, stubs=None, keep=()):
    """Patch every journey module's db to `testdb`, neutralise fire-and-forget
    writers, and apply per-test LLM/transport stubs. Restores everything on exit.

    `stubs` maps "package.module.attr" -> callable (usually an async fake).
    `keep` is a set of "package.module.attr" fire-and-forget writers to leave
    REAL (their db is patched to testdb, so they write there) -- e.g. keep
    brain_context.record_context real to assert provenance was written.
    """
    saved = []   # (module_obj, attr, original)
    keep = set(keep)

    def _set(mod, attr, value):
        saved.append((mod, attr, getattr(mod, attr)))
        setattr(mod, attr, value)

    # 1) rebind db globals
    for name in _DB_MODULES:
        try:
            mod = importlib.import_module(name)
        except Exception:
            continue
        if hasattr(mod, "db"):
            _set(mod, "db", testdb)

    # 2) neutralise fire-and-forget writers (unless kept real)
    kindfn = {"noop": _noop, "identity": _identity, "identity_list": _identity_list}
    for name, attr, kind in _NEUTRALISE:
        if f"{name}.{attr}" in keep:
            continue
        try:
            mod = importlib.import_module(name)
        except Exception:
            continue
        if hasattr(mod, attr):
            _set(mod, attr, kindfn[kind])

    # 3) per-test stubs (LLM / transport leaves)
    for dotted, fn in (stubs or {}).items():
        modname, attr = dotted.rsplit(".", 1)
        mod = importlib.import_module(modname)
        _set(mod, attr, fn)

    try:
        yield
    finally:
        for mod, attr, original in reversed(saved):
            setattr(mod, attr, original)


# --- tiny seed helpers ------------------------------------------------------
def owner(tenant="t1", uid="u-owner"):
    return {"id": uid, "tenant_id": tenant, "role": "owner", "name": "Owner"}


def member(role, tenant="t1"):
    return {"id": f"u-{role}", "tenant_id": tenant, "role": role, "name": f"{role.title()} User"}


async def seed_tenant_and_users(testdb, tenant="t1", roles=("finance", "sales", "operations")):
    from shared.ids import now_iso
    await testdb.tenants.insert_one({
        "id": tenant, "company_name": "Weave Co", "industry": "Textile Manufacturing",
        "plan": "business", "created_at": now_iso()})
    await testdb.users.insert_one({
        "id": "u-owner", "tenant_id": tenant, "role": "owner", "name": "Owner",
        "email": f"owner@{tenant}.test", "created_at": now_iso()})
    for r in roles:
        await testdb.users.insert_one({
            "id": f"u-{r}", "tenant_id": tenant, "role": r, "name": f"{r.title()} User",
            "email": f"{r}@{tenant}.test", "created_at": now_iso()})
    # active memberships so RBAC / assignment see them
    from core.permissions import ROLE_DEFAULT_PERMS
    for r in ("owner",) + tuple(roles):
        await testdb.memberships.insert_one({
            "id": f"m-{r}", "tenant_id": tenant, "user_id": "u-owner" if r == "owner" else f"u-{r}",
            "role": r, "status": "active",
            "permissions": list(ROLE_DEFAULT_PERMS.get(r, [])), "created_at": now_iso()})
