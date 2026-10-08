# Data inventory — for the Play Data Safety form

**2026-09-29.** The public policy is the app's `/privacy` page
(`frontend/src/pages/Privacy.js`); this is the same facts in the shape Play's
questionnaire asks for, so the two cannot drift apart and so nobody has to
guess an answer at 11pm the night before a submission.

Every row was read out of the code, not assumed. Sources named per row.

**2026-10-08 (Play compliance audit, C5).** Brought back in line with the code:
push notifications (FCM) and their permission, photos, calendar events,
WhatsApp messages, CRM contacts, reports, the email/search/bot-check providers,
retention per record type, and what account deletion now removes. The audit
itself is `docs/PLAY_STORE_COMPLIANCE_AUDIT.pdf`.

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

| Data | Where from | Why | Play category | Required? |
|---|---|---|---|---|
| Mobile number | sign-up / sign-in | it **is** the sign-in | Personal info → Phone number | Required |
| Name | sign-up, team invite | to show who did what | Personal info → Name | Required |
| Email | sign-up (owner), profile | receipts, verification, sign-in for owners | Personal info → Email address | Optional for members |
| User ID | every account | account management | Personal info → User IDs | Required |
| Company GST, phone; CRM contacts (customers'/suppliers' names, phones, emails, addresses) | typed or CSV import | the product | Personal info → Other info | Optional |
| Workspace records — decisions, tasks, approvals, staff, leave, attendance, notes | typed by the user | the product | App activity → Other user-generated content | Optional |
| Comments; WhatsApp messages to the business number | typed / webhook | the product | Messages → Other in-app messages | Optional |
| Money records — invoices, payments, expenses, assets, inventory, ledger | typed or uploaded | the product | Financial info → Other financial info | Optional |
| Profile photos, bill photos | upload / camera via file picker | the product | Photos and videos → Photos | Optional |
| Voice recordings + transcripts | Dex, signup interview, `RECORD_AUDIO` | spoken capture | Audio → Voice or sound recordings | Optional |
| Uploaded files and documents | upload, Company Brain | the product | Files and docs | Optional |
| Calendar events | typed by the user | the product | Calendar → Calendar events | Optional |
| Push token (FCM) / Firebase Installation ID | Android, after `POST_NOTIFICATIONS` | push notifications | Device or other IDs | Optional |
| IP, user agent | sessions (`active_sessions`), audit log | security | Device or other IDs / App activity → Other | Automatic |
| AI request records (feature, latency, outcome; PII redacted) | `core/usage.py` `ai_calls` | AI reliability | App info & performance → Diagnostics | Automatic |
| Screens opened | PostHog pageviews — **only if `REACT_APP_POSTHOG_KEY` is set at build** | product analytics | App activity → App interactions | Automatic |
| Crash/error details | Sentry — **only if `SENTRY_DSN` is set** | reliability | App info & performance → Crash logs | Automatic |
| Reports of content / AI output / people | Report button (`content_reports`) | moderation | App activity → Other user-generated content | Optional |

**Not collected at all:** advertising ID (no `AD_ID` permission), location,
device contacts, SMS, call logs, health, web history, installed apps.

**Android permissions** (merged release manifest): `INTERNET`, `RECORD_AUDIO`,
`MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS` (asked after an in-app
explanation, `components/PushRationale.js`), `VIBRATE` (haptic tick on the Dex
slider, `@capacitor/haptics`), and from Firebase: `ACCESS_NETWORK_STATE`,
`WAKE_LOCK`, `c2dm.permission.RECEIVE`.

**Purposes to tick:** App functionality, Account management, Developer
communications (notifications, emails), Fraud prevention, security and
compliance (IP, captcha, audit log); add Analytics only if PostHog is on.

## Who it is shared with

All of these process data on our behalf (service providers), so on the Data
Safety form they are **collection, not "sharing"** — but every one is named in
the public policy.

| Third party | Gets | Source in this repo |
|---|---|---|
| Railway | hosting — everything, at rest | deploy |
| MongoDB | the database | deploy |
| Emergent | uploaded files and recordings (object storage) + AI gateway | `backend/integrations/storage.py`, `integrations/llm.py` |
| Anthropic / OpenAI / Google Gemini | only what an AI feature needs, **only after AI consent** (signup step, then owner consent) | `backend/config.py`; `routers/signup.py` `_AI_SIGNUP_KINDS`; `/tenant/ai-consent` |
| Sarvam / OpenAI | audio for speech-to-text; text for text-to-speech | `backend/integrations/stt.py`, `routers/signup.py` |
| Voyage + Qdrant | document/note text → embeddings, stored for search | `backend/integrations/embeddings.py`, `integrations/qdrant.py` |
| APM Technologies / Twilio | mobile number, sign-in code | `backend/services/otp.py` |
| Gmail SMTP / Resend | email address + message | `backend/integrations/email.py` |
| Firebase Cloud Messaging (Google) | push token, notification title/body | `backend/services/push_fcm.py` |
| WhatsApp (Meta) | number + message, if the workspace uses it | `backend/integrations/whatsapp.py` |
| Cloudflare Turnstile / hCaptcha | IP, browser details at signup | `backend/services/captcha.py` |
| Sentry | backend errors — **only if `SENTRY_DSN` is set**, `send_default_pii=False` | `backend/core/observability.py` |
| PostHog (**US**) | IP, device id, screens opened — only if the key is set | `frontend/public/index.html` |
| Razorpay | payment details, on the website checkout only | `backend/routers/billing.py` |
| Google Fonts | IP — the website landing page only; the app bundles its fonts | `frontend/public/landing/index.html` |

## Retention

| Record | Kept |
|---|---|
| Workspace records and files | until deleted, or the workspace is deleted |
| OTP codes | 5 minutes (`OTP_TTL_SECONDS`) |
| Email tokens | up to 3 days (TTL index) |
| Sessions | until expiry, at most 7 days (TTL index on `exp`) |
| Push tokens | until sign-out on the device, or account deletion |
| Audit log, AI request records | life of the workspace; actor email/IP/UA removed on account deletion |
| Billing events | as long as tax and accounting law requires (not wiped with the workspace) |
| Unfinished signup drafts | until account deletion or on request |

## What deleting an account removes (`backend/routers/account.py`)

Membership and user rows; push tokens, sessions, notifications, email tokens,
OTP codes, sign-in lockout counters and signup drafts for that person; actor
email/IP/UA in the audit log. A sole owner's workspace — or a shared one the
owner explicitly chooses to delete — goes entirely via
`services/tenant_wipe.TENANT_COLLECTIONS`. Work done for a company someone
leaves stays with that company. Billing events are kept.

## Answers the form will want

- **Is data encrypted in transit?** Yes — https throughout; the release
  Android build has no cleartext exemption (that is debug-only).
- **Can users request deletion?** Yes — in-app (Settings → Account) and at
  `https://www.decisionos.biz/delete-account`. See
  [PLAY_STORE_READINESS.md](PLAY_STORE_READINESS.md) §1.2.
- **Is data shared?** No — every third party above is a service provider
  processing on our behalf.
- **Is any data collected required?** The mobile number is: it is the sign-in.
  Everything else follows from using the product.
- **Data used for tracking across apps?** No.
- **Data sold?** No.
- **Committed to Play Families policy?** Not applicable — 18+.

## Still to settle before submitting

1. **`support@decisionos.biz` must deliver.** The policy page and DPDP's
   grievance requirement both point there. It is one constant, `CONTACT` in
   `frontend/src/pages/Privacy.js` and `Terms.js`.
2. **The legal entity name** that will be the Play developer must appear in the
   privacy policy (Play: the entity named in the store listing must appear in
   the privacy policy, or the app must be named in it).
3. **PostHog and Sentry in production** — decide, then make this table, the
   policy and the Data Safety form agree.
