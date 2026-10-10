# Google Play launch tracker

**Started 2026-10-09** from the founder's *Google_Play_Upload_Guide.pdf* (its
six phases and its final checklist), merged with what was still open in
[PLAY_STORE_COMPLIANCE_AUDIT.pdf](PLAY_STORE_COMPLIANCE_AUDIT.pdf) (8 Oct) and
[PLAY_STORE_READINESS.md](PLAY_STORE_READINESS.md) (29 Sep).

| Mark | Meaning |
|---|---|
| ✅ | done and checked |
| 🟡 | **needs you**: a decision, an account or a password only you can give |
| ⬜ | done in Play Console, after the account exists |

**Where things are:**

| What | Where |
|---|---|
| Signed bundle to upload | `~/Documents/DecisionOS-release-v1.0.6/DecisionOS-v1.0.6-7.aab` (+ the matching `.apk` and `SHA256SUMS.txt`). The 1.0.4 (5) and 1.0.5 (6) bundles beside it are superseded: never uploaded. |
| Listing text, App access text, tester message | [play-store/STORE_LISTING.md](play-store/STORE_LISTING.md) |
| Questionnaire answers (Data safety, rating, ads…) | [play-store/CONSOLE_ANSWERS.md](play-store/CONSOLE_ANSWERS.md) |
| Icon, feature graphic, 8 screenshots | [play-store/](play-store/) |
| Signing key | `frontend/android/release.keystore` + `keystore.properties` (gitignored) |

---

## Decisions only you can make

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| D1 | ~~Personal or Organisation developer account~~ | **Settled 2026-10-10: Organisation** (Play Console → Developer account → Account type), already paid | The 12-tester × 14-day closed test applies only to *personal* accounts created after 13 Nov 2023, so **it does not apply here**. Internal testing → pre-launch report → production, with no "apply for production access" step. |
| D2 | **The developer name** shown on the listing | The registered company name (or your own name for a personal account) | Play requires the privacy policy to name the same developer. Tell me the exact name and I'll add it to `/privacy` and `/terms`. |
| D3 | **The public demo workspace** ("Try DecisionOS on a live workspace") | Give reviewers a **dedicated reviewer account** (App access set B), and either reset the shared demo on a schedule or hide its button in the store build | It is one shared workspace anyone can write in, and it is never reset: it is seeded once and keeps whatever visitors leave. The emulator showed strangers' entries in it today ("Dispatch all stock to vendors tomorrow"). A reviewer who lands on something offensive can reject under User-Generated Content (audit C2/W9). |
| D4 | **Analytics and crash reporting in production** (PostHog `REACT_APP_POSTHOG_KEY`, Sentry `SENTRY_DSN` on Railway) | Decide on/off now and keep it that way through review | The Data safety answers change with it ([CONSOLE_ANSWERS §6](play-store/CONSOLE_ANSWERS.md)). Over-declaring is safe; under-declaring is not. |
| D5 | **Countries** | India first; add others when you are ready to support them | Pricing is **Free** (a free app can never become paid on Play). |

---

## Things only you can do

| | Item | Notes |
|---|---|---|
| 🟡 | **Back up the signing key off this Mac** | Copy `frontend/android/release.keystore` and `keystore.properties` into a password manager's secure-file slot. Right now they exist only on this laptop. |
| 🟡 | **Retire the second key** | [RELEASE_SIGNING.md](RELEASE_SIGNING.md) records two keys. This Mac holds the original (`E4:C5:7E:AD…4A:8F:30`), the one `assetlinks.json` already trusts, and it signed the 1.0.4, 1.0.5 and 1.0.6 bundles. Delete the other (`8C:56:55:CC…`) wherever it lives (the Windows machine) so it is never uploaded by mistake. |
| 🟡 | **Make `support@decisionos.biz` deliver** | The policy, the terms and the listing all point there; DPDP needs a working grievance contact. Send it a test email. |
| 🟡 | **Check `FIREBASE_SERVICE_ACCOUNT` is set on the production backend** | Without it push notifications do nothing for reviewers and testers (audit R4). |
| — | ~~Recruit 12+ testers~~ | Not required for an Organisation account. A handful of internal testers is still worth it (same message, STORE_LISTING.md). |
| ✅ | **Register, pay $25** | Done: Organisation account, on the corporate Google account. Use a Chrome profile signed in to that account only. |
| 🟡 | **Android developer verification** | Open it from the Play Console sidebar and check that nothing is pending. If it asks you to register the app: package `com.decisionos.app`, upload key SHA-256 `E4:C5:7E:AD:34:CD:99:64:29:79:62:8D:6C:02:FE:7E:5C:A0:8B:65:C3:30:6D:1B:E5:02:57:B8:75:4A:8F:30`. |

---

## Phase 1 · Developer account

| | Item |
|---|---|
| ✅ | Account created, $25 paid: **Organisation** (seen 2026-10-10) |
| 🟡 | Android developer verification: nothing pending (sidebar item) |
| ✅ | Merchant account: **not needed**. The app is free, with no in-app purchases. |

## Phase 2 · The code

| | Item | Evidence |
|---|---|---|
| ✅ | Test harder | Session fixes this week: Ask locked while Dex thinks, slide-back-to-cancel for Ask and Decide (21/21 browser checks), fixed card heights, Ask panel height. Release APK smoke-tested on the Android 16 emulator: launches in 0.3 s, no crash. |
| ✅ | No debug code or test data in the release | Shipped bundle scanned: no fixtures, dev OTP, localhost, debug attributes or source maps. **Fixed today:** the fictional fixture workspace was being bundled through the design lab's import (`fixtures/mobile/names.js` split out). |
| ✅ | `android:debuggable` absent | Not in the manifest; the release variant is not debuggable. |
| ✅ | No hidden features | Admin portal already excluded from the store build; **today the design lab too** (`App.js`). |
| ✅ | No off-Play payment | **Fixed today:** "Choose a plan" (Razorpay checkout), "or straight away on a bigger plan" and "ask us to add seats" are left out of the store build (`lib/storeBuild.js`). The website keeps them. Audit W1, plus the plan card added after the audit. |
| ✅ | Phones locked to portrait | **Fixed today.** Landscape put the dock over the Desk with nothing scrollable. Tablets still rotate (Android 16 rule). |
| ✅ | `targetSdk` / `compileSdk` **36**, `minSdk` 24 | `variables.gradle`; Play's floor since 31 Aug 2026 is 36 |
| ✅ | `applicationId` `com.decisionos.app` | unique, permanent once published |
| ✅ | `versionCode` **7**, `versionName` **1.0.6** | Defaults updated in `variables.gradle`; iOS numbers matched (`project.pbxproj`). 1.0.2 (3) and 1.0.3 (4) were sideloaded APKs only. 1.0.4 (5) and 1.0.5 (6) were built and tagged, then superseded before upload: 1.0.5 added Yokesh's audit P2/P3 fixes, and 1.0.6 adds "Your call" pinned to the decision sheet's foot and the minimal dock (2026-10-10). |
| ✅ | 16 KB page size (Android 15+ requirement) | The one native library (`libdatastore_shared_counter.so`, from Firebase) passes `zipalign -P 16` and has 16 KB-aligned LOAD segments in all four ABIs. |
| ✅ | Shrinking (`minifyEnabled`): **left off, deliberately** | Recommended, not required. 9.9 MB of dex would shrink, but R8 can strip classes Capacitor plugins reach by reflection, and that only shows up as a runtime crash. Revisit after launch, with a full test pass on the minified build. |

## Phase 3 · Graphics

| | Item | File |
|---|---|---|
| ✅ | Adaptive launcher icon | `res/mipmap-*`, matches the store icon |
| ✅ | 512 × 512 icon | `play-store/app-icon-512.png` |
| ✅ | Feature graphic 1024 × 500, no alpha | `play-store/feature-graphic-1024x500.png` |
| ✅ | Phone screenshots: 8, at 1242 × 2208, no alpha | `play-store/screenshots/`. They show the microphone features, which also answers the "website in a wrapper" review risk (audit W11). |

## Phase 4 · The signed bundle

| | Item | Evidence |
|---|---|---|
| ✅ | Signed `.aab` built with `cap:sync:prod` | `DecisionOS-v1.0.6-7.aab`, 12.9 MB, `jar verified`, signer SHA-256 `E4:C5:7E:AD…4A:8F:30`, 16 KB check passes, release scans clean |
| ✅ | Release build tested | Matching `.apk` (v2-signed, verifies) installed on the emulator. Launch, render and portrait lock checked; no crash in logcat. |
| 🟡 | Keystore backed up off the laptop | above |
| ✅ | Built from a **tagged commit** | Tag `mobile-1.0.6-build7`; the bundle in the folder is exactly that tree. (`mobile-1.0.4-build5` and `mobile-1.0.5-build6` mark the superseded builds.) |
| ⬜ | **Opt into Play App Signing** at the first upload | Irreversible, and the right choice: the key on this Mac becomes a replaceable *upload* key. |

## Phase 5 · Play Console setup

| | Item | Source |
|---|---|---|
| ⬜ | Create app: name **DecisionOS**, App, **Free**, declarations ticked | STORE_LISTING.md |
| ⬜ | Main store listing: name, short and full description, icon, feature graphic, screenshots | STORE_LISTING.md (text written, assets ready) |
| ⬜ | Store settings: category **Business**, email, website | STORE_LISTING.md |
| ⬜ | Privacy policy URL | `https://www.decisionos.biz/privacy` (live) |
| ⬜ | App access | STORE_LISTING.md, set A or B (D3) |
| ⬜ | Ads: no · Content rating · Target audience **18+** | CONSOLE_ANSWERS.md §3–5 |
| ⬜ | Data safety + deletion URL `https://www.decisionos.biz/delete-account` (live) | CONSOLE_ANSWERS.md §6 (D4 first) |
| ⬜ | Financial features · Health · Government · News | CONSOLE_ANSWERS.md §7–8 |
| ⬜ | Countries and pricing: Free; countries per D5 | — |

## Phase 6 · Testing, then release

| | Item | Notes |
|---|---|---|
| ⬜ | **Internal testing**: upload the `.aab`, release notes from STORE_LISTING.md, roll out | No review; live in minutes; up to 100 testers. Start here. |
| ⬜ | **Read the pre-launch report** a few hours later | Google runs the app on real phones and reports crashes, ANRs and accessibility issues. Fix before promoting. |
| ⬜ | After Play App Signing: copy the **app signing** SHA-256 from Setup → App integrity | Then set `ANDROID_APP_FINGERPRINT` on the web deploy to `E4:C5:…,<Play's fingerprint>` so invite links open the app from a Play install. Send it to me and I'll update DEEP_LINKS.md. |
| — | ~~Closed testing, 12 testers × 14 days~~ | Not required: Organisation account. Optional if you want a wider test group first. |
| — | ~~Apply for production access~~ | Not required: Organisation account. |
| ⬜ | **Production release**: same `.aab`, Review release, then Start rollout | First review of a new app: a few days to two weeks. |

### Closed test log (fill in as it runs)

| Date | Testers opted in | Build | Feedback received | Changed in response |
|---|---|---|---|---|
| | | 1.0.6 (7) | | |

---

## Every later upload

Bump **both** numbers in `frontend/android/variables.gradle` (and the iOS pair),
then:

```bash
cd frontend
npm run cap:sync:prod
cd android && ./gradlew bundleRelease
```

`cap:sync:prod` is not optional: it points the app at the production backend,
turns on the store build (no checkout, no admin portal, no design lab) and
prunes the marketing site from the bundle. Tag the commit you built from.
