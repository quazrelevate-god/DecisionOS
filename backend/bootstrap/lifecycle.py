"""Application bootstrap + lifespan (Epic 8 Sprint 7 -- U8-07.4).

_bootstrap is the startup orchestrator: it ensures indexes, runs one-shot data
migrations, seeds the demo/platform-admin data, and loads AI keys -- all
fire-and-forget so uvicorn can bind the port and answer /health immediately
(slow remote-Atlas seeding must not block the deploy health check).

`lifespan` is the modern replacement for the deprecated @app.on_event startup/
shutdown hooks: it launches _bootstrap + the follow-up scheduler on entry and
closes the Mongo client on exit. server.py passes it to FastAPI(lifespan=...).
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from core import db, client, logger, now_iso, DB_NAME, load_ai_keys_from_db
from services import obj_store
from models.workflows import WORKFLOW_OWNER_ROLE
from bootstrap.seed import seed_demo, fixup_demo_tenant, write_test_credentials
from bootstrap.migrations import (
    migrate_tenants,
    migrate_local_disk_uploads_to_obj_store,
    seed_platform_admin,
)
from workers.schedulers import _followup_scheduler_loop


async def _bootstrap():
    """Idempotent bootstrap (indexes, migrations, demo seed). Runs in the background so it
    never blocks the app from becoming ready, and never crashes the process on failure."""
    # S5-05 audit fix (2026-08-16): hoist the migration ledger import
    # to function-top. Was previously imported at line 6365 (inside the
    # same function) which made `_apply_migration` an UnboundLocal for
    # every earlier reference (backfill_memberships_v1,
    # backfill_grandfathered_plans_v1, rename_production_role). The
    # try/except right after each call silently swallowed the
    # UnboundLocalError, so those 3 migrations have been failing at
    # every boot for weeks -- causing real DB drift: orphaned users
    # missing membership rows, tenants missing plan field, tenants
    # still holding the old 'production' role key.
    from services.migrations import apply_migration as _apply_migration  # noqa: F401

    try:
        # Core tenant-scoped indexes (P0 for multi-tenant scale — every read
        # of these collections filters by tenant_id, so unindexed = full scans).
        await db.users.create_index("email", unique=True)
        await db.users.create_index([("tenant_id", 1), ("role", 1)])
        # FIX-002-D: TTL index on scheduler_locks so expired leader locks
        # get auto-cleaned by Mongo (no separate GC job needed). Sorts by
        # expires_at with expireAfterSeconds=0 = "delete when expires_at
        # is in the past." Doesn't interfere with acquire logic; only
        # removes stale rows for hygiene.
        try:
            await db.scheduler_locks.create_index(
                "expires_at",
                expireAfterSeconds=0,
                name="scheduler_locks_expires_at_ttl",
            )
        except Exception as e:
            logger.warning(f"scheduler_locks TTL index: {e}")
        # FIX-004-F (RBAC-20): audit_log collection indexes.
        # Two hot read patterns: "everything in tenant X since Monday"
        # and "everything user Y did". Timestamp is a string (iso)
        # but sorts lexicographically the same as chrono order — no
        # BSON date conversion needed.
        try:
            await db.audit_log.create_index(
                [("tenant_id", 1), ("timestamp", -1)],
                name="audit_log_tenant_timestamp",
            )
            await db.audit_log.create_index(
                [("actor_id", 1), ("timestamp", -1)],
                name="audit_log_actor_timestamp",
            )
            # Bonus for the entity-scoped view ("everything that
            # happened to this decision") — cheap secondary index.
            await db.audit_log.create_index(
                [("tenant_id", 1), ("entity_type", 1), ("entity_id", 1)],
                name="audit_log_entity",
            )
        except Exception as e:
            logger.warning(f"audit_log indexes: {e}")
        # FIX-004-B (RBAC-13): memberships collection indexes.
        # Compound unique on (user_id, tenant_id) — one membership per
        # (person, workspace). Query indexes for the two hot paths:
        #   * list memberships for a user  (login-ambiguity picker,
        #     /me/workspaces)
        #   * list memberships for a tenant (GET /users, admin views)
        try:
            await db.memberships.create_index(
                [("user_id", 1), ("tenant_id", 1)],
                unique=True,
                name="memberships_user_tenant_unique",
            )
        except Exception as e:
            logger.warning(f"memberships unique index: {e}")
        try:
            await db.memberships.create_index(
                [("user_id", 1), ("status", 1)],
                name="memberships_user_status",
            )
            await db.memberships.create_index(
                [("tenant_id", 1), ("status", 1)],
                name="memberships_tenant_status",
            )
        except Exception as e:
            logger.warning(f"memberships query indexes: {e}")

        # S5-05 audit fix (2026-08-16): indexes for collections shipped
        # in the last 2 sessions that were queried WITHOUT indexes,
        # causing full-scan hot paths + one race-condition bug.
        try:
            # billing_events: UNIQUE on idempotency_key so a webhook
            # retry that races between find_one() and insert_one() in
            # routers/billing.py::razorpay_webhook can't insert a
            # duplicate + double-upgrade a plan. Belt (unique index)
            # AND braces (DuplicateKeyError catch at insert site).
            await db.billing_events.create_index(
                "idempotency_key",
                unique=True,
                name="billing_events_idempotency_key_unique",
            )
            # crm_activities: tenant+contact+created for the
            # ContactProfile timeline read; sorted DESC to match the
            # find(...).sort("created_at", -1) in routers/crm.py.
            await db.crm_activities.create_index(
                [("tenant_id", 1), ("contact_id", 1), ("created_at", -1)],
                name="crm_activities_tenant_contact_created",
            )
            # invoices.source_task_id: FUP-50 auto-invoice dedup key
            # in routers/tasks.py::_maybe_auto_invoice. Partial so
            # only auto-drafted rows contribute (~5% of invoices).
            await db.invoices.create_index(
                [("tenant_id", 1), ("source_task_id", 1)],
                partialFilterExpression={"source_task_id": {"$type": "string"}},
                name="invoices_source_task_id_partial",
            )
        except Exception as e:
            logger.warning(f"S5-05 pre-audit indexes: {e}")

        # Backfill: for every existing user with a tenant_id (the
        # legacy 1:1 model), synthesize the matching membership row.
        # Idempotent: skips users who already have a row for that
        # (user_id, tenant_id). Runs exactly once via the migration
        # ledger so subsequent boots skip cleanly.
        async def _backfill_memberships(_db):
            from services.auth.membership import (
                find_membership as _fm,
                create_membership as _cm,
                STATUS_ACTIVE as _ACTIVE,
                STATUS_SUSPENDED as _SUSP,
            )

            scanned = created = 0
            async for u in _db.users.find(
                {"tenant_id": {"$type": "string", "$gt": ""}},
                {"_id": 0, "id": 1, "tenant_id": 1, "role": 1, "permissions": 1, "suspended": 1},
            ):
                scanned += 1
                if not u.get("id") or not u.get("tenant_id"):
                    continue
                if await _fm(_db, u["id"], u["tenant_id"]):
                    continue
                status = _SUSP if u.get("suspended") else _ACTIVE
                await _cm(
                    _db,
                    user_id=u["id"],
                    tenant_id=u["tenant_id"],
                    role=u.get("role") or "sales",
                    permissions=u.get("permissions") or [],
                    status=status,
                )
                created += 1
            logger.info(f"[FIX-004-B] backfill_memberships: scanned={scanned} created={created}")

        try:
            _mres = await _apply_migration(
                db,
                "backfill_memberships_v1",
                _backfill_memberships,
                description="FIX-004-B: create memberships rows for legacy user.tenant_id 1:1 model",
            )
            if _mres == "applied":
                logger.info("Migration applied: backfill_memberships_v1")
        except Exception as e:
            logger.exception(f"backfill_memberships migration: {e}")  # S5-05: surface tracebacks

        # FIX-005-A (S3-02): backfill plan fields on existing tenants
        # that predate the plan model. Every legacy tenant gets
        # plan=grandfathered (unlimited seats + quotas, feature-flag
        # defaults set) so nothing about their experience changes
        # until an admin explicitly repositions them. New tenants
        # created AFTER this migration get plan=trial via
        # routers/auth.register.
        async def _backfill_grandfathered_plans(_db):
            from services.plans import PLAN_GRANDFATHERED

            _res = await _db.tenants.update_many(
                {"plan": {"$exists": False}},
                {
                    "$set": {
                        "plan": PLAN_GRANDFATHERED,
                        "seat_limit_override": None,
                        "usage_quotas": {},
                        "feature_flags": {},
                        "updated_at": now_iso(),
                    }
                },
            )
            logger.info(
                f"[FIX-005-A] backfill_grandfathered_plans: " f"tenants marked={getattr(_res, 'modified_count', 0)}"
            )

        try:
            _pres = await _apply_migration(
                db,
                "backfill_grandfathered_plans_v1",
                _backfill_grandfathered_plans,
                description="FIX-005-A (S3-02): mark pre-plan tenants as grandfathered",
            )
            if _pres == "applied":
                logger.info("Migration applied: backfill_grandfathered_plans_v1")
        except Exception as e:
            logger.exception(f"backfill_grandfathered_plans migration: {e}")  # S5-05

        # FIX-004-D (RBAC-16): canonical role rename production -> operations.
        # Prior code had config.ROLES with 'production' but
        # config.DEFAULT_ROLES with 'operations' — silent inconsistency
        # that hid tenants using 'operations'. Canonical name is
        # 'operations'. Rewrites: tenant.roles[].key, users.role,
        # memberships.role. Idempotent (skips rows already migrated).
        async def _rename_production_to_operations(_db):
            renamed_tenants = renamed_users = renamed_memberships = 0
            # 1. Tenants: rewrite the tenant.roles[] array entries.
            async for _t in _db.tenants.find(
                {"roles.key": "production"},
                {"_id": 0, "id": 1, "roles": 1},
            ):
                new_roles = []
                changed = False
                for _r in _t.get("roles") or []:
                    if _r.get("key") == "production":
                        _r = {**_r, "key": "operations"}
                        changed = True
                    new_roles.append(_r)
                if changed:
                    await _db.tenants.update_one(
                        {"id": _t["id"]},
                        {"$set": {"roles": new_roles}},
                    )
                    renamed_tenants += 1
            # 2. Legacy users.role (compat until pre-membership sites migrated).
            _ures = await _db.users.update_many(
                {"role": "production"},
                {"$set": {"role": "operations"}},
            )
            renamed_users = getattr(_ures, "modified_count", 0)
            # 3. Memberships — the authoritative source post-Wave-2.
            _mres = await _db.memberships.update_many(
                {"role": "production"},
                {"$set": {"role": "operations"}},
            )
            renamed_memberships = getattr(_mres, "modified_count", 0)
            logger.info(
                f"[FIX-004-D] rename_production_to_operations: "
                f"tenants={renamed_tenants} users={renamed_users} memberships={renamed_memberships}"
            )

        try:
            _rres = await _apply_migration(
                db,
                "rename_production_role_v1",
                _rename_production_to_operations,
                description="FIX-004-D: canonicalize role key 'production' -> 'operations'",
            )
            if _rres == "applied":
                logger.info("Migration applied: rename_production_role_v1")
        except Exception as e:
            logger.exception(f"rename_production_role migration: {e}")  # S5-05

        # WE-03 (2026-08-16): stage objects extend. Existing tenant
        # operating_model.pipelines[].stages[] entries only carry
        # {key,label}. This migration re-runs normalize_operating_model
        # over every tenant so the three new fields (tasks[], approval,
        # side_effects[]) get defaulted in place. Empty defaults =
        # today's behaviour verbatim; WE-06 engine treats empty
        # tasks[] as "no auto-spawn on entry" and approval=None as
        # "no gate required". Backward-compatible by construction.
        async def _stage_objects_extend(_db):
            from core import normalize_operating_model

            scanned = touched = 0
            async for _t in _db.tenants.find(
                {"operating_model": {"$exists": True}},
                {"_id": 0, "id": 1, "operating_model": 1},
            ):
                scanned += 1
                om_in = _t.get("operating_model") or {}
                om_out = normalize_operating_model(om_in)
                # Cheap change-detect: only write if any stage is missing
                # one of the three new fields. Skips the write for
                # tenants who were already on the new shape.
                needs = False
                for _p in om_in.get("pipelines") or []:
                    for _s in _p.get("stages") or []:
                        if not isinstance(_s, dict):
                            needs = True
                            break
                        if "tasks" not in _s or "approval" not in _s or "side_effects" not in _s:
                            needs = True
                            break
                    if needs:
                        break
                if not needs:
                    continue
                await _db.tenants.update_one(
                    {"id": _t["id"]},
                    {"$set": {"operating_model": om_out, "updated_at": now_iso()}},
                )
                touched += 1
            logger.info(f"[WE-03] stage_objects_extend: scanned={scanned} touched={touched}")

        try:
            _sres = await _apply_migration(
                db,
                "stage_objects_extend_v1",
                _stage_objects_extend,
                description="WE-03: add tasks[]/approval/side_effects[] to every pipeline stage (empty defaults preserve behaviour)",
            )
            if _sres == "applied":
                logger.info("Migration applied: stage_objects_extend_v1")
        except Exception as e:
            logger.exception(f"stage_objects_extend migration: {e}")  # WE-03

        # WE-01 (2026-08-16): task -> workflow linkage backfill.
        # Every task with a decision_id gets workflow_id set to the
        # matching workflow (looked up by shared decision_id, tenant-
        # scoped). stage_key is set to the workflow's INITIAL stage --
        # NOT current -- because the task was spawned when the card
        # was created; setting current would falsely gate advance out
        # of the current stage. Ambiguous matches (0 or >1 workflow
        # for a decision_id) leave both fields null. Idempotent: the
        # match filter excludes tasks that already have workflow_id.
        async def _backfill_task_workflow_link(_db):
            from services.workflows import stage_key_for_backfill

            scanned = matched = 0
            async for _tsk in _db.tasks.find(
                {
                    "decision_id": {"$exists": True, "$nin": [None, ""]},
                    "$or": [{"workflow_id": {"$exists": False}}, {"workflow_id": {"$in": [None, ""]}}],
                },
                {"_id": 0, "id": 1, "tenant_id": 1, "decision_id": 1},
            ):
                scanned += 1
                _wfs = await _db.workflows.find(
                    {"tenant_id": _tsk["tenant_id"], "decision_id": _tsk["decision_id"]},
                    {"_id": 0, "id": 1, "stages": 1},
                ).to_list(2)
                if len(_wfs) != 1:
                    continue  # ambiguous: leave unlinked
                _wf = _wfs[0]
                _stage_key = stage_key_for_backfill(_wf)
                await _db.tasks.update_one(
                    {"id": _tsk["id"]},
                    {"$set": {"workflow_id": _wf["id"], "stage_key": _stage_key}},
                )
                matched += 1
            logger.info(f"[WE-01] backfill_task_workflow_link: " f"scanned={scanned} matched={matched}")

        try:
            _bwlres = await _apply_migration(
                db,
                "backfill_task_workflow_link_v1",
                _backfill_task_workflow_link,
                description="WE-01: link tasks to workflows via shared decision_id (initial stage, tenant-scoped)",
            )
            if _bwlres == "applied":
                logger.info("Migration applied: backfill_task_workflow_link_v1")
        except Exception as e:
            logger.exception(f"backfill_task_workflow_link migration: {e}")  # WE-01

        # WE-02 (2026-08-16): drop the two ghost collections that
        # confused Settings ("three cards, three shapes, one concept").
        # Nothing reads workflow_templates now that /tenant/os-blueprint
        # ignores it and the Settings UI editor is gone; nothing reads
        # lexicon.workflows now that lex()'s workflows merge is gone.
        # $unset both fields on every tenant so exports + admin views
        # don't carry stale garbage. Idempotent (unset is a no-op when
        # the field is already absent).
        async def _drop_ghost_workflow_collections(_db):
            _r1 = await _db.tenants.update_many(
                {"workflow_templates": {"$exists": True}},
                {"$unset": {"workflow_templates": ""}},
            )
            _r2 = await _db.tenants.update_many(
                {"lexicon.workflows": {"$exists": True}},
                {"$unset": {"lexicon.workflows": ""}},
            )
            logger.info(
                f"[WE-02] drop_ghost_workflow_collections: "
                f"tenants.workflow_templates unset={getattr(_r1, 'modified_count', 0)} "
                f"tenants.lexicon.workflows unset={getattr(_r2, 'modified_count', 0)}"
            )

        try:
            _dres = await _apply_migration(
                db,
                "drop_ghost_workflow_collections_v1",
                _drop_ghost_workflow_collections,
                description="WE-02: $unset tenant.workflow_templates and tenant.lexicon.workflows (dead outputs)",
            )
            if _dres == "applied":
                logger.info("Migration applied: drop_ghost_workflow_collections_v1")
        except Exception as e:
            logger.exception(f"drop_ghost_workflow_collections migration: {e}")  # WE-02

        # WE-08 (2026-08-16): the FIX-001-B behaviour that used to be
        # hardcoded in the advance endpoint (procurement -> Finance
        # auto-expense) is now a `create_expense` side-effect bound to
        # the procurement pipeline's TERMINAL stage. This migration
        # walks every tenant whose operating_model has a procurement
        # pipeline (identified by approval_stage or the legacy
        # 'purchase_payment' key) and appends the side-effect to the
        # terminal stage if it is not already present. Idempotent:
        # skips stages already carrying it. Zero-behaviour-diff for
        # existing tenants -- the engine will call the same handler
        # with the same effect as the old inline block.
        async def _backfill_procurement_side_effect(_db):
            touched = scanned = 0
            async for _t in _db.tenants.find(
                {"operating_model.pipelines": {"$exists": True}},
                {"_id": 0, "id": 1, "operating_model": 1},
            ):
                scanned += 1
                om = _t.get("operating_model") or {}
                changed = False
                for _p in om.get("pipelines") or []:
                    # Identify procurement: pipelines with an
                    # approval_stage, plus the legacy purchase_payment key.
                    if not (_p.get("approval_stage") or _p.get("key") == "purchase_payment"):
                        continue
                    _stages = _p.get("stages") or []
                    if not _stages:
                        continue
                    _term = _stages[-1]
                    if not isinstance(_term, dict):
                        continue  # legacy string stage; WE-03 migration handles this pre-run
                    _ses = _term.setdefault("side_effects", [])
                    if any((_se or {}).get("kind") == "create_expense" for _se in _ses):
                        continue
                    _ses.append(
                        {
                            "kind": "create_expense",
                            "params": {"status": "awaiting_bill"},
                        }
                    )
                    changed = True
                if changed:
                    await _db.tenants.update_one(
                        {"id": _t["id"]},
                        {"$set": {"operating_model": om, "updated_at": now_iso()}},
                    )
                    touched += 1
            logger.info(f"[WE-08] backfill_procurement_side_effect: " f"scanned={scanned} touched={touched}")

        try:
            _pres = await _apply_migration(
                db,
                "backfill_procurement_side_effect_v1",
                _backfill_procurement_side_effect,
                description="WE-08: bind create_expense side-effect to procurement terminal stage",
            )
            if _pres == "applied":
                logger.info("Migration applied: backfill_procurement_side_effect_v1")
        except Exception as e:
            logger.exception(f"backfill_procurement_side_effect migration: {e}")  # WE-08

        # WE-09 (2026-08-16): stage_version = optimistic-lock counter for
        # engine.advance's find_one_and_update CAS. Backfill every
        # existing workflow to stage_version=0 so the first engine
        # advance transitions to 1 cleanly.
        async def _backfill_stage_version(_db):
            _r = await _db.workflows.update_many(
                {"stage_version": {"$exists": False}},
                {"$set": {"stage_version": 0}},
            )
            logger.info(f"[WE-09] backfill_stage_version: " f"workflows initialised={getattr(_r, 'modified_count', 0)}")

        try:
            _svres = await _apply_migration(
                db,
                "backfill_stage_version_v1",
                _backfill_stage_version,
                description="WE-09: initialise workflows.stage_version=0 for optimistic-lock CAS",
            )
            if _svres == "applied":
                logger.info("Migration applied: backfill_stage_version_v1")
        except Exception as e:
            logger.exception(f"backfill_stage_version migration: {e}")  # WE-09

        # WE-01.5 (2026-08-16): backfill stage.role for existing
        # tenants. The AI didn't emit it before, so we derive it from
        # (a) stage.tasks[0].role if a template task exists there, or
        # (b) the legacy WORKFLOW_OWNER_ROLE map for the well-known
        # pipeline types (production / distribution / purchase_payment
        # / sales_dispatch). Skip stages that already have role set.
        # Idempotent -- filter excludes tenants where every stage
        # already carries the field.
        async def _backfill_stage_role(_db):
            touched = scanned = 0
            async for _t in _db.tenants.find(
                {"operating_model.pipelines": {"$exists": True}},
                {"_id": 0, "id": 1, "operating_model": 1},
            ):
                scanned += 1
                om = _t.get("operating_model") or {}
                changed = False
                for _p in om.get("pipelines") or []:
                    _p_key = _p.get("key")
                    _legacy = WORKFLOW_OWNER_ROLE.get(_p_key) or {}
                    for _s in _p.get("stages") or []:
                        if not isinstance(_s, dict):
                            continue
                        if _s.get("role"):
                            continue
                        _stage_key = _s.get("key")
                        # (a) derive from first template task's role
                        _from_task = None
                        for _tk in _s.get("tasks") or []:
                            if _tk.get("role"):
                                _from_task = _tk["role"]
                                break
                        # (b) legacy per-stage map
                        _from_legacy = _legacy.get(_stage_key)
                        _role = _from_task or _from_legacy or ""
                        if _role:
                            _s["role"] = _role
                            changed = True
                if changed:
                    await _db.tenants.update_one(
                        {"id": _t["id"]},
                        {"$set": {"operating_model": om, "updated_at": now_iso()}},
                    )
                    touched += 1
            logger.info(f"[WE-01.5] backfill_stage_role: scanned={scanned} touched={touched}")

        try:
            _srres = await _apply_migration(
                db,
                "backfill_stage_role_v1",
                _backfill_stage_role,
                description="WE-01.5: derive stage.role from tasks[0].role or WORKFLOW_OWNER_ROLE legacy map",
            )
            if _srres == "applied":
                logger.info("Migration applied: backfill_stage_role_v1")
        except Exception as e:
            logger.exception(f"backfill_stage_role migration: {e}")  # WE-01.5
        # WE-01: indexes for the new query patterns unlocked by the
        # workflow linkage. Compound (tenant_id, workflow_id, stage_key)
        # supports both "all tasks for this card" (uses the tenant_id +
        # workflow_id prefix) and "all tasks in this specific stage of
        # this card" (uses the full compound). Partial filter on
        # workflow_id !=  null keeps the index small -- most ad-hoc
        # tasks won't have workflow_id and shouldn't bloat the index.
        try:
            await db.tasks.create_index(
                [("tenant_id", 1), ("workflow_id", 1), ("stage_key", 1)],
                name="tasks_tenant_workflow_stage",
                partialFilterExpression={"workflow_id": {"$type": "string"}},
            )
        except Exception as e:
            logger.warning(f"WE-01 tasks_tenant_workflow_stage index: {e}")
        # FIX-003-D (S2-07): auth_email_tokens for email verification +
        # password reset. Unique index on the token string, TTL index on
        # expires_at so used/expired rows auto-purge. Kind + email combo
        # is queried on issue() to reuse an existing token within the
        # cooldown — add a compound index for that lookup too.
        try:
            await db.auth_email_tokens.create_index("token", unique=True, name="auth_email_tokens_token_unique")
        except Exception as e:
            logger.warning(f"auth_email_tokens token index: {e}")
        try:
            await db.auth_email_tokens.create_index(
                "expires_at",
                expireAfterSeconds=0,
                name="auth_email_tokens_expires_at_ttl",
            )
        except Exception as e:
            logger.warning(f"auth_email_tokens TTL index: {e}")
        try:
            await db.auth_email_tokens.create_index(
                [("kind", 1), ("email", 1), ("used_at", 1)],
                name="auth_email_tokens_kind_email_used",
            )
        except Exception as e:
            logger.warning(f"auth_email_tokens compound index: {e}")
        # FIX-004-G (RBAC-21): active_sessions collection indexes.
        # Two hot patterns: /me/sessions (find by user_id) and revoke
        # (find by jti). TTL on `exp` cleans up expired-token rows.
        try:
            await db.active_sessions.create_index(
                "jti",
                unique=True,
                name="active_sessions_jti_unique",
            )
            await db.active_sessions.create_index(
                [("user_id", 1), ("created_at", -1)],
                name="active_sessions_user_created",
            )
            await db.active_sessions.create_index(
                "exp",
                expireAfterSeconds=0,
                name="active_sessions_exp_ttl",
            )
        except Exception as e:
            logger.warning(f"active_sessions indexes: {e}")
        # FIX-003-C (S2-06): revoked-token table for logout-invalidates-JWT.
        # `jti` is the lookup key on every authenticated request (see
        # core.get_current_user -> services.session_revocation.is_revoked),
        # and the TTL on `exp` purges rows when the underlying token would
        # have expired anyway — keeps the table bounded to (~= logouts
        # per 7-day window).
        try:
            await db.revoked_tokens.create_index("jti", unique=True, name="revoked_tokens_jti_unique")
        except Exception as e:
            logger.warning(f"revoked_tokens jti index: {e}")
        try:
            await db.revoked_tokens.create_index(
                "exp",
                expireAfterSeconds=0,
                name="revoked_tokens_exp_ttl",
            )
        except Exception as e:
            logger.warning(f"revoked_tokens TTL index: {e}")
        # FIX-002-A: index the normalized 10-digit form so OTP login + WhatsApp
        # routing are exact-match lookups instead of full-collection scans.
        # Partial index — only users who actually have a phone contribute; keeps
        # the index small and skips users with phone_norm = None/"".
        await db.users.create_index(
            [("phone_norm", 1)],
            partialFilterExpression={"phone_norm": {"$type": "string", "$gt": ""}},
            name="users_phone_norm_partial",
        )
        # FIX-002-C: phone_norm backfill routed through the migration ledger.
        # Idempotent internally (only touches docs missing the field) AND
        # tracked in db.migrations_applied so subsequent boots skip cleanly.
        # (2026-08-16: import hoisted to _bootstrap top -- see comment there.)

        async def _backfill_phone_norm(_db):
            from services.auth.phone import norm_phone as _np

            async for _u in _db.users.find(
                {"phone": {"$type": "string", "$gt": ""}, "phone_norm": {"$exists": False}},
                {"_id": 0, "id": 1, "phone": 1},
            ):
                _pn = _np(_u.get("phone") or "")
                if _pn:
                    await _db.users.update_one({"id": _u["id"]}, {"$set": {"phone_norm": _pn}})

        try:
            _result = await _apply_migration(
                db,
                "backfill_users_phone_norm_v1",
                _backfill_phone_norm,
                description="FIX-002-A: compute phone_norm for pre-migration users",
            )
            if _result == "applied":
                logger.info("Migration applied: backfill_users_phone_norm_v1")
        except Exception as e:
            logger.exception(f"phone_norm backfill migration: {e}")  # S5-05

        # FIX-003-A (S2-03): otp_codes are keyed by (phone, tenant_id) so
        # two tenants that share a phone can each hold their own live
        # OTP. The migration ledger call:
        #   1) drops the old single-column {phone: 1} unique index
        #      (created implicitly by early code paths); leaving it in
        #      place would prevent the compound insert.
        #   2) deletes any pre-existing otp_codes rows that lack a
        #      tenant_id — they'd fail the new compound-unique index
        #      and they're TTL'd anyway (300s), so we're not losing
        #      anything a user needs.
        # After the migration runs once, we create the new compound
        # unique index. Both are idempotent — safe on every boot.
        async def _prepare_otp_codes_tenant_scope(_db):
            # Drop any index whose spec is exactly {"phone": 1} — that's
            # the old single-column index we need to replace.
            try:
                info = await _db.otp_codes.index_information()
                for idx_name, spec in info.items():
                    key = spec.get("key") or []
                    # spec['key'] is a list of (field, direction) tuples
                    if [(k, d) for k, d in key] == [("phone", 1)]:
                        try:
                            await _db.otp_codes.drop_index(idx_name)
                            logger.info(f"[FIX-003-A] dropped legacy otp_codes index {idx_name}")
                        except Exception as _e:
                            logger.warning(f"[FIX-003-A] could not drop {idx_name}: {_e}")
            except Exception as _e:
                logger.warning(f"[FIX-003-A] otp_codes index scan failed: {_e}")
            # Delete rows missing tenant_id — they're short-lived and
            # would fail the new compound-unique index.
            try:
                res = await _db.otp_codes.delete_many({"tenant_id": {"$in": [None, ""]}})
                if res.deleted_count:
                    logger.info(f"[FIX-003-A] cleared {res.deleted_count} pre-migration otp_codes rows")
            except Exception as _e:
                logger.warning(f"[FIX-003-A] otp_codes cleanup failed: {_e}")
            try:
                res2 = await _db.otp_codes.delete_many({"tenant_id": {"$exists": False}})
                if res2.deleted_count:
                    logger.info(f"[FIX-003-A] cleared {res2.deleted_count} tenant_id-less otp_codes rows")
            except Exception as _e:
                logger.warning(f"[FIX-003-A] otp_codes cleanup (missing field) failed: {_e}")

        try:
            _fix003_res = await _apply_migration(
                db,
                "otp_codes_tenant_scope_v1",
                _prepare_otp_codes_tenant_scope,
                description="FIX-003-A: drop legacy {phone:1} unique index and clear tenant-less otp_codes rows",
            )
            if _fix003_res == "applied":
                logger.info("Migration applied: otp_codes_tenant_scope_v1")
        except Exception as e:
            logger.exception(f"otp_codes tenant-scope migration: {e}")  # S5-05

        # FIX-007-A (S4-03): rename brain_contexts → brain_query_cache to
        # kill the name collision with brain_context (singular, decision-
        # provenance store). Mongo's renameCollection is atomic and only
        # works when the target doesn't already exist as a REAL collection
        # — this migration checks source has data and target is missing
        # before firing; on second boot, source is empty/absent and
        # target holds the data, so the guard skips (idempotent).
        async def _rename_brain_contexts_to_query_cache(_db):
            names = set(await _db.list_collection_names())
            has_src = "brain_contexts" in names
            has_dst = "brain_query_cache" in names
            if not has_src:
                logger.info("[S4-03] brain_contexts absent — rename no-op")
                return
            if has_dst:
                # Target already there — likely a fresh index create landed
                # first on a boot that lost the migration ledger. Check
                # counts; if target is empty we can safely drop+rename,
                # else we bail (destructive to merge) and leave both.
                dst_n = await _db.brain_query_cache.count_documents({})
                if dst_n == 0:
                    await _db.brain_query_cache.drop()
                    logger.info("[S4-03] dropped empty brain_query_cache before rename")
                else:
                    logger.warning(
                        "[S4-03] brain_query_cache already has data (%d rows); "
                        "leaving brain_contexts as-is. Manual merge needed.",
                        dst_n,
                    )
                    return
            # Motor exposes admin.command; renameCollection needs fully-
            # qualified namespaces.
            src_ns = f"{DB_NAME}.brain_contexts"
            dst_ns = f"{DB_NAME}.brain_query_cache"
            await client.admin.command({"renameCollection": src_ns, "to": dst_ns, "dropTarget": False})
            logger.info("[S4-03] renamed brain_contexts → brain_query_cache")

        try:
            _s403_res = await _apply_migration(
                db,
                "rename_brain_contexts_to_query_cache_v1",
                _rename_brain_contexts_to_query_cache,
                description="FIX-007-A (S4-03): kill brain_contexts/brain_context name collision",
            )
            if _s403_res == "applied":
                logger.info("Migration applied: rename_brain_contexts_to_query_cache_v1")
        except Exception as e:
            logger.exception(f"brain_contexts rename migration: {e}")  # S5-05

        # FIX-007-A (S4-01): drop text indexes that were created with
        # default_language="none" so the create_index calls below can
        # rebuild them with default_language="english" (Mongo doesn't
        # let you MUTATE default_language on an existing text index).
        # Only drops when the existing index spec says language:none —
        # if someone already switched to english, this is a no-op.
        async def _drop_none_language_text_indexes(_db):
            for coll_name, index_name in (
                ("brain_context", "brain_context_text_v1"),
                ("brain_documents", "brain_documents_text_v1"),
            ):
                try:
                    info = await _db[coll_name].index_information()
                    spec = info.get(index_name) or {}
                    if spec.get("default_language") == "none":
                        await _db[coll_name].drop_index(index_name)
                        logger.info(
                            "[S4-01] dropped %s.%s (default_language=none) — " "will be recreated with english below",
                            coll_name,
                            index_name,
                        )
                except Exception as _e:
                    logger.warning("[S4-01] %s.%s inspect/drop failed: %s", coll_name, index_name, _e)

        try:
            _s401_res = await _apply_migration(
                db,
                "drop_none_language_text_indexes_v1",
                _drop_none_language_text_indexes,
                description="FIX-007-A (S4-01): drop stale text indexes so english-stemmed ones can rebuild",
            )
            if _s401_res == "applied":
                logger.info("Migration applied: drop_none_language_text_indexes_v1")
        except Exception as e:
            logger.exception(f"drop-none-language text indexes migration: {e}")  # S5-05
        # New compound unique index — one live OTP per (phone, tenant).
        try:
            await db.otp_codes.create_index(
                [("phone", 1), ("tenant_id", 1)],
                unique=True,
                name="otp_codes_phone_tenant_unique",
            )
        except Exception as e:
            logger.warning(f"otp_codes compound unique index: {e}")
        await db.decisions.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.tasks.create_index([("tenant_id", 1), ("status", 1), ("due_date", 1)])
        await db.tasks.create_index([("tenant_id", 1), ("assignee_id", 1), ("status", 1)])
        # BUG-13: engine-spawned template tasks are keyed by
        # (tenant_id, workflow_id, stage_key, title). on_stage_enter used a
        # find-then-insert with no unique index, so a concurrent stage re-entry
        # could double-spawn. This PARTIAL unique index (only over source='engine'
        # tasks, so it never constrains ordinary user tasks) makes the second
        # concurrent insert fail with DuplicateKeyError instead.
        try:
            await db.tasks.create_index(
                [("tenant_id", 1), ("workflow_id", 1), ("stage_key", 1), ("title", 1)],
                unique=True,
                partialFilterExpression={"source": "engine"},
                name="engine_template_task_unique",
            )
        except Exception as e:
            logger.warning(f"engine template-task unique index: {e}")
        await db.workflows.create_index("tenant_id")
        await db.platform_admins.create_index("email", unique=True)
        await db.usage_events.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.usage_events.create_index("created_at")
        await db.files.create_index([("tenant_id", 1), ("task_id", 1)])
        # High-volume collections — these were doing full scans pre-1.0.
        await db.activity.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.notifications.create_index([("tenant_id", 1), ("user_id", 1), ("read", 1), ("created_at", -1)])
        await db.inbox.create_index([("tenant_id", 1), ("status", 1), ("created_at", -1)])
        await db.inbox.create_index([("tenant_id", 1), ("classification", 1)])
        await db.voice_notes.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.memory.create_index([("tenant_id", 1), ("created_at", -1)])
        # FIX-007-A (S4-01): db.memory had NO text index — every knowledge
        # lookup fell back to case-insensitive regex, which is a collection
        # scan filtered by tenant_id only. Adding ranked full-text search
        # brings /ask + brain_router into parity with brain_context /
        # brain_documents (both of which have had text indexes for months).
        # default_language="english" enables stemming so "refund" also
        # matches "refunds" / "refunded" — the recall bug the tracker
        # called out ("refund != refunds").
        try:
            await db.memory.create_index(
                [("text", "text"), ("tag", "text")],
                weights={"text": 3, "tag": 1},
                name="memory_text_v1",
                default_language="english",
            )
        except Exception as e:
            logger.warning(f"memory text index: {e}")
        await db.brain_audit.create_index([("tenant_id", 1), ("created_at", -1)])
        # FIX-007-A (S4-03): brain_contexts (plural) renamed to
        # brain_query_cache — the singular/plural collision with the
        # decision-provenance store `brain_context` was a foot-gun that
        # produced silent data corruption on typo. Post-rename these
        # indexes live on the new collection; the migration below
        # renameCollections + skips the create if the rename already ran.
        await db.brain_query_cache.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.brain_query_cache.create_index("id")
        await db.leaves.create_index([("tenant_id", 1), ("status", 1), ("from_date", -1)])
        await db.contacts.create_index([("tenant_id", 1), ("name", 1)])
        # FIX-003-B (S2-08): the contacts collection field is `type`
        # (customer|vendor), NOT `kind`. Every read (see server.py
        # list_contacts + the enrich_contacts projection) uses `type`,
        # so the old {tenant_id: 1, kind: 1} index was dead — index
        # entries got created only for docs that happened to also
        # carry a legacy `kind` field (none of them, in practice),
        # and every `type=vendor` query fell back to a collection
        # scan filtered by tenant_id only. Drop the dead one and
        # replace with the real field.
        await db.contacts.create_index([("tenant_id", 1), ("type", 1)])
        try:
            _ci_info = await db.contacts.index_information()
            for _idx_name, _spec in _ci_info.items():
                _key = _spec.get("key") or []
                if [(k, d) for k, d in _key] == [("tenant_id", 1), ("kind", 1)]:
                    try:
                        await db.contacts.drop_index(_idx_name)
                        logger.info(f"[FIX-003-B] dropped dead contacts index {_idx_name}")
                    except Exception as _e:
                        logger.warning(f"[FIX-003-B] could not drop contacts kind index: {_e}")
        except Exception as _e:
            logger.warning(f"[FIX-003-B] contacts index inspection failed: {_e}")
        await db.invoices.create_index([("tenant_id", 1), ("status", 1), ("due_date", 1)])
        await db.invoices.create_index([("tenant_id", 1), ("contact_name", 1)])
        await db.payments.create_index([("tenant_id", 1), ("invoice_id", 1)])
        await db.expenses.create_index([("tenant_id", 1), ("date", -1)])
        await db.complaints.create_index([("tenant_id", 1), ("status", 1), ("created_at", -1)])
        # S9 (U8-09.2): index gap-fill. These list endpoints filter by tenant_id
        # and sort by created_at, but had no supporting index (workflows had only
        # a bare tenant_id; expenses was indexed on `date` not `created_at`;
        # assets/inventory had none) -- so each list was a tenant scan + in-memory
        # sort. Adding (tenant_id, created_at) makes the sort index-backed.
        await db.workflows.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.workflows.create_index([("tenant_id", 1), ("type", 1), ("stage", 1)])
        await db.expenses.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.assets.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.inventory.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.calendar_events.create_index([("tenant_id", 1), ("date", 1)])
        await db.meetings.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.platform_audit.create_index([("admin_id", 1), ("created_at", -1)])
        await db.signup_sessions.create_index("id")
        await db.tenants.create_index("id")
        # Company Brain — documents catalog (P1) indexes.
        await db.brain_documents.create_index([("tenant_id", 1), ("is_deleted", 1), ("created_at", -1)])
        await db.brain_documents.create_index([("tenant_id", 1), ("kind", 1)])
        await db.brain_documents.create_index([("tenant_id", 1), ("keywords", 1)])
        await db.brain_documents.create_index([("tenant_id", 1), ("tags", 1)])
        # Company Brain — decision/approval/resolution context (P2) indexes.
        await db.brain_context.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.brain_context.create_index([("tenant_id", 1), ("kind", 1), ("created_at", -1)])
        await db.brain_context.create_index([("tenant_id", 1), ("source_type", 1), ("source_id", 1)])
        # P5 — Mongo native full-text index so knowledge_lookup can rank by
        # relevance (not just regex hits). Wrapped in try/except because a
        # collection can only have ONE text index — this call is a no-op the
        # second time it's run with the same fields.
        # FIX-007-A (S4-01): default_language now "english" (was "none")
        # so Mongo's snowball stemmer kicks in — "refund" matches "refunds"
        # / "refunded", "invoice" matches "invoiced" / "invoicing".
        # Mongo doesn't let you MUTATE default_language on an existing
        # text index, so the migration below drops the old
        # brain_context_text_v1 / brain_documents_text_v1 indexes exactly
        # once; this create_index then rebuilds them with the new setting.
        try:
            await db.brain_context.create_index(
                [("title", "text"), ("why", "text"), ("tags", "text")],
                weights={"title": 6, "tags": 3, "why": 1},
                name="brain_context_text_v1",
                default_language="english",
            )
        except Exception as e:
            logger.warning(f"brain_context text index: {e}")
        try:
            await db.brain_documents.create_index(
                [
                    ("title", "text"),
                    ("summary", "text"),
                    ("original_filename", "text"),
                    ("keywords", "text"),
                    ("tags", "text"),
                ],
                weights={"title": 8, "tags": 4, "keywords": 3, "summary": 2, "original_filename": 1},
                name="brain_documents_text_v1",
                default_language="english",
            )
        except Exception as e:
            logger.warning(f"brain_documents text index: {e}")
        try:
            await obj_store.init_storage()
        except Exception as e:
            logger.warning(f"Object storage init deferred (will retry on first upload): {e}")
        await load_ai_keys_from_db()
        await seed_platform_admin()
        await seed_demo()
        # FIX-002-C: route through the migration ledger so it runs exactly
        # once instead of scanning every tenant on every boot.
        try:
            _tres = await _apply_migration(
                db,
                "migrate_tenants_backfill_roles_v1",
                lambda _db: migrate_tenants(),
                description="Backfill industry/roles/products on pre-onboarding tenants",
            )
            if _tres == "applied":
                logger.info("Migration applied: migrate_tenants_backfill_roles_v1")
        except Exception as e:
            logger.exception(f"migrate_tenants migration: {e}")  # S5-05
        # FIX-002-E: copy any legacy local-disk uploads into obj_store and
        # rewrite the referring domain records to point at the new
        # storage_path. Runs exactly once via ledger; safe on second boot.
        try:
            _ures = await _apply_migration(
                db,
                "migrate_local_disk_uploads_to_obj_store_v1",
                migrate_local_disk_uploads_to_obj_store,
                description="FIX-002-E: move voice_notes/meetings/ingestions/ledger files to obj_store",
            )
            if _ures == "applied":
                logger.info("Migration applied: migrate_local_disk_uploads_to_obj_store_v1")
        except Exception as e:
            logger.exception(f"local-disk uploads migration: {e}")  # S5-05
        await fixup_demo_tenant()
        await write_test_credentials()
        logger.info("Bootstrap complete.")
    except Exception as e:
        logger.error(f"Bootstrap error (non-fatal, app stays up): {e}")


@asynccontextmanager
async def lifespan(app):
    """Startup/shutdown for the FastAPI app (replaces @app.on_event)."""
    # Fire-and-forget so uvicorn binds the port and answers /health immediately —
    # otherwise slow remote-Atlas seeding would block readiness and fail the deploy check.
    asyncio.create_task(_bootstrap())
    # Timer-driven follow-up/escalation sweep (independent of user polling).
    asyncio.create_task(_followup_scheduler_loop())
    # Epic 10 S6: apply runtime platform config (model routes, Sarvam) at boot.
    from services.platform_config import load_all as _load_platform_config
    asyncio.create_task(_load_platform_config())
    try:
        yield
    finally:
        # PyMongo AsyncMongoClient.close() is a coroutine — must be awaited.
        await client.close()
