"""main -> karma-redesign data migration.

Copies the LIVE production MongoDB (documents shaped by the `main` branch code)
into a NEW MongoDB database that the `karma-redesign` code runs against,
reshaping documents on the way and then replaying karma's own ledgered boot
migrations + index builds on the new DB.

The source is NEVER written to: it is only reachable through `ReadOnlySource`,
which exposes read calls and nothing else. (Still use a read-only Mongo user.)

MODES
    plan      Dry run (the default). Read-only. Scans every source document,
              runs every transform in memory, pre-checks karma's unique indexes
              against the transformed data, and writes a JSON report. Touches
              nothing on either side.
    rehearse  Full run into a THROWAWAY database on the target cluster
              (<target-db>_rehearsal_<ts>): copy, karma bootstrap, verify, then
              drop it (keep it with --keep-rehearsal). Proves the whole pipeline
              end-to-end without touching the real target DB.
    execute   The proper run into --target-db. Requires --confirm <target-db>.
              Refuses a non-empty target unless --resume.

TYPICAL SEQUENCE
    cd backend
    # 0. copy prod's backend/uploads directory to this machine (e.g. ./prod_uploads)
    #    When the source is a JSON dump rather than a live DB, first load it into
    #    its own database (scripts/load_json_dump.py) and use that as --source-db.
    # 1. dry run -- fix every BLOCKING issue it reports, re-run until clean
    .venv/Scripts/python.exe scripts/migrate_main_to_karma.py plan --uploads-dir ./prod_uploads
    # 2. rehearsal on the target cluster
    .venv/Scripts/python.exe scripts/migrate_main_to_karma.py rehearse --uploads-dir ./prod_uploads --ai-consent reconsent
    # 3. freeze writes on the old app (maintenance mode), then the proper run
    .venv/Scripts/python.exe scripts/migrate_main_to_karma.py execute --uploads-dir ./prod_uploads \
        --ai-consent reconsent --confirm <target-db>

CUTOVER RULES
    * Never start karma against the target DB before `execute` finishes: its boot
      migrations would record "done" on an empty DB and never touch the copy.
    * backend/.env on this machine must carry PROD's EMERGENT_LLM_KEY (object
      storage is keyed by it) -- files uploaded under another key are invisible.
    * The script stubs karma's demo seeding while it bootstraps, but karma's
      app still runs seed_demo on every boot.

CONNECTION (flags, or env vars)
    --source-url / SOURCE_MONGO_URL     --source-db / SOURCE_DB_NAME
    --target-url / TARGET_MONGO_URL     --target-db / TARGET_DB_NAME

EXIT CODES
    0 ok | 1 fatal/config error | 2 blocking issues (nothing written) |
    3 written but verification failed | 4 ok but the source changed during the copy

Consistency: MongoDB cannot snapshot a whole DB for a long read, so stop writes
to the old app for the duration of `execute`. The script counts the source
before and after the copy and exits 4 if it moved.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

from pymongo import AsyncMongoClient, ReplaceOne
from pymongo.errors import BulkWriteError, PyMongoError

BACKEND_DIR = Path(__file__).resolve().parent.parent
LIFECYCLE_PY = BACKEND_DIR / "bootstrap" / "lifecycle.py"
CHECKPOINT_COLL = "_migration_main_to_karma"
FILES_CHECKPOINT_COLL = "_migration_main_to_karma_files"
UPLOADS_LEDGER_NAME = "migrate_local_disk_uploads_to_obj_store_v1"
UPLOADS_DEFERRED_MARKER = "deferred by migrate_main_to_karma"

EXIT_OK, EXIT_FATAL, EXIT_BLOCKED, EXIT_VERIFY_FAILED, EXIT_SOURCE_DRIFT = 0, 1, 2, 3, 4


class Fatal(Exception):
    """Configuration / safety failure: abort before (or instead of) writing."""


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def mask_url(url: str) -> str:
    """Hide the password in a Mongo URL for printing."""
    try:
        parts = urlsplit(url)
        if parts.password:
            return url.replace(":" + parts.password + "@", ":***@", 1)
    except ValueError:
        pass
    return url


def url_hosts(url: str) -> set[str]:
    netloc = url.split("://", 1)[-1].split("/", 1)[0]
    netloc = netloc.rsplit("@", 1)[-1]
    return {h.strip().lower() for h in netloc.split(",") if h.strip()}


# =============================================================================
# Collection plan + transforms (main-shaped document -> karma-shaped document)
# =============================================================================
#
# Transform contract:
#   fn(doc, ctx) -> dict | None
#     * Return the karma-shaped document, or None to drop it.
#     * Do NOT mutate `doc` or anything nested in it -- build a new dict
#       (`out = dict(doc)`, copy nested containers you change).
#     * Be deterministic: no now_iso()/new_id(). Use ctx.run_started_iso for a
#       timestamp. Verification re-runs transforms and compares to the target.
#     * ctx.warn(...) for things worth knowing; ctx.block(...) for data that
#       would break karma -- any block stops `execute` before it writes.

# What karma's boot migrations already fix is deliberately NOT repeated here --
# the script replays them on the target (run_karma_bootstrap): memberships,
# phone_norm, workflow_id/stage_key, stage_version, operating-model stage
# fields, workflow_templates cleanup, brain_contexts rename, text indexes.
# The transforms below cover what those migrations miss or get wrong.

LEGACY_ROLE, CANONICAL_ROLE = "production", "operations"  # karma FIX-004-D
DEMO_OWNER_EMAIL = "owner@sharma.com"  # main's seed_demo account (published password)
AI_CONSENT_VERSION = "1.0"  # = services/ai_consent.py CURRENT_CONSENT_VERSION (pinned by a test)
MAX_CO_ASSIGNEES = 10  # = services/tasks.py MAX_CO_ASSIGNEES
MONEY_FIELDS = ("amount", "amount_paid", "purchase_amount", "unit_cost", "applied")

# Run-wide options transforms may read via ctx.options (set from the CLI).
RUN_OPTIONS: dict[str, Any] = {}


def norm_phone(p) -> str:
    """= services/auth/phone.py norm_phone (pinned by a test): the last 10 digits."""
    return re.sub(r"\D", "", p)[-10:] if isinstance(p, str) else ""


def transform_tenant(doc: dict, ctx: "Ctx") -> dict:
    out = dict(doc)

    # Plan fields (karma FIX-005-A), set here rather than left to boot: karma's
    # memberships backfill runs BEFORE its plan backfill, and a plan-less tenant
    # resolves to trial (seat_limit=3), so reserve_seat raises 402 on a tenant's
    # 4th user and the whole memberships backfill aborts. Same values karma
    # writes, so backfill_grandfathered_plans_v1 becomes a no-op.
    if "plan" not in out:
        out.update(
            plan="grandfathered",
            seat_limit_override=None,
            usage_quotas={},
            feature_flags={},
            updated_at=ctx.run_started_iso,
        )

    # production -> operations. Karma's rename rewrites the key in place, which
    # leaves a duplicate when a tenant already has both keys.
    roles = out.get("roles")
    if isinstance(roles, list) and any(isinstance(r, dict) and r.get("key") == LEGACY_ROLE for r in roles):
        has_canonical = any(isinstance(r, dict) and r.get("key") == CANONICAL_ROLE for r in roles)
        new_roles = []
        for r in roles:
            if isinstance(r, dict) and r.get("key") == LEGACY_ROLE:
                if has_canonical:
                    ctx.warn("role_production_merged_into_operations", doc, f"dropped duplicate role entry {r}")
                    continue
                r = {**r, "key": CANONICAL_ROLE}
            new_roles.append(r)
        out["roles"] = new_roles

    # Karma's rename misses leave_approvers (keyed by role), so leave requests
    # from operations staff would silently fall through to the owner.
    approvers = out.get("leave_approvers")
    if isinstance(approvers, dict) and LEGACY_ROLE in approvers:
        approvers = dict(approvers)
        legacy = approvers.pop(LEGACY_ROLE)
        if approvers.get(CANONICAL_ROLE) not in (None, legacy):
            ctx.warn(
                "leave_approver_conflict",
                doc,
                f"kept operations={approvers[CANONICAL_ROLE]}, dropped production={legacy}",
            )
        else:
            approvers[CANONICAL_ROLE] = legacy
        out["leave_approvers"] = approvers

    # DPDP consent: karma refuses every AI call (451) for a tenant without an
    # active consent record, and main never recorded one. The operator chooses
    # the policy explicitly (--ai-consent); a revoked consent is never overridden.
    consent = out.get("ai_consent") if isinstance(out.get("ai_consent"), dict) else {}
    active = (
        bool(consent.get("granted_at"))
        and not consent.get("revoked_at")
        and consent.get("version") == AI_CONSENT_VERSION
    )
    if not active:
        if ctx.options.get("ai_consent") == "grandfather" and not consent.get("revoked_at"):
            out["ai_consent"] = {
                "granted_at": ctx.run_started_iso,
                "granted_by_user_id": "migration:main_to_karma",
                "granted_by_email": None,
                "ip": None,
                "ua": None,
                "version": AI_CONSENT_VERSION,
                "revoked_at": None,
            }
            ctx.warn("ai_consent_grandfathered", doc)
        else:
            ctx.warn("ai_consent_required", doc, "AI features return 451 until the owner grants consent")

    # Copied, not dropped (deleting a workspace is the operator's call): prod
    # carries TEST_* workspaces that test runs left behind with nobody in them.
    if not ctx.lookups["tenant_user_ids"].get(out.get("id")):
        ctx.warn("tenant_without_users", doc, f"name={out.get('name')!r}: nobody can sign in to it")
    return out


def transform_user(doc: dict, ctx: "Ctx") -> dict:
    out = dict(doc)
    email = out.get("email")
    if isinstance(email, str) and email:
        norm = email.strip().lower()
        if norm != email:
            ctx.warn("email_normalized", doc, "trimmed/lowercased; karma looks users up by lowercase email")
            out["email"] = norm
        if norm == DEMO_OWNER_EMAIL:
            ctx.warn(
                "demo_account_present", doc, "main's seeded demo login (published password) -- consider removing it"
            )
    else:
        ctx.warn("missing_email", doc, "cannot log in by email")
    if out.get("role") == LEGACY_ROLE:
        out["role"] = CANONICAL_ROLE
    if not out.get("created_at"):
        ctx.warn(
            "missing_created_at", doc, "karma reads users.created_at without a fallback; set to the migration time"
        )
        out["created_at"] = ctx.run_started_iso
    if not out.get("tenant_id"):
        ctx.warn("user_without_tenant", doc, "gets no membership, so no workspace access")
    # Karma resolves an OTP login / WhatsApp sender by (phone_norm, tenant):
    # two people sharing a number inside one workspace cannot both be reached.
    phone = norm_phone(out.get("phone"))
    if phone and ctx.lookups["tenant_phone_counts"].get((out.get("tenant_id"), phone), 0) > 1:
        ctx.warn("phone_shared_in_tenant", doc, f"another user of this workspace has the phone ...{phone[-4:]}")
    return out


def transform_task(doc: dict, ctx: "Ctx") -> dict:
    out = dict(doc)

    # ASK-28 TK-06 removed support_id ("supporting employee"); helpers are
    # co_assignee_ids now. Karma ignores support_id, so carry it over.
    if "support_id" in out:
        sid = out.pop("support_id")
        if sid:
            helpers = list(out.get("co_assignee_ids") or [])
            tenant_users = ctx.lookups["tenant_user_ids"].get(out.get("tenant_id"), ())
            if sid == out.get("assignee_id") or sid in helpers:
                pass
            elif sid not in tenant_users:
                ctx.warn("support_id_dropped_unknown_user", doc, f"support_id={sid} is not a user of this tenant")
            elif len(helpers) >= MAX_CO_ASSIGNEES:
                ctx.warn("support_id_dropped_helper_cap", doc, f"already {len(helpers)} helpers")
            else:
                out["co_assignee_ids"] = helpers + [sid]

    # Karma's role rename skips tasks, and tasks are matched to people by role.
    if out.get("assignee_role") == LEGACY_ROLE:
        if not out.get("task_type"):
            out["task_type"] = LEGACY_ROLE  # _derive_task_type derived this from the old role
        out["assignee_role"] = CANONICAL_ROLE
    updates = out.get("updates")
    if isinstance(updates, list) and any(isinstance(u, dict) and u.get("to_role") == LEGACY_ROLE for u in updates):
        out["updates"] = [
            {**u, "to_role": CANONICAL_ROLE} if isinstance(u, dict) and u.get("to_role") == LEGACY_ROLE else u
            for u in updates
        ]
    return out


def transform_leave(doc: dict, ctx: "Ctx") -> dict:
    if doc.get("user_role") != LEGACY_ROLE:
        return doc
    return {**doc, "user_role": CANONICAL_ROLE}


def transform_money(doc: dict, ctx: "Ctx") -> dict:
    """Main always stored floats, but a string amount would be silently skipped
    by karma's $sum aggregations -- convert the parseable ones, flag the rest."""
    out = doc
    for field in MONEY_FIELDS:
        value = doc.get(field)
        if not isinstance(value, str):
            continue
        if out is doc:
            out = dict(doc)
        try:
            out[field] = float(value.replace(",", "").strip())
            ctx.warn("string_amount_converted", doc, f"{field}={value!r}")
        except ValueError:
            ctx.warn("string_amount_unparseable", doc, f"{field}={value!r} left as-is")
    return out


def transform_reclassify_job(doc: dict, ctx: "Ctx") -> dict:
    """Karma refuses to start a finance re-sync while any job says "running";
    a job copied mid-run would lock that admin action forever."""
    if doc.get("status") != "running":
        return doc
    ctx.warn("reclassify_job_interrupted", doc)
    return {**doc, "status": "interrupted", "finished_at": doc.get("finished_at") or ctx.run_started_iso}


def transform_capture_draft_role(doc: dict, ctx: "Ctx") -> dict:
    # Non-owners only see drafts whose reviewer_role equals their own role.
    if doc.get("reviewer_role") != LEGACY_ROLE:
        return doc
    return {**doc, "reviewer_role": CANONICAL_ROLE}


def transform_brain_context(doc: dict, ctx: "Ctx") -> dict:
    # department drives the Brain's per-department visibility filter.
    if doc.get("department") != LEGACY_ROLE:
        return doc
    return {**doc, "department": CANONICAL_ROLE}


def transform_brain_document(doc: dict, ctx: "Ctx") -> dict:
    out = doc
    if doc.get("department") == LEGACY_ROLE:
        out = {**out, "department": CANONICAL_ROLE}
    allowed = doc.get("roles_allowed")
    if isinstance(allowed, list) and LEGACY_ROLE in allowed:
        renamed: list = []
        for role in allowed:
            role = CANONICAL_ROLE if role == LEGACY_ROLE else role
            if role not in renamed:
                renamed.append(role)
        out = {**out, "roles_allowed": renamed}
    return out


def transform_platform_alert(doc: dict, ctx: "Ctx") -> dict:
    """Provider alerts from the old deployment would show as live outages on
    karma's admin dashboard; karma re-raises any that are still happening."""
    if doc.get("resolved"):
        return doc
    ctx.warn("platform_alert_resolved", doc, f"provider={doc.get('provider')}")
    return {**doc, "resolved": True, "resolved_at": ctx.run_started_iso}


# --- uploaded files -------------------------------------------------------------
# main kept uploads on its own disk (backend/uploads) and referenced them by
# absolute path or /api/files/<name>. Karma serves object-storage keys only, and
# its own uploads migration cannot help: karma's container has no uploads dir,
# and that migration ignores ingestions, capture_drafts and invoices. The script
# pushes the files from --uploads-dir (a copy of prod's backend/uploads) to
# object storage BEFORE writing documents, then rewrites the references to the
# path the store returned (UPLOADED_PATHS).

APP_NAME = "decisionos"  # = integrations/storage.py APP_NAME
LEDGER_COLLECTIONS = ("expenses", "assets", "inventory", "invoices")
RECORDING_COLLECTIONS = ("voice_notes", "meetings")
FILE_REF_COLLECTIONS = RECORDING_COLLECTIONS + ("ingestions", "capture_drafts") + LEDGER_COLLECTIONS
INTERRUPTED_STATUSES = ("queued", "transcribing", "structuring")

# requested object key -> storage_path. Predicted (key -> key) for files found
# during validation, replaced by what the store actually returned after upload.
UPLOADED_PATHS: dict[str, str] = {}


def build_key(tenant_id: str, category: str, file_id: str, ext: str) -> str:
    """= services/uploads.py build_key (pinned by a test)."""
    ext_clean = (ext or "bin").lstrip(".").lower()
    return f"{APP_NAME}/{tenant_id}/{category}/{file_id}.{ext_clean}"


def _split_ext(fname: str) -> tuple[str, str]:
    stem, dot, ext = fname.rpartition(".")
    return (stem, ext) if dot else (fname, "")


def file_ref(coll: str, doc: dict) -> tuple[str, str] | None:
    """(file name in prod's uploads dir, karma object key) for a document's
    legacy upload reference, or None when it has none (or is already a key)."""
    tid = doc.get("tenant_id")
    if not tid:
        return None
    if coll in RECORDING_COLLECTIONS:
        path = doc.get("audio_path")
        if not isinstance(path, str) or not path or path.startswith(APP_NAME + "/") or not doc.get("id"):
            return None
        fname = re.split(r"[\\/]", path)[-1]  # main stored the absolute path on its host
        # same category + file id karma's own uploads migration uses
        return fname, build_key(tid, coll.replace("_", "-"), doc["id"], _split_ext(fname)[1])
    if coll in ("ingestions", "capture_drafts"):
        if doc.get("storage_path"):
            return None
        m = re.fullmatch(r"/api/files/(ingest_([^/]+))", doc.get("file_url") or "")
        if not m:
            return None
        # keyed by the file, not the doc: approving a capture reuses its file under a new ingestion id
        stem, ext = _split_ext(m.group(2))
        return m.group(1), build_key(tid, "ingestions", stem, ext)
    if coll in LEDGER_COLLECTIONS:
        att = doc.get("attachment")
        if not isinstance(att, dict) or att.get("storage_path"):
            return None
        m = re.fullmatch(r"/api/files/(ledger-([^/]+))", att.get("url") or "")
        if not m:
            return None
        stem, ext = _split_ext(m.group(2))
        return m.group(1), build_key(tid, "ledger", stem, ext)
    return None


def transform_upload_ref(coll: str, doc: dict, ctx: "Ctx") -> dict:
    ref = file_ref(coll, doc)
    if ref is None:
        return doc
    fname, key = ref
    mode = ctx.options.get("uploads", "unchecked")
    if mode != "migrate":
        ctx.warn(f"upload_not_migrated:{mode}", doc, fname)
        return doc
    stored = ctx.lookups.get("uploaded", {}).get(key)
    if coll in RECORDING_COLLECTIONS:
        if stored:
            return {**doc, "audio_path": stored}
        ctx.warn("upload_missing", doc, f"{fname}: audio_path cleared (same as karma's own migration)")
        return {**doc, "audio_path": None, "_upload_missing": True}
    if not stored:
        ctx.warn("upload_missing", doc, f"{fname} not in --uploads-dir; its link keeps returning 404")
        return doc
    if coll in LEDGER_COLLECTIONS:
        return {**doc, "attachment": {**doc["attachment"], "storage_path": stored}}
    return {**doc, "storage_path": stored}


def _uploads(coll: str) -> Callable[[dict, "Ctx"], dict]:
    return lambda doc, ctx: transform_upload_ref(coll, doc, ctx)


def _recording(coll: str) -> Callable[[dict, "Ctx"], dict]:
    def fn(doc: dict, ctx: "Ctx") -> dict:
        out = transform_upload_ref(coll, doc, ctx)
        # No job resumes processing after a restart, so these would count as
        # "in progress" forever.
        if out.get("status") in INTERRUPTED_STATUSES:
            ctx.warn("processing_interrupted", doc, f"status={out.get('status')} -> failed")
            out = {**out, "status": "failed", "error": out.get("error") or "interrupted by the karma migration"}
        return out

    return fn


def _chain(*fns: Callable[[dict, "Ctx"], dict]) -> Callable[[dict, "Ctx"], dict]:
    def fn(doc: dict, ctx: "Ctx") -> dict:
        for f in fns:
            doc = f(doc, ctx)
        return doc

    return fn


async def collect_file_refs(src: "ReadOnlySource", names: list[str]) -> dict[str, str]:
    """object key -> file name, for every legacy upload a source document references."""
    refs: dict[str, str] = {}
    projection = {"_id": 0, "id": 1, "tenant_id": 1, "audio_path": 1, "file_url": 1, "storage_path": 1, "attachment": 1}
    for coll in FILE_REF_COLLECTIONS:
        if coll not in names:
            continue
        async for doc in src.find(coll, {}, projection=projection):
            ref = file_ref(coll, doc)
            if ref:
                refs[ref[1]] = ref[0]
    return refs


def survey_uploads(refs: dict[str, str], uploads_dir: Path) -> tuple[dict[str, str], list[str], int]:
    """Split references into found (key -> file name) and missing file names."""
    root = uploads_dir.resolve()
    found: dict[str, str] = {}
    missing: list[str] = []
    total_bytes = 0
    for key, fname in refs.items():
        path = (root / fname).resolve()
        if path.parent == root and path.is_file():  # names come from the DB: no escaping the dir
            found[key] = fname
            total_bytes += path.stat().st_size
        else:
            missing.append(fname)
    return found, missing, total_bytes


# Collections never copied (ephemeral, or rebuilt by karma), with the reason.
SKIP: dict[str, str] = {
    "migrations_applied": "karma's ledger must replay from zero on the new DB",
    CHECKPOINT_COLL: "this script's own checkpoint",
    FILES_CHECKPOINT_COLL: "this script's own checkpoint",
    "otp_codes": "5-minute login codes; karma re-keys them by (phone, tenant_id) and deletes tenant-less rows",
    "platform_login_attempts": "admin lockout counters; starting from zero is harmless",
    "brain_contexts": "AI answer cache (karma renamed it brain_query_cache); old follow-ups just report 'expired'",
}

# name -> transform. Collections not listed here are copied verbatim.
TRANSFORMS: dict[str, Callable[[dict, "Ctx"], dict | None]] = {
    "tenants": transform_tenant,
    "users": transform_user,
    "tasks": transform_task,
    "leaves": transform_leave,
    "invoices": _chain(transform_money, _uploads("invoices")),
    "payments": transform_money,
    "expenses": _chain(transform_money, _uploads("expenses")),
    "assets": _chain(transform_money, _uploads("assets")),
    "inventory": _chain(transform_money, _uploads("inventory")),
    "voice_notes": _recording("voice_notes"),
    "meetings": _recording("meetings"),
    "ingestions": _uploads("ingestions"),
    "capture_drafts": _chain(_uploads("capture_drafts"), transform_capture_draft_role),
    "reclassify_jobs": transform_reclassify_job,
    "brain_context": transform_brain_context,
    "brain_documents": transform_brain_document,
    "platform_alerts": transform_platform_alert,
}


async def _load_tenant_user_ids(src: "ReadOnlySource") -> dict[str, set]:
    by_tenant: dict[str, set] = {}
    async for u in src.find("users", {}, projection={"_id": 0, "id": 1, "tenant_id": 1}):
        by_tenant.setdefault(u.get("tenant_id"), set()).add(u.get("id"))
    return by_tenant


async def _load_tenant_phone_counts(src: "ReadOnlySource") -> dict[tuple, int]:
    counts: dict[tuple, int] = {}
    async for u in src.find("users", {}, projection={"_id": 0, "tenant_id": 1, "phone": 1}):
        phone = norm_phone(u.get("phone"))
        if phone:
            key = (u.get("tenant_id"), phone)
            counts[key] = counts.get(key, 0) + 1
    return counts


# name -> async loader(source) -> value, exposed to transforms as ctx.lookups[name].
PRELOADS: dict[str, Callable[["ReadOnlySource"], Awaitable[Any]]] = {
    "tenant_user_ids": _load_tenant_user_ids,
    "tenant_phone_counts": _load_tenant_phone_counts,
}

# Collections main's code writes. A source collection outside this set (and not
# skipped) is still copied, but flagged so a human looks at it.
KNOWN_MAIN_COLLECTIONS = {
    "activity",
    "assets",
    "attendance",
    "brain_audit",
    "brain_context",
    "brain_contexts",
    "brain_documents",
    "calendar_events",
    "capture_drafts",
    "complaints",
    "contacts",
    "decisions",
    "expenses",
    "files",
    "inbox",
    "ingestions",
    "inventory",
    "invoices",
    "leaves",
    "ledger_ai",
    "meetings",
    "memory",
    "notifications",
    "otp_codes",
    "payments",
    "platform_admins",
    "platform_alerts",
    "platform_audit",
    "platform_login_attempts",
    "platform_settings",
    "reclassify_jobs",
    "signup_sessions",
    "tasks",
    "tenants",
    "usage_events",
    "users",
    "voice_notes",
    "wa_events",
    "workflows",
}

# Copy order: parents first so a failure leaves children missing, not orphans.
PRIORITY_ORDER = ["tenants", "users", "platform_admins"]

# Unique indexes karma's bootstrap builds. `create_index("email", unique=True)`
# on users is NOT wrapped in a try in _bootstrap -- a duplicate aborts the whole
# bootstrap (every later migration + index silently skipped). So these are
# checked against the transformed data BEFORE anything is written.
# (collection, fields, partial-filter predicate or None, index label)
UNIQUE_INDEXES: list[tuple[str, tuple[str, ...], Callable[[dict], bool] | None, str]] = [
    ("users", ("email",), None, "users.email"),
    ("platform_admins", ("email",), None, "platform_admins.email"),
    ("billing_events", ("idempotency_key",), None, "billing_events.idempotency_key"),
    ("auth_email_tokens", ("token",), None, "auth_email_tokens.token"),
    ("active_sessions", ("jti",), None, "active_sessions.jti"),
    ("revoked_tokens", ("jti",), None, "revoked_tokens.jti"),
    ("otp_codes", ("phone", "tenant_id"), None, "otp_codes.phone+tenant_id"),
    (
        "tasks",
        ("tenant_id", "workflow_id", "stage_key", "title"),
        lambda d: d.get("source") == "engine",
        "tasks.engine_template_task_unique",
    ),
]

# Indexes that must exist after bootstrap (collection, key spec).
CRITICAL_INDEXES: list[tuple[str, list[tuple[str, Any]]]] = [
    ("users", [("email", 1)]),
    ("users", [("phone_norm", 1)]),
    ("memberships", [("user_id", 1), ("tenant_id", 1)]),
    ("tasks", [("tenant_id", 1), ("status", 1), ("due_date", 1)]),
    ("tasks", [("tenant_id", 1), ("workflow_id", 1), ("stage_key", 1), ("title", 1)]),
    ("decisions", [("tenant_id", 1), ("created_at", -1)]),
    ("platform_admins", [("email", 1)]),
    ("otp_codes", [("phone", 1), ("tenant_id", 1)]),
    ("memory", [("_fts", "text"), ("_ftsx", 1)]),
    ("brain_documents", [("_fts", "text"), ("_ftsx", 1)]),
]


# =============================================================================
# Source access (read-only by construction)
# =============================================================================
class ReadOnlySource:
    """The only handle the script holds on the live DB. No write methods exist."""

    _WRITE_STAGES = ("$out", "$merge")

    def __init__(self, client: AsyncMongoClient, db_name: str):
        self._client = client
        self._db = client[db_name]
        self.name = db_name

    async def hello(self) -> dict:
        return await self._client.admin.command("hello")

    async def build_info(self) -> dict:
        return await self._client.admin.command("buildInfo")

    async def db_stats(self) -> dict:
        return await self._db.command("dbStats")

    async def collections(self) -> list[str]:
        """Real collections only (views and system.* excluded)."""
        names = []
        cursor = await self._db.list_collections()
        async for info in cursor:
            if info.get("type", "collection") == "collection" and not info["name"].startswith("system."):
                names.append(info["name"])
        return sorted(names)

    async def count(self, coll: str) -> int:
        return await self._db[coll].count_documents({})

    async def index_information(self, coll: str) -> dict:
        return await self._db[coll].index_information()

    def find(self, coll: str, filt: dict | None = None, **kwargs):
        return self._db[coll].find(filt or {}, **kwargs)

    async def find_one(self, coll: str, filt: dict, **kwargs):
        return await self._db[coll].find_one(filt, **kwargs)

    async def sample_ids(self, coll: str, n: int) -> list:
        pipeline = [{"$sample": {"size": n}}, {"$project": {"_id": 1}}]
        assert not any(k in stage for stage in pipeline for k in self._WRITE_STAGES)
        cursor = await self._db[coll].aggregate(pipeline)
        return [d["_id"] async for d in cursor]


# =============================================================================
# Per-collection bookkeeping
# =============================================================================
class CollectionStats:
    SAMPLES_PER_ISSUE = 5

    def __init__(self, name: str, policy: str):
        self.name = name
        self.policy = policy  # "skip" | "copy" | "transform"
        self.skip_reason = ""
        self.source_count = 0
        self.scanned = 0
        self.dropped = 0
        self.changed_docs = 0
        self.written = 0
        self.field_changes: dict[str, dict[str, int]] = {}
        self.issues: dict[str, dict] = {}

    @property
    def expected_target_count(self) -> int:
        return self.scanned - self.dropped

    def add_issue(self, severity: str, code: str, doc: dict | None, detail: str = "") -> None:
        key = f"{severity}:{code}"
        entry = self.issues.setdefault(key, {"severity": severity, "code": code, "count": 0, "samples": []})
        entry["count"] += 1
        if len(entry["samples"]) < self.SAMPLES_PER_ISSUE:
            entry["samples"].append({"doc": doc_ref(doc), "detail": detail[:300]})

    def record_field_diff(self, before: dict, after: dict) -> None:
        changed = False
        for key in set(before) | set(after):
            if key not in after:
                kind = "removed"
            elif key not in before:
                kind = "added"
            elif before[key] != after[key]:
                kind = "changed"
            else:
                continue
            changed = True
            bucket = self.field_changes.setdefault(key, {"added": 0, "removed": 0, "changed": 0})
            bucket[kind] += 1
        if changed:
            self.changed_docs += 1

    @property
    def blocking(self) -> int:
        return sum(i["count"] for i in self.issues.values() if i["severity"] == "block")

    @property
    def warnings(self) -> int:
        return sum(i["count"] for i in self.issues.values() if i["severity"] == "warn")

    def to_dict(self) -> dict:
        return {
            "policy": self.policy,
            "skip_reason": self.skip_reason or None,
            "source_count": self.source_count,
            "scanned": self.scanned,
            "dropped": self.dropped,
            "changed_docs": self.changed_docs,
            "expected_target_count": self.expected_target_count if self.policy != "skip" else 0,
            "written_this_run": self.written,
            "field_changes": dict(sorted(self.field_changes.items())),
            "issues": sorted(self.issues.values(), key=lambda i: (i["severity"] != "block", -i["count"])),
        }


def doc_ref(doc: dict | None) -> str:
    if not doc:
        return ""
    return str(doc.get("id") or doc.get("_id"))


class Ctx:
    """Handed to every transform."""

    def __init__(self, stats: CollectionStats, lookups: dict[str, Any], run_started_iso: str):
        self.stats = stats
        self.lookups = lookups
        self.run_started_iso = run_started_iso

    @property
    def options(self) -> dict[str, Any]:
        return self.lookups.get("options", {})

    def warn(self, code: str, doc: dict | None, detail: str = "") -> None:
        self.stats.add_issue("warn", code, doc, detail)

    def block(self, code: str, doc: dict | None, detail: str = "") -> None:
        self.stats.add_issue("block", code, doc, detail)


class _NullStats(CollectionStats):
    """Swallows issues -- used when re-running transforms for verification."""

    def add_issue(self, *a, **k) -> None:
        return None


class UniqueTracker:
    """Detects documents that would violate a karma unique index.

    Mirrors Mongo semantics: a missing field indexes as null, so two documents
    both missing a unique field collide too (unless the index is partial)."""

    def __init__(self, coll: str):
        self._specs = [(f, p, label) for c, f, p, label in UNIQUE_INDEXES if c == coll]
        self._seen: dict[str, dict] = {label: {} for _, _, label in self._specs}

    def check(self, doc: dict, ctx: Ctx) -> None:
        for fields, predicate, label in self._specs:
            if predicate is not None and not predicate(doc):
                continue
            key = json.dumps([doc.get(f) for f in fields], default=str, sort_keys=True)
            first = self._seen[label].get(key)
            if first is None:
                self._seen[label][key] = doc_ref(doc)
            else:
                ctx.block(
                    f"unique_violation:{label}",
                    doc,
                    f"same {'+'.join(fields)}={key} as {first}",
                )


# =============================================================================
# Scan / copy
# =============================================================================
SNAPSHOT_PREFIX = "_snapshot"  # scripts/snapshot_live.py bookkeeping: _snapshot_meta, _snapshot_uploads.*


def skip_reason(name: str) -> str | None:
    if name in SKIP:
        return SKIP[name]
    if name.startswith(SNAPSHOT_PREFIX):
        return "snapshot bookkeeping from snapshot_live.py, not application data"
    return None


def ordered(names: list[str]) -> list[str]:
    head = [n for n in PRIORITY_ORDER if n in names]
    return head + [n for n in names if n not in head]


def apply_transform(name: str, doc: dict, ctx: Ctx) -> dict | None:
    fn = TRANSFORMS.get(name)
    return fn(doc, ctx) if fn else doc


async def scan_collection(
    src: ReadOnlySource,
    name: str,
    lookups: dict[str, Any],
    run_started_iso: str,
    *,
    dst_db=None,
    batch_size: int = 1000,
) -> CollectionStats:
    """One full pass over a source collection. Validates every document; when
    `dst_db` is given, also upserts the transformed documents into it."""
    reason = skip_reason(name)
    policy = "skip" if reason else ("transform" if name in TRANSFORMS else "copy")
    stats = CollectionStats(name, policy)
    stats.source_count = await src.count(name)
    if policy == "skip":
        stats.skip_reason = reason
        return stats
    if name not in KNOWN_MAIN_COLLECTIONS:
        stats.add_issue("warn", "unmapped_collection", None, "not written by main's code -- copied verbatim, review it")

    ctx = Ctx(stats, lookups, run_started_iso)
    uniques = UniqueTracker(name)
    target = dst_db[name] if dst_db is not None else None
    batch: list[dict] = []
    started = time.time()

    async def flush() -> None:
        if not batch:
            return
        ops = [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in batch]
        try:
            await target.bulk_write(ops, ordered=False)
        except BulkWriteError as e:
            errs = e.details.get("writeErrors", [])[:5]
            raise Fatal(f"{name}: bulk write failed ({len(e.details.get('writeErrors', []))} errors), first: {errs}")
        stats.written += len(batch)
        batch.clear()

    async for doc in src.find(name, sort=[("_id", 1)], batch_size=batch_size):
        stats.scanned += 1
        before = dict(doc)
        try:
            out = apply_transform(name, doc, ctx)
        except Exception as e:  # a transform bug must never become silent data loss
            ctx.block("transform_error", before, f"{type(e).__name__}: {e}")
            continue
        if out is None:
            stats.dropped += 1
            continue
        if out.get("_id") != before.get("_id"):
            ctx.block("transform_changed_id", before, "transforms must keep _id")
            continue
        stats.record_field_diff(before, out)
        uniques.check(out, ctx)
        if target is not None:
            batch.append(out)
            if len(batch) >= batch_size:
                await flush()
        if stats.scanned % 20000 == 0:
            log(f"    {name}: {stats.scanned}/{stats.source_count} ({time.time() - started:.0f}s)")
    if target is not None:
        await flush()
    return stats


async def load_lookups(src: ReadOnlySource) -> dict[str, Any]:
    lookups: dict[str, Any] = {"options": dict(RUN_OPTIONS), "uploaded": dict(UPLOADED_PATHS)}
    for key, loader in PRELOADS.items():
        lookups[key] = await loader(src)
    return lookups


async def validate_all(src: ReadOnlySource, names: list[str], run_started_iso: str) -> dict[str, CollectionStats]:
    lookups = await load_lookups(src)
    results = {}
    for name in names:
        stats = await scan_collection(src, name, lookups, run_started_iso)
        results[name] = stats
        flag = f"BLOCK={stats.blocking} " if stats.blocking else ""
        log(
            f"  {name:<28} {stats.policy:<9} docs={stats.scanned:<8} "
            f"changed={stats.changed_docs:<7} dropped={stats.dropped:<5} {flag}warn={stats.warnings}"
        )
    return results


# =============================================================================
# Karma bootstrap on the target
# =============================================================================
class _LogCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.lines: list[tuple[str, str]] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append((record.levelname, record.getMessage()))


def ledger_names_from_lifecycle() -> list[str]:
    """Every ledgered migration karma's bootstrap runs, read from its source so
    this list can never drift from the code."""
    text = LIFECYCLE_PY.read_text(encoding="utf-8")
    return re.findall(r'_apply_migration\(\s*db,\s*"([^"]+)"', text)


def import_karma(target_url: str, target_db: str):
    """Import karma's backend bound to the TARGET database. Its config reads
    MONGO_URL/DB_NAME from the environment exactly once, at import, and
    backend/.env never overrides variables already set."""
    os.environ["MONGO_URL"] = target_url
    os.environ["DB_NAME"] = target_db
    if "config" in sys.modules:
        core = sys.modules.get("core")
        if core is None or core.db.name != target_db:
            raise Fatal("karma config was already imported for another database -- refusing")
        return core
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    try:
        import core
    except (KeyError, RuntimeError) as e:
        raise Fatal(f"importing karma backend failed ({type(e).__name__}: {e}); check backend/.env") from e
    if core.db.name != target_db:
        raise Fatal(f"karma core bound to DB {core.db.name!r}, expected {target_db!r}")
    return core


async def upload_files(found: dict[str, str], uploads_dir: Path, dst_db, concurrency: int) -> dict[str, str]:
    """Push every found file to object storage under its karma key and return
    key -> storage_path. Resumable: files already recorded in the checkpoint
    with the same sha256 are not re-sent."""
    from services import obj_store

    ckpt = dst_db[FILES_CHECKPOINT_COLL]
    prior = {row["_id"]: row async for row in ckpt.find({})}
    root = uploads_dir.resolve()
    sem = asyncio.Semaphore(max(1, concurrency))
    stored: dict[str, str] = {}
    failures: list[str] = []
    done = 0

    async def one(key: str, fname: str) -> None:
        nonlocal done
        async with sem:
            try:
                data = await asyncio.to_thread((root / fname).read_bytes)
                digest = hashlib.sha256(data).hexdigest()
                row = prior.get(key)
                if row and row.get("sha256") == digest:
                    stored[key] = row["storage_path"]
                else:
                    res = await obj_store.put_object(key, data, obj_store.guess_mime(fname))
                    path = (res or {}).get("path") or key
                    await ckpt.update_one(
                        {"_id": key},
                        {
                            "$set": {
                                "file": fname,
                                "storage_path": path,
                                "size": len(data),
                                "sha256": digest,
                                "uploaded_at": datetime.now(timezone.utc),
                            }
                        },
                        upsert=True,
                    )
                    stored[key] = path
            except Exception as e:
                failures.append(f"{fname}: {type(e).__name__}: {e}")
            done += 1
            if done % 200 == 0:
                log(f"    uploads {done}/{len(found)}")

    await asyncio.gather(*(one(k, f) for k, f in found.items()))
    if failures:
        raise Fatal(
            f"{len(failures)} upload(s) failed, first: {failures[:3]} -- re-run; uploaded files are not re-sent"
        )
    return stored


async def verify_uploads(dst_db, samples: int) -> list[str]:
    """Read random uploaded objects back and compare their sha256."""
    from services import obj_store

    failures = []
    cursor = await dst_db[FILES_CHECKPOINT_COLL].aggregate([{"$sample": {"size": max(1, min(samples, 10))}}])
    async for row in cursor:
        try:
            data, _ctype = await obj_store.get_object(row["storage_path"])
        except Exception as e:
            failures.append(f"upload {row['_id']}: read-back failed ({type(e).__name__}: {e})")
            continue
        if hashlib.sha256(data).hexdigest() != row["sha256"]:
            failures.append(f"upload {row['_id']}: stored bytes differ from {row['file']}")
    return failures


async def run_karma_bootstrap(target_url: str, target_db: str) -> dict:
    """Run karma's own `_bootstrap` (indexes + ledgered migrations) against the
    target, with everything that must not touch migrated production data
    stubbed out:
      * seed_demo / fixup_demo_tenant -- would plant the Sharma demo tenant with
        a well-known password into the production copy
      * write_test_credentials -- writes a creds cheat-sheet file to disk
      * seed_platform_admin -- the platform admins are migrated, not re-seeded
      * migrate_local_disk_uploads_to_obj_store -- reads and DELETES files in
        backend/uploads of whatever machine runs it (this one). The script
        migrates uploads itself; the stub leaves the ledger row `failed`, so
        karma re-checks at its own first boot and finds nothing left to move.
    """
    core = import_karma(target_url, target_db)
    try:
        import bootstrap.lifecycle as lifecycle
    except (KeyError, RuntimeError, ImportError) as e:
        raise Fatal(f"importing karma bootstrap failed ({type(e).__name__}: {e})") from e

    async def _noop(*_a, **_k):
        return None

    async def _defer_uploads(_db):
        raise RuntimeError(f"{UPLOADS_DEFERRED_MARKER}: the script migrated uploads; karma re-checks at first boot")

    lifecycle.seed_demo = _noop
    lifecycle.fixup_demo_tenant = _noop
    lifecycle.write_test_credentials = _noop
    lifecycle.seed_platform_admin = _noop
    lifecycle.migrate_local_disk_uploads_to_obj_store = _defer_uploads

    capture = _LogCapture()
    core.logger.addHandler(capture)
    started = time.time()
    try:
        await lifecycle._bootstrap()
    finally:
        core.logger.removeHandler(capture)
    duration = time.time() - started

    ledger = {
        row["name"]: row
        async for row in core.db.migrations_applied.find({}, {"_id": 0, "name": 1, "status": 1, "error": 1})
    }
    await core.client.close()
    return {
        "duration_s": round(duration, 1),
        "completed": any(msg == "Bootstrap complete." for _, msg in capture.lines),
        "errors": [msg for lvl, msg in capture.lines if lvl in ("ERROR", "CRITICAL")],
        "warnings": [msg for lvl, msg in capture.lines if lvl == "WARNING"],
        "ledger": ledger,
    }


# =============================================================================
# Verification
# =============================================================================
async def verify_copy(
    src: ReadOnlySource, dst_db, results: dict[str, CollectionStats], run_started_iso: str, samples: int
) -> list[str]:
    """Exact check BEFORE karma's bootstrap mutates anything: counts match the
    validation pass, and random source docs re-transformed equal the target docs."""
    failures = []
    lookups = await load_lookups(src)
    for name, stats in results.items():
        if stats.policy == "skip":
            continue
        got = await dst_db[name].count_documents({})
        if got != stats.expected_target_count:
            failures.append(f"{name}: target has {got} docs, expected {stats.expected_target_count}")
            continue
        if not samples or not stats.scanned:
            continue
        ctx = Ctx(_NullStats(name, stats.policy), lookups, run_started_iso)
        for _id in await src.sample_ids(name, samples):
            src_doc = await src.find_one(name, {"_id": _id})
            if src_doc is None:
                continue  # deleted since -- the drift check reports it
            expected = apply_transform(name, src_doc, ctx)
            actual = await dst_db[name].find_one({"_id": _id})
            if expected is None:
                if actual is not None:
                    failures.append(f"{name}: {_id} should have been dropped")
            elif actual != expected:
                failures.append(f"{name}: {_id} differs from its transformed source")
    return failures


def verify_bootstrap(boot: dict) -> list[str]:
    failures = []
    if not boot["completed"]:
        failures.append("karma _bootstrap did not reach 'Bootstrap complete.' -- see bootstrap.errors in the report")
    for name in ledger_names_from_lifecycle():
        row = boot["ledger"].get(name)
        if name == UPLOADS_LEDGER_NAME:
            if row and row.get("status") == "failed" and UPLOADS_DEFERRED_MARKER in (row.get("error") or ""):
                continue
        if not row or row.get("status") != "ok":
            failures.append(
                f"ledger migration {name}: {row.get('status') if row else 'missing'} {(row or {}).get('error') or ''}".strip()
            )
    return failures


async def verify_indexes(dst_db) -> list[str]:
    failures = []
    for coll, key in CRITICAL_INDEXES:
        info = await dst_db[coll].index_information()
        wanted = [(k, v) for k, v in key]
        if not any([(k, v) for k, v in spec.get("key", [])] == wanted for spec in info.values()):
            failures.append(f"missing index {coll} {wanted}")
    return failures


# =============================================================================
# Orchestration
# =============================================================================
class Run:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.run_started_iso = datetime.now(timezone.utc).isoformat()
        self.report: dict[str, Any] = {
            "script": "migrate_main_to_karma",
            "mode": args.mode,
            "started_at": self.run_started_iso,
            "source": {"url": mask_url(args.source_url), "db": args.source_db},
            "target": {"url": mask_url(args.target_url), "db": args.target_db},
            "options": {
                "ai_consent": args.ai_consent or "reconsent",
                "uploads": "migrate" if args.uploads_dir else ("skip" if args.skip_uploads else "unchecked"),
            },
        }
        self.found_uploads: dict[str, str] = {}
        RUN_OPTIONS.clear()
        RUN_OPTIONS.update(self.report["options"])
        self.src_client: AsyncMongoClient | None = None
        self.dst_client: AsyncMongoClient | None = None

    # -- connections + guards --------------------------------------------------
    async def connect(self) -> ReadOnlySource:
        a = self.args
        self.src_client = AsyncMongoClient(
            a.source_url, serverSelectionTimeoutMS=15000, appname="migrate_main_to_karma:src"
        )
        src = ReadOnlySource(self.src_client, a.source_db)
        try:
            src_hello = await src.hello()
            src_version = (await src.build_info()).get("version")
        except PyMongoError as e:
            raise Fatal(f"cannot reach source {mask_url(a.source_url)}: {e}") from e
        if a.source_db not in await self.src_client.list_database_names():
            raise Fatal(f"source DB {a.source_db!r} does not exist")
        self.report["source"]["server_version"] = src_version
        log(f"source  {mask_url(a.source_url)} / {a.source_db}  (MongoDB {src_version})")

        if a.mode == "plan":
            return src

        self.dst_client = AsyncMongoClient(
            a.target_url, serverSelectionTimeoutMS=15000, appname="migrate_main_to_karma:dst"
        )
        try:
            dst_hello = await self.dst_client.admin.command("hello")
            dst_version = (await self.dst_client.admin.command("buildInfo")).get("version")
        except PyMongoError as e:
            raise Fatal(f"cannot reach target {mask_url(a.target_url)}: {e}") from e
        self.report["target"]["server_version"] = dst_version
        log(f"target  {mask_url(a.target_url)} / {a.target_db}  (MongoDB {dst_version})")

        same_cluster = bool(url_hosts(a.source_url) & url_hosts(a.target_url)) or (
            src_hello.get("setName") and src_hello.get("setName") == dst_hello.get("setName")
        )
        if same_cluster and a.source_db == a.target_db:
            raise Fatal("source and target are the same database -- refusing")
        return src

    async def close(self) -> None:
        for c in (self.src_client, self.dst_client):
            if c is not None:
                await c.close()

    # -- modes -------------------------------------------------------------------
    async def run(self) -> int:
        src = await self.connect()
        stats = await src.db_stats()
        self.report["source"]["data_size_mb"] = round(stats.get("dataSize", 0) / 1e6, 1)

        names = ordered(await src.collections())
        self.report["source"]["collections"] = names
        if "migrations_applied" in names:
            applied = [d["name"] async for d in src.find("migrations_applied", {}, projection={"_id": 0, "name": 1})]
            self.report["source"]["already_applied_karma_migrations"] = applied
            log(
                f"note: source already has a karma ledger ({len(applied)} rows); it is not copied -- all replay idempotently"
            )

        refs = await collect_file_refs(src, names)
        uploads_report: dict[str, Any] = {"mode": RUN_OPTIONS["uploads"], "referenced_files": len(refs)}
        UPLOADED_PATHS.clear()
        if self.args.uploads_dir:
            found, missing, total_bytes = survey_uploads(refs, self.args.uploads_dir)
            self.found_uploads = found
            UPLOADED_PATHS.update({key: key for key in found})  # predicted until the real upload
            uploads_report.update(
                found=len(found),
                missing=len(missing),
                found_mb=round(total_bytes / 1e6, 1),
                missing_samples=sorted(missing)[:25],
            )
            log(
                f"uploads: {len(refs)} referenced, {len(found)} found in {self.args.uploads_dir}, {len(missing)} missing"
            )
        else:
            log(f"uploads: {len(refs)} referenced, files not checked (uploads={RUN_OPTIONS['uploads']})")
        self.report["uploads"] = uploads_report

        log(f"validating {len(names)} collections ({self.report['source']['data_size_mb']} MB) ...")
        results = await validate_all(src, names, self.run_started_iso)
        self.report["collections"] = {n: s.to_dict() for n, s in results.items()}
        blocking = sum(s.blocking for s in results.values())
        self.report["blocking_issues"] = blocking
        self.report["warnings"] = sum(s.warnings for s in results.values())

        if self.args.mode == "plan":
            self.print_summary(results)
            if blocking:
                log(f"PLAN: {blocking} BLOCKING issue(s) -- fix them before rehearse/execute (details in the report)")
                return EXIT_BLOCKED
            log("PLAN: clean -- no blocking issues")
            return EXIT_OK

        if blocking:
            self.print_summary(results)
            log(f"REFUSING to write: {blocking} blocking issue(s). Run `plan` and fix them first.")
            return EXIT_BLOCKED

        target_db = self.args.target_db
        if self.args.mode == "rehearse":
            target_db = f"{self.args.target_db}_rehearsal_{int(time.time())}"
            self.report["target"]["rehearsal_db"] = target_db
            log(f"rehearsal DB: {target_db}")
        try:
            return await self.write_and_verify(src, names, results, target_db)
        finally:
            if self.args.mode == "rehearse" and not self.args.keep_rehearsal:
                await self.dst_client.drop_database(target_db)
                log(f"dropped rehearsal DB {target_db}")

    async def write_and_verify(
        self, src: ReadOnlySource, names: list[str], results: dict[str, CollectionStats], target_db: str
    ) -> int:
        a = self.args
        dst_db = self.dst_client[target_db]
        existing = [
            n for n in await dst_db.list_collection_names() if n not in (CHECKPOINT_COLL, FILES_CHECKPOINT_COLL)
        ]
        checkpoint = {d["_id"]: d async for d in dst_db[CHECKPOINT_COLL].find({})}
        if existing and not (a.resume or a.allow_nonempty_target):
            raise Fatal(
                f"target DB {target_db!r} is not empty ({len(existing)} collections). "
                "Use --resume to continue an interrupted run, or point at an empty DB."
            )

        # -- uploads, before any document points at them ------------------------------
        if RUN_OPTIONS.get("uploads") == "migrate" and self.found_uploads:
            import_karma(a.target_url, target_db)
            log(f"uploading {len(self.found_uploads)} files to object storage ...")
            stored = await upload_files(self.found_uploads, a.uploads_dir, dst_db, a.upload_concurrency)
            UPLOADED_PATHS.clear()
            UPLOADED_PATHS.update(stored)
            self.report["uploads"]["uploaded"] = len(stored)
            self.report["uploads"]["store_returned_other_path"] = sum(1 for k, v in stored.items() if k != v)

        # -- copy ----------------------------------------------------------------
        source_counts_before = {n: results[n].source_count for n in names}
        lookups = await load_lookups(src)
        log(f"copying into {target_db} ...")
        for name in names:
            if results[name].policy == "skip":
                continue
            done = checkpoint.get(name)
            if a.resume and done and done.get("status") == "copied" and done.get("scanned") == results[name].scanned:
                log(f"  {name:<28} already copied (checkpoint) -- skipped")
                continue
            await dst_db[CHECKPOINT_COLL].update_one(
                {"_id": name}, {"$set": {"status": "copying", "started_at": datetime.now(timezone.utc)}}, upsert=True
            )
            t0 = time.time()
            written = await scan_collection(
                src, name, lookups, self.run_started_iso, dst_db=dst_db, batch_size=a.batch_size
            )
            if written.blocking:  # source changed between validation and copy
                raise Fatal(f"{name}: {written.blocking} blocking issue(s) appeared during the copy (source changed?)")
            await dst_db[CHECKPOINT_COLL].update_one(
                {"_id": name},
                {
                    "$set": {
                        "status": "copied",
                        "scanned": written.scanned,
                        "written": written.written,
                        "finished_at": datetime.now(timezone.utc),
                    }
                },
            )
            results[name].written = written.written
            log(f"  {name:<28} wrote {written.written:<8} ({time.time() - t0:.1f}s)")

        # -- verify the raw copy before karma's bootstrap mutates it -----------------
        log("verifying copy (counts + random-sample equality) ...")
        copy_failures = await verify_copy(src, dst_db, results, self.run_started_iso, a.verify_samples)
        if RUN_OPTIONS.get("uploads") == "migrate" and UPLOADED_PATHS:
            copy_failures += await verify_uploads(dst_db, a.verify_samples)
        self.report["verify_copy_failures"] = copy_failures

        # -- source drift ----------------------------------------------------------
        drift = {}
        for name in names:
            now = await src.count(name)
            if now != source_counts_before[name]:
                drift[name] = {"before": source_counts_before[name], "after": now}
        self.report["source_drift"] = drift

        if copy_failures:
            for f in copy_failures:
                log(f"  FAIL {f}")
            self.report["collections"] = {n: s.to_dict() for n, s in results.items()}
            return EXIT_VERIFY_FAILED

        # -- karma bootstrap ----------------------------------------------------------
        if a.skip_bootstrap:
            log("skipping karma bootstrap (--skip-bootstrap): karma's app will run it at first boot")
            self.report["bootstrap"] = "skipped"
            bootstrap_failures: list[str] = []
        else:
            log("running karma bootstrap on the target (indexes + ledgered migrations; demo/admin seeding stubbed) ...")
            boot = await run_karma_bootstrap(a.target_url, target_db)
            self.report["bootstrap"] = boot
            bootstrap_failures = verify_bootstrap(boot) + await verify_indexes(dst_db)
            log(f"  bootstrap finished in {boot['duration_s']}s, {len(boot['ledger'])} ledger rows")

        counts_after = {n: await dst_db[n].count_documents({}) for n in await dst_db.list_collection_names()}
        self.report["target_counts_after_bootstrap"] = dict(sorted(counts_after.items()))
        self.report["verify_bootstrap_failures"] = bootstrap_failures
        self.report["collections"] = {n: s.to_dict() for n, s in results.items()}
        self.print_summary(results)

        if bootstrap_failures:
            for f in bootstrap_failures:
                log(f"  FAIL {f}")
            return EXIT_VERIFY_FAILED
        if drift:
            log(f"WARNING: source changed during the copy: {drift}. Freeze writes and re-run with --resume.")
            return EXIT_SOURCE_DRIFT
        log(f"{a.mode.upper()}: OK")
        return EXIT_OK

    # -- output ------------------------------------------------------------------
    def print_summary(self, results: dict[str, CollectionStats]) -> None:
        print()
        print(f"{'collection':<28} {'policy':<9} {'source':>8} {'target':>8} {'changed':>8} {'block':>6} {'warn':>6}")
        for name, s in results.items():
            target = "-" if s.policy == "skip" else s.expected_target_count
            print(
                f"{name:<28} {s.policy:<9} {s.source_count:>8} {target:>8} {s.changed_docs:>8} {s.blocking:>6} {s.warnings:>6}"
            )
            for issue in s.to_dict()["issues"]:
                sample = issue["samples"][0] if issue["samples"] else {}
                print(
                    f"    {issue['severity'].upper():<5} {issue['code']} x{issue['count']}  e.g. {sample.get('doc', '')} {sample.get('detail', '')}"
                )
        print()

    def write_report(self, exit_code: int) -> Path:
        self.report["finished_at"] = datetime.now(timezone.utc).isoformat()
        self.report["exit_code"] = exit_code
        path = Path(
            self.args.report or f"migration_report_{self.args.mode}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        path.write_text(json.dumps(self.report, indent=2, default=str), encoding="utf-8")
        return path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Migrate the live main-branch MongoDB into a new karma-redesign DB.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("mode", nargs="?", default="plan", choices=["plan", "rehearse", "execute"])
    p.add_argument("--source-url", default=os.environ.get("SOURCE_MONGO_URL"))
    p.add_argument("--source-db", default=os.environ.get("SOURCE_DB_NAME"))
    p.add_argument("--target-url", default=os.environ.get("TARGET_MONGO_URL"))
    p.add_argument("--target-db", default=os.environ.get("TARGET_DB_NAME"))
    p.add_argument("--confirm", help="execute only: must equal --target-db")
    p.add_argument(
        "--ai-consent",
        choices=["reconsent", "grandfather"],
        help="required for rehearse/execute. karma blocks AI for tenants without a DPDP consent record. "
        "reconsent: leave it absent, each owner accepts in Settings. "
        "grandfather: record consent as granted by this migration (a legal call -- confirm first)",
    )
    p.add_argument(
        "--resume", action="store_true", help="continue an interrupted execute (skips collections already copied)"
    )
    p.add_argument(
        "--allow-nonempty-target",
        action="store_true",
        help="write into a target that already has data (upserts by _id)",
    )
    p.add_argument("--batch-size", type=int, default=1000)
    p.add_argument(
        "--verify-samples", type=int, default=25, help="random docs per collection re-checked after the copy"
    )
    p.add_argument(
        "--skip-bootstrap", action="store_true", help="copy only; leave karma's bootstrap to the app's first boot"
    )
    uploads = p.add_mutually_exclusive_group()
    uploads.add_argument(
        "--uploads-dir",
        type=Path,
        help="a copy of prod's backend/uploads: referenced files are pushed to object storage "
        "(with the EMERGENT_LLM_KEY in backend/.env) and document references rewritten",
    )
    uploads.add_argument(
        "--skip-uploads",
        action="store_true",
        help="leave file references untouched (recording audio is cleared at karma boot; "
        "ingestion, capture and ledger attachment links return 404)",
    )
    p.add_argument("--upload-concurrency", type=int, default=8)
    p.add_argument("--keep-rehearsal", action="store_true", help="rehearse only: do not drop the rehearsal DB")
    p.add_argument("--report", help="report JSON path (default: ./migration_report_<mode>_<ts>.json)")
    args = p.parse_args(argv)

    missing = [f for f in ("source_url", "source_db") if not getattr(args, f)]
    if args.mode != "plan":
        missing += [f for f in ("target_url", "target_db") if not getattr(args, f)]
    if missing:
        p.error("missing: " + ", ".join("--" + m.replace("_", "-") for m in missing))
    if args.mode != "plan" and not args.ai_consent:
        p.error("--ai-consent {reconsent,grandfather} is required for rehearse/execute (see --help)")
    if args.mode != "plan" and not (args.uploads_dir or args.skip_uploads):
        p.error("pass --uploads-dir <copy of prod backend/uploads> or --skip-uploads for rehearse/execute")
    if args.uploads_dir and not args.uploads_dir.is_dir():
        p.error(f"--uploads-dir {args.uploads_dir} is not a directory")
    if args.mode == "execute" and args.confirm != args.target_db:
        p.error(f"execute writes to {args.target_db!r}: pass --confirm {args.target_db} to proceed")
    if args.batch_size < 1:
        p.error("--batch-size must be >= 1")
    return args


async def amain(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    run = Run(args)
    code = EXIT_FATAL
    try:
        code = await run.run()
    except Fatal as e:
        log(f"FATAL: {e}")
        run.report["fatal"] = str(e)
        code = EXIT_FATAL
    except KeyboardInterrupt:
        log("interrupted -- re-run execute with --resume to continue")
        run.report["fatal"] = "interrupted"
        code = EXIT_FATAL
    finally:
        await run.close()
        path = run.write_report(code)
        log(f"report: {path.resolve()}")
    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(amain()))
