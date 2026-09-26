# PILOT-2 B · A draft flag on the decision, so "Save as draft" travels

**For:** Yokesh (backend) · **From:** PILOT-2 part B · **Date:** 2026-09-27

## Why this is needed

The pilot client asked for Dex's "Later" button to say **Save as draft**, and
for a decision saved that way to be marked "Draft" wherever it shows. The rename
is in (frontend, PILOT-2 B). But the mark is only on one device.

How it works today:

- The **decision** is saved on the server as soon as Dex finishes reading the
  capture (`status: "pending_approval"`). Nothing is lost.
- The **draft mark** is a list of decision ids in the browser's localStorage
  (`dos_deferred_decisions`, `frontend/src/lib/deferredDecisions.js`). It was
  built that way on purpose for ASK-36, when the button said "Later" and meant
  "I looked at this on this device".

"Save as draft" promises something saved. If the founder saves a draft on the
laptop and then opens the same company on the phone, the decision is there but
it is not marked as a draft. Another device, a cleared browser, or a private
window all lose the mark. That is what this ask fixes.

## What we need

### 1. Fields on the decision

| Field | Type | Meaning |
|---|---|---|
| `draft` | bool | `true` while the decision is saved as a draft. A missing field means `false`, so no migration is needed. |
| `drafted_at` | ISO string | When it was saved as a draft. |
| `drafted_by` | user id | Who saved it. |

Setting or clearing the flag must also stamp **`updated_at`**. `/api/pulse`
watches `decisions.updated_at`, so the change reaches every open screen within
about 20 seconds.

### 2. Two endpoints

```
POST   /api/decisions/{id}/draft   -> sets draft=true,  returns the enriched decision
DELETE /api/decisions/{id}/draft   -> sets draft=false, returns the enriched decision
```

- **Who may call it:** the same people who may decide it. That is
  `decision_flow.can_decide(user, d)`, or whoever `_editable` lets shape the
  proposal. Anyone else gets a 403.
- **When it applies:** only while `status` is `pending` or `pending_approval`.
  On a decided decision, return a 409 with a sentence the UI can show, for
  example "This decision has already been decided."
- **Idempotent:** setting a draft that is already set is not an error.

### 3. Deciding clears it

`approve_decision_flow` and `reject_decision_flow`
(`services/decision_flow.py`) should set `draft: false` in the same write that
changes the status. A decided decision is never a draft.

### 4. Reads carry it

- `GET /api/decisions/{id}` returns `draft` (via `enrich_decision`).
- The Desk's decision cards (`_cards_needs_decision` in `routers/desk.py`)
  return `draft` on each card. The Decisions column can then mark the row
  without a second request.
- `GET /api/decisions` returns it too, for completeness.

### 5. Is the flag per person or per decision?

**Per decision** is what I recommend. The client's words, "so people can
understand the yellow means draft", describe the decision's state for everyone
who looks at it, not one person's bookmark. If you see a reason to make it per
person instead (for example, a manager and the owner disagreeing about the same
decision), raise it before building. The frontend change is the same either way.

## What the frontend does once it ships

1. `deferDecision(id)` also calls `POST …/draft`, and the mark shows at once as
   an optimistic update.
2. The Desk row and DecisionDialog's "(Draft)" read `draft` from the server
   instead of from localStorage.
3. **One-time carry-over:** on first load after the ship, any id still in
   `dos_deferred_decisions` that is still pending gets `POST …/draft`. Then the
   local list is removed. Drafts that already exist on someone's device are not
   lost in the switch.
4. `lib/deferredDecisions.js` retires.

## Tests to add with it

- Setting a draft on a pending decision gives `draft: true`, stamps
  `updated_at`, and `GET` shows it.
- Setting a draft on an approved or rejected decision returns 409, and the
  decision is unchanged.
- Someone who cannot decide it gets 403 on both verbs.
- Approving a draft clears the flag, and so does rejecting one.
- The Desk card for a draft decision carries `draft: true`. A decision in
  another tenant is never visible (the usual tenant isolation check).
- After the API baseline is regenerated (`tests/regen_api_baseline.py`), it
  lists the two new routes.

## Until then

The rename is live, and the report to the founder says in plain words that
**the draft mark is per device**. The decision itself is always saved on the
server.
