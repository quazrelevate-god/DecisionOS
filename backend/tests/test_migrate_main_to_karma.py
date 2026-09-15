"""Tests for scripts/migrate_main_to_karma.py (main -> karma-redesign data migration).

Pure unit tests for every transform + an end-to-end run of plan / execute /
resume against an in-memory fake MongoDB. No live DB, no network, no karma
backend import (bootstrap + object storage are stubbed at their seams).
"""

import asyncio
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("migrate_main_to_karma", ROOT / "scripts" / "migrate_main_to_karma.py")
mig = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = mig
_spec.loader.exec_module(mig)

RUN_ISO = "2026-09-14T00:00:00+00:00"


def make_ctx(options=None, uploaded=None, tenant_user_ids=None):
    stats = mig.CollectionStats("test", "transform")
    lookups = {"options": options or {}, "uploaded": uploaded or {}, "tenant_user_ids": tenant_user_ids or {}}
    return mig.Ctx(stats, lookups, RUN_ISO)


def issue_codes(ctx):
    return {key: entry["count"] for key, entry in ctx.stats.issues.items()}


def run_pure(fn, doc, ctx):
    """Run a transform and assert it did not mutate its input."""
    before = copy.deepcopy(doc)
    out = fn(doc, ctx)
    assert doc == before, "transform mutated its input document"
    return out


# =============================================================================
# Pinned constants still match karma's source
# =============================================================================
class TestParityWithKarmaSource:
    def _src(self, rel):
        return (ROOT / rel).read_text(encoding="utf-8")

    def test_ai_consent_version(self):
        m = re.search(r'CURRENT_CONSENT_VERSION\s*=\s*"([^"]+)"', self._src("services/ai_consent.py"))
        assert m and m.group(1) == mig.AI_CONSENT_VERSION

    def test_max_co_assignees(self):
        m = re.search(r"MAX_CO_ASSIGNEES\s*=\s*(\d+)", self._src("services/tasks.py"))
        assert m and int(m.group(1)) == mig.MAX_CO_ASSIGNEES

    def test_storage_key_format(self):
        assert re.search(r'APP_NAME\s*=\s*"decisionos"', self._src("integrations/storage.py"))
        assert 'f"{obj_store.APP_NAME}/{tenant_id}/{category}/{file_id}.{ext_clean}"' in self._src(
            "services/uploads.py"
        )
        assert mig.build_key("t", "ledger", "abc", ".PDF") == "decisionos/t/ledger/abc.pdf"

    def test_plan_fields_match_karma_backfill(self):
        src = self._src("bootstrap/lifecycle.py")
        for field in ('"seat_limit_override": None', '"usage_quotas": {}', '"feature_flags": {}'):
            assert field in src
        assert re.search(r'PLAN_GRANDFATHERED\s*=\s*"grandfathered"', self._src("services/plans.py"))

    def test_ledger_names_read_from_lifecycle(self):
        names = mig.ledger_names_from_lifecycle()
        assert len(names) == len(set(names)) >= 15
        for expected in (
            "backfill_memberships_v1",
            "backfill_grandfathered_plans_v1",
            "rename_production_role_v1",
            mig.UPLOADS_LEDGER_NAME,
        ):
            assert expected in names

    def test_bootstrap_seams_still_exist(self):
        src = self._src("bootstrap/lifecycle.py")
        for name in (
            "seed_demo",
            "fixup_demo_tenant",
            "write_test_credentials",
            "seed_platform_admin",
            "migrate_local_disk_uploads_to_obj_store",
        ):
            assert re.search(rf"\b{name}\b", src), name


# =============================================================================
# tenants
# =============================================================================
class TestTenantTransform:
    def test_plan_backfilled_like_karma(self):
        ctx = make_ctx()
        out = run_pure(mig.transform_tenant, {"_id": 1, "id": "t1"}, ctx)
        assert out["plan"] == "grandfathered"
        assert out["seat_limit_override"] is None
        assert out["usage_quotas"] == {} and out["feature_flags"] == {}
        assert out["updated_at"] == RUN_ISO

    def test_existing_plan_untouched(self):
        out = run_pure(mig.transform_tenant, {"_id": 1, "id": "t1", "plan": "starter", "updated_at": "x"}, make_ctx())
        assert out["plan"] == "starter" and out["updated_at"] == "x"

    def test_production_role_renamed(self):
        doc = {
            "_id": 1,
            "id": "t1",
            "plan": "trial",
            "roles": [{"key": "sales", "label": "Sales"}, {"key": "production", "label": "Production"}],
        }
        out = run_pure(mig.transform_tenant, doc, make_ctx())
        assert out["roles"] == [{"key": "sales", "label": "Sales"}, {"key": "operations", "label": "Production"}]

    def test_production_and_operations_merged_without_duplicate_keys(self):
        doc = {
            "_id": 1,
            "id": "t1",
            "plan": "trial",
            "roles": [{"key": "operations", "label": "Ops"}, {"key": "production", "label": "Production"}],
        }
        ctx = make_ctx()
        out = run_pure(mig.transform_tenant, doc, ctx)
        assert [r["key"] for r in out["roles"]] == ["operations"]
        assert "warn:role_production_merged_into_operations" in issue_codes(ctx)

    def test_leave_approvers_key_moved(self):
        out = run_pure(
            mig.transform_tenant,
            {"_id": 1, "id": "t1", "leave_approvers": {"production": "u9", "sales": "u2"}},
            make_ctx(),
        )
        assert out["leave_approvers"] == {"operations": "u9", "sales": "u2"}

    def test_leave_approvers_conflict_keeps_operations(self):
        ctx = make_ctx()
        out = run_pure(
            mig.transform_tenant,
            {"_id": 1, "id": "t1", "leave_approvers": {"production": "u9", "operations": "u1"}},
            ctx,
        )
        assert out["leave_approvers"] == {"operations": "u1"}
        assert "warn:leave_approver_conflict" in issue_codes(ctx)

    def test_consent_reconsent_leaves_it_absent(self):
        ctx = make_ctx({"ai_consent": "reconsent"})
        out = run_pure(mig.transform_tenant, {"_id": 1, "id": "t1"}, ctx)
        assert "ai_consent" not in out
        assert "warn:ai_consent_required" in issue_codes(ctx)

    def test_consent_grandfather_records_migration_grant(self):
        out = run_pure(mig.transform_tenant, {"_id": 1, "id": "t1"}, make_ctx({"ai_consent": "grandfather"}))
        consent = out["ai_consent"]
        assert consent["granted_at"] == RUN_ISO and consent["version"] == mig.AI_CONSENT_VERSION
        assert consent["revoked_at"] is None and consent["granted_by_user_id"] == "migration:main_to_karma"

    def test_consent_grandfather_never_overrides_a_revocation(self):
        revoked = {"granted_at": "a", "revoked_at": "b", "version": "1.0"}
        out = run_pure(
            mig.transform_tenant, {"_id": 1, "id": "t1", "ai_consent": revoked}, make_ctx({"ai_consent": "grandfather"})
        )
        assert out["ai_consent"] == revoked

    def test_active_consent_kept(self):
        active = {"granted_at": "a", "revoked_at": None, "version": mig.AI_CONSENT_VERSION}
        ctx = make_ctx({"ai_consent": "grandfather"})
        out = run_pure(mig.transform_tenant, {"_id": 1, "id": "t1", "ai_consent": active}, ctx)
        assert out["ai_consent"] == active and not ctx.stats.issues


# =============================================================================
# users / tasks / leaves
# =============================================================================
class TestUserTransform:
    def test_email_normalised_and_role_renamed(self):
        ctx = make_ctx()
        out = run_pure(
            mig.transform_user,
            {
                "_id": 1,
                "id": "u",
                "tenant_id": "t",
                "email": " Ravi@Acme.COM ",
                "role": "production",
                "created_at": "x",
            },
            ctx,
        )
        assert out["email"] == "ravi@acme.com" and out["role"] == "operations"
        assert "warn:email_normalized" in issue_codes(ctx)

    def test_missing_created_at_filled(self):
        out = run_pure(mig.transform_user, {"_id": 1, "id": "u", "tenant_id": "t", "email": "a@b.c"}, make_ctx())
        assert out["created_at"] == RUN_ISO

    def test_demo_account_flagged(self):
        ctx = make_ctx()
        run_pure(
            mig.transform_user,
            {"_id": 1, "id": "u", "tenant_id": "t", "email": "owner@sharma.com", "created_at": "x"},
            ctx,
        )
        assert "warn:demo_account_present" in issue_codes(ctx)


class TestTaskTransform:
    USERS = {"t": {"lead", "helper", "other"}}

    def task(self, **kw):
        return {"_id": 1, "id": "k", "tenant_id": "t", "assignee_id": "lead", **kw}

    def test_support_id_becomes_helper(self):
        out = run_pure(mig.transform_task, self.task(support_id="helper"), make_ctx(tenant_user_ids=self.USERS))
        assert "support_id" not in out and out["co_assignee_ids"] == ["helper"]

    def test_support_id_same_as_lead_or_existing_helper_just_dropped(self):
        ctx = make_ctx(tenant_user_ids=self.USERS)
        out = run_pure(mig.transform_task, self.task(support_id="lead"), ctx)
        assert "support_id" not in out and "co_assignee_ids" not in out
        out = run_pure(mig.transform_task, self.task(support_id="helper", co_assignee_ids=["helper"]), ctx)
        assert out["co_assignee_ids"] == ["helper"] and not ctx.stats.issues

    def test_support_id_unknown_user_dropped_with_warning(self):
        ctx = make_ctx(tenant_user_ids=self.USERS)
        out = run_pure(mig.transform_task, self.task(support_id="stranger"), ctx)
        assert "co_assignee_ids" not in out
        assert "warn:support_id_dropped_unknown_user" in issue_codes(ctx)

    def test_helper_cap_respected(self):
        ctx = make_ctx(tenant_user_ids={"t": {"helper"}})
        full = [f"h{i}" for i in range(mig.MAX_CO_ASSIGNEES)]
        out = run_pure(mig.transform_task, self.task(support_id="helper", co_assignee_ids=full), ctx)
        assert out["co_assignee_ids"] == full
        assert "warn:support_id_dropped_helper_cap" in issue_codes(ctx)

    def test_production_role_renamed_and_type_preserved(self):
        doc = self.task(
            assignee_role="production", updates=[{"kind": "handoff", "to_role": "production"}, {"kind": "note"}]
        )
        out = run_pure(mig.transform_task, doc, make_ctx(tenant_user_ids=self.USERS))
        assert out["assignee_role"] == "operations" and out["task_type"] == "production"
        assert out["updates"] == [{"kind": "handoff", "to_role": "operations"}, {"kind": "note"}]

    def test_explicit_task_type_kept(self):
        out = run_pure(mig.transform_task, self.task(assignee_role="production", task_type="sales"), make_ctx())
        assert out["task_type"] == "sales"


def test_snapshot_bookkeeping_is_never_migrated():
    for name in ("_snapshot_meta", "_snapshot_uploads.files", "_snapshot_uploads.chunks"):
        assert mig.skip_reason(name)
    assert mig.skip_reason("otp_codes") == mig.SKIP["otp_codes"]
    assert mig.skip_reason("tasks") is None


def test_leave_role_renamed():
    assert mig.transform_leave({"user_role": "production"}, make_ctx()) == {"user_role": "operations"}
    doc = {"user_role": "sales"}
    assert mig.transform_leave(doc, make_ctx()) is doc


class TestSmallTransforms:
    def test_money_strings(self):
        ctx = make_ctx()
        out = run_pure(
            mig.transform_money, {"_id": 1, "amount": "1,200.50", "amount_paid": 10.0, "unit_cost": "n/a"}, ctx
        )
        assert out["amount"] == 1200.5 and out["amount_paid"] == 10.0 and out["unit_cost"] == "n/a"
        assert set(issue_codes(ctx)) == {"warn:string_amount_converted", "warn:string_amount_unparseable"}

    def test_money_untouched_returns_same_object(self):
        doc = {"_id": 1, "amount": 5.0}
        assert mig.transform_money(doc, make_ctx()) is doc

    def test_running_reclassify_job_interrupted(self):
        out = run_pure(mig.transform_reclassify_job, {"id": "j", "status": "running"}, make_ctx())
        assert out["status"] == "interrupted" and out["finished_at"] == RUN_ISO
        done = {"id": "j", "status": "done"}
        assert mig.transform_reclassify_job(done, make_ctx()) is done

    def test_brain_document_roles(self):
        out = run_pure(
            mig.transform_brain_document,
            {"department": "production", "roles_allowed": ["production", "operations", "sales"]},
            make_ctx(),
        )
        assert out == {"department": "operations", "roles_allowed": ["operations", "sales"]}

    def test_capture_and_brain_context_roles(self):
        assert (
            mig.transform_capture_draft_role({"reviewer_role": "production"}, make_ctx())["reviewer_role"]
            == "operations"
        )
        assert mig.transform_brain_context({"department": "production"}, make_ctx())["department"] == "operations"

    def test_platform_alert_resolved(self):
        out = run_pure(mig.transform_platform_alert, {"provider": "gemini", "resolved": False}, make_ctx())
        assert out["resolved"] is True and out["resolved_at"] == RUN_ISO


# =============================================================================
# uploads
# =============================================================================
class TestFileRefs:
    def test_voice_note_posix_and_windows_paths(self):
        for path in ("/app/backend/uploads/n1.webm", r"C:\app\backend\uploads\n1.webm"):
            doc = {"id": "n1", "tenant_id": "t", "audio_path": path}
            assert mig.file_ref("voice_notes", doc) == ("n1.webm", "decisionos/t/voice-notes/n1.webm")

    def test_meeting_uses_doc_id(self):
        doc = {"id": "m1", "tenant_id": "t", "audio_path": "/app/backend/uploads/meeting-m1.WAV"}
        assert mig.file_ref("meetings", doc) == ("meeting-m1.WAV", "decisionos/t/meetings/m1.wav")

    def test_already_migrated_or_absent_is_none(self):
        assert (
            mig.file_ref("voice_notes", {"id": "n", "tenant_id": "t", "audio_path": "decisionos/t/voice-notes/n.webm"})
            is None
        )
        assert mig.file_ref("voice_notes", {"id": "n", "tenant_id": "t", "audio_path": None}) is None
        assert (
            mig.file_ref("ingestions", {"tenant_id": "t", "file_url": "/api/files/ingest_a.pdf", "storage_path": "x"})
            is None
        )
        assert (
            mig.file_ref(
                "expenses", {"tenant_id": "t", "attachment": {"url": "/api/files/ledger-a.pdf", "storage_path": "x"}}
            )
            is None
        )
        assert mig.file_ref("expenses", {"attachment": {"url": "/api/files/ledger-a.pdf"}}) is None  # no tenant

    def test_ingestion_and_capture_keyed_by_file_name(self):
        for coll in ("ingestions", "capture_drafts"):
            doc = {"id": "different-id", "tenant_id": "t", "file_url": "/api/files/ingest_u1.pdf"}
            assert mig.file_ref(coll, doc) == ("ingest_u1.pdf", "decisionos/t/ingestions/u1.pdf")

    def test_ledger_attachments_including_invoices(self):
        for coll in mig.LEDGER_COLLECTIONS:
            doc = {"tenant_id": "t", "attachment": {"url": "/api/files/ledger-u2.jpg", "filename": "bill.jpg"}}
            assert mig.file_ref(coll, doc) == ("ledger-u2.jpg", "decisionos/t/ledger/u2.jpg")

    def test_unchecked_mode_leaves_reference(self):
        doc = {"_id": 1, "id": "n", "tenant_id": "t", "audio_path": "/x/n.webm"}
        ctx = make_ctx({"uploads": "skip"})
        assert mig.transform_upload_ref("voice_notes", doc, ctx) is doc
        assert "warn:upload_not_migrated:skip" in issue_codes(ctx)

    def test_migrate_rewrites_to_stored_path(self):
        ctx = make_ctx(
            {"uploads": "migrate"}, uploaded={"decisionos/t/ledger/u2.jpg": "decisionos/t/ledger/u2.jpg?v=1"}
        )
        doc = {"_id": 1, "tenant_id": "t", "attachment": {"url": "/api/files/ledger-u2.jpg", "mime": "image/jpeg"}}
        out = run_pure(lambda d, c: mig.transform_upload_ref("invoices", d, c), doc, ctx)
        assert out["attachment"] == {
            "url": "/api/files/ledger-u2.jpg",
            "mime": "image/jpeg",
            "storage_path": "decisionos/t/ledger/u2.jpg?v=1",
        }

    def test_missing_recording_cleared_like_karma(self):
        ctx = make_ctx({"uploads": "migrate"})
        out = mig.transform_upload_ref(
            "voice_notes", {"_id": 1, "id": "n", "tenant_id": "t", "audio_path": "/x/n.webm"}, ctx
        )
        assert out["audio_path"] is None and out["_upload_missing"] is True

    def test_missing_ingestion_left_as_is(self):
        doc = {"_id": 1, "tenant_id": "t", "file_url": "/api/files/ingest_u.pdf"}
        ctx = make_ctx({"uploads": "migrate"})
        assert mig.transform_upload_ref("ingestions", doc, ctx) is doc
        assert "warn:upload_missing" in issue_codes(ctx)

    def test_interrupted_recording_marked_failed(self):
        fn = mig.TRANSFORMS["voice_notes"]
        out = run_pure(fn, {"_id": 1, "id": "n", "tenant_id": "t", "status": "transcribing"}, make_ctx())
        assert out["status"] == "failed" and out["error"]

    def test_survey_refuses_names_escaping_the_dir(self, tmp_path):
        (tmp_path / "ok.pdf").write_bytes(b"x")
        (tmp_path.parent / "secret.pdf").write_bytes(b"x")
        found, missing, total = mig.survey_uploads({"k1": "ok.pdf", "k2": "..", "k3": "nope.pdf"}, tmp_path)
        assert found == {"k1": "ok.pdf"} and sorted(missing) == ["..", "nope.pdf"] and total == 1


# =============================================================================
# engine pieces
# =============================================================================
class TestUniqueTracker:
    def test_duplicates_and_null_collisions(self):
        ctx = make_ctx()
        tracker = mig.UniqueTracker("users")
        for doc in ({"_id": 1, "email": "a@x"}, {"_id": 2, "email": "a@x"}, {"_id": 3}, {"_id": 4}):
            tracker.check(doc, ctx)
        assert issue_codes(ctx) == {"block:unique_violation:users.email": 2}

    def test_partial_index_only_counts_matching_docs(self):
        ctx = make_ctx()
        tracker = mig.UniqueTracker("tasks")
        same = {"tenant_id": "t", "workflow_id": "w", "stage_key": "s", "title": "x"}
        tracker.check({"_id": 1, **same}, ctx)
        tracker.check({"_id": 2, **same}, ctx)
        assert not ctx.stats.issues
        tracker.check({"_id": 3, **same, "source": "engine"}, ctx)
        tracker.check({"_id": 4, **same, "source": "engine"}, ctx)
        assert issue_codes(ctx) == {"block:unique_violation:tasks.engine_template_task_unique": 1}


class TestVerifyBootstrap:
    def boot(self, **ledger_overrides):
        ledger = {name: {"name": name, "status": "ok"} for name in mig.ledger_names_from_lifecycle()}
        ledger[mig.UPLOADS_LEDGER_NAME] = {"status": "failed", "error": f"{mig.UPLOADS_DEFERRED_MARKER}: x"}
        ledger.update(ledger_overrides)
        return {"completed": True, "ledger": ledger}

    def test_clean_boot_with_deferred_uploads_passes(self):
        assert mig.verify_bootstrap(self.boot()) == []

    def test_failed_or_missing_migration_reported(self):
        boot = self.boot(backfill_memberships_v1={"status": "failed", "error": "402 seat limit"})
        del boot["ledger"]["backfill_users_phone_norm_v1"]
        failures = mig.verify_bootstrap(boot)
        assert any("backfill_memberships_v1" in f and "402" in f for f in failures)
        assert any("backfill_users_phone_norm_v1" in f and "missing" in f for f in failures)

    def test_incomplete_bootstrap_reported(self):
        boot = self.boot()
        boot["completed"] = False
        assert any("did not reach" in f for f in mig.verify_bootstrap(boot))


class TestArgs:
    BASE = [
        "--source-url",
        "mongodb://src",
        "--source-db",
        "prod",
        "--target-url",
        "mongodb://dst",
        "--target-db",
        "karma",
    ]

    def test_plan_needs_only_source(self):
        args = mig.parse_args(["plan", "--source-url", "mongodb://src", "--source-db", "prod"])
        assert args.mode == "plan"

    @pytest.mark.parametrize(
        "extra",
        [
            ["--skip-uploads", "--confirm", "karma"],  # no --ai-consent
            ["--ai-consent", "reconsent", "--confirm", "karma"],  # no uploads choice
            ["--ai-consent", "reconsent", "--skip-uploads"],  # no --confirm
            ["--ai-consent", "reconsent", "--skip-uploads", "--confirm", "prod"],  # wrong --confirm
        ],
    )
    def test_execute_guards(self, extra):
        with pytest.raises(SystemExit):
            mig.parse_args(["execute", *self.BASE, *extra])

    def test_execute_ok(self):
        args = mig.parse_args(
            ["execute", *self.BASE, "--ai-consent", "reconsent", "--skip-uploads", "--confirm", "karma"]
        )
        assert args.confirm == "karma"

    def test_mask_url(self):
        assert mig.mask_url("mongodb+srv://app:s3cret@c.x.net/db") == "mongodb+srv://app:***@c.x.net/db"


# =============================================================================
# End to end against an in-memory fake MongoDB
# =============================================================================
class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def __aiter__(self):
        self._it = iter(self._rows)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def _project(doc, projection):
    if not projection:
        return copy.deepcopy(doc)
    include = [k for k, v in projection.items() if v and k != "_id"]
    if include:
        out = {k: copy.deepcopy(doc[k]) for k in include if k in doc}
        if projection.get("_id", 1) and "_id" in doc:
            out["_id"] = doc["_id"]
        return out
    return {k: copy.deepcopy(v) for k, v in doc.items() if projection.get(k, 1)}


class _Coll:
    def __init__(self):
        self.docs = {}

    def _matching(self, filt):
        return [d for d in self.docs.values() if all(d.get(k) == v for k, v in (filt or {}).items())]

    async def count_documents(self, filt):
        return len(self._matching(filt))

    def find(self, filt=None, projection=None, sort=None, **_kw):
        rows = self._matching(filt)
        if sort:
            rows = sorted(rows, key=lambda d: str(d.get("_id")))
        return _Cursor([_project(d, projection) for d in rows])

    async def find_one(self, filt, projection=None, **_kw):
        rows = self._matching(filt)
        return _project(rows[0], projection) if rows else None

    async def bulk_write(self, ops, ordered=True):
        for op in ops:
            self.docs[op._doc["_id"]] = copy.deepcopy(op._doc)

    async def update_one(self, filt, update, upsert=False):
        rows = self._matching(filt)
        if rows:
            rows[0].update(copy.deepcopy(update.get("$set", {})))
        elif upsert:
            doc = {**filt, **copy.deepcopy(update.get("$set", {}))}
            self.docs[doc["_id"]] = doc

    async def aggregate(self, pipeline):
        size = pipeline[0]["$sample"]["size"]
        projection = pipeline[1]["$project"] if len(pipeline) > 1 else None
        return _Cursor([_project(d, projection) for d in list(self.docs.values())[:size]])


class _DB:
    def __init__(self, name):
        self.name = name
        self.colls = {}

    def __getitem__(self, name):
        return self.colls.setdefault(name, _Coll())

    async def list_collection_names(self):
        return [n for n, c in self.colls.items() if c.docs]

    async def list_collections(self):
        return _Cursor([{"name": n, "type": "collection"} for n in await self.list_collection_names()])

    async def command(self, name):
        return {"dataSize": 1234}


class _Admin:
    async def command(self, name):
        return {"version": "7.0.0"} if name == "buildInfo" else {"ok": 1}


class _Client:
    def __init__(self):
        self.dbs = {}
        self.admin = _Admin()

    def __getitem__(self, name):
        return self.dbs.setdefault(name, _DB(name))

    async def list_database_names(self):
        return [n for n, d in self.dbs.items() if d.colls]

    async def drop_database(self, name):
        self.dbs.pop(name, None)

    async def close(self):
        return None


def seed(db, data):
    for coll, docs in data.items():
        for d in docs:
            db[coll].docs[d["_id"]] = copy.deepcopy(d)


def prod_data():
    users = [
        {
            "_id": f"u{i}",
            "id": f"user-{i}",
            "tenant_id": "ten-1",
            "email": f"u{i}@acme.com",
            "role": "sales",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
        for i in range(1, 6)  # 5 users: more than a trial plan's 3 seats
    ]
    users[0]["email"] = "U1@Acme.com"
    users[1]["role"] = "production"
    return {
        "tenants": [
            {
                "_id": "t1",
                "id": "ten-1",
                "name": "Acme",
                "created_at": "2026-01-01T00:00:00+00:00",
                "roles": [{"key": "sales", "label": "Sales"}, {"key": "production", "label": "Production"}],
                "leave_approvers": {"production": "user-1"},
            }
        ],
        "users": users,
        "tasks": [
            {
                "_id": "k1",
                "id": "task-1",
                "tenant_id": "ten-1",
                "assignee_id": "user-1",
                "support_id": "user-2",
                "assignee_role": "production",
                "status": "todo",
            }
        ],
        "voice_notes": [
            {
                "_id": "v1",
                "id": "note-1",
                "tenant_id": "ten-1",
                "audio_path": "/app/backend/uploads/note-1.webm",
                "status": "done",
            },
            {
                "_id": "v2",
                "id": "note-2",
                "tenant_id": "ten-1",
                "audio_path": "/app/backend/uploads/note-2.webm",
                "status": "transcribing",
            },
        ],
        "expenses": [
            {
                "_id": "e1",
                "id": "exp-1",
                "tenant_id": "ten-1",
                "amount": "1,200.50",
                "attachment": {"filename": "bill.pdf", "url": "/api/files/ledger-abc.pdf", "mime": "application/pdf"},
            }
        ],
        "ingestions": [{"_id": "i1", "id": "ing-1", "tenant_id": "ten-1", "file_url": "/api/files/ingest_xyz.pdf"}],
        "otp_codes": [{"_id": "o1", "phone": "9999999999"}],
        "migrations_applied": [{"_id": "m1", "name": "something_v1", "status": "ok"}],
        "brain_contexts": [{"_id": "b1", "tenant_id": "ten-1"}],
    }


@pytest.fixture
def world(tmp_path, monkeypatch):
    """Fake source + target clusters, a prod uploads dir, stubbed storage/karma seams."""
    src_client, dst_client = _Client(), _Client()
    seed(src_client["prod"], prod_data())
    uploads = tmp_path / "prod_uploads"
    uploads.mkdir()
    for name in ("note-1.webm", "ledger-abc.pdf", "ingest_xyz.pdf"):  # note-2.webm is missing
        (uploads / name).write_bytes(b"bytes of " + name.encode())
    clients = {"mongodb://src": src_client, "mongodb://dst": dst_client}
    monkeypatch.setattr(mig, "AsyncMongoClient", lambda url, **_kw: clients[url])
    monkeypatch.setattr(mig, "import_karma", lambda *_a: None)
    uploaded_calls = []

    async def fake_upload(found, uploads_dir, dst_db, concurrency):
        uploaded_calls.append(dict(found))
        return {key: key for key in found}

    async def fake_verify_uploads(dst_db, samples):
        return []

    monkeypatch.setattr(mig, "upload_files", fake_upload)
    monkeypatch.setattr(mig, "verify_uploads", fake_verify_uploads)

    def run(*argv):
        report = tmp_path / f"report_{len(list(tmp_path.glob('report_*')))}.json"
        code = asyncio.run(
            mig.amain([*argv, "--source-url", "mongodb://src", "--source-db", "prod", "--report", str(report)])
        )
        return code, json.loads(report.read_text(encoding="utf-8"))

    return {
        "src": src_client["prod"],
        "dst": dst_client,
        "uploads": uploads,
        "run": run,
        "uploaded_calls": uploaded_calls,
    }


EXECUTE = [
    "--target-url",
    "mongodb://dst",
    "--target-db",
    "karma",
    "--ai-consent",
    "reconsent",
    "--skip-bootstrap",
    "--confirm",
    "karma",
]


class TestEndToEnd:
    def test_plan_is_read_only_and_reports(self, world):
        before = copy.deepcopy({n: c.docs for n, c in world["src"].colls.items()})
        code, report = world["run"]("plan", "--uploads-dir", str(world["uploads"]))
        assert code == mig.EXIT_OK
        assert {n: c.docs for n, c in world["src"].colls.items()} == before
        assert world["dst"].dbs == {}
        assert report["uploads"] == {
            "mode": "migrate",
            "referenced_files": 4,
            "found": 3,
            "missing": 1,
            "found_mb": report["uploads"]["found_mb"],
            "missing_samples": ["note-2.webm"],
        }
        assert report["collections"]["otp_codes"]["policy"] == "skip"
        assert report["collections"]["users"]["changed_docs"] == 2

    def test_execute_migrates_everything(self, world):
        code, report = world["run"]("execute", *EXECUTE, "--uploads-dir", str(world["uploads"]))
        assert code == mig.EXIT_OK, report
        dst = world["dst"]["karma"]

        tenant = dst["tenants"].docs["t1"]
        assert tenant["plan"] == "grandfathered"
        assert [r["key"] for r in tenant["roles"]] == ["sales", "operations"]
        assert tenant["leave_approvers"] == {"operations": "user-1"}

        assert dst["users"].docs["u1"]["email"] == "u1@acme.com"
        assert dst["users"].docs["u2"]["role"] == "operations"

        task = dst["tasks"].docs["k1"]
        assert "support_id" not in task and task["co_assignee_ids"] == ["user-2"]
        assert task["assignee_role"] == "operations" and task["task_type"] == "production"

        assert dst["voice_notes"].docs["v1"]["audio_path"] == "decisionos/ten-1/voice-notes/note-1.webm"
        missing = dst["voice_notes"].docs["v2"]
        assert missing["audio_path"] is None and missing["_upload_missing"] and missing["status"] == "failed"
        expense = dst["expenses"].docs["e1"]
        assert expense["amount"] == 1200.5
        assert expense["attachment"]["storage_path"] == "decisionos/ten-1/ledger/abc.pdf"
        assert dst["ingestions"].docs["i1"]["storage_path"] == "decisionos/ten-1/ingestions/xyz.pdf"

        for skipped in ("otp_codes", "migrations_applied", "brain_contexts"):
            assert not dst[skipped].docs
        assert world["uploaded_calls"] == [
            {
                "decisionos/ten-1/voice-notes/note-1.webm": "note-1.webm",
                "decisionos/ten-1/ledger/abc.pdf": "ledger-abc.pdf",
                "decisionos/ten-1/ingestions/xyz.pdf": "ingest_xyz.pdf",
            }
        ]
        assert dst[mig.CHECKPOINT_COLL].docs["users"]["status"] == "copied"
        assert report["verify_copy_failures"] == [] and report["source_drift"] == {}

    def test_duplicate_email_after_normalising_blocks_before_any_write(self, world):
        world["src"]["users"].docs["u9"] = {
            "_id": "u9",
            "id": "user-9",
            "tenant_id": "ten-1",
            "email": "U2@ACME.com",
            "created_at": "x",
        }
        code, report = world["run"]("plan")
        assert code == mig.EXIT_BLOCKED
        issues = report["collections"]["users"]["issues"]
        assert issues[0]["code"] == "unique_violation:users.email"

        code, _ = world["run"]("execute", *EXECUTE, "--skip-uploads")
        assert code == mig.EXIT_BLOCKED
        assert world["dst"].dbs.get("karma") is None or not world["dst"]["karma"].colls

    def test_refuses_non_empty_target(self, world):
        world["dst"]["karma"]["tenants"].docs["x"] = {"_id": "x"}
        code, report = world["run"]("execute", *EXECUTE, "--skip-uploads")
        assert code == mig.EXIT_FATAL and "not empty" in report["fatal"]

    def test_refuses_same_database(self, world):
        code, report = world["run"](
            "execute",
            "--target-url",
            "mongodb://src",
            "--target-db",
            "prod",
            "--ai-consent",
            "reconsent",
            "--skip-bootstrap",
            "--skip-uploads",
            "--confirm",
            "prod",
        )
        assert code == mig.EXIT_FATAL and "same database" in report["fatal"]

    def test_resume_recopies_only_unfinished_collections(self, world):
        code, _ = world["run"]("execute", *EXECUTE, "--skip-uploads")
        assert code == mig.EXIT_OK
        dst = world["dst"]["karma"]
        dst["tasks"].docs.clear()
        dst[mig.CHECKPOINT_COLL].docs["tasks"]["status"] = "copying"
        dst["users"].docs["u1"]["marker"] = "not recopied"

        code, report = world["run"]("execute", *EXECUTE, "--skip-uploads", "--resume", "--verify-samples", "0")
        assert code == mig.EXIT_OK, report
        assert "k1" in dst["tasks"].docs
        assert dst["users"].docs["u1"]["marker"] == "not recopied"

    def test_rehearse_drops_its_database(self, world):
        code, report = world["run"](
            "rehearse",
            "--target-url",
            "mongodb://dst",
            "--target-db",
            "karma",
            "--ai-consent",
            "reconsent",
            "--skip-bootstrap",
            "--skip-uploads",
        )
        assert code == mig.EXIT_OK, report
        assert report["target"]["rehearsal_db"].startswith("karma_rehearsal_")
        assert report["target"]["rehearsal_db"] not in world["dst"].dbs

    def test_verify_copy_catches_a_wrong_document(self, world):
        async def scenario():
            src = mig.ReadOnlySource(_ClientWith(world["src"]), "prod")
            names = mig.ordered(await src.collections())
            mig.RUN_OPTIONS.clear()
            mig.UPLOADED_PATHS.clear()
            results = await mig.validate_all(src, names, RUN_ISO)
            dst = _DB("karma")
            lookups = await mig.load_lookups(src)
            for name in names:
                await mig.scan_collection(src, name, lookups, RUN_ISO, dst_db=dst)
            assert await mig.verify_copy(src, dst, results, RUN_ISO, samples=50) == []
            dst["tenants"].docs["t1"]["plan"] = "trial"
            return await mig.verify_copy(src, dst, results, RUN_ISO, samples=50)

        failures = asyncio.run(scenario())
        assert failures == ["tenants: t1 differs from its transformed source"]


class _ClientWith(_Client):
    def __init__(self, db):
        super().__init__()
        self.dbs[db.name] = db
