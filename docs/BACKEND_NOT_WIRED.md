# Built in the backend, never reached from the app (2026-09-17)

Yokesh asked for this after the onboarding fix: the draft store had been sitting
there since FIX-001-D — create, resume, patch, a signed token, a 30-day TTL, and
`/register` already merging it — and the wizard called none of it, so every
founder who closed a tab started again. What else is like that?

**Method.** The API baseline lists **329 routes**. Every `api.get/post/patch/
put/delete` and `fetch` in `frontend/src` (213 files) was matched against them by
method and path shape, then every candidate was checked a second time by
searching the frontend for the literal path fragment — templates, helpers and
composed URLs included. That second pass cleared a dozen false alarms
(`/tenant/plan`, `/work-coach/refresh`, the ledger deletes, leave approvals and
task reassignment are all wired; the regex simply missed the string). What is
below survived both passes.

---

## 1. A person hits a wall

**Forgot password.** `POST /auth/password/forgot` and `/auth/password/reset` are
built, with tokens and emails. The sign-in screen has no "Forgot password?" link
and there is no reset page. Someone who forgets their password and has no mobile
number on file cannot get back in at all.

**The verification email links to a page that does not exist.** Registration
emails `{APP_BASE_URL}/verify-email?token=…` (routers/auth.py). `App.js` has no
`/verify-email` route, so that link lands on a 404. `POST
/auth/email/send-verification` (re-send from Settings) is unused too.

**A second workspace is unreachable.** Memberships are per workspace, `GET
/auth/me/workspaces` and `POST /auth/me/switch-workspace` exist, and `/auth/login`
answers with a workspace picker (`{ambiguous: true, choices: […]}`) when one
person belongs to several. The frontend never calls either endpoint and never
handles that answer. Anyone in two workspaces is stuck in whichever one login
picks. This is the consultant serving two clients — the exact case the phone
routing was designed around.

---

## 2. A whole feature with no way in

**Meetings.** `POST /meetings` (audio) and `/meetings/text` transcribe a meeting,
summarise it, and turn its action items into tasks; `GET /meetings` lists them.
The app's `/meetings` route **redirects to the home page**. Nothing records a
meeting, and nothing shows one.

**Complaints.** The count appears on the Desk and in CRM, and the endpoints are
all there — but there is no Complaints page, and `PATCH
/complaints/{id}/resolve` is never called. A complaint can be counted and never
closed.

**The company's own notes.** `GET/POST /api/memory` holds the plain notes the
company keeps. The Decision Desk *writes* them — a capture that is news rather
than a decision says "Kept in the Company Brain" — and **nothing in the app ever
lists them**. (Mine, from 2026-09-16. The promise is kept in the database and
broken on screen.)

**Billing.** `/billing/plans`, `/billing/status`, `/billing/checkout` and the
webhook are built. Settings shows the plan and seat count (`/tenant/plan`), but
there is no way to see subscription state or to subscribe. The trial ends and
the founder has no button.

**Support tickets.** `POST /api/support/tickets` and its replies, plus
`/admin/tickets` on the other side. Nobody can raise a ticket from inside the
app, and the console cannot answer one.

---

## 3. Built for safety, unreachable

**Two-factor for real users.** Enroll, confirm, backup codes, disable, and the
login challenge all exist for tenant accounts. Only the *platform admin* console
uses 2FA. A workspace owner cannot turn it on for themselves.

**Where you are signed in.** `GET /auth/me/sessions`, delete one, delete all —
built for RBAC-21, with device and IP recorded on every login. No screen shows
them, so a founder who loses a phone cannot end its session.

**Temporary access.** `POST/GET/DELETE /users/{id}/temp-grant` (RBAC-27): give
someone Finance for three days and it lapses by itself. No UI, so every grant
today is permanent until somebody remembers to undo it.

**Handing the workspace over.** `POST /auth/tenant/transfer-ownership` promotes
the new owner and demotes the caller in one step. Team can promote someone to
owner through the role change, which leaves two owners; the clean hand-over is
unused.

---

## 4. Smaller, but cheap to finish

- **"AI setup incomplete — click to regenerate"** was designed for it:
  `GET /tenant/ai-setup/status` and `POST /tenant/ai-setup/retry`. No screen
  reads either, so a workspace whose setup fell back to defaults never says so.
  (Now that the setup runs behind registration, this is the screen that would
  tell a founder it is still filling in.)
- **Editing a finance row.** Expenses, assets and inventory can be created and
  deleted, but `PATCH /expenses/{id}`, `/assets/{id}`, `/inventory/{id}` are
  unused: a typo means delete and re-enter.
- **Matching a payment to an invoice.** `/revenue/payment/{id}/match`,
  `/standalone`, and the payables pair — the reconciliation half of Finance.
- **Attendance.** `GET/POST /api/attendance` — who is in today. Nothing calls it.
- **The pending-invite list.** `GET /api/invites`; Team derives the same thing
  from `/users`, so this is duplication rather than a gap.
- **AI surfaces built and not exposed:** `/brain/agent`, `/brain/agent/run`,
  `/brain/agent/create-task`, `/brain/context`, `/dex/capture`,
  `/capture/clarify`, `/tasks/{id}/steps/ask`, `/onboarding/suggest`.

---

## 5. The admin console

Seventeen admin endpoints the console never calls, including the ones that
matter most when something goes wrong: **suspend / reactivate a tenant**,
**suspend / reactivate / reset-access a user**, per-tenant **feature flags**,
**runtime config** and **plan capabilities**, **migrations** and **scheduler
locks**, **AI quality**, and the **DSAR export** for a single user (the DPDP
request path built in Epic 9 S9).

---

## What I would take first

1. **Forgot password** and **the verify-email route** — both are a link and a
   page, and today one of them is a dead end and the other a 404.
2. **The workspace picker** — a person in two workspaces cannot reach the second.
3. **The company's notes** — we tell founders we kept something; show it.
4. **Meetings** — a whole feature sitting behind a redirect.

Each is small. The first two are an afternoon together.
