# DecisionOS — complete UI/UX audit plan

Branch `karma-redesign` · started 2026-09-13 · owner: Yogesh
Report: `docs/DecisionOS_UI_Bug_Report.xlsx` (built from `backend/scripts/build_ui_bug_report.py`)

Written before execution so nothing is skipped. An item is ticked only with
evidence behind it (script output, screenshot, or preview capture).

---

## 1 · The standard every area gets

| # | Check | How |
|---|---|---|
| S1 | **Desktop 1440 and mobile 390** | Playwright contexts; mobile with touch |
| S2 | **Every role** — Owner, Sales, Production, Finance | demo seats via `ux_login.demo_login` |
| S3 | **Every control pressed** — buttons, links, tabs, toggles, dialogs, row actions | scripted, then re-checked by hand on anything that fails |
| S4 | **Writes blocked** — every POST/PATCH/PUT/DELETE aborted after sign-in | `page.route`; nothing created, changed, deleted, sent or charged |
| S5 | **Validation + failure paths** — empty forms, a blocked save, a blocked AI call | toast text recorded, form state checked |
| S6 | **Forced load failures + slow loads** — abort / delay each GET the page depends on | does the page say so, or fake "loading" / "empty"? |
| S7 | **Missing records + refused access** — unknown ids, 403s, direct links | does the page explain itself with a way out? |
| S8 | **Layout** — overflow, 24px tap targets, clipped / covered controls, scroll reach | measured in the DOM |
| S9 | **Browser preview** — look at it at phone size | screenshots / page text in the preview pane |
| S10 | **Re-check before filing** — any fail that could be the harness is re-run on a fresh page | e.g. toast de-duplication, timing, wrong selector |
| S11 | **Report** — findings + coverage in the workbook, plan ticked, commit + push, pull first | |

Not run without the founder's go: anything that makes a paid model call AND
stores its result (coach refresh, rescore, extraction, AI refresh / ask), and
anything that creates an account or messages a real person.

---

## 2 · Coverage map

### Already done to the standard (2026-09-13)

- [x] **My Work** — full audit + re-verification of 13 commits (MW-15…21)
- [x] **Team** — hands-on pass, 4 passes (TM-07, TM-08)
- [x] **Ops** — view-as, 4 roles, AI failure paths (OP-10…14)
- [x] **CRM** — 4 roles, failures (CR-10…14)
- [x] **Finance** — 4 roles, deletes, failures (FN-06…11)

### To do — in this order

- [x] **A · App shell + routing** — header nav, global search, language, bell,
      profile menu, mobile dock, More panel, Dex FAB; every redirect (`/brief`,
      `/leave`, `/review`, `/ingest`, `/tasks`, `/priorities`, `/meetings`,
      `/ledger`, `/ask`, `/contacts`, `*`); a **role × route matrix** for every
      protected route; dev routes (`/design-lab`, `/__mobile-kit`) exposure;
      signed-out access to protected routes
- [x] **B · Decision Desk** — `/inbox` (scopes, KPI tiles, decision cards,
      approve / reject / clarify, capture), `/decisions/:id`
- [x] **C · Dex / Company Brain** — `/brain`, documents, ask, voice entry points
- [x] **D · CEO Journal** — `/journal` (owner-only)
- [x] **E · Calendar + Notifications** — `/calendar`, `/notifications`
- [x] **F · Settings + People** — `/settings`, `/people`
- [x] **G · Sign-in, sign-up, onboarding** — `/login`, `/signup`, demo seats,
      invite link landing (`/login?invite=`) — validation and failure paths only,
      no account is created
- [x] **H · Admin portal** — `/admin/*`
- [ ] **I · My Work full re-sweep** — once MW-20 (drawer closes on any click) is
      fixed; if it is still open, sweep everything outside the drawer
- [x] **J · Cross-cutting report** — the error-state pattern across all pages,
      role × route matrix, open Highs by area, what still needs the founder's go

---

## 3 · Execution log

(Filled in as each area completes: script, passes, findings, commit.)

### A · App shell + routing — run complete 2026-09-13
Script `backend/scripts/ux_shell_routes_0913.py` — signed-out pass + 4 roles × 1440/390.
141 pass / 12 fail / 4 info; fails re-checked in the browser preview.
- Holds: signed-out visitors redirected from all 15 protected routes; every
  redirect (13) lands correctly; role gating (Journal owner-only, CRM needs
  People) shows Access Denied; nav pills route and mark current; global search
  (button + Ctrl+K) hands to Dex; user menu shows Settings only to the owner;
  language switcher; mobile dock; every More tile opens; bell dropdown (preview).
- Harness artefacts (not filed): bell "0 items" (timing — preview shows 7), mobile
  bell check (selector — preview shows dropdown opens).
- Findings: non-owners on mobile cannot reach Ops, Team or Settings (More panel
  hides them; desktop shows them); Desk money tiles for Sales/Production never
  load ('…') because /ledger/summary 403s, while 'To collect (overdue) ₹7.5L'
  still shows them receivables; Finance for Sales/Production (= FN-07).

### B · Decision Desk — run complete 2026-09-13
Script `backend/scripts/ux_desk_0913.py` — 4 roles × 1440/390 + forced failure.
47 pass / 26 fail / 38 info; key fails confirmed in the browser preview.
- Holds: scope pills (desktop), KPI tiles route (owner), Review opens the decision
  page, Reject needs a second tap, failed approve/reject/note report and keep
  state, Escape does not discard a review, decided decisions show outcome.
- Findings: unknown or not-yours decision is a dead end (no Close; Escape and
  outside tap disabled; 404 and network errors both say 'You don't have access');
  a failed Desk load says 'Nothing waiting on you' with 0s everywhere; Company/You
  switch hidden on phones; decision-note mic only toasts; Complaints tile dead end
  for non-owners (= CR-13).
- By design (not filed): non-owner Desk sections exclude their own tasks (those
  live on My Work — desk.py:499-601); Approve is one tap while Reject is two.
- Re-checked: desktop Close from a real Review flow returns to /inbox; leave Info
  opens a note with Send Request; bell traced — see GL-01.

### C–F · Dex, Journal, Calendar, Notifications, Settings, People — 2026-09-13
Script `backend/scripts/ux_pages_cf_0913.py` — 4 roles × 1440/390 + forced failures;
browser preview at 375×812 for Dex, Journal, Calendar, Settings, People.
- Holds: failed Dex question reported in chat; Clear; mic explains missing
  microphone; /brain?q= asks; documents panel (owner-only Add, empty upload refused,
  delete asks); Journal views, week nav, day select, search, timeline dialog;
  Calendar modes, week nav, filters; Notifications list; Settings tabs + deep links
  + save failures (Money re-checked fresh); People tabs with read-only banner.
- Harness artefacts (not filed): Dex Send "disabled=None" (no Send until typed);
  documents "Loading…" (read too early — preview shows the empty state); Settings
  Money save toast (de-duplication — fresh page shows 'Could not save');
  per-item read button click timeout.
- Findings: GL-01 desktop bell closes itself; CL-01 failed loads look empty on
  Notifications / People / Journal / Calendar; CL-02 calendar events not
  clickable; CL-03 Mark all read fails silently; CL-04 Settings add links 20px.

### G–H · Sign-in, sign-up, invite, admin — 2026-09-13
Script `backend/scripts/ux_auth_admin_0913.py` — signed out + signed-in owner ×
1440/390, every write blocked, no password typed; preview for sign-up and admin.
30 pass / 12 fail / 2 info.
- Holds: empty/malformed sign-in refused; failed sign-in, demo seat and OTP send
  reported; demo seats open/close; theme; register + legacy ?signup=1 links; bad
  invite link explained; sign-up empty company name refused inline (preview);
  admin portal refuses signed-out, deep links and tenant owners (401).
- Findings: AU-01 unlabelled sign-in/sign-up/admin fields; AU-02 3-digit OTP
  number sent; AU-03 20px links on desktop login; GL-03 /login shows the form to
  a signed-in user. Verified non-issue: dev OTP gated by an explicit flag (N-08).

### I · My Work re-sweep — 2026-09-13
MW-20 was fixed in `0a57743` (+ `89ed015` for the phone scrim), so the drawer is
in scope again.
- `backend/scripts/ux_verify_mywork_0913.py` (1440, 1920, 390, Sales): **55 pass /
  2 fail**. Both fails are the stale "board has no outer well" expectation — the
  well was restored on the founder's call in `21142be` (T-113 records it as by
  design).
- Drawer re-verified by hand-written probes at 1440 and 390: 5/5 inside clicks
  keep it open; one 44px close in the header on phones, scrim strip closes; focus
  lands on the close; Log update form visible on phones; View details → Delete →
  confirm; /finance and /team capped at 1400 while /my-work is full width;
  Department lists only departments with work. MW-15…MW-21 marked Fixed.
- Full control sweep (`backend/scripts/ux_audit.py`, writes blocked): running.

### J · Cross-cutting report — 2026-09-13

**Totals** (workbook `DecisionOS_UI_Bug_Report.xlsx`): 83 findings — 62 open,
20 fixed and verified, 1 by design. Open by severity: **15 High**, 22 Medium,
22 Low, 3 Nit. Coverage 270 checks, 184 pass / 84 fail / 2 not run.

**Open Highs by area**

| Area | Open Highs |
|---|---|
| Finance | FN-01 rupee grouping · FN-02 all-time figure under "This month" · FN-03 trends from expenses · FN-06 one-tap delete · FN-07 Sales/Production see an empty Finance · FN-08 no add on phones |
| Ops | OP-01 team execution panel · OP-02 "Do these first" on mobile · OP-03 score model · OP-10 endless skeleton on 403/404 |
| CRM | CR-04 add menu (mobile) · CR-05 filter (mobile) · CR-10 endless skeleton on failed list |
| Decision Desk | DD-01 dead-end decision page · DD-02 failed load says "Nothing waiting" |

**Three faults account for most of what is left**

1. **Failed loads pretend to be empty or loading** — OP-10, CR-10, CR-11, FN-07,
   FN-09, DD-01, DD-02, DD-03, CL-01 (nine findings, every major page). Pages read
   only `data`/`isLoading`, so an error falls through to the empty state or the
   skeleton. One shared `<QueryError onRetry>` that branches on 403 / 404 / other
   fixes the family.
2. **Permission rules disagree between route, nav and API** — FN-07 (route allows
   data_input, API needs ledger), CR-12 (`/crm/outstanding` ungated), CR-13 and
   DD-03 (Desk tiles link or fetch for roles that are refused), GL-02 (mobile More
   hides pages the routes allow), TM-05 (access matrix readable by everyone). One
   permission map shared by `App.js`, `Layout.js`, `AllAppsPanel.jsx` and the
   backend `require_*` guards would stop them drifting.
3. **Phone parity** — FN-08 (no add), CR-04 / CR-05 (clipped mobile controls),
   CR-09 (no Score with AI), DD-04 (no Company/You), GL-02 (no Ops/Team/Settings
   for staff). Desktop-only controls hidden with `hidden lg:*` and no mobile
   placement.

**Not run — needs the founder's go**
- Live AI: coach refresh, contact rescore, Finance extraction / AI refresh / Ask,
  Dex ask — each is a paid model call and most store their result.
- Invite link end to end (T-217) — mints a real token for a teammate.

**Decisions still parked**: ASK-8 (leave approvers), ASK-19 (operating score
KPIs), ASK numbering collision note.

