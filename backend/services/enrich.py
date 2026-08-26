"""Read-model enrichment for contacts + decisions (Epic 8 Sprint 4 --
extracted from server.py).

Hydrates list/detail payloads with assignee names, creator names, and nested
enriched tasks. Depends on core.db + services.tasks.enrich_tasks; imports
nothing from server.
"""
from typing import Optional

from core import db
from services.tasks import enrich_tasks


async def enrich_contacts(contacts: list) -> list:
    ids = list({c.get("assigned_id") for c in contacts if c.get("assigned_id")})
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            umap[u["id"]] = u["name"]
    for c in contacts:
        c["assigned_name"] = umap.get(c.get("assigned_id"))
    return contacts


async def enrich_decision(d: dict, tenant_id: Optional[str] = None) -> dict:
    # FIX-003-B (S2-05): defense-in-depth tenant filter. In today's flow,
    # a decision's task_ids and created_by are always same-tenant (the
    # decision itself came from a tenant-scoped query), but the bare
    # {"id": {"$in": ...}} lookup would happily return cross-tenant
    # matches if any bug or corrupted document ever slipped a foreign
    # id into task_ids. Filter defensively.
    tid = tenant_id if tenant_id is not None else d.get("tenant_id")
    task_q = {"id": {"$in": d.get("task_ids", [])}}
    if tid:
        task_q["tenant_id"] = tid
    tasks = await db.tasks.find(task_q, {"_id": 0}).to_list(200)
    user_q = {"id": d.get("created_by")}
    if tid:
        user_q["tenant_id"] = tid
    creator = await db.users.find_one(user_q, {"_id": 0, "name": 1})
    d["tasks"] = await enrich_tasks(tasks)
    d["created_by_name"] = creator["name"] if creator else "Unknown"
    return d


async def enrich_decisions(decisions: list, tenant_id: Optional[str] = None) -> list:
    # FIX-003-B (S2-05): defense-in-depth tenant filter — see
    # enrich_decision above. Same tenancy invariant applies at the
    # batch level. The `tenant_id` argument is optional so existing
    # callers keep working; when supplied it filters the id-lookups.
    # If not supplied AND every decision has the same tenant_id, we
    # infer it (the common case for a per-tenant caller). Only when
    # the input mixes tenants (never happens in practice today, but a
    # future admin cross-tenant sweep might) do we skip the filter.
    task_ids = list({tid for d in decisions for tid in d.get("task_ids", [])})
    creator_ids = list({d.get("created_by") for d in decisions if d.get("created_by")})
    scope_tid = tenant_id
    if scope_tid is None:
        tids_in_batch = {d.get("tenant_id") for d in decisions if d.get("tenant_id")}
        if len(tids_in_batch) == 1:
            scope_tid = next(iter(tids_in_batch))
    tasks_map = {}
    if task_ids:
        task_q = {"id": {"$in": task_ids}}
        if scope_tid:
            task_q["tenant_id"] = scope_tid
        for t in await enrich_tasks(await db.tasks.find(task_q, {"_id": 0}).to_list(2000)):
            tasks_map[t["id"]] = t
    users_map = {}
    if creator_ids:
        user_q = {"id": {"$in": creator_ids}}
        if scope_tid:
            user_q["tenant_id"] = scope_tid
        for u in await db.users.find(user_q, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            users_map[u["id"]] = u["name"]
    for d in decisions:
        d["tasks"] = [tasks_map[t] for t in d.get("task_ids", []) if t in tasks_map]
        d["created_by_name"] = users_map.get(d.get("created_by"), "Unknown")
        d.setdefault("dtype", "directive")
        d.setdefault("confidence", None)
    return decisions
