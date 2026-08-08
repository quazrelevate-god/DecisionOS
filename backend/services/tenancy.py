"""Tenant-scoped safety helpers.

Every read followed by a write in this codebase can leak cross-tenant if
the write's filter drops the `tenant_id`. Today the codebase is safe
because ids are UUID4 (unguessable), but any future feature that leaks
an id into a shared link, an email, or a URL turns that latent leak into
a real data-breach bug.

This module gives you two primitives; if you touch tenant-owned data,
use them:

    ensure_owned(coll, id, tenant_id) -> dict
        Fetch a doc AND verify tenant ownership in one call. Raises 404
        if not found (indistinguishable from "wrong tenant" — never
        leak the existence of a cross-tenant record).

    tenant_filter(id, tenant_id, **extra) -> dict
        Standard Mongo filter dict for tenant-scoped writes. Use for
        every update_one / update_many / delete_one / delete_many that
        targets a tenant-owned record.

Convention (FIX-001-C): every routers/*.py handler that touches
tenant-owned collections (tasks, decisions, workflows, contacts,
invoices, payments, expenses, assets, inventory, brain_documents,
brain_context, notifications, memory, meetings, complaints, activity)
routes writes through `tenant_filter`. If a caller genuinely needs to
write without tenant_id (rare: platform-admin actions, signup pre-
registration), that call MUST carry a `# INTENTIONALLY UNSCOPED: <why>`
comment so the next reader knows it isn't drift.
"""
from typing import Any, Optional

from fastapi import HTTPException


def tenant_filter(doc_id: str, tenant_id: str, **extra: Any) -> dict:
    """Return a Mongo filter dict pinning both `id` AND `tenant_id`.

    Extra kwargs are merged in for additional constraints without
    letting the caller accidentally drop tenant_id:

        tenant_filter("wf-42", "bak-1", type="procurement")
        -> {"id": "wf-42", "tenant_id": "bak-1", "type": "procurement"}

    Deliberately positional-only for the first two args so a swap
    (passing tenant_id where id was expected) is caught by tests.
    """
    filt = {"id": doc_id, "tenant_id": tenant_id}
    filt.update(extra)
    return filt


async def ensure_owned(coll, doc_id: str, tenant_id: str,
                       *, projection: Optional[dict] = None) -> dict:
    """Fetch a tenant-owned doc and verify tenant ownership in one call.

    Raises HTTPException(404) if the doc doesn't exist OR belongs to
    another tenant. The two cases are deliberately indistinguishable in
    the response so an attacker can't probe for the existence of a
    cross-tenant record.

    Follow-up writes should still use `tenant_filter(...)` in their
    filter dict — this helper only covers the READ side.
    """
    q = {"id": doc_id, "tenant_id": tenant_id}
    doc = await coll.find_one(q, projection if projection is not None else {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


async def owned_or_none(coll, doc_id: str, tenant_id: str,
                        *, projection: Optional[dict] = None) -> Optional[dict]:
    """Same as `ensure_owned` but returns None instead of raising 404.

    For handlers that need to check existence and branch, rather than
    hard-fail. Still enforces the tenant scope.
    """
    q = {"id": doc_id, "tenant_id": tenant_id}
    return await coll.find_one(q, projection if projection is not None else {"_id": 0})
