# DecisionOS Backend — Schema, Dynamic Workflows, Scale & Go-Live Review

**Date:** 2026-08-03
**Branch:** `Backend_optimization`
**Method:** Direct code reads + 3 parallel deep-dive audits (dynamic-workflow engine, data-model/schema, scalability/ops). Confidence scores are the auditor's, grounded in specific file:line reads.
**Question asked:** "Review the complete schemas and DBMS. Will it work for dynamic workflows for different tenants? Will it scale? Can we go live?"

---

## TL;DR — the three answers

1. **Will it work for dynamic workflows for different tenants?** **Mostly yes, with one real hole.** Each tenant gets an AI-designed operating model (custom pipelines, stages, finance categories) stored on the tenant doc and resolved per-request. The create/advance/AI-extract paths are genuinely dynamic. BUT the owner-approval loop, the "pending purchases" dashboard, and payment-overdue alerts are hardcoded to the textile pipeline key `purchase_payment` and terminal stages `delivered`/`paid`. A restaurant or clinic whose AI-designed procurement pipeline is keyed `procurement` silently loses its owner sign-off and payment tracking. **P0 for the "shaped around YOUR workflow" promise.**

2. **Is the schema/DBMS sound?** **Yes.** No P0 data-corruption risk. UUID `id`/`_id` discipline is clean, enums are validated on write, tenant scoping and indexes are consistent and well-designed. Issues are a dead `contacts.kind` index, denormalized names going stale on rename, and a concurrent-registration race that throws a raw 500. All P1/P2.

3. **Will it scale / can we go live?** **Not as currently deployed.** The blockers are operational, not algorithmic (the query layer is actually decent — enrich functions batch correctly, blocking calls are offloaded to threads). Blockers: in-process scheduler that triple-fires under multiple replicas, an unindexed full-collection scan on every login, local-disk file storage that won't survive horizontal scaling, and no deployment config at all. These are fixable in ~1 sprint.

**Overall go-live verdict: NOT YET.** Two sprints of focused work (this doc's P0 list + the P0 list in `BACKEND_SAAS_READINESS_REVIEW.md`) and you can run a controlled private beta. Do not open self-serve signup until both are clear.

---

## Section 1 — Dynamic Workflows Per Tenant

### What's genuinely dynamic (verified, don't touch)
- `tenant_operating_model()` (server.py:1163) reads each tenant's `operating_model` (pipelines + stages + task_categories), falls back to `DEFAULT_OPERATING_MODEL` if null. Clean.
- `_create_workflows()` (server.py:937) materializes cards from the tenant's OWN pipelines. `ai_extract()` (server.py:250) is passed the tenant's pipelines + roles — the AI prompt is fully data-driven, no textile hardcoding (server.py:254-305).
- Advance path (server.py:2241-2252) validates `inp.stage in wf["stages"]` against the card's own stage array — dynamic, no invalid jumps.
- `normalize_operating_model` (core.py:582-605) dedupes pipeline/stage keys and validates `approval_stage ∈ stage_keys`. Colliding keys are dropped, not merged.
- `backfill_operating_model()` (server.py:1222) is a real non-destructive migration preserving in-flight cards.
- Role guard (server.py:868) sets `assignee_role=None` when the AI names a role not in the tenant's role set — a bogus role degrades to unassigned (visible to owner), doesn't vanish.
- `WORKFLOW_OWNER_ROLE` (server.py:212) is dead code — never referenced. So no static role misassignment. (Recommend deleting it to avoid future confusion.)

### The holes

**WF-1 [P0, confidence 9/10] — Approval/procurement/payment surface hardcodes the textile key `purchase_payment`.**
The AI designs a "Procurement" pipeline; `_slugify_key` (core.py:405) turns "Procurement" → `procurement`, never `purchase_payment`. But these all filter on the literal `purchase_payment`:
- `routers/decisions.py:166` — approving a decision auto-advances only `type:"purchase_payment", stage:"requested"`.
- `server.py:2429` dashboard `pending_purchases`; `routers/brief.py:95,98,238,262` — pending purchases, payment overdue, purchase panel, payment-pending recommendations.

**Failure:** A restaurant owner approves "buy a new fryer." The Procurement card (`type:"procurement"`) is never auto-advanced, never shows in the pending-purchases approval queue, never triggers payment-overdue alerts. The core owner sign-off loop is dead for every non-textile tenant.
**Fix:** Resolve the procurement/approval pipeline from the tenant's operating model (the pipeline whose `approval_stage` is set), not a hardcoded key. ~half a day with the operating-model resolver already in place.

**WF-2 [P1, confidence 9/10] — AI failure silently falls back to the TEXTILE model.**
`ai_generate_operating_model` (server.py:1154-1160): on malformed JSON / timeout → `data={}` → `DEFAULT_OPERATING_MODEL` (Production/Distribution/Procurement). A clinic that onboards while the LLM hiccups silently gets a textile board with no error surfaced.
**Fix:** Validate the AI output has ≥1 non-default pipeline; on failure, retry once, then flag the tenant for manual setup instead of silently defaulting.

**WF-3 [P1, confidence 8/10] — Dashboard "active workflows" hardcodes textile terminal stages.**
`server.py:2433`: `count_documents({..., "stage": {"$nin": ["delivered", "paid"]}})`. A salon pipeline ending in `served`/`completed` never matches `$nin`, so every card counts as "active" forever — the KPI only climbs.

**WF-4 [P2, confidence 7/10] — Approval gate can vanish after a re-design orphans a card.**
Advance resolves the sign-off stage from the current operating model (server.py:2241-2252). If a re-run onboarding removes/renames a pipeline whose key a card still carries, `pipeline` is `None`, and for non-`purchase_payment` types `appr_stage` becomes `None` → the owner-only gate disappears; a regular employee can advance through what was a sign-off stage.

**WF-5 [P2, confidence 6/10] — Card/task label drift after re-design.** Removed pipeline/category keys leave old cards/tasks rendering unlabeled/unfilterable (`LEGACY_WF_LABELS` at server.py:1219 only maps the four textile keys). Cards still advance; they just lose their label chip.

---

## Section 2 — Schema / DBMS

**Verdict: sound enough to go live.** No P0. Verified good: UUID `id`/`_id` discipline (all app queries use `id`, all reads project `{"_id":0}`); enum validation on write (task status vs `TASK_STATUSES` at routers/tasks.py:255, inbox classification fallback at server.py:238, workflow stage adjacency-checked, contact type/status validated); index field names match written keys for tasks/inbox/invoices/notifications. **The notification `read` field is correct** — code writes `read` (server.py:2577), index uses `read` (server.py:4855); the docs mentioning `is_read` are just stale docs, not a bug.

**SC-1 [P1, confidence 9/10] — `contacts.kind` index is dead.** server.py:4865 indexes `(tenant_id, kind)`, but every write/read uses `type` (server.py:1674, 1691, 3276, 3298). `GET /contacts?type=vendor` on a big tenant filters `type` in-memory off the `(tenant_id,name)` prefix — a tenant-wide scan. **Fix:** index `(tenant_id, type)`. Trivial.

**SC-2 [P2, confidence 6-7/10] — Denormalized names/roles go stale.**
- `assignee_role` on tasks: `_can_work_task` (services/tasks.py:103) gates board visibility on `assignee_role == user.role`. If a user's role later changes, existing tasks orphan from their board.
- `contact_name` on invoices (server.py:3326) is copied, indexed, and rendered — rename a contact and 40 invoices show the old name + the index misses the new name.
**Fix:** refresh-on-rename sweep, or resolve names at read time. Do before the first tenant renames a contact at volume.

**SC-3 [P2, confidence 8/10] — Global-unique email = 1-email-1-tenant, with a rough edge.** `db.users.create_index("email", unique=True)`. Same person can't belong to two workspaces (a real limitation for consultants/multi-company founders — a deliberate model, but decide it consciously). Concurrent registers with the same email race past the `find_one` pre-check (auth.py:92) and hit the unique index → one caller gets an unhandled `DuplicateKeyError` 500 instead of a clean 400. **Fix:** wrap the insert in try/except for `DuplicateKeyError`.

**SC-4 [P2, confidence 5/10] — Invoice shape diverges across two writers.** `ledger.py:318` writes `amount_paid`; ingest path server.py:3323 doesn't. Partial-payment math silently treats ingested invoices as `0` paid. Benign (reads use `.get()`), but flag for the finance-accuracy path.

**Migrations:** ad-hoc `update_many`-on-startup, no framework, but idempotent + per-document + replica-safe as written. Fine for go-live. Add a migration ledger before any destructive backfill ever ships.

---

## Section 3 — Scale & Go-Live

**Verdict: works in the 4-user demo, will NOT safely survive 100 tenants / 2000 users as deployed.** Blockers are operational. The query layer is better than expected: **enrich functions batch with a single `$in`** (no N+1), and **blocking STT/vision/SMTP calls are correctly offloaded via `asyncio.to_thread`**. Those two premises were checked and retracted — good engineering there.

**SCALE-1 [P0, confidence 9/10] — In-process scheduler triple-fires under multiple replicas.** `_followup_scheduler_loop` (server.py:2765) started per-process (server.py:4946) sweeps every tenant every 300s. It's an in-process timer, not external cron. 3 replicas → 3× duplicate escalations, duplicate owner **emails**, duplicate `platform_alerts`. 1 replica → dies on every deploy/restart. Also serially awaits each tenant, so one slow tenant stalls all. **Fix:** externalize to a single cron/worker (or a leader-election lock).

**SCALE-2 [P0, confidence 9/10] — Unindexed phone scan on every login.** `resolve_wa_tenant` / OTP (server.py:1357, 1419, 4004) do `db.users.find({"phone":...}).to_list(5000)` then filter in Python. No `phone` index. Full collection scan every OTP request + every WhatsApp inbound. At 2000 users, 50 concurrent logins = 50 COLLSCANs. The `.to_list(5000)` cap also silently locks out user #5001. **Fix:** add `(tenant_id, phone)` or a normalized-phone index, drop the Python filter. (This overlaps the tenant-scoping P0 in the SaaS-readiness doc — fix both together.)

**SCALE-3 [P0, confidence 8/10] — Local-disk file storage won't survive horizontal scaling.** Voice notes (server.py:1739), meetings (1902), ledger uploads (ledger.py:146) write to local `UPLOAD_DIR`, served by `GET /api/files/{fname}` (server.py:3032). File written on replica A → 404 from replica B; all lost on container restart. Newer task attachments correctly use `obj_store` — storage is split-brain. **Fix:** route ALL uploads through `obj_store`, delete the local-disk path. (Also closes the unauth-file-download P0 from the SaaS-readiness doc.)

**SCALE-4 [P0, confidence 8/10] — No deployment config exists.** No Dockerfile/compose/Procfile/railway/render/fly (only `.emergent/emergent.yml` base-image pointer). Unknown worker count, no graceful shutdown of in-flight LLM work, no request-size cap. `/health` + `/api/health` exist (good). **Fix:** commit a real Dockerfile/Procfile pinning worker count with graceful shutdown before you can even reason about the P0s above.

**SCALE-5 [P1, confidence 8/10] — No timeout on LLM calls + single shared key.** `_ResilientChat.send_message` (core.py:177) has no `asyncio.wait_for`. One global `EMERGENT_LLM_KEY` = one shared Anthropic rate limit across all tenants. 50 concurrent voice-captures contend on one key → 429 cascade, no upper bound. Voice/meeting transcription runs in `BackgroundTasks` which softens user latency, but the shared-key ceiling remains. **Fix:** `asyncio.wait_for` on every LLM call + a concurrency semaphore, and per-tenant keys (ties to the global-AI-key P0 in the SaaS-readiness doc).

**SCALE-6 [P1, confidence 7/10] — Heavy full-tenant loads into memory.** operating-score / dashboard / cashflow pull `.to_list(2000-3000)` full docs per call (server.py:1996-2007, 2662-2692) to aggregate in Python. Tenant-indexed, won't crash, but latency + memory grow linearly with per-tenant data. **Fix:** push aggregation into Mongo (`$group`) for the hot dashboards.

**SCALE-7 [P1, confidence 7/10] — Unbounded platform-admin scans.** admin.py:258/450/228 do `.to_list(5000/10000/2000)` with no pagination — silent truncation as the platform grows.

**SCALE-8 [P2] — Mongo pool default 100** (database.py:17, no `maxPoolSize`), can saturate under bursty `.to_list(2000+)` dashboards. **CORS wildcard + credentials** and **dev-OTP in response** repeat here from the SaaS-readiness doc — security, not scale, but both gate go-live.

---

## Consolidated go-live checklist (this review + prior two)

**Sprint 1 — Operational blockers (this doc):**
- [ ] Externalize the follow-up scheduler to one cron/worker (SCALE-1)
- [ ] Add phone index, drop Python-side filter (SCALE-2)
- [ ] Move all uploads to obj_store, delete local `/api/files` path (SCALE-3)
- [ ] Commit a real Dockerfile/Procfile with worker count + graceful shutdown (SCALE-4)
- [ ] `asyncio.wait_for` + semaphore on LLM calls (SCALE-5)
- [ ] Fix the `purchase_payment` hardcode so approval/payment works for all tenants (WF-1)

**Sprint 2 — Security/tenancy blockers (`BACKEND_SAAS_READINESS_REVIEW.md`):**
- [ ] Hard-coded superadmin, CORS wildcard, unauth file download, dev-OTP leak, WhatsApp signature bypass, unauth LLM signup endpoints
- [ ] Tenant-scope OTP + WhatsApp phone routing; `_ensure_owned` helper; complete `TENANT_COLLECTIONS`
- [ ] Per-tenant AI keys; billing/quota enforcement; plan/entitlement fields

**Before charging money:** billing (Stripe/Razorpay) is entirely absent — `stripe` is in requirements but never imported.

**Nice-to-have before first non-textile tenant:** WF-2 (AI-failure fallback flag), WF-3 (active-workflow terminal stages), SC-1 (dead kind index), SC-3 (email race 500).

---

## What impressed me (don't rewrite)
The operating-model abstraction is real engineering — per-tenant dynamic pipelines with a clean resolver, non-destructive migration, and a fully data-driven AI extraction prompt. The index strategy is thoughtful and tenant-scoped. Enrich functions batch correctly. Blocking calls are offloaded. This is not a throwaway prototype; it's a solid single-tenant-shaped app that needs its operational and multi-tenant edges hardened, not a rewrite.

## Open decisions for you
1. **1-email-1-tenant** (SC-3) — deliberate, or do you need the same person in multiple workspaces? Changes the user model.
2. **Deployment target** — Railway/Render/Fly/self-hosted? Determines the Dockerfile/scheduler/object-store specifics for Sprint 1.
3. **Fix WF-1 now or defer?** If your first 5 pilot tenants are all textile/manufacturing (matching the demo), the `purchase_payment` hardcode won't bite yet. If any pilot is a restaurant/clinic/services business, it's a day-one blocker.
