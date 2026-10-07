# B33 · Push notifications — what it takes

**For:** Yokesh (backend) + whoever holds the Google account
**From:** B33, the Android bug report · **Date:** 2026-09-29

---

## UPDATE 2026-10-05 — now IMPLEMENTED (Android), switch-on pending

The code below is written and verified on the emulator. What the original ask
said needs doing first (a Firebase project + `google-services.json`) is done:
the project is `decisionos-5ddd4`, the file is at
`frontend/android/app/google-services.json` (package `com.decisionos.app`).

**What was built (all guarded — the app behaves exactly as today until switched on):**

- **Client** — `@capacitor/push-notifications@8.1.3` installed; new leaf
  `frontend/src/lib/native/push.js` (asks permission on sign-in, registers,
  POSTs the token to `/api/devices`, routes a tapped notification via
  `notifLink()`); mounted in `hooks/useNativeBack.js`; token cleared on
  sign-out in `context/AuthContext.js`; `POST_NOTIFICATIONS` declared in the
  Android manifest (the plugin does not).
- **Server** — `routers/devices.py` (`POST`/`DELETE /api/devices`, stored in a
  `device_tokens` collection, one row per install); `services/push_fcm.py`
  (firebase-admin sender, prunes dead tokens, **no-op without a credential**);
  a fan-out call added to the single choke-point
  `services.notifications.push_notification()`, so **every** notification type
  already in the product (all the Work status-changes, approvals, leave,
  decisions, finance) becomes a device push; `firebase-admin==6.5.0` in
  requirements.

**Verified on a fresh release install (emulator with Google Play Services):**
builds clean with the plugin + firebase-messaging + google-services; Firebase
initialises at runtime (`FirebaseApp initialization successful`); the
notification-permission prompt shows and grants; no crash. The FCM token value
is not observable in a release webview, and the backend sender is still off, so
storage + delivery verify once the two switch-on steps below are done.

**To switch it on (the only things left, both needing credentials I can't create):**

1. **Backend credential** — generate a Firebase **service-account key** and set
   it on Railway as `FIREBASE_SERVICE_ACCOUNT` (the JSON, inline). Secret —
   env only, never the repo. Then `pip install -r requirements.txt` picks up
   firebase-admin, and **deploy** so `/api/devices` exists and the sender runs.
2. **iOS** — still untouched: needs an Apple Developer account, an APNs key
   uploaded to the same Firebase project, `GoogleService-Info.plist` in the iOS
   project, the Push + Background-Modes capabilities, and a real iPhone to test.

**Decisions still open from the original ask:** permission is currently asked on
first sign-in (not "after the first approval" as suggested below); no quiet-hours
suppression yet; push currently mirrors *every* notification (not the tight
three-event v1 below). All easy to narrow later.

---

## Where this stands

Everything else in the bug report is fixed or has a written ask. This one has
**no code at all**, deliberately, and that is the honest thing to report.

Push cannot be written blind. It needs a Firebase project and a
`google-services.json` before a single line can be run, let alone tested — and
scaffolding that nobody can execute is worse than an empty folder, because it
looks finished and rots. What follows is the whole shape so that when the
credentials exist this is a day's work, not a week's.

## Why it matters more than its P3 suggests

Today DecisionOS only tells you anything while you have it open. A decision
routed to a founder at 9pm waits until they next open the app. The report filed
this as polish; for an operations product it is closer to the point. It is also
half of guideline 4.2 — "device features genuinely used" is the argument that a
web-based app is a real app, and push is the loudest one.

## What has to exist first (not code)

1. **A Firebase project** on the company Google account, with an Android app
   registered as `com.decisionos.app`.
2. **`google-services.json`** from that project, dropped at
   `frontend/android/app/google-services.json`. The build already looks for it
   — `app/build.gradle` applies the google-services plugin only when the file
   is present, and logs "Push Notifications won't work" when it is not. Nothing
   needs changing there.
3. **A service account key** for the backend to send with (Firebase Admin SDK),
   kept out of the repo like every other secret.
4. For iOS, later: an APNs key from the Apple developer account, uploaded to
   the same Firebase project.

`google-services.json` is not a secret in the usual sense — it ships inside the
APK — but the **service account key is**, and it must never reach the client or
the repository.

## The client half

```bash
npm i @capacitor/push-notifications && npx cap sync
```

A small module beside the two that already exist — `lib/native/back.js` and
`lib/native/links.js` — following the same shape: inert in a browser, one
`start…` function, mounted once in `hooks/useNativeBack.js`.

- Ask permission **at the moment it earns it**, not on first launch: after the
  founder approves their first decision, which is when "tell me when one needs
  me" is a sentence they would agree with. A permission asked on launch is the
  one people refuse.
- On `registration`, POST the token to the backend with the platform.
- On `pushNotificationActionPerformed`, route to the screen the notification is
  about — the routing already exists in `lib/native/links.js`; a notification
  carries a `path` in its data and goes through `inAppPath`.
- Clear the badge on resume.

## The server half

**One endpoint to register a device:**

```
POST /api/devices          { token, platform: "android" | "ios" }
DELETE /api/devices/{token}
```

- Scoped to the signed-in user and tenant, like everything else.
- A token is per install, not per user: the same phone signing in as somebody
  else must not keep the old registration. Delete the user's tokens on sign-out
  (`/auth/logout`) — otherwise the next person on a shared phone gets the
  previous person's approvals on their lock screen, which is the mobile version
  of the bug JOURNEY-1 J12 already fixed for drafts.
- FCM rejects dead tokens with `UNREGISTERED`; delete on that, or the table
  grows for ever.

**Three events, and only three for v1:**

| Event | Goes to | Why this one |
|---|---|---|
| A task is assigned to you | the assignee | the whole product is work reaching a person |
| An approval is waiting on you | the approver | the thing that blocks everybody else |
| A decision is routed to you to decide | the decider | same |

Each carries `path` so the tap lands on the right screen: `/my-work?task=…`,
`/inbox?decision=…`.

Resist adding more. A notification people swipe away is worse than no
notification, and the fourth one is where that starts.

**Quiet hours.** These founders are in one timezone and the tenant already
knows its `region`. Nothing between 21:00 and 07:00 local except an escalation.

## What it does NOT need

- No new background service. FCM delivers whether the app is running or not.
- No change to the web app. Browser push is a different mechanism and is not
  worth it here — the pilot is on a phone.
- No change to the notification records already in the database. Push is a
  second delivery channel for events that are already written; the bell and
  `/notifications` stay exactly as they are, which is also what makes this
  testable — the event fires either way, and push either reaches the phone or
  does not.

## How to tell it works

- A test send from the Firebase console reaches a real device.
- Assigning a task to a second phone raises a notification within seconds, and
  tapping it opens that task rather than the Desk.
- Signing out stops them arriving on that device.
- The Play Data Safety form is updated: a device token is an identifier, and it
  has to be declared. (While you are in there — the app already calls PostHog
  on launch, which also needs declaring.)
