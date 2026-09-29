# Google Play readiness — an audit before the first upload

**2026-09-29 · branch `mobile-capacitor`, release build `versionCode 1`**

Audited against what Play actually rejects for, not against code quality. The
bug report work is done and the app runs; nothing below is a bug. These are
the things that stop an upload, or get one taken down after it is live.

**Verdict: three hard blockers, none of them code you have to invent, plus one
policy risk that needs a deliberate answer.** Everything else is Console work
and an afternoon.

---

## 1 · Hard blockers — you cannot ship without these

### 1.1 There is no privacy policy

Not in the app, not on the site, not anywhere in this repository. Play makes
the privacy-policy URL a **required field** on every submission, and the Data
Safety form cross-checks against it. This is the single thing most likely to
stop the first upload dead.

It has to be a live, public URL — not a PDF, not behind a login — and it has to
actually describe what DecisionOS collects. It cannot be generic boilerplate,
because §1.3 below means the real answer is more than most templates cover.

### 1.2 There is no way for a person to delete their own account

Play's User Data policy: an app that lets people **create** an account must let
them **request deletion of that account and its data** from inside the app, and
must also publish a **web URL** that does the same without installing anything.
Both are required. Nothing in `frontend/src` does this.

The good news is that the destructive half already exists and is audited:

| Exists | Where | Who can call it |
|---|---|---|
| Delete a whole tenant and its collections | `backend/routers/admin.py` → `admin_delete_tenant` | platform admin only |
| Delete a member for good | `backend/routers/team.py` → `DELETE /users/{user_id}/forever` | tenant admin |
| Consent export | `backend/routers/admin_compliance.py` | platform admin |

So this is not "build deletion". It is "let the person themselves ask, route
it to the machinery that already exists, and put a form on the web". The real
design question is what deletion *means* for a founder who **is** the tenant —
deleting them should probably offer to delete the workspace — versus a member,
where it should not take the company's decisions with them.

### 1.3 PostHog ships unconditionally, with session recording configured

`frontend/public/index.html` initialises PostHog inline, before the app mounts,
on every launch:

```js
posthog.init("phc_xAvL…", {
  api_host: "https://us.i.posthog.com",
  person_profiles: "identified_only",
  session_recording: { recordCrossOriginIframes: true, capturePerformance: false }
})
```

Three separate problems, and I was too casual about this earlier — I described
it as "analytics that needs declaring on the Data Safety form". It is more
than that.

**It is session replay on a business product.** If recording is on in the
PostHog project, what is captured is the founder's screen: decision text,
money figures, supplier names, staff names. That is not "usage analytics", and
declaring it as such on the Data Safety form would be a false declaration —
which is itself a removable offence.

> Check this before anything else: the snippet *configures* session recording
> but does not enable it. Recording is switched on per project in PostHog
> (Settings → Session Replay). **Go and look at whether it is on.** The answer
> changes what you must declare and what you must ask consent for.

**It is a third-party script loaded at runtime.** The snippet fetches
`array.js` from PostHog's asset host on launch, so a third party executes code
inside your app and sees every user's IP.

**It fires with no consent.** The app already has a DPDP consent mechanism —
but it gates the **AI**, not analytics. Under India's DPDP Act, a founder's
personal data leaving to a US processor without notice or consent is a problem
independent of anything Google thinks. The consent scaffolding exists
(`/tenant/ai-consent`, `admin_compliance.py`); analytics was simply never put
behind it.

Pick one, deliberately:

- **Turn it off for the app build** — cleanest for the pilot, one condition in
  `index.html`. You lose mobile analytics.
- **Keep events, kill replay** — declare "app interactions", no screen content.
- **Keep replay** — then it needs consent before init, masking of every money
  and name field, and a privacy policy that says so plainly.

---

## 2 · Also required before upload — Console work, not code

| # | Item | State |
|---|---|---|
| 2.1 | **Upload an `.aab`, not an `.apk`** — Play has not accepted APKs for new apps since 2021 | ✅ `./gradlew bundleRelease` works today, 11.0 MB, signed |
| 2.2 | **Play App Signing** — opt in; Google holds the real key and the one in this repo becomes a replaceable *upload* key | decision not made — see [RELEASE_SIGNING.md](RELEASE_SIGNING.md) |
| 2.3 | **Back up the keystore off the laptop** | not done, and it exists in one place |
| 2.4 | **Data Safety form** | not started; §1.3 decides half of it |
| 2.5 | **Content rating questionnaire** | not started — a business tool rates trivially |
| 2.6 | **Target audience** — declare 18+, no children | not started |
| 2.7 | **Store listing** — 512px icon, feature graphic, ≥2 phone screenshots, short + full description | not started |
| 2.8 | **`versionCode` discipline** — every upload needs a higher one; it is hardcoded `1` in `app/build.gradle` | fine for upload #1, will bite on #2 |
| 2.9 | **App access instructions** — credentials for the reviewer | **already solved, see below** |

### 2.9 is worth calling out, because it is usually the worst one

Login-gated apps get rejected constantly because the reviewer cannot get in —
and DecisionOS signs in by **OTP to an Indian mobile**, which a reviewer in
another country cannot receive.

You already have the answer: **"Try DecisionOS on a live workspace"** on the
sign-in screen signs in as a role in one tap, no OTP, and B20 now marks that
workspace as a demo. Put those tap-by-tap instructions in the "App access"
section of the Console and this problem disappears. It is genuinely the
strongest thing in this whole audit.

---

## 3 · The real policy risk: "minimum functionality"

Play's Spam & Minimum Functionality policy targets apps that are a website in
a wrapper with nothing native about them. A Capacitor app is exactly the shape
reviewers apply it to, so it is worth knowing where you stand.

**What defends this app:**

| Native capability | Status |
|---|---|
| Microphone — Dex voice capture | shipped, `RECORD_AUDIO` declared (B02) |
| Hardware/gesture back handled properly | shipped (MOBILE-2) — this is the most visible "it behaves like an app" signal |
| Offline state instead of a broken page | shipped (B04) |
| App Links — invites open the app | built, one config value short (B19) |
| Push notifications | **not built** ([PUSH_NOTIFICATIONS_ASK.md](PUSH_NOTIFICATIONS_ASK.md)) |

That is a reasonable defence today, and the microphone is the strongest single
item. **Push would make it comfortable** rather than merely reasonable, which
is a better argument for doing B33 than "it would be nice to have".

Practical move: put the microphone and the offline behaviour in the store
screenshots. Reviewers look at listings.

---

## 4 · Clean — no action

Genuinely good, and worth knowing so nobody "fixes" it:

- **Permissions are minimal**: `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`,
  and nothing else. **No `AD_ID`**, no location, contacts, storage or SMS. That
  avoids a whole class of declarations.
- **The production bundle carries no development code.** Checked the shipped
  asset bundle for `resolveFixture`, `activeFixture`, `__DOS_FIXTURE_CALLS`,
  `dev_otp`, `DEV_OTP`, `localhost:8000`, `10.0.2.2` — **zero hits on all
  seven**. The `NODE_ENV` guards work.
- `targetSdk 36` / `minSdk 24` — comfortably inside Play's window.
- `allowBackup="false"` with extraction rules (B08).
- Cleartext is debug-only; the release build cannot make a plaintext request.
- Release is signed (v2, `CN=DecisionOS`), 11.1 MB APK / 11.0 MB AAB.
- Adaptive launcher icons and `app_name` present.
- No financial-services features in the Play sense — the app tracks a
  business's own money, it does not lend, invest or transfer. Expect the
  Console to ask; the answer is no.

---

## 5 · Verify on a real device

**Predictive back.** Apps targeting SDK 35+ get the predictive back gesture
from the platform, and nothing in the manifest sets
`enableOnBackInvokedCallback` either way — so the platform default applies.
Back *works* (verified on the Android 16 emulator, and it is the fix you asked
for first), but predictive back also draws a **preview of the app closing**
while your thumb is still down. If the JS handler then cancels the exit and
navigates instead, you may see the home screen peek through and snap back.
Functionally correct, visually odd. Worth one look on a real phone; if it
looks wrong, it is a one-line manifest change.

**Fonts on a cold, offline first launch.** Urbanist and IBM Plex Mono come from
Google Fonts at runtime — nothing is bundled — so a never-online first launch
renders in the system font, and every cold start waits on a third-party
request. It is also one more entry for the Data Safety form. Bundling them is
contained and strictly better for a native app.

---

## 6 · The order I would do it in

1. **Look at whether PostHog session replay is actually on.** One click, and it
   decides §1.3, the privacy policy and the Data Safety form.
2. **Decide the analytics posture** (off / events only / consented replay).
3. **Write the privacy policy** — it can only be written truthfully after 1–2.
4. **Build self-service account deletion** — in-app, plus a web form. The
   backend half exists.
5. Back up the keystore; opt into Play App Signing.
6. Console: Data Safety, content rating, target audience, listing assets, and
   the demo-login instructions under App access.
7. Upload the `.aab` to **internal testing** first, and read the pre-launch
   report — it runs the app on real devices and catches crashes and
   accessibility findings before a human reviewer sees it.

Items 1–4 are the ones with real thinking in them. 5–7 are an afternoon.
