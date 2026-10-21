# Notification history — plan (FEATURE-08)

**Status:** Built 2026-10-22 after the go-ahead ("go with both"), awaiting push. Tracked as **Epic 11 — New Features, Sprint 2**, `docs/DecisionOS_Epic11_New_Features.xlsx` (NF-2.1 … NF-2.9) — 9 of 9.

**As built — worth knowing:**
- History lives in **both** places: Settings → Account → Notification history (opens on the latest five with Show more, so the sections below stay in reach) and the Notifications page's History tab, one tap from the bell.
- Also fixed on the way: the bell's **"need you" badge was always 0** — it tested a `kind` field no notification carries. The server now counts the asks (approval, question, waiting on you, a nudge) across every unread notification (`services/notifications.NEEDS_YOU_TYPES`). People who have seen no badge until now will start seeing one.
- Checked in the browser on a scratch database (Priya, 59 notifications): badge "3 need you", dropdown "24 new" and unread only; Mark read → History with Undo; History paged back to the oldest; Move back to New; the Settings section; phone width.

## The ask (client)

Notifications can be marked as read. Read notifications should move into a dedicated **Notification History** section under Profile Settings, so people can review what they have already read without losing access to it.

## What happens today (checked in the code, 2026-10-22)

| | Today |
|---|---|
| Marking read | Sets `read: true` on the row. Nothing is deleted. No time of reading is kept. |
| The list | `GET /api/notifications` returns the **newest 100**, read and unread mixed (read ones dimmed). Anything older is unreachable — there is no paging. |
| The unread count | Counted **inside those 100 only**, so past 100 unread the badge is wrong. |
| Deletion | Only if a company switches on retention (Epic 9 S9): off by default; when on, notifications older than its window (365 days default, never under 30) are purged. |
| Volume (dev database, 2026-10-22) | 7,690 notifications across 62 users; **11 users are past the 100 cap**; the busiest two hold ~2,500 each over three months (~25 a day). For them, anything older than a few days is already gone from view. |

So the client's fear is real — not because reading deletes anything, but because the list stops at 100.

## Verdict

**Feasible, small, and worth doing.** The data is already kept; what is missing is a way to reach it. The same work fixes the wrong unread badge. It touches no notification *writer*, so nothing that sends notifications can break.

**One adjustment recommended:** put the history where the client asked (Settings → Account → Notification history) **and** one tap from the Notifications page and the bell ("History"). Settings is where people change things, not where they look for a message they saw yesterday; offering both costs nothing because it is one component in two places.

## Plan

### Backend
1. `GET /api/notifications?status=unread|read&before=<created_at>&limit=` — paged by state, using the index that already exists (`tenant_id, user_id, read, created_at`). No parameters = today's answer, so nothing that reads it now changes.
2. The unread count from the database (`count_documents`), not from the 100 — fixes the badge.
3. `read_at` stamped when read (one or all), so history can say "read 2 h ago".
4. `POST /api/notifications/{id}/unread` — "Move back to New", so reading by mistake loses nothing.
5. The history says how long it is kept: the company's retention window when on, "kept until deleted" when off.
6. Tests; read-gate inventory and API baseline (+1 route).

### Web (design system)
1. Notifications page: **New** (unread) and **History** (read) tabs; History pages with "Show older"; marking read moves the row to History with an Undo.
2. Settings → Account → **Notification history** section (owner and member views) — the full history, as asked.
3. Bell dropdown shows unread only, with a "History" link; badge uses the true count; the phone's Notifications tile the same.
4. Browser check on a scratch database.

**Effort:** about 1.5–2 days including tests. **Risk:** low.

## Not in this plan (say if wanted)
- Deleting or clearing history (kept for its audit value).
- Searching or filtering history by type (approvals, requests, tasks…) — a cheap follow-up.
- Auto-reading very old unread notifications (the busiest owner has ~1,800 unread).
