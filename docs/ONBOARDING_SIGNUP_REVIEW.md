# Creating a workspace — what was wrong, 2026-09-17

Owner: Yokesh. Found by testing signup in the browser: *"everything passed, and
finally it said it couldn't create a workspace — email already registered, but
the email was new."*

## What actually happened

Walked the real signup against a throwaway backend and timed every call:

| call | result |
|---|---|
| `POST /signup/check-email` (the wizard's email step) | `available: true` — the email **was** free |
| `POST /auth/register` | **200 in 14,425 ms** — three AI generations, the slowest 10,012 ms |
| `POST /auth/register` (the founder pressing again) | **400 Email already registered** |
| `POST /signup/check-email` | `available: false` — the account existed |
| `POST /auth/login` | **200** — and their password worked |

The three setup generators (lexicon, operating model, finance categories) ran
**inside** the request and **before** the user row was written. Any client that
gave up first kept nothing from stopping the server: it finished, committed the
workspace, and the founder was looking at "Couldn't create your workspace". Every
press after that hit the duplicate-email check. KM-61 had already caught the
exact pair in the Railway log —

    POST /api/auth/register  499  totalDuration 60000   (the proxy giving up)
    POST /api/auth/register  400  totalDuration 26      (the retry)

— and made the three calls concurrent, which narrowed the window without closing
it, because the window *is* the AI latency.

## What changed

1. **The account is created before the AI runs.** Tenant, owner and membership
   are written from what the signup collected — deterministic and fast — the
   session is handed back, and `services.ai.ai_setup.generate_tenant_setup`
   fills in the AI fields behind the founder. `ai_setup_status` reads "pending"
   until it lands; every reader already tolerated absent AI fields, because a
   failed generator stored exactly that. **Register: 14.4s → 4-5s.**
2. **A second press ends in the workspace.** If the password opens the account
   that already exists, that is the same founder finishing the same signup:
   register signs them in. If it does not, the refusal carries `email_registered`
   and the words the wizard uses at the email step, and the screen shows a
   **Sign in instead** button. The screen also re-checks the email right before
   the long call, and falls back to signing in when creating fails at all.
3. **The rate limit says how long.** Three workspaces per hour is counted per
   *network*, so an office behind one address reaches it fast. "Try again later"
   became "Try again in about N minutes — or sign in if you already have a
   workspace."

## Every step, clicked

`backend/scripts/ux_signup_0917.py` walks the whole wizard on a throwaway
database (24/24): a blank company name, a malformed email, an email that already
has a workspace (**caught on that step**, not sixty seconds later), a short
password, the team-size chips, the website step skipped, the industry that
Continue waits for, the interview, the build, the confirm — then the workspace,
the reveal, and the Desk.

It also caught a crash I introduced while fixing this: `Signup.js` passed a
`login` it had not taken from the auth context, which broke the whole signup
screen at the build step. No unit test would have seen it.

## Closing the tab is no longer starting over (same day)

The draft store had been there since FIX-001-D — create, resume, patch, a signed
token per draft, a 30-day TTL, and `/register` already merging a draft underneath
the final call. The wizard never called any of it.

It does now. Each step is saved as it completes (`about`, `scale`,
`os_blueprint`); the browser keeps the draft id and its token; reopening `/signup`
restores what was typed and reopens at **the password** — the one field that is
never stored, because the store refuses it by design. The founder sees why:
*"Welcome back, Meena — we kept your answers. Just your password again, and
you're on."* A blueprint that was already built comes back with them rather than
being generated a second time.

And the order the founder asked for holds: **validate each step, save each step,
create nothing until the end.** Checked in the browser — after three answers and
a closed tab, `check-email` still says the address is free; the workspace is
created once, at the last press.

Edge cases closed with it: a draft that expired, was already used, or whose token
no longer verifies just starts a clean signup with no error; a browser with
storage disabled (a private window) signs up exactly as before; and saving is
best-effort throughout — a draft that cannot be written never blocks the founder.

`backend/scripts/ux_signup_resume_0917.py` (12/12) types the first answers,
throws the browser away, comes back with only what a real one keeps, and finishes.

## The founder's mobile is confirmed before it is trusted (2026-09-19)

Yokesh: the email is the business address for support and receipts; the
**mobile** is how the founder signs in on the mobile app, so we have to have it
and it has to be right.

**What was wrong.** Step 05 was optional, and its only check was "at least 8
digits". The backend stored whatever arrived. But that number is two things at
once: a **sign-in** (Mobile OTP looks the account up by it) and a **route**
(WhatsApp from it lands in the workspace as that person). So a one-digit slip:

- locked the founder out of Mobile OTP — "No account is registered with this
  mobile number", about their own account; and
- handed whoever owns the mistyped number an OTP sign-in **as the owner** —
  they request a code, it arrives on their own phone — with their WhatsApp
  messages filed as the owner's captures.

An 8-digit number was worse: it saved fine and then OTP sign-in refused it as
invalid, so the founder could never use it.

**What changed.**

- **Required, and a real Indian mobile.** Ten digits starting 6-9, written any
  way people write them (`+91 98765 43210`, `098765-43210`, `(98765) 43210`).
  Landlines, short numbers and other countries' codes are refused rather than
  guessed at — a UAE number's last ten digits are some Indian stranger's
  mobile. One rule, two copies kept in step:
  `backend/services/auth/phone.py` and `frontend/src/lib/phone.js`.
- **Confirmed with a texted code, at that step.** "Text me a code" → six boxes →
  Confirm (or just type the sixth digit). Wrong codes are refused and counted;
  five spend the code. Resend after 30 seconds. "Change number" goes back.
- **Register trusts a phone only with proof.** `/signup/phone/verify` returns a
  signed proof for that exact number (24 hours; a key derived from the session
  secret, so it can never pass for a session). `/auth/register` refuses a phone
  without one (`phone_unverified`) or one that cannot be a mobile
  (`phone_invalid`), stores it as `+91 98765 43210`, and marks
  `phone_verified_at`. A proof for your own number does not carry over to a
  colleague's.
- **A resumed signup is not texted twice.** The proof rides on the draft with
  the number; coming back shows *"Confirmed — no need for another code"* until
  it lapses. If it lapses on the last screen, Create says so and **Confirm my
  mobile** goes to that one step and straight back to the built OS.
- **Texting any number is capped.** `/signup/phone/send-code` is the one public
  endpoint that texts a number nobody registered, so on top of the signup
  surface's per-network limits it allows five codes an hour **per number**.
- **The API still accepts a signup with no phone** (tests, scripts). What it
  enforces is the security property: any phone it stores was proven. The
  wizard is what makes the mobile required.

**Mobile OTP sign-in, checked end to end.** It works — request, text, verify,
session — and two faults in it are fixed:

- **A number in two workspaces was told "OTP sent" when nothing was sent.** The
  API answers that case with a list and sends nothing; the sign-in page ignored
  the list, showed the code boxes and waited. It now asks *"Which one are you
  signing in to?"*, texts the code for the one chosen, and signs into that
  workspace. (Sakthivel's migration found shared numbers in the production
  dump, so this is not hypothetical.)
- **Twilio was handed the number as typed.** Twilio needs `+91…`; "98765 43210"
  was refused and nobody got a code. The APM gateway, the live provider, was
  unaffected.

**Proof.** `backend/tests/test_founder_mobile_is_confirmed.py` (34) — the rule,
the proof (forged, lapsed, borrowed, other-purpose), send/verify with a fake
gateway that texts nothing, the per-number cap, register's three refusals, the
stored form, and the screens. `backend/scripts/ux_founder_mobile_0919.py`
(29/29) walks it in a browser on a throwaway database: four bad numbers
refused, a wrong code refused, the right one moves on, a closed tab comes back
confirmed without a second text, the workspace is created with the confirmed
number, the founder signs out and back in by Mobile OTP, and with the same
number in a second workspace the page asks which one and signs into it.

## Adding a member, and their first sign-in (2026-09-19)

Yokesh: a manager or HR person adds each member on Team — name, role, mobile —
and the member makes the account their own. Checking the loop found the first
half working (add → invite link → OTP → in) and the second half missing:

- a "temporary" password the manager typed, that nothing ever asked the member
  to replace — so the manager could keep signing in as them;
- members added "Mobile OTP only" could never add a password;
- the mobile was never marked confirmed, the email never checked;
- the Team form took any 10+ digits, and plain Mobile OTP would open a
  just-invited account to whoever held a mistyped number;
- the first sign-in landed straight on the Desk.

Yokesh's call: **members sign in with their mobile only; owners have both an
email + password and a mobile.** So:

- **Team › Add member** has no password and no sign-in toggle. The mobile is
  required and must be a real Indian mobile (same rule as signup); the email
  is optional. Saving always hands over the invite link. The API refuses a
  password for a member, and `users.email` became a partial unique index
  (unique among real addresses) so members without an email don't collide.
- **The first sign-in goes through the invite link.** Until then, the
  member's number alone opens nothing — plain Mobile OTP answers "Open the
  invite link you were sent…" and texts no one. So a mistyped number gets a
  stranger nothing, and the real member (link, but no code) tells the
  manager. A number already live in another workspace keeps signing in there.
- **Signing in by code marks the mobile confirmed**, and the first time, a
  one-time **welcome card** shows it confirmed and asks them to check their
  name and add a job title, what they handle and (optionally) an email. Save
  or Later; one request; Settings holds the same fields any time.
- **An email is contact detail for a mobile-only member,** so adding or
  changing it needs no code (it did, briefly — a code to the phone).
- **Owners:** someone added as an owner, or promoted to one, is asked for an
  email and a password at their next sign-in, before anything else — the owner
  is who can be recovered by email, and who recovers everyone else. The
  promote dialog says so. After that, both ways in work.
- **A new password is 8+ characters with a letter and a number** — signup,
  reset (checked before the link is spent), change, and an owner setting one.
  Existing passwords keep working until changed.

**Proof.** `tests/test_member_loop.py` (38). Browser, two sessions on a
throwaway database: `scripts/ux_member_loop_0919.py` 26/26 — the Team form, a
bad number refused, the invite link handed over, the number alone opening
nothing, the link signing in, the welcome card saving, plain Mobile OTP working
after, promotion to owner asking for email + password (a weak one refused),
and both ways in afterwards.

**Seen along the way, not changed:** saves took 6–8 s in these runs while the
Desk behind them was loading its AI calls. Worth its own look (U7-24.18) — looked at, below.

**The Add member form, checked (same day, U7-24.19).** Required: name, a real
mobile, department (pre-selected). Optional: email, job title, reports to;
access defaults to the department's. The email is saved and shown on the
profile, the card and in search. Fixed: whoever manages the team can now add,
fix or clear a mobile member's email (an email someone signs in with stays an
owner's call and can't be removed); a bad email is flagged under the field
before Save; a member without one shows "Not added" instead of an empty box.
`scripts/ux_member_email_0919.py` 11/11.

**Saves no longer queue behind the Desk loading (same day, U7-24.18).**
Measured on a throwaway database against the remote Mongo (~205 ms a round
trip): the AI calls were not the cause and the event loop was not blocked —
`GET /api/health` answered in ~10 ms throughout, and a watchdog dumping the
loop's stack caught only bcrypt. The time went on database round trips made one
after another, queued on a connection pool that could not grow:

- every signed-in request made six lookups in a row before its handler ran
  (~1.45 s for a bare `/auth/me`) — now side by side, 2 round trips;
- `/desk/summary` made nine counts in a row (~7 s) — now side by side;
- PyMongo opened only 2 connections at a time, so the Desk's dozen requests
  shared 3–4 connections — now up to 16 (`MONGO_MAX_CONNECTING`);
- the owner-credentials bcrypt (~0.3 s of CPU) runs off the event loop.

Same browser journey: welcome-card save 6.8 s → 4.1–4.5 s, owner-credentials
9.4 s → 5.5–5.9 s, `/auth/me` under load 1.46 s → 0.69 s. What remains is the
browser's 6-connections-per-host limit on local http (the save waits for a free
connection behind the Desk's requests), the follow-up `/auth/me`, and each
save's own round trips. Tests: `test_u7_24_18_desk_load_latency.py` (11).

## Still open

- **Nothing tells the founder the AI setup is still filling in.** It takes a few
  seconds after they enter; the status is on the tenant (`ai_setup_status`) and
  there is a retry endpoint, but no screen reads either.
- **A resumed signup redoes the website and interview steps** unless the
  blueprint was already built. Their answers are safe; the two AI steps are not
  saved individually.
- ~~**Changing your own mobile in Settings is not confirmed yet.**~~ **Done
  2026-09-19 (U7-24.14).** Settings › Your Profile now texts a code to the NEW
  number (`POST /auth/phone/send-code`, signed-in only) and saves it only with
  that code; the old number keeps working until then. The same Indian-mobile
  rule applies (a 5-digit number used to save), a colleague's number is
  refused before anything is texted, the same number written differently is
  not a change, an old malformed number rides along untouched until changed,
  and someone who signs in only by mobile can change their number but not
  remove it. The code lives in its own scope, so a sign-in code can't confirm a
  change and a change code can't sign anyone in; it is checked last, so a
  refusal elsewhere in the form doesn't spend it. Tests:
  `test_own_mobile_change_is_confirmed.py` (19); browser:
  `scripts/ux_own_mobile_0919.py` 15/15 — including the old number no longer
  signing in and the new one signing in by Mobile OTP.
- **The Flutter app signs in with email and password only.** Mobile OTP exists
  on the web and the installed web app; the native app (on hold) has no OTP
  screen.
