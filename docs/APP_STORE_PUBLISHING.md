# Publishing DecisionOS to the App Store — the steps

**Written 2026-09-29.** The companion to
[APP_STORE_READINESS.md](APP_STORE_READINESS.md), which says what would get you
rejected. This one is the running order, starting from a Mac with no Xcode on
it.

Console UIs move. Where a menu path is given, it is a signpost, not a promise.

**Read this first:** the code side is done — usage strings, privacy manifest,
`CFBundleIconName`, the icon, the scaffold defaults, all committed and verified.
What is left is a machine, an account, and forms. But **nothing on iOS has ever
been compiled**, so budget for step 4 to find bugs the way the Android build
did.

---

## 0 · What this costs, and what it does not

| For | Account | Cost |
|---|---|---|
| Install Xcode | any Apple ID | free |
| Build and run in the **simulator** | nothing extra | free |
| Install on **your own iPhone** | any Apple ID | free |
| `.ipa` for **TestFlight** or the **App Store** | Apple Developer Program | **$99/year** |

The middle two matter more than they look. **You can put the app on a real
iPhone today, for free**, while the paid enrolment is still processing — see
step 4. That is the fastest way to answer the biggest open question in this
project, which is whether the iOS build works at all.

---

## 1 · Free up disk space

Xcode needs roughly **40 GB** during installation — the download is 10–17 GB
and expands. As of 2026-09-29 this Mac had **31 GB free**, which is not enough;
the install will fail partway.

```bash
df -h /
```

Also worth knowing: this is an **Intel** Mac on macOS 15.7. Xcode 16 supports
Intel, so you are fine — but it is the last generation that does, and iOS
builds are markedly slower than on Apple Silicon.

---

## 2 · Install Xcode

**Mac App Store → search Xcode → Get.** Free, and any Apple ID works. No paid
membership needed for this step.

It is a long download. When it finishes, open it once so it can install the
additional components it asks for, then point the command-line tools at it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

That last command currently fails on this machine — it is how you will know the
install worked.

---

## 3 · Enrol in the Apple Developer Program — start this now

developer.apple.com/programs → Enrol. **$99/year.**

**Do this in parallel with everything else.** It is the longest-lead item in
the whole project:

- **Individual**: often same-day.
- **Organisation**: needs a **D-U-N-S number** and verification of your legal
  entity, and takes **days, sometimes weeks**. Apple may telephone to verify.

Choose deliberately. An organisation account lists the company as the seller
and lets several people share access; an individual account lists your own
name. Switching later means transferring apps between accounts.

Nothing can reach TestFlight or the App Store until this completes.

---

## 4 · Build to your own iPhone — free, and do it before enrolment lands

This costs nothing and needs no paid account. Do it as soon as Xcode is
installed.

```bash
cd frontend
npm install
npm run cap:sync:prod
npx cap open ios
```

Two things that waste an afternoon if you do not know them:

- **`npm install` is not optional.** `CapApp-SPM/Package.swift` depends on
  `@capacitor/app` by a *relative path into `node_modules`*. A fresh clone
  without it fails Swift package resolution with an error that never mentions
  npm.
- **`cap:sync:prod`, never plain `cap:sync`.** The plain one reads
  `frontend/.env`, which says `http://localhost:8000` — and on a phone,
  localhost is the phone. Every API call would fail.

In Xcode:

1. Plug in your iPhone; trust the Mac when it asks.
2. Select the **App** target → **Signing & Capabilities**.
3. **Team** → *Add an Account…* → sign in with your ordinary Apple ID → pick
   the "(Personal Team)" that appears.
4. Select your iPhone as the run destination and press **Run**.
5. On the phone: **Settings → General → VPN & Device Management** → trust the
   developer certificate.

The app installs and runs properly. The free-tier caveats are that the
certificate **expires after 7 days** (re-run from Xcode to renew) and one Apple
ID can provision three apps at a time.

**Walk [ANDROID_TEST_CHECKLIST.md](ANDROID_TEST_CHECKLIST.md) on it.** Every
finding from the Android round — `CapacitorHttp` getting past CORS, the
service-worker fix, the microphone, the offline state — is *assumed* on iOS,
never verified. WKWebView is a different engine from Android's Chromium
WebView and the two disagree regularly. Expect a crop of bugs. That is normal
and it is why this step exists.

---

## 5 · Create the App ID and the App Store Connect record

Once enrolment completes.

**appstoreconnect.apple.com → My Apps → + → New App.**

| Field | Answer |
|---|---|
| Platform | iOS |
| Name | DecisionOS |
| Primary language | English (India) or English (U.K.) |
| Bundle ID | `com.decisionos.app` |
| SKU | anything internal, e.g. `decisionos-ios-01` |
| User access | Full Access |

If the bundle ID is not in the dropdown, register it first at
developer.apple.com → Certificates, Identifiers & Profiles → Identifiers.

The name is limited to 30 characters and must be unique across the entire App
Store.

---

## 6 · Archive and upload

Back in Xcode, with **Team** now set to your paid team rather than the personal
one:

1. Destination: **Any iOS Device (arm64)**. An archive cannot be made against a
   simulator — the option is greyed out otherwise, and this is the usual reason
   people think Archive is broken.
2. **Product → Archive.**
3. In the Organizer: **Distribute App → App Store Connect → Upload.**
4. Leave automatic signing on; let Xcode manage the distribution certificate
   and provisioning profile.

Xcode validates before it transmits. Everything it fails on is already in place
and was verified on 2026-09-29: `CFBundleIdentifier`,
`CFBundleShortVersionString`, `CFBundleVersion`, `CFBundleIconName`,
`ITSAppUsesNonExemptEncryption`, the three usage descriptions, and
`PrivacyInfo.xcprivacy` in Copy Bundle Resources.

`ITSAppUsesNonExemptEncryption = false` is why it will not stop to ask you the
export-compliance question.

Processing takes **5–15 minutes** after upload before the build appears.

---

## 7 · TestFlight internal testing

**App Store Connect → your app → TestFlight.**

1. **Internal Testing** → create a group → add testers. Internal testers must
   be members of your App Store Connect team; up to 100.
2. Assign the processed build to the group.
3. Testers install the **TestFlight** app from the App Store and accept the
   invitation.

**Internal testing needs no review**, so builds are available in minutes.
External testing (up to 10,000 people, no team membership needed) does get a
review, though a lighter one than App Store submission.

This is what you want rather than a development install: it is the same
binary, signing and upload pipeline you will use to submit, so it proves the
whole path rather than just the app.

---

## 8 · The App Store listing

**App Store Connect → your app → the version → App Information / Pricing /
Prepare for Submission.**

| Item | Spec | State |
|---|---|---|
| Screenshots | **6.7"** and **6.5"** iPhone, ≥1 each | not captured |
| Description | up to 4000 chars | to write |
| Keywords | 100 chars, comma separated | to write |
| Support URL | a reachable page | `https://www.decisionos.biz` |
| Privacy policy URL | required | `https://www.decisionos.biz/privacy` |
| Age rating | questionnaire | business tool — rates trivially |
| Category | Business or Productivity | pick one |

### The privacy nutrition label

**App Privacy → Get Started.** Same substance as Play's Data Safety form, asked
differently, and the answers are already written down in
[PRIVACY.md](PRIVACY.md). Keep the two consistent — they describe one product,
and `ios/App/App/PrivacyInfo.xcprivacy` is the machine-readable version of the
same thing.

You will be asked whether you track users across other companies' apps and
sites. **The answer is no** — no IDFA, no ad SDK, and PostHog ships with
autocapture and session replay off. That is why the app needs no App Tracking
Transparency prompt. It is *not* a reason to declare nothing: analytics, IP and
device data are still collected and must be listed.

### Account deletion

Apple requires an in-app route (Guideline 5.1.1(v)). It exists: **Settings →
Account → Delete your account**, backed by `backend/routers/account.py`. Say so
in the review notes.

---

## 9 · App Review Information — the field that decides your first review

Still under **Prepare for Submission**, near the bottom.

DecisionOS signs in by **OTP to an Indian mobile number**. A reviewer in
California cannot receive one. This single field is the most common reason
login-gated apps are rejected, and you have the answer already.

Tick **Sign-in required** and write the taps out:

> 1. Open the app.
> 2. On the sign-in screen, tap **"Try DecisionOS on a live workspace"**.
> 3. Choose any role. You are signed in — no code, no password needed.
>
> Account deletion is at Settings → Account → Delete your account, and also at
> https://www.decisionos.biz/delete-account

Add a note about the microphone too, since it is the feature most likely to be
probed and the one that best answers Guideline 4.2:

> Tap the microphone on the Desk screen to capture a decision by voice. iOS
> will ask for microphone permission the first time.

---

## 10 · Submit, and what will be argued about

**Add for Review → Submit.** First reviews typically take **24–48 hours**.

The rejection to expect is **Guideline 4.2, Minimum Functionality** — Apple
applies it to webview-wrapped apps and is considerably stricter than Google.
[APP_STORE_READINESS.md §3](APP_STORE_READINESS.md) sets out where you stand.
The short version: the microphone and native voice capture are the strongest
defence, the offline state helps, and push notifications would make the
argument comfortable rather than merely reasonable.

If it is rejected on 4.2, do not re-submit the same binary with an appeal.
Reply in Resolution Center naming the native capabilities specifically, and put
the microphone in the screenshots.

---

## 11 · Every upload after the first

`CFBundleVersion` must increase for each upload against the same
`CFBundleShortVersionString`. Both live in the Xcode build settings:

| Setting | Now | Android equivalent |
|---|---|---|
| `MARKETING_VERSION` | `1.0.1` | `appVersionName` |
| `CURRENT_PROJECT_VERSION` | `2` | `appVersionCode` |

They are **matched by hand** — Android reads its pair from
`android/variables.gradle` with an environment override; iOS has no equivalent,
deliberately, because one could not be tested without Xcode. Bump both
platforms together.

And per [DECISIONOS_MOBILE_APP_PLAN.md](DECISIONOS_MOBILE_APP_PLAN.md), every
store build comes from a tagged commit.

---

## The short version

1. Free up disk — you need ~40 GB, you had 31
2. Install Xcode (free Apple ID)
3. **Enrol in the Developer Program now** — days to weeks, runs in parallel
4. **Build to your own iPhone free, today** — and find the iOS bugs
5. Create the App Store Connect record
6. Archive → upload
7. TestFlight internal
8. Listing: screenshots, description, nutrition label
9. **App Review notes: the demo-login taps**
10. Submit; expect a 4.2 conversation

Steps 3 and 4 are the ones to start first — one because it is slow, the other
because it is free and answers the most important unknown.
