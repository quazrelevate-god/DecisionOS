# Play Console: App content answers

**Prepared 2026-10-09 for build 1.0.4 (5); still true of 1.0.5 (6).** Play Console → **Policy → App
content**. Play will not roll out to *any* track, internal testing included,
until every item on that page is answered. The facts come from
[../PRIVACY.md](../PRIVACY.md) (the data inventory, read out of the code) and
from the release build's merged manifest. If the code changes, change both.

**Do not understate anything here.** A Data safety declaration that does not
match the app is a removable offence on its own.

---

## 1 · Privacy policy

```
https://www.decisionos.biz/privacy
```

Live, public and readable signed out (checked 2026-10-09; it renders "Last
updated 8 October 2026" and names Sarvam, Firebase, PostHog, deletion and the
support address).

**Before submitting:** the policy must name the **developer name exactly as it
will appear on the Play listing** (the person or company you register the Play
account as). See the tracker, decision D2.

## 2 · App access

**"All or some functionality is restricted"**, then paste instruction set A
or B from [STORE_LISTING.md § App access](STORE_LISTING.md).

## 3 · Ads

**No, my app does not contain ads.** (No ad SDK, and no `AD_ID` permission in
the merged manifest.)

## 4 · Content rating (IARC questionnaire)

| Question | Answer |
|---|---|
| Category | **All other app types** (a business/productivity tool, not a game, not social media) |
| Violence, blood, sexual content, nudity, profanity, drugs, alcohol, tobacco | **No** to all |
| Gambling or simulated gambling | **No** |
| Users can interact or exchange content with each other | **Yes**: people in the same workspace see each other's tasks, comments, decisions and files. Moderation exists: Terms accepted first, and Report on content and people. |
| Shares the user's current physical location with others | **No** |
| Allows purchase of digital goods | **No**: the store build has no purchases, and checkout is website-only (lib/storeBuild) |
| Generative AI content | **Yes**, if asked: Dex answers and drafts. Every AI output carries Report and "AI can make mistakes". |
| Unrestricted internet / web browsing | **No** (external links open the phone's browser; there is no in-app browser) |

Expected outcome: a low age rating with a "Users Interact" note. That is
normal for a team tool.

## 5 · Target audience and content

- Target age groups: **18 and over only**.
- Appeals to children: **No**.
- This keeps the app out of the Families programme entirely.

## 6 · Data safety

### Overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only; the release build has no cleartext exemption) |
| Do you provide a way for users to request that their data is deleted? | **Yes**: in the app (Settings → Account → Delete your account) and at the URL below |
| Account deletion URL | `https://www.decisionos.biz/delete-account` |
| Is data shared with third parties? | **No sharing.** Every third party in PRIVACY.md processes on our behalf (a service provider), which Play counts as collection, not sharing. All are named in the policy. |

### Data types: tick these, all "Collected", none "Shared", none "Processed ephemerally"

| Play category › type | Required or optional | Purposes to tick |
|---|---|---|
| Personal info › **Name** | Required | App functionality, Account management |
| Personal info › **Email address** | Optional | App functionality, Account management, Developer communications |
| Personal info › **User IDs** | Required | App functionality, Account management |
| Personal info › **Phone number** | Required (it is the sign-in) | App functionality, Account management, Fraud prevention / security |
| Personal info › **Other info** (CRM contacts, company GST) | Optional | App functionality |
| Financial info › **Other financial info** (invoices, payments, expenses, ledger) | Optional | App functionality |
| Messages › **Other in-app messages** (comments; WhatsApp to the business number) | Optional | App functionality |
| Photos and videos › **Photos** (avatars, bill photos) | Optional | App functionality |
| Audio › **Voice or sound recordings** (Dex, signup interview) | Optional | App functionality |
| Files and docs | Optional | App functionality |
| Calendar › **Calendar events** | Optional | App functionality |
| App activity › **Other user-generated content** (decisions, tasks, notes, reports) | Optional | App functionality |
| App activity › **App interactions** (screens opened; audit log) | Collected automatically | App functionality, Fraud prevention / security; **add Analytics only if PostHog is on in production** (decision D4) |
| App info and performance › **Diagnostics** (AI request records, PII redacted) | Collected automatically | App functionality |
| App info and performance › **Crash logs** | Only if Sentry is on in production (D4); otherwise leave unticked | App functionality |
| Device or other IDs (push token, Firebase installation ID, session user agent) | Collected automatically | App functionality, Fraud prevention / security |

**Leave unticked** (not collected): location, contacts on the device, SMS,
call logs, health and fitness, web browsing history, installed apps, user
payment info (card details exist only on the website checkout, through
Razorpay, never in the app).

## 7 · Financial features declaration

DecisionOS keeps a company's **own** books: bills, invoices, payments
received, expenses, assets and inventory. It does **not** lend, hold money,
transfer funds, process payments, invest, insure or give financial advice.
If the form lists a bookkeeping, accounting or expense-management option,
choose that. Otherwise choose **"My app doesn't provide any financial
features"** and say the above in any free-text box. Do not tick payments,
banking, loans, investments or crypto.

## 8 · The remaining declarations

| Declaration | Answer |
|---|---|
| Health apps | **Not a health app** (leave and attendance are HR records) |
| Government app | **No** |
| News app | **No** |
| COVID-19 contact tracing / status | **No** |
| Advertising ID | **No**, the app does not use it |
| Photo and video permissions | Not applicable: no `READ_MEDIA_*`; photos come through the system picker |
| Foreground service, exact alarm, full-screen intent | Not applicable: none declared |

## 9 · Permissions you may be asked about

From the merged release manifest (checked on the 1.0.4 and 1.0.5 builds; the same nine):

| Permission | Why |
|---|---|
| `RECORD_AUDIO` | speaking to Dex; asked only when the mic is first used, after a one-time notice explaining where audio goes |
| `MODIFY_AUDIO_SETTINGS` | goes with the microphone in the webview; no prompt |
| `POST_NOTIFICATIONS` | decision and task notifications; asked after an in-app explanation, not at launch |
| `VIBRATE` | the haptic tick on the Dex slider |
| `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `c2dm.permission.RECEIVE` | added by Firebase Cloud Messaging for push |
| `INTERNET` | everything |

No location, contacts, SMS, call log, storage or camera permission is
declared.
