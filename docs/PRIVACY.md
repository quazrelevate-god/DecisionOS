# Data inventory — for the Play Data Safety form

**2026-09-29.** The public policy is the app's `/privacy` page
(`frontend/src/pages/Privacy.js`); this is the same facts in the shape Play's
questionnaire asks for, so the two cannot drift apart and so nobody has to
guess an answer at 11pm the night before a submission.

Every row was read out of the code, not assumed. Sources named per row.

## The analytics decision (PLAY-2)

PostHog used to initialise unconditionally in `public/index.html` with a
`session_recording` block and nothing said about it. What changed, and why:

| | Before | Now | Why |
|---|---|---|---|
| Session replay | configured; on/off decided by a PostHog **project** setting | **off in the app** (`disable_session_recording: true`) | These screens *are* somebody's decisions, suppliers, staff and money. Replay of that is not "usage analytics", and declaring it as such would be a false Data Safety declaration. Setting it in code means a dashboard toggle flipped later cannot turn it back on. |
| Autocapture | on (PostHog default) | **off** | Autocapture records the *text* of what you click — here, "Approve ₹2,40,000 to Sharma Textiles". That is content, not behaviour. |
| Pageviews | on | **on** | Which screens get used is the question a pilot needs answered, and it carries no business content. |
| Key | hard-coded | `REACT_APP_POSTHOG_KEY` | A real off switch: no key, no `init`, no request. Unset the variable and analytics stops without a code change. |

Events worth having are now worth naming — add `posthog.capture("…")` at the
moment that matters rather than hoovering up every click.

## What the app collects

| Data | Where from | Why | Play category |
|---|---|---|---|
| Mobile number | sign-up / sign-in | it **is** the sign-in | Personal info → Phone number |
| Name | sign-up, team invite | to show who did what | Personal info → Name |
| Email (optional) | profile | receipts, verification | Personal info → Email |
| Workspace records — decisions, tasks, approvals, contacts, staff, leave, attendance, notes | typed by the user | the product | App info & performance → Other / Personal info → Other |
| Money records — invoices, payments, expenses, ledger | typed or uploaded | the product | Financial info → Other financial info |
| Voice recordings + transcripts | Dex, `RECORD_AUDIO` | spoken capture | Audio → Voice or sound recordings |
| Uploaded files | document ingestion | the product | Files and docs |
| IP, device, browser | every request | serving and security | App activity / Device IDs |
| Screens opened | PostHog pageviews | product analytics | App activity → App interactions |
| Sign-in and admin audit log | `services/audit_log` | security | App activity → Other |

**Not collected at all:** advertising ID (the Android manifest requests no
`AD_ID` permission — `frontend/android/app/src/main/AndroidManifest.xml`
declares only `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`), location,
contacts, photos, SMS, call logs, health, calendar.

## Who it is shared with

| Third party | Gets | Source in this repo |
|---|---|---|
| Railway | hosting — everything, at rest | deploy |
| MongoDB | the database | deploy |
| SMS provider (APM SMS / Twilio) | mobile number, sign-in code | `backend/services/otp.py` |
| WhatsApp (Meta) | number + message, if the workspace uses it | `backend/routers/whatsapp.py` |
| PostHog (**US**) | IP, device id, screens opened | `frontend/public/index.html` |
| Anthropic / OpenAI / Google / Voyage / Sarvam | only what an AI feature needs, **only after owner AI consent** | `backend/config.py` `_AI_KEY_ENV`; consent at `/tenant/ai-consent` |
| Emergent | uploaded files (object storage) + AI gateway | `backend/integrations/storage.py` |
| Google Fonts | IP at page load | `frontend/public/index.html` |
| Sentry | backend errors — **only if `SENTRY_DSN` is set** | `backend/core/observability.py` |

## Answers the form will want

- **Is data encrypted in transit?** Yes — https throughout; the release
  Android build has no cleartext exemption (that is debug-only).
- **Can users request deletion?** Yes — in-app (Settings → Account) and at
  `https://www.decisionos.biz/delete-account`. See
  [PLAY_STORE_READINESS.md](PLAY_STORE_READINESS.md) §1.2.
- **Is any data collected required?** The mobile number is: it is the sign-in.
  Everything else follows from using the product.
- **Data used for tracking across apps?** No.
- **Data sold?** No.
- **Committed to Play Families policy?** Not applicable — 18+.

## Two things to settle before submitting

1. **`support@decisionos.biz` must deliver.** The policy page and DPDP's
   grievance requirement both point there. It is one constant, `CONTACT` in
   `frontend/src/pages/Privacy.js`, if it should be a different address.
2. **Google Fonts is a third-party request on every cold start.** Bundling the
   two families locally removes a row from this table, removes a dependency
   from the launch path, and fixes the system-font fallback on a first offline
   launch. Contained change; not done yet.
