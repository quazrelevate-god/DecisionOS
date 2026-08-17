# Epic 7, Sprint 1 — Operating Score Redesign

**Analysis doc — read before writing any code.** Founder ask 2026-08-17:
> "apart from the mobile we will first figure out the what? the old KPI contains, what we will do show better metrics design approach we can show, right now they can see about the company operations alone, what if the team person login and go the ops it have to show the individuals person metrics right we have to design based on that .. do the complete analysis first then we will do one by one"

## Part 1 — What exists today (the audit)

Two completely separate metric surfaces exist:

### A. `/api/operating-score` — company view (**owner-only**, `require_role("owner")`)

Returns:

```
company.overall              # weighted average, 0-100
company.categories           # { execution, finance, sales, responsiveness }
company.enough_data          # false until ≥3 actionable tasks OR ≥1 invoice
stats                        # done, open, overdue, total_decisions, approved,
                             # open_complaints, outstanding (if can_finance)
employees[]                  # per-person: id, name, role, score, done, open, overdue
can_finance                  # is finance data visible for this viewer
```

**Category formulas** (in `_score_execution`, `_score_sales`, inline for finance/responsiveness):

| Category | Weight | Formula | Notes |
|---|---|---|---|
| Execution | 35% | `completion_rate × 100 − overdue_ratio × 40` | across ALL tasks in tenant |
| Finance | 25% | `(paid ÷ billed) × 100 − overdue_invoices × 5` | gated by `can_finance` |
| Sales | 20% | `approved_decisions ÷ total_decisions × 100` | binary, no depth |
| Responsiveness | 20% | `100 − open_complaints × 12 − overdue_tasks × 3` | conflates two dimensions |

Weighted overall = `Σ(cat × weight) ÷ Σ(available_weights)` — categories can be null (finance if user lacks perm), gets renormalized.

### B. `/api/work-coach` — individual view (**any authenticated user**)

Returns per-person stats:

```
completed, open, overdue, actionable
completion_rate         # (done / actionable) %
proof_upload_rate       # % of done tasks with photo/voice attached  <-- richer signal
plans_used              # execution plans accepted
plans_completed         # execution plans hit 100%
photos_uploaded         # engagement signal
voice_updates           # engagement signal
```

Plus AI review: headline, strengths, improvements, recommendation. Cached in `users.coach_summary`. **Owner can view any user; non-owner only self.**

### The gap the founder is pointing at

- Team member visits `/operating-score` → gets a **silent 403** (backend gate + no nav item)
- Nowhere in the app is there "**this** is how **you** are doing" surfaced as the primary experience
- WorkCoach (`/coach`) exists but is buried behind employee leaderboard, framed as "coaching," not "your dashboard"
- Two computations of execution score coexist (`_score_execution` for company + `compute_employee_stats` for individual), with **different depth** — individual has proof-upload, plan adoption, photos, voice; company version has none

**Root problem: the product treats "metrics" as an owner-only concept. Everyone else is a subject, not a viewer.**

## Part 2 — Roles that exist

From `config.py:189`:
```
ROLES = ["owner", "sales", "operations", "finance"]
```

Plus tenant-added custom roles (e.g., "consignee_liaison" for Tracole). Multiple people can share a role.

**No dedicated "manager" role today** — the only privileged role is owner. Every non-owner is a peer of every other non-owner in permission terms (though they can have different `permissions[]` overrides).

## Part 3 — Personas that need a view

| Persona | Who | What they need |
|---|---|---|
| **Owner** | Founder, single per tenant | Company health + team performance + individual drill-down. Already gets this today (imperfectly). |
| **Individual contributor** | Sales/Ops/Finance/custom-role people | "How am I doing?" — my execution, my streaks, my open work, my rank vs peers |
| **Role peer** (future) | When 3+ people share a role | "How is my team (all sales) doing?" — role-level roll-up. **Defer to v2.** |

**No manager tier in v1.** The design must accommodate a future manager tier (role-based roll-up) without paying for it now.

## Part 4 — Metric inventory (what we could show)

Grouped by what's already computable vs what needs new backend work.

### Available today (used somewhere)
- Task counts: done, open, overdue, actionable
- Completion rate, overdue ratio
- Invoice counts + amounts: billed, paid, overdue
- Decision counts: total, approved
- Complaints: open, resolved
- Per-person: proof upload rate, execution plan adoption, photos/voice counts

### Available today (not surfaced)
- **Task rework rate** — tasks reopened after being marked done. High rework = shallow "done."
- **Workflow throughput** — workflows advanced-per-week, completed-per-week
- **Decision latency** — median time from decision-captured to decision-approved
- **Response latency** — median time from task-assigned to first-update (comment / attachment / status change)
- **Employee engagement** — % of team with activity in last 7 days
- **Streak** — consecutive days with at least one done task

### Need new backend work
- **30-day trend line** — snapshot history (new collection: `operating_score_history`)
- **Peer comparison** — "you're 3rd of 4 sales this week" (compute per-role rank)
- **Cash flow trend** — 30-day rolling revenue − expense sparkline (has data; needs aggregation)

## Part 5 — What each persona sees (the new IA)

### Owner view of `/operating-score` — evolution, not revolution

Same structure as today, upgraded:

1. **Hero** — Company score + delta chip vs last week + one-sentence Dex narrative
2. **4 category cards** — each expands into a drill-down (execution → tasks, finance → invoices, sales → decisions, responsiveness → complaints)
3. **30-day trend sparkline** behind the hero
4. **Team leaderboard** — existing, add period + delta per person
5. **NEW: "Your personal snapshot"** mini-widget — owner is also an IC and deserves their own view

### Non-owner view of `/operating-score` — brand new

Same route, adaptive content:

1. **Hero** — **YOUR** score + delta + Dex narrative ("You're at 82 this week — up 4, driven by 3 workflows advanced and 0 overdue")
2. **My execution breakdown** — completion rate, proof upload rate, plan adoption, streak. These are the **richer** individual metrics from `compute_employee_stats` that the company view throws away.
3. **My open work** — top 5 tasks with aging; deep-link to MyWork
4. **My active workflows** — where am I the current-stage owner? deep-link to Workflows
5. **How I stack up** — my rank in my role + vs company average. Opt-in per user (privacy toggle in Settings).
6. **NEW (optional, owner-configurable): Company card** — a small card showing company score, so team members feel part of a bigger picture without seeing the full owner dashboard. Owner sets in Settings: "Share company score with team?" default off.

### v2 (deferred): role peer view

When there are 3+ people in the same role, add a middle tier: "Sales team score" between "you" and "company." Design the components generically so we can plug this in later without a rewrite.

## Part 6 — Design approach (recommended)

**Same route (`/operating-score`), adaptive content by role.**

- One nav item, one URL, one page component
- Page component dispatches to `<OwnerView />` or `<SelfView />` based on `user.role === 'owner'`
- Backend endpoint returns both shapes based on viewer identity:
  ```
  GET /api/operating-score
    → owner view: { company, employees, my_snapshot }
    → non-owner view: { self, my_open_work, my_workflows, peer_context }
  ```
- Backend still uses one endpoint (avoids duplicate route surface + auth logic)

**Why not two routes?**
- Extra nav item creates confusion ("which one do I go to?")
- Same-URL role-aware is the pattern the rest of the app already uses (Desk, MyWork)
- Founder benefits from a "switch to team-member view" toggle in one place

## Part 7 — Metric mapping per persona

| Metric | Owner sees | IC sees | Notes |
|---|---|---|---|
| Company overall score | ✅ hero | ⚪ optional card | owner-toggle in Settings |
| Company category scores | ✅ drill-down | ⚪ optional summary | same source, different depth |
| Employee leaderboard | ✅ | ❌ | privacy: don't show ranks unless user opted in |
| **My score** | ✅ mini-widget | ✅ hero | same formula, different framing |
| **My completion rate** | ✅ (in mini) | ✅ hero | primary IC metric |
| **My proof-upload rate** | ✅ (in mini) | ✅ card | rich signal, was invisible on owner side |
| **My plan adoption** | ✅ (in mini) | ✅ card | rich signal, was invisible on owner side |
| **My streak** | ✅ (in mini) | ✅ chip | motivational |
| **My open work** | ⚪ link to MyWork | ✅ list | primary IC action surface |
| **My active workflows** | ⚪ link to Workflows | ✅ list | primary IC action surface |
| **My rank vs peers** | ✅ leaderboard | ✅ opt-in chip | privacy-first |
| **Trend line (30-day)** | ✅ company | ✅ personal | new backend work |
| **Dex narrative** | ✅ | ✅ | different prompt per view |
| **Suggested actions** | ✅ | ✅ | different prompt per view |

## Part 8 — Better metric formulas (what we should upgrade)

Current formulas are simple ratios with hardcoded penalty coefficients. Founder-visible upgrades:

1. **Responsiveness** currently mixes complaints + task overdue — those are two different things. Split into:
   - `complaint_response_time` — median hours from complaint-raised to first-response
   - `task_overdue_score` — separate metric under execution
2. **Sales** currently only measures approval rate. Add:
   - `decision_latency` — median time capture → approval (fast = healthy)
3. **Execution** currently ignores rework. Add:
   - `first_pass_yield` — % of done tasks that stay done (not reopened within 7 days)
   - `plan_adoption` — % of tasks with an accepted execution plan (from work-coach)
   - `proof_upload_rate` — % of done tasks with attached evidence (from work-coach)
4. **Finance** currently only collection ratio. Add:
   - `days_sales_outstanding` — average age of unpaid invoices (DSO, classic SME metric)
   - `expense_ratio_trend` — 30-day rolling

## Part 9 — Backend changes required

Minimal for v1:

1. **Change auth gate** on `/api/operating-score`: `require_role("owner")` → `get_current_user`. Endpoint returns different payload shape by role.
2. **Add `compute_employee_stats` as a callable** from `/api/operating-score` for non-owner viewers — already exists, just reuse it.
3. **Add per-user peer rank computation** — cheap: sort tenant users by score, index of `self`.
4. **Add trend history** — new collection + daily cron:
   ```
   operating_score_history: { tenant_id, date, overall, categories, employees[] }
   ```
   Cron writes one row per tenant per day.

That's it for backend v1. All the drill-downs are frontend + existing endpoints (`/tasks`, `/invoices`, `/decisions`, `/complaints`).

## Part 10 — Sprint 1 phasing (revised, mobile deferred as founder said)

**Phase A — the role split (must-ship first, unblocks everything else)**
- A1. Backend: remove owner-only gate, add per-role payload dispatch
- A2. Frontend: route dispatcher (`<OwnerView />` vs `<SelfView />`)
- A3. Build `<SelfView />` component with the 5 sections above (hero, breakdown, open work, active workflows, peer context)
- A4. Build `<OwnerView />` mini `<PersonalSnapshot />` widget (owner sees their own IC card too)

**Phase B — the better metrics**
- B1. Add first-pass-yield, plan-adoption, proof-upload-rate to owner execution score
- B2. Split responsiveness: complaint-response-time + separate task-overdue
- B3. Add decision-latency to sales score
- B4. Add DSO to finance score

**Phase C — visual + drill-downs**
- C1. Hero rewrite (delta chip + Dex narrative) — both views
- C2. Category drill-down cards (owner view)
- C3. 30-day trend sparkline (new backend history + frontend)
- C4. Suggested-action chips (Dex-generated)

**Phase D — empty states, DS, a11y, mobile** (last, per founder priority)

## Part 11 — Open decisions for the founder

Before we code Phase A:

1. **Peer rank visibility default** — should non-owners see "You're 3rd of 4 sales" by default (opt-out) or hidden by default (opt-in)? Privacy vs motivation trade-off. **Recommendation: opt-in, off by default.**
2. **Company card for non-owners** — should team members see the company score at all? Some tenants will want transparency, others will want to keep it owner-only. **Recommendation: owner setting in Settings > Business, default off.**
3. **v2 role-tier** — do we design components generically for it now (adds 20% frontend effort) or ignore it entirely (rewrite later)? **Recommendation: design generically now — a `<ScoreView scope="self|role|company" />` component pattern.**
4. **Better metrics scope** — Phase B is a proper metric redesign that may want its own discussion round. **Recommendation: ship Phase A first (role split with existing metrics), then have a dedicated design conversation on Phase B formulas before coding them.**
5. **Historical trend** — do we backfill history from existing data (imperfect: no snapshots exist) or start fresh from today? **Recommendation: start fresh; trend appears from day 1 of shipping the cron.**

## Recommendation

**Do Phase A first** (role split). It's the founder's core ask ("team person sees individual metrics"), doesn't touch formulas or IA, and it makes every subsequent phase easier because we now have a proper viewer-aware payload.

**Then discuss Phase B formulas together** before coding — that's where domain judgment matters (which metrics for a manufacturer vs a logistics company vs a consultancy).

**Phases C + D** are the polish we already scoped in the tracker's 25 items.
