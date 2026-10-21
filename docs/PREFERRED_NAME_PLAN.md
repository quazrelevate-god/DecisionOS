# Preferred name — plan (FEATURE-03)

**Status:** Built 2026-10-22 with the fallback ("go ahead with the fallback"), awaiting push. Tracked as **Epic 11 — New Features, Sprint 3**, `docs/DecisionOS_Epic11_New_Features.xlsx` (NF-3.1 … NF-3.5) — 5 of 5.

**As built — worth knowing:**
- The rule lives in `backend/shared/names.py` and, for the screens, `frontend/src/lib/names.js`; a test keeps the two in step.
- Besides initials it skips a title before the name (Mr, Mrs, Ms, Dr, Prof, Er, Smt) and two or three capitals before another word ("SR Karthik" → Karthik). Two letters in ordinary case stay a name ("Om Prakash" → Om). "S.Rhea" without a space counts as "S. Rhea".
- Checked in the browser on a scratch database with the client's own example, "S Rhea": the Desk said "Good morning, Rhea." with nothing set; with the preferred name "Riya" the Desk, the Dex welcome and Ops all said Riya, and the profile's preview line updates as you type.

## The ask (client)

Profile Settings gain a **Preferred name** field, and the home and dashboard greeting uses it. A user named "S Rhea" with the preferred name "Rhea" is greeted "Good afternoon, Rhea", not "Good afternoon, S".

## What happens today (checked in the code, 2026-10-22)

**Not implemented.** There is no preferred-name, nickname or display-name field anywhere. Every greeting takes the **first word of the full name**, so "S Rhea" is greeted "S":

| Where | Code | Says today |
|---|---|---|
| Desk greeting (web + phone) | `routers/desk.py _greeting_for` | "Good afternoon, S" |
| Phone brief greeting | `routers/brief.py` | "Good morning, S" |
| Dex welcome | `pages/Brain.js` → `DexWelcome` | "Good afternoon, S" |
| Ops page | `pages/OperatingScore.js` | "Hi S — here's how you're doing" |
| Dex refusing an out-of-access question | `services/ai/brain_rbac.py` | "Sorry S — …" |

Emails already say "Hi" with the full name, which is fine.

The profile form (Settings → Your profile, `PATCH /api/auth/profile`) lets a person edit their own name, job title, what they handle, mobile and email. A new field on the user record reaches `/api/auth/me` and every screen with no extra plumbing.

**How common:** on the dev database 2 of 73 users start with an initial ("X Xxxx", "X. Xxxx Xxxxxx") and 3 with two capitals. Dev data is mostly test accounts; among real users in Tamil Nadu, where the client is, a name written initial-first ("S. Rhea", "K. Ramesh") is the normal way to write a name. So it would hit a large share of real users.

## Verdict

**Needed, small, and worth doing.** About half a day including tests. Low risk: it touches the profile and five greeting lines, nothing else.

**One addition recommended:** a smarter fallback for people who never set a preferred name. When the first word is only an initial ("S", "K.", "S.R."), greet by the first real word instead ("S Rhea" → "Rhea"). Most users never visit Settings; this fixes the greeting for all of them on day one, and the preferred name stays the person's own override.

## Plan

### Backend
1. `preferred_name` on the user (each company's record, like the name itself): set from `PATCH /api/auth/profile`, trimmed, at most 40 characters; blank clears it. Returned by `/api/auth/me` automatically.
2. One rule, one place (`shared/names.py greeting_name`): the preferred name if set; else the first word of the name that is not an initial; else "there". Used by the Desk greeting, the phone brief greeting and Dex's messages.

### Web (design system)
3. Settings → Your profile: a **Preferred name** field under the name, with a live line — "We'll greet you as: Good afternoon, Rhea". Owner and member views.
4. The same rule on the screen side (`lib/names.js`): the Dex welcome and the Ops "Hi …" line.
5. Tests (the rule, the save, the Desk greeting) and a browser check on a scratch database.

## Not in this plan (say if wanted)
- Showing the preferred name to OTHER people (Team page, assignments, approvals). The ask is the greeting; records and approvals keep the full name.
- Sharing one preferred name across every company the same person belongs to (each company's profile keeps its own today, as the name does).
