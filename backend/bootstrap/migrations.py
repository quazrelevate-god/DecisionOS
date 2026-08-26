"""One-shot data migrations + platform-admin seed (Epic 8 Sprint 7 -- U8-07.3).

Extracted verbatim from server.py. migrate_tenants backfills the roles array on
legacy tenants; migrate_local_disk_uploads_to_obj_store is the ledgered, destructive
move of legacy disk uploads into object storage; seed_platform_admin provisions the
super-admin from env. All are startup-only, orchestrated by
bootstrap.lifecycle._bootstrap. server.py re-exports these names.
"""
from __future__ import annotations

import os
from pathlib import Path

from core import (
    db, logger, now_iso, new_id, hash_password, verify_password, DEFAULT_ROLES,
)

# Legacy local-disk upload root (backend/uploads). Derived from this file's
# location so the migration does not import server. bootstrap/ -> backend/.
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


async def migrate_tenants():
    """Backfill onboarding fields for tenants created before industry-aware onboarding."""
    async for t in db.tenants.find({"roles": {"$exists": False}}):
        await db.tenants.update_one({"id": t["id"]}, {"$set": {
            "industry": t.get("industry", "General"),
            "company_size": t.get("company_size", ""),
            "region": t.get("region", ""),
            "currency": t.get("currency", "INR"),
            "roles": DEFAULT_ROLES,
            "products": t.get("products", []),
        }})


async def migrate_local_disk_uploads_to_obj_store(_db):
    """FIX-002-E: one-shot migration. Copy every legacy local-disk upload
    referenced by voice_notes/meetings/ingestions/expenses/assets to
    obj_store, rewrite the doc to point at the new storage_path, then
    delete the local file. Idempotent internally (skips docs whose path
    is already an obj_store key) AND wrapped in the ledger for exactly-
    once safety across restarts.

    This is the FIRST truly destructive migration in the codebase — it
    deletes source files after copy. The ledger protects against re-runs.
    Its own idempotency guard (skip already-migrated docs) protects
    within a single run if it crashes mid-way and the ledger records
    'failed' (next boot retries only what wasn't migrated).
    """
    from services.uploads import store_upload, is_legacy_path
    stats = {"scanned": 0, "migrated": 0, "skipped_absent": 0, "already_new": 0, "failed": 0}

    # Map: collection -> (path_field, category, tenant_extractor)
    plan = [
        ("voice_notes", "audio_path", "voice-notes"),
        ("meetings",    "audio_path", "meetings"),
        ("ingestions",  "storage_path", "ingestions"),  # storage_path may already be new
    ]

    for coll_name, path_field, category in plan:
        cursor = _db[coll_name].find(
            {path_field: {"$exists": True, "$ne": None, "$ne": ""}},
            {"_id": 0, "id": 1, "tenant_id": 1, path_field: 1},
        )
        async for doc in cursor:
            stats["scanned"] += 1
            path = doc.get(path_field)
            if not path:
                continue
            if not is_legacy_path(path):
                stats["already_new"] += 1
                continue
            tenant_id = doc.get("tenant_id")
            if not tenant_id:
                stats["failed"] += 1
                continue
            # Try to read the legacy file. If it doesn't exist on this
            # box (very common — the app moved to a new machine, files
            # left behind), skip and record.
            from pathlib import Path as _P
            legacy_p = _P(path) if _P(path).is_absolute() else UPLOAD_DIR / path
            if not legacy_p.exists():
                stats["skipped_absent"] += 1
                # Still rewrite the doc field to null so read paths stop
                # attempting the absent local file. Preserves the record.
                await _db[coll_name].update_one(
                    {"id": doc["id"]}, {"$set": {path_field: None, "_upload_missing": True}}
                )
                continue
            try:
                data = legacy_p.read_bytes()
                ext = legacy_p.suffix.lstrip(".") or "bin"
                stored = await store_upload(tenant_id, category, data, ext,
                                             file_id=doc["id"])
                await _db[coll_name].update_one(
                    {"id": doc["id"]},
                    {"$set": {path_field: stored["storage_path"]}},
                )
                # Only delete the local file AFTER the DB pointer moves.
                try:
                    legacy_p.unlink()
                except Exception as del_err:
                    logger.warning(f"legacy file delete failed for {legacy_p}: {del_err}")
                stats["migrated"] += 1
            except Exception as e:
                logger.warning(f"local-disk migration failed for {coll_name}/{doc['id']}: {e}")
                stats["failed"] += 1

    # Also handle ledger attachments (nested field: attachment.storage_path)
    for coll_name in ("expenses", "assets", "inventory"):
        cursor = _db[coll_name].find(
            {"attachment.url": {"$regex": "^/api/files/"},
             "attachment.storage_path": {"$exists": False}},
            {"_id": 0, "id": 1, "tenant_id": 1, "attachment": 1},
        )
        async for doc in cursor:
            stats["scanned"] += 1
            att = doc.get("attachment") or {}
            fname = (att.get("url") or "").split("/")[-1]
            if not fname:
                continue
            legacy_p = UPLOAD_DIR / fname
            if not legacy_p.exists():
                stats["skipped_absent"] += 1
                continue
            tenant_id = doc.get("tenant_id")
            if not tenant_id:
                stats["failed"] += 1
                continue
            try:
                data = legacy_p.read_bytes()
                ext = legacy_p.suffix.lstrip(".") or "bin"
                stored = await store_upload(tenant_id, "ledger", data, ext)
                new_att = {**att, "storage_path": stored["storage_path"]}
                await _db[coll_name].update_one(
                    {"id": doc["id"]}, {"$set": {"attachment": new_att}}
                )
                try:
                    legacy_p.unlink()
                except Exception:
                    pass
                stats["migrated"] += 1
            except Exception as e:
                logger.warning(f"ledger attachment migration failed for {coll_name}/{doc['id']}: {e}")
                stats["failed"] += 1

    logger.info(f"[migrate_local_disk_uploads] {stats}")


async def seed_platform_admin():
    """FIX-006-A (S0-01): platform super-admin seeder.

    Prior behaviour had two problems:
      1. Hardcoded default email + password (`admin@decisionos.biz` /
         `DecisionOS@2026`) shipped in the code — anyone who deployed
         without SUPERADMIN_* env vars set got a well-known admin
         account.
      2. On every restart, if the env password didn't match the DB
         hash, the DB was silently overwritten. That blocked
         credential rotation via the DB and meant anyone with env-var
         write access could re-take the account across the fleet.

    Now:
      * In prod (ENV=prod) we REFUSE to seed with the fallback defaults —
        raise a loud error so a misconfigured deploy fails fast instead
        of standing up a known-credentials admin.
      * We only INSERT when the admin doesn't exist. Overwriting an
        existing hash requires the explicit SUPERADMIN_ALLOW_HASH_REFRESH=1
        opt-in (one-off flag for the rare intended reset).
    """
    from config import PLATFORM_ADMIN_JWT_SECRET as _pjwt  # noqa: F401 (import triggers config warn)
    env_email = os.environ.get("SUPERADMIN_EMAIL", "").strip().lower()
    env_password = os.environ.get("SUPERADMIN_PASSWORD", "").strip()
    running_env = os.environ.get("ENV", "dev").strip().lower()
    if not env_email or not env_password:
        if running_env == "prod":
            raise RuntimeError(
                "SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD are REQUIRED when ENV=prod. "
                "Refusing to boot with hardcoded defaults."
            )
        # Non-prod fallback so local dev still gets a working admin login.
        # Log the fact loudly so nobody forgets to set the env in staging.
        email = env_email or "admin@decisionos.biz"
        password = env_password or "DecisionOS@2026"
        logger.warning(
            "Seeding platform super-admin with DEV FALLBACK credentials. "
            "Set SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD before touching prod."
        )
    else:
        email = env_email
        password = env_password
    existing = await db.platform_admins.find_one({"email": email})
    if not existing:
        await db.platform_admins.insert_one({
            "id": new_id(), "email": email, "name": "Platform Admin",
            "password_hash": hash_password(password), "created_at": now_iso(),
        })
        logger.info(f"Platform super-admin seeded: {email}")
        return
    # From here on: an admin doc already exists. We NEVER silently
    # replace its hash — that would let anyone with env-var access
    # overwrite the account on the next restart. Only refresh when the
    # deployer explicitly opts in via SUPERADMIN_ALLOW_HASH_REFRESH=1,
    # which they should then unset on the following deploy.
    from config import SUPERADMIN_ALLOW_HASH_REFRESH as _refresh_ok
    if _refresh_ok and not verify_password(password, existing.get("password_hash", "")):
        await db.platform_admins.update_one(
            {"id": existing["id"]},
            {"$set": {"password_hash": hash_password(password)}},
        )
        logger.warning(
            f"Platform super-admin hash REFRESHED from env (opt-in): {email}. "
            "Unset SUPERADMIN_ALLOW_HASH_REFRESH now to prevent silent future refreshes."
        )
