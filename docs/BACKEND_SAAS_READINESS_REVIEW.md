# DecisionOS Backend — SaaS Multi-Tenant Readiness Review

**Date:** 2026-08-03
**Branch:** `Backend_optimization`
**Reviewer:** Claude (plan-eng-review style audit, 3 parallel subagent sweeps: tenant isolation, auth/RBAC, secrets+uploads+billing+ops)
**Scope:** `backend/` — FastAPI + MongoDB, ~5000-line `server.py` mid-refactor into `routers/`/`services/`/`models/` per `ARCHITECTURE.md`

## Bottom line

The backend is a well-organized single-tenant app that has already started grooming for
multi-tenancy — the `tenant_id` convention is enforced in most routers, RBAC fails closed,
and JWTs re-hydrate the user from the DB on every request (so stale/escalated tokens can't
be replayed). **It is not yet safe to sell as a SaaS.** There are 10 P0 issues that would get
the platform owned in week one, plus real gaps around billing, per-tenant AI key isolation,
and file isolation that will kill enterprise deals even after the P0s are fixed.

Nothing here is unfixable — most P0s are 1–2 day fixes. But the multi-tenant version should
not onboard an external tenant until the P0 list is clear.

---

## P0 — Ship-blockers (fix before ANY external tenant onboards)

| # | Finding | File:line | Fix effort |
|---|---------|-----------|-----------|
| 1 | **Hard-coded super-admin default** `admin@decisionos.biz / DecisionOS@2026`. Also silently overwrites the DB hash on every startup, so rotation is impossible. | `server.py:4925-4937` | 2 hrs — require env vars, remove overwrite, one-time seed only |
| 2 | **CORS default = `.*` regex + `allow_credentials=True` + no CSRF tokens + `SameSite=None`**. Any site can call any authed endpoint with the user's cookie. | `server.py:4994-5001`, `core.py:218-222` | 1 day — strict allow-list, add CSRF middleware, or move mutating routes to header-based auth |
| 3 | **`GET /api/files/{fname}` is UNAUTH and has no tenant check** — knowing/guessing a UUID = download any tenant's file. | `server.py:3032-3038` | 2 hrs — add `get_current_user`, verify file belongs to caller's tenant |
| 4 | **Local `uploads/` is flat (no tenant prefix) and on ephemeral disk.** Data mixes across tenants and vanishes on redeploy. | `server.py:1731`, `backend/uploads/` | 1 day — move everything through `obj_store` with `{tenant_id}/` prefix, delete local path |
| 5 | **OTP login not scoped by tenant.** Two users in different tenants sharing a phone number → login lands in whichever record Mongo yields first. Also caps at 2000 users globally (`to_list(2000)`). | `server.py:1418-1428`, `server.py:1357` | 1 day — compound unique index `(phone, tenant_id)`, require tenant hint at OTP request, or workspace picker on ambiguity |
| 6 | **WhatsApp signature "verified" then IGNORED on mismatch.** Comment says "a proxy may re-encode the body" — that defeats HMAC entirely. Any anon POST triggers DB writes + LLM calls. | `server.py:3919-3933` | 2 hrs — reject on mismatch, fix the proxy separately |
| 7 | **All AI endpoints on `/api/signup/*` and `/api/onboarding/*` are UNAUTH.** No captcha, no rate limit. A script burns thousands of $ in Anthropic credits in minutes. | `routers/signup.py`, `routers/onboarding.py:39,73` | 1 day — Turnstile/hCaptcha on signup, IP + fingerprint rate-limit, tiny prompt caps |
| 8 | **Dev-mode OTP returned in response body** if `TWILIO_ENABLED=false`. One misconfigured deploy = auth bypass for anyone who knows a phone number. | `server.py:1345-1347` | 30 min — hard-fail boot if SMS provider unset when `ENV=prod` |
| 9 | **`stripe==14.4.1` in requirements but zero `import stripe` anywhere.** No billing. A tenant can drive $100k of Claude tokens and get invoiced $0. | `requirements.txt:129` | Weeks — real work; can gate with hard usage quotas as interim |
| 10 | **All AI keys are a single global pool.** One leaked/rate-limited key breaks 100% of tenants. No per-tenant BYO-key path, no per-tenant kill-switch. `_ResilientChat` silently falls back to platform pool on any error → cost attribution lies. | `config.py:53-60`, `core.py:177-205`, `routers/admin.py:335-348` | 3-5 days — per-tenant key columns, resolver order, quota-aware fallback |

---

## P1 — Fix before selling to any real customer

| # | Finding | Why it matters |
|---|---------|----------------|
| 11 | No login rate-limit on tenant users (only admin login has 5-attempt lockout). Password `min_length=6`. Trivial brute-force. `routers/auth.py:151-162` | Basic security auditor will fail this |
| 12 | No session invalidation. `logout` clears cookie only; JWT valid 7 days. `change-password` doesn't rotate a token version. No `jti`, no revocation list. `core.py:225-226` | Stolen session = 7 days of access; enterprise SSO story starts here |
| 13 | JWT + login return the raw token in the JSON body. Any XSS bypasses the HttpOnly cookie. `routers/auth.py:148,162` | Remove; cookie-only |
| 14 | Single `JWT_SECRET` shared between tenant users AND platform super-admin. Only the `type` claim separates them. `core.py:237,297` | Cross-trust-boundary bug waiting to happen — split secrets |
| 15 | `update_one`/`update_many`/`delete_*` widely uses `{"id": X}` without `tenant_id` after an initial tenant-scoped read. UUID4 makes it non-exploitable today, but drift or an ID leak → cross-tenant write. Widespread: `routers/tasks.py:317,360,395`, `routers/decisions.py:144-227`, `routers/brain_docs.py:320,329`, `routers/ledger.py:585,638,684`, plus many spots in `server.py` | One `_ensure_owned()` helper + lint rule collapses the risk permanently |
| 16 | Tenant deletion is incomplete. `TENANT_COLLECTIONS` in `routers/admin.py:161-186` omits `brain_context`, `brain_documents`, `capture_drafts`, `platform_alerts`, `reclassify_jobs`, `signup_sessions`, AND doesn't delete uploaded files | GDPR / DPA violation — deleted tenant's knowledge base survives forever |
| 17 | Invite tokens never invalidated after first use (`server.py:1372,1386`); `invite_start` bypasses OTP cooldown → SMS bombing; leaks full phone number in response | Permanent backdoor per leaked invite link |
| 18 | No email verification, no self-serve password reset anywhere (only OTP forgot-password stub) | Enterprise deal killer |
| 19 | Open self-service tenant registration — no email verification, no captcha, no disposable-email block. `/api/signup/check-email` is a user-enumeration oracle. `routers/auth.py:82`, `routers/signup.py:103` | Abuse + spam vector |
| 20 | No tenant plan/entitlement fields. No `plan`, `trial_ends_at`, `seat_limit`, `feature_flags` on the tenant doc — everyone is on "unlimited free forever" | Blocks pricing model |
| 21 | `whatsapp/logs` shows rows with `tenant_id: None` to every tenant owner. Any WA event logged before tenant resolution leaks cross-tenant sender phones + message summaries. `server.py:3993-3995` | Cross-tenant PII leak |
| 22 | WhatsApp inbound routing is documented cross-tenant hijack: any tenant that adds a member with a phone matching another tenant's user steals that tenant's inbound WhatsApp. `server.py:3999-4028` | Design flaw for SaaS |
| 23 | `enrich_decisions` fetches related tasks + users with NO tenant filter. If `task_ids` ever contain a foreign UUID, a decision renders tasks from another tenant. `server.py:2142-2158`, `routers/decisions.py:44,172-175` | Defense-in-depth |
| 24 | No slug/subdomain concept. Tenants keyed only by UUID — blocks vanity URLs, per-tenant SSO, per-tenant branded email | Enterprise blocker |
| 25 | No Mongo backup / DR runbook anywhere in `scripts/`, `docs/`, README, or config | Any enterprise deal will ask; RPO/RTO undefined |
| 26 | No error tracker (Sentry etc.), no APM, no structured logging — just `logging.basicConfig` to stdout | You will not learn about production bugs |
| 27 | No rate-limiting middleware at all. `grep slowapi\|RateLimit` → 0. Only ad-hoc login/OTP cooldowns | Every endpoint is a cost/DoS vector |
| 28 | File upload trusts client `content_type`, no MIME sniff, no antivirus, `Content-Disposition: inline` echoes raw filename. `server.py:2886,2933` | Reflected XSS + malware distribution |
| 29 | Seed demo runs on every startup and writes hardcoded credentials to `/app/memory/test_credentials.md`. `server.py:4629,4750-4768` | Not-for-production; gate on `ENV != prod` |
| 30 | `server.py` is 5007 lines — Phase B endpoint extraction still incomplete. Half the routes still live outside the router layer where tenancy conventions are documented | Every uncleaned handler is a P1-15 candidate |

---

## P2 — Nice to have, gate on customer traction

- Constant-time OTP compare (`server.py:1414`)
- JWT `kid` header for secret rotation
- Admin action logs include emails (fine, but confirm log-shipping DPA)
- `platform_alerts` broadcast — verify no tenant-specific detail leaks in message body
- `process_meeting` and other background jobs don't call `set_usage_tenant` → cost telemetry mis-attributed (`server.py:1855`)
- Global collection scans `to_list(2000)` / `to_list(5000)` on OTP + WA routing will silently break past cap
- Document that unknown roles fall back to `_BASE_PERMS` (inbox+tasks+brain+ask) — allow-by-default for common surface (`core.py:346`)

---

## What's actually GOOD (don't touch)

- JWT re-hydrates `tenant_id` and `role` from the DB on every request (`core.py:314`) — stale tokens can't escalate. Right design.
- bcrypt everywhere with `bcrypt.checkpw` (constant-time) (`core.py:281-289`)
- `brain_rbac` fails closed by default (`services/brain_rbac.py:43-54`)
- `obj_store` path is properly tenant-prefixed (`server.py:2895`)
- `routers/tasks.py` consistently reads with `tenant_id` before mutating
- `brain_context` primary search filter includes `tenant_id` (`services/brain_context.py:154-159`)
- Clean phased refactor plan already in `backend/ARCHITECTURE.md` — keep executing it

---

## Remediation plan — recommended sequencing

**Sprint 1 (1 week) — Auth/CSRF/File hardening.**
Kill items #1–8. Nothing else matters if these are open. Ship a private beta only after this sprint.

**Sprint 2 (1 week) — Tenancy hygiene.**
- #15 — add `_ensure_owned(coll, id, tenant_id)` helper, refactor every raw `db.X.update_one({"id": …})` call to use it
- #16 — rebuild `TENANT_COLLECTIONS` from a full code-scan, unit-test the wipe
- #21–23 — kill the `tenant_id: None` leaks and cross-tenant enrichment paths

**Sprint 3 (1–2 weeks) — Multi-tenant AI + billing.**
- #9 — Stripe or Razorpay integration with quota enforcement (402 on exceed)
- #10 — per-tenant AI key columns + resolver order (tenant key → platform pool fallback, with visible cost attribution either way)
- #20 — plan/entitlement fields on the tenant document

This is the sprint that turns this into an actually-billable product.

**Sprint 4 (ongoing) — Enterprise-readiness.**
SSO/subdomain (#24), backup/DR runbook (#25), Sentry (#26), rate limits (#27), password reset + email verification (#18).

---

## Open decisions needed before implementation starts

1. **Are tenants likely to have overlapping phone numbers?** (e.g., India SMB founders reusing personal mobiles across sub-businesses?) Changes the fix for #5 from "unique index" to "workspace picker on ambiguous phone."
2. **BYO-AI-keys or platform-billed AI?** Drives #10 design.
3. **India-first (Razorpay) or global (Stripe)?** Drives #9.
4. **Is `admin@decisionos.biz` a live production credential today?** If yes, rotate immediately — don't wait for the refactor.

---

## Methodology

This review used 3 parallel read-only audits (tenant isolation / auth+RBAC / secrets+uploads+billing+ops)
plus manual inspection of `config.py`, `database.py`, `ARCHITECTURE.md`, and router line counts. No code
was changed as part of this review — findings only. Confidence: all P0/P1 findings are grounded in specific
file:line citations from direct code reads, not inference.
