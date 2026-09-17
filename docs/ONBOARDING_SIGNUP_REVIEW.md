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

## Still open

- **Nothing tells the founder the AI setup is still filling in.** It takes a few
  seconds after they enter; the status is on the tenant (`ai_setup_status`) and
  there is a retry endpoint, but no screen reads either.
- **A resumed signup redoes the website and interview steps** unless the
  blueprint was already built. Their answers are safe; the two AI steps are not
  saved individually.
