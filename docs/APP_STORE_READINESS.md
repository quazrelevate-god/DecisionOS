# Apple App Store readiness — an audit before the first upload

**2026-09-29 · branch `mobile-capacitor`, commit `0ac7f00`**

The sibling of [PLAY_STORE_READINESS.md](PLAY_STORE_READINESS.md), which covers
Google Play and is in good shape. This one covers Apple, which is **not**.

For the running order rather than the audit — from installing Xcode to
submitting — see [APP_STORE_PUBLISHING.md](APP_STORE_PUBLISHING.md).

Audited the same way: against what Apple actually rejects for, not against code
quality. Everything below was read out of `frontend/ios/` and `frontend/src/`
on the current branch.

**Verdict as first written: four hard blockers, none started.**
**All four were closed on 2026-09-29** and are struck through below — the three
crashing permission strings, the privacy manifest, the scaffold defaults, and
the placeholder icon (on both platforms).

**What remains is not code.** An Apple Developer account, an Xcode build, and
App Store Connect. Those are in §6, and item 1 is pure calendar: enrolment can
take days, and nothing can be submitted until it exists.

The caveat in §0 still stands in full and is the most important thing in this
document: **none of this has been compiled.**

Read §1 before planning any App Store date.

---

## R · Re-audit, 2026-10-14 — read this first

Everything below §R is the 29–30 Sept audit, kept as history. Since then the
app has been redesigned, the iOS build compiles and runs (iPhone 17 Pro
simulator, iOS 26.5 — §7.1's hang is gone), and 1.0.7 removed the in-app demo
login. This section re-checks every item against Apple's requirements **as of
14 Oct 2026** (sources: developer.apple.com — App Review Guidelines, last
updated 8 Jun 2026; Upcoming Requirements; App Store Connect Help).

**Verdict: no code blockers left. What stands between this build and review is
a production deploy, a reviewer account, and App Store Connect.** All checks in
R.1 are now pinned by `backend/tests/test_the_ios_app_is_ready_for_the_app_store.py`.

### R.1 · Verified compliant

| Requirement | Rule | State |
|---|---|---|
| Built with Xcode 26 / iOS 26 SDK | mandatory since 28 Apr 2026 | Xcode 26.6 ✓ |
| Deployment target ≥ iOS 13 | since 9 Sep 2026 | 15.0 ✓ |
| UIScene life cycle | mandatory from the iOS 27 SDK (TN3187) | scene manifest + SceneDelegate ✓ |
| Purpose strings: microphone, camera, photo library | 5.1.1(ii) — missing = crash | specific wording ✓ |
| No speech-recognition / location strings needed | | transcription is server-side; no location ✓ |
| `ITSAppUsesNonExemptEncryption = false` | export compliance | HTTPS only ✓ |
| 1024×1024 icon, no alpha; `CFBundleIconName` | upload validation | ✓ (Icon Composer layers are optional) |
| Launch storyboard | since 2020 | ✓ |
| iPhone-only, portrait, arm64 | 2.4.1 — graded on what you declare | ✓ |
| `PrivacyInfo.xcprivacy` bundled; required-reason APIs | since 1 May 2024 | UserDefaults CA92.1; Capacitor core and all five plugins checked — no other reason APIs ✓ |
| Capacitor/Cordova SDK manifests + signatures | third-party SDK list | shipped by capacitor-swift-pm 8.5.2 ✓ |
| No downloaded/executed code | 2.5.2 | web assets bundled; remote URL only for dev live-reload ✓ |
| In-app account deletion, for owners **and** staff | 5.1.1(v) | Preferences → Delete your account, plus `/delete-account` ✓ |
| Sign in with Apple not required | 4.8 — own sign-in only | email/password + mobile OTP ✓ |
| Nothing sold or pointed to in the app | 3.1.1 / 3.1.3(c) | `STORE_BUILD` hides every plan picker and "choose a plan" line ✓ |
| Reviewer can sign in without an Indian SMS | 2.1 | Password tab on the sign-in screen ✓ (account still to create — R.3) |
| AI: disclose providers + explicit permission | **5.1.2(i), changed 13 Nov 2025** | signup consent names them; workspace "Agree and turn on" now names them too (R.2); per-person mic notice names the speech providers ✓ |
| AI answers can be reported | 1.2 / AI safety | every answer has Report ✓ |
| Privacy policy in the app and on the web | 5.1.1(i) | `/privacy` names every processor incl. AI and speech ✓ |
| Push not prompted on iOS | 4.5.4 | iOS returns before the prompt (`push.js`) ✓ |

### R.2 · Fixed on 2026-10-14

1. **Privacy manifest was missing two data types** — *Photos or Videos* (bill
   and receipt photos are uploaded) and *Other Diagnostic Data* (AI request
   records, already declared in the Play Data Safety form). Added; `plutil` OK.
2. **The microphone "denied" message sent iPhone users to Android Settings**
   (`lib/native/mic.js`) — wrong on iOS and a 2.3.10 "names another platform"
   risk. Each platform now gets its own path.
3. **Terms said plans are "bought outside the Android app."** Now
   platform-neutral: "arranged with the company directly; nothing is sold
   inside the app."
4. **The privacy policy called itself the policy for "the app for Android"**
   and pointed to "its Google Play listing". Now "the DecisionOS mobile app"
   and "its app store listings". (The push paragraph still says Android — it
   is the truth, push is Android-only.) Both "Last updated" dates moved to
   14 Oct 2026; `TERMS_VERSION` deliberately not bumped — the meaning did not
   change, so nobody is made to re-accept.
5. **The workspace AI consent card did not name the providers.** It now says
   what is sent (typed text, voice, photos/documents, the records involved)
   and to whom (Anthropic, OpenAI, Google Gemini; Sarvam and OpenAI for
   speech), with a link to the policy. This card is the consent a reviewer
   meets — the review account never sees signup.
6. **"AI is off… Turn it on in Settings"** now says *Preferences* on a phone,
   the name that screen has there.
7. (2026-10-13) **iOS 26 WebKit zooms boxes but not text** — every word was
   25% too big; the app now falls back to a pinned, scaled viewport there
   (`hooks/useUiScale.js`). Without it the Desk showed one row instead of three.

### R.3 · Before you press Submit (not code)

1. **Deploy the current frontend to production first.** `https://www.decisionos.biz/guide/`
   still serves the app shell, not the guide — so in the app "Help & guide"
   opens the wrong page (a 2.1 completeness risk), and the guide's contact
   section is what the Support URL should point at. The privacy/terms
   wording above also only reaches the store-linked URLs by deploying.
2. **Accept the updated Apple Developer Program License Agreement**
   (13 Oct 2026) — the Account Holder must, or the account stops working.
3. **Create the App Review account in production** — owner, email +
   password, a fictional business with enough data that every screen has
   something on it (never the pilot client's). Decide its AI consent:
   *recommended* **off**, so the reviewer meets the disclosure — the first Dex
   use offers "Turn on AI", which opens the card above; say so in the notes.
4. **Build the release from a clean sync.** `frontend/ios/App/App/public`
   currently holds a *local test* build (localhost:8001). Run
   `npm run cap:sync:prod`, bump **both** platforms to the next version
   (1.0.8 / 9 — `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` and
   `variables.gradle`; the test enforces they match), set the Team, archive.
5. **Expect one upload warning:** *ITMS-90078 Missing Push Notification
   Entitlement*. The push plugin is linked but iOS push is not built (it needs
   an APNs key and either Firebase's iOS SDK or a direct APNs sender — the
   backend sends via FCM). A warning, not a rejection; iOS push is a separate
   piece of work.
6. **App Store Connect:**
   - **App Privacy:** Contact Info (name, email, phone), Audio Data, Photos or
     Videos, Other User Content, Other Financial Info, User ID, Device ID,
     Product Interaction, Other Diagnostic Data — all *linked*, none
     *tracking*. Mirror `PrivacyInfo.xcprivacy`.
   - **Age rating** (new 4+/9+/13+/16+/18+ questionnaire): no unrestricted web
     access (the in-app browser only opens our guide); generative AI — answer
     honestly that an AI assistant produces text, with reporting in place.
   - **Category:** Business (secondary: Productivity).
   - **URLs:** privacy `https://www.decisionos.biz/privacy`, support
     `https://www.decisionos.biz/guide/#contact` (after step 1).
   - **EU DSA trader status — mandatory to declare.** A company selling SaaS
     is a trader, which publishes an address, phone and email on the EU
     product page. Simplest first launch: **India only**, and declare.
   - **Screenshots:** 6.9" (1320×2868, iPhone 17 Pro Max) and 6.3"
     (1206×2622, iPhone 17 Pro) — both simulators are on this Mac.
   - **Content rights:** no third-party content.
7. **Optional:** Accessibility Nutrition Labels (voluntary for now).

### R.4 · The two judgement calls Apple could make

- **4.2 minimum functionality** — a Capacitor app is the shape reviewers
  test for "repackaged website". Lead with what is native: speaking to Dex
  through the microphone, photographing bills and proof with the camera,
  haptics, the screen blanking at your ear while you dictate (proximity
  sensor), the swipe-to-talk dock control, the in-app guide. Put the
  microphone in the first screenshot.
- **3.1.3(c) enterprise services** — the app is sold to businesses for their
  staff, outside the app, and the app sells nothing. A solo owner signing up
  is the grey area; say plainly in the notes that plans are arranged with
  companies and nothing can be bought in the app.

### R.5 · Draft App Review notes

> DecisionOS is a business operations app for Indian small and mid-sized
> companies, used by an owner and the staff they invite. It is sold to
> companies directly under a business agreement (Guideline 3.1.3(c)); nothing
> can be bought inside the app and the app links to no purchase flow.
>
> **Sign in:** on the sign-in screen tap **Password**, then use
> email `[reviewer account]` / password `[password]`. (Mobile-number sign-in
> sends an SMS code to Indian numbers only.)
>
> **AI consent:** AI features are off for this workspace until an owner
> agrees. The first time you ask Dex anything you will be offered **Turn on
> AI**; the screen names the AI providers (Anthropic, OpenAI, Google Gemini,
> and Sarvam/OpenAI for speech) and what is sent, before you agree. It can be
> turned off again at More → Preferences → AI processing.
>
> **To try:** swipe the round button in the dock to the right and say a
> decision out loud — Dex turns it into tasks, owners and dates for you to
> approve (swipe left instead to ask a question; slide back to the middle to
> cancel). Open a decision from the Desk and approve it; add an expense in
> Money and attach a photo of the bill; Help & guide is under More →
> Preferences.
>
> **Account deletion:** More → Preferences → Delete your account.

---

## 0 · Nothing on iOS has ever been built

> **Updated 2026-09-30.** The machine has changed since this was written, and
> two of the three things below are no longer true. **Xcode 26.6 is installed**
> (licence accepted, first-launch complete) and **iOS 26.5 simulators exist**
> (iPhone 17 Pro, 17 Pro Max, 17e, 17, Air). **CocoaPods is irrelevant** — this
> project is Swift Package Manager: there is no Podfile, there is
> `App/CapApp-SPM/Package.swift`, and its relative path into `node_modules`
> resolves.
>
> **It still has not compiled**, for a new reason, and that reason is now the
> blocker — see §7.1. The paragraph below stands as written on the day, and
> everything it says about iOS findings being *assumed* rather than verified is
> unchanged and still the most important thing here.

There is no Xcode on the machine this branch has been developed on — Command
Line Tools only, zero simulators, no CocoaPods. So:

- the iOS project has **never been compiled**;
- the app has **never launched** on an iPhone or a simulator;
- none of the Android findings (which were all found *by running it*) have been
  checked on iOS.

Everything Android-side that was proven by running the app — `CapacitorHttp`
getting past CORS, the service-worker bug, back-gesture handling, the
microphone — is **assumed** on iOS, not verified. WKWebView is a different
engine from Android's Chromium WebView, and the two disagree regularly.

Budget for the first iOS build to surface its own crop of bugs, the way the
Android one did. Do not plan as though Android's testing transfers.

---

## 1 · Hard blockers

### 1.1 ~~The microphone will crash the app~~ — FIXED 2026-09-29

`NSMicrophoneUsageDescription`, `NSCameraUsageDescription` and
`NSPhotoLibraryUsageDescription` are now in `Info.plist`, each written to say
what the app does with the data rather than restating the permission — Apple
rejects vague strings. `plutil -lint` passes and the keys survive `npx cap
sync`, which was checked rather than assumed.

The original finding, for the record:

`Info.plist` contained **no `NSMicrophoneUsageDescription`**. The app records
audio in two places — `src/components/MicDictateButton.js` and
`src/hooks/useDexCapture.js`, both `getUserMedia` + `MediaRecorder`.

On iOS this is not a denied permission. Requesting a protected resource with no
usage-description string is an **immediate, uncatchable crash** — the system
kills the process. The first reviewer who taps the Dex microphone gets a
crash-on-launch-of-the-main-feature, which is a rejection under Guideline 2.1
and the fastest possible way to fail review.

`RECORD_AUDIO` was declared on Android (B02). The iOS equivalent was never
added.

### 1.2 ~~The camera and photo library will crash it too~~ — FIXED 2026-09-29

Same mechanism, same result:

| Missing key | Triggered by |
|---|---|
| `NSCameraUsageDescription` | `capture=` inputs — `src/pages/MyWork.js`, `src/pages/Brain.js` |
| `NSPhotoLibraryUsageDescription` | `accept="image/*"` — `src/components/DexCaptureBar.js`, `src/components/mobile/DexChat.jsx` |

Bill and receipt capture is a headline feature. It crashes.

### 1.3 ~~There is no privacy manifest~~ — FIXED 2026-09-29

Apple has required **`PrivacyInfo.xcprivacy`** in the app bundle since 1 May
2024. Without it, App Store Connect rejects the upload before a human sees it.

It must declare:

- **Data collected** — matching the nutrition label and, for consistency, the
  Data Safety answers already worked out for Play in
  [PLAY_STORE_READINESS.md §1.3](PLAY_STORE_READINESS.md).
- **Required-reason APIs** — Capacitor's runtime uses `UserDefaults`
  (`NSPrivacyAccessedAPICategoryUserDefaults`, reason `CA92.1`), and file
  timestamp APIs are commonly pulled in too.

**Written** at `ios/App/App/PrivacyInfo.xcprivacy`, as the Apple-shaped
restatement of [PRIVACY.md](PRIVACY.md) so the nutrition label and the Play
Data Safety form cannot drift: phone, name, email, audio, user content,
financial info, user ID, product interaction and device ID — all linked, none
tracking. `NSPrivacyTracking` is `false`; `UserDefaults` is declared under
`CA92.1` conservatively, because an undeclared required-reason API fails upload
validation.

**It is also registered in the Xcode project**, which is the half that is easy
to miss — a manifest sitting on disk but absent from Copy Bundle Resources is
not in the app. Four insertions into `project.pbxproj` (file reference, build
file, group, resources phase); the file still parses and the build file is
present in the resources phase.

### 1.5 ~~`CFBundleIconName` is missing~~ — FIXED 2026-09-29

Found while pre-flighting the archive. An app that supplies its icon from an
asset catalog — which this one does — must also name that catalog entry in
`Info.plist`. Without it App Store Connect refuses the upload:

> Missing Info.plist value. A value for the Info.plist key `CFBundleIconName`
> is missing.

`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` was already set in the build
settings, so only the plist half was absent. Both now say `AppIcon`.

This is the kind of thing that only surfaces at upload, which is the most
expensive moment to find it.

### 1.4 ~~The app icon is still Capacitor's logo~~ — FIXED 2026-09-29, both platforms

`ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` is the blue
Capacitor mark, unchanged since the scaffold commit `9305dd6`. **Android has
the same problem** — `mipmap-*/ic_launcher.png` are also untouched defaults,
which the Play audit did not catch.

Apple rejects placeholder and third-party-branded icons (Guideline 4.0, and 2.3
for misrepresentation). Shipping another product's logo as your own is also
just wrong.

**Fixed from the brand mark that already existed** — `public/icon-512.png`, the
red `#FF3C2A` square with the white D that the PWA has always used. Nothing was
invented.

- **iOS**: 1024×1024, **opaque RGB, full-bleed, no pre-rounded corners** — iOS
  applies its own mask and rejects alpha. The source art's rounded corners were
  flooded out to red rather than left white.
- **Android**: adaptive icon — background recoloured from `#FFFFFF` to
  `#FF3C2A`, foreground is the white D alone on transparency, scaled into the
  66% safe zone so no launcher mask clips it. Legacy square and round PNGs
  regenerated at all five densities.

Verified by building the APK and reading the icons back out of it, and by
compositing the adaptive layers under a circular mask — the harshest one — to
confirm nothing is clipped.

---

## 2 · ~~Wrong-by-default settings in the scaffold~~ — ALL FIXED 2026-09-29

None of these crashed anything. All of them would have cost a review cycle.
`plutil -lint` passes on both `Info.plist` and `project.pbxproj` after the
edits, and all of it survives `npx cap sync`.

| Setting | Was | Now | Why it mattered |
|---|---|---|---|
| `TARGETED_DEVICE_FAMILY` | `"1,2"` — iPad included | **`1`** — iPhone only | You are graded on what you declare. Reviewers run an iPad build on an iPad. The design system is a phone design; nothing has ever been laid out for a 13" canvas. Guideline 2.4.1. |
| `UISupportedInterfaceOrientations` | portrait + both landscapes | **portrait only** on iPhone | Same argument. A reviewer will rotate the phone. |
| `UIRequiredDeviceCapabilities` | `armv7` | **`arm64`** | `armv7` is 32-bit and has not existed on a supported device since iOS 11. Capacitor template cruft. |
| `ITSAppUsesNonExemptEncryption` | absent | **`false`** | Absent means App Store Connect stops **every** build to ask the export-compliance question by hand. The app uses HTTPS only, which is exempt. One key saves a manual step per upload forever. |
| `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | `1.0` / `1` | **`1.0.1` / `2`**, matching Android | Android reads these from `variables.gradle` (`104c9aa`) with an env override. iOS now *matches* but is still hardcoded — **they must be bumped together by hand**. A shared source for both was deliberately not invented here, because it cannot be tested without Xcode. |
| `DEVELOPMENT_TEAM` | unset | **still unset — yours to set** | Needs a paid Apple Developer account, $99/year, and enrolment can take days if the entity needs verifying. **Start this now** — it is the longest-lead item in this document and nothing else can be submitted without it. |

---

## 3 · The real risk: Guideline 4.2, and Apple is far stricter than Google

The Play audit's §3 covers "minimum functionality". Apple's version of that
rule is the single most likely reason this app gets rejected, and the bar is
materially higher.

Apple rejects apps that are "primarily a repackaged website", and a Capacitor
app is exactly the shape reviewers apply 4.2 to. The Play defence is a good
starting point but it is not automatically enough here.

**What defends the app on iOS:**

| Capability | Android | iOS |
|---|---|---|
| Microphone / voice capture | shipped | **will crash until §1.1** |
| Hardware back handled natively | shipped (MOBILE-2) | n/a — iOS has no back button |
| Offline state | shipped (B04) | assumed, unverified |
| Deep links open the app | built (B19) | **not configured** — needs Associated Domains + `apple-app-site-association` |
| Push notifications | not built | not built |

Strip out what is Android-only or broken, and the iOS story is currently
"a website in a wrapper". That is the rejection.

**The honest read:** the microphone is the strongest single argument, and it is
also blocker §1.1. Fixing §1.1 does double duty — it stops the crash *and*
supplies the 4.2 defence. Push notifications ([PUSH_NOTIFICATIONS_ASK.md](PUSH_NOTIFICATIONS_ASK.md))
would move this from arguable to comfortable, and matter more on iOS than on
Android.

Put the microphone in the screenshots. Reviewers look at listings.

---

## 4 · Clean, or already solved — no action

Worth knowing so nobody spends time here:

- **Sign in with Apple is not required.** Guideline 4.8 only bites when you
  offer third-party social login. This app offers email/password and mobile
  OTP, and nothing else — checked across the sign-in pages.
- **Account deletion exists** — Guideline 5.1.1(v), shipped for Play and the
  same code serves Apple: in-app under Settings → Account, and
  `https://www.decisionos.biz/delete-account`.
- **A privacy policy exists** at `/privacy`, which App Store Connect requires
  as a URL.
- **ATT is very likely not needed.** App Tracking Transparency is about
  tracking across *other companies'* apps and sites. PostHog now ships with
  `autocapture: false` and `disable_session_recording: true`, there is no IDFA
  use and no ad SDK. The **privacy nutrition label still has to declare**
  analytics and IP address — "no ATT prompt" is not "nothing to declare".
- **The reviewer can get in.** This is usually the worst problem for a
  login-gated app, and worse here because sign-in is an OTP to an Indian
  mobile that a reviewer in California cannot receive. "Try DecisionOS on a
  live workspace" solves it in one tap. Put the tap-by-tap steps in App Review
  Information → Notes, exactly as planned for Play's App access.
- **Deployment target `15.0`** is sensible and needs no change.
- **HTTPS only** — no ATS exceptions in the plist, and the release config
  cannot make a plaintext request.

---

## 5 · Corrections to PLAY_STORE_READINESS.md

That document is accurate as of when it was written, and two items have since
been fixed by work that landed on 2026-09-29. Noting them here so nobody
re-does them:

- **§5, "fonts come from Google Fonts at runtime — nothing is bundled"** —
  fixed by `3af2856`. The APK now carries 10 `.woff2` files and `index.html`
  has zero references to `fonts.googleapis.com`. The Data Safety entry for it
  can go.
- **§2.8, "`versionCode` is hardcoded `1`"** — fixed by `104c9aa`. It now comes
  from `variables.gradle`, overridable by `ANDROID_VERSION_CODE`, currently
  `2` / `1.0.1`.

And one item it missed:

- **The Android launcher icons are also still Capacitor's placeholders**
  (§1.4 above). Play is more tolerant than Apple here, but it is a listing
  quality problem and the fix is shared.

---

## 6 · The order I would do it in

Longest-lead first, because the calendar matters more than the effort here.

1. **Enrol in the Apple Developer Program.** $99/year. Days, sometimes longer
   for a company entity. Nothing else can be submitted until this exists, and
   it is pure waiting.
2. **Install Xcode and build the thing once.** Everything on iOS is currently
   unverified. Expect bugs; the Android build found several.
3. **Fix §1.1–1.3** — three usage-description strings and a privacy manifest.
   An hour, and it stops the crashes.
4. **Draw a real app icon**, for both platforms.
5. **Fix the §2 defaults** — iPhone-only, portrait-only, `arm64`, encryption
   key, shared version.
6. **Run it on a real iPhone** and walk the same checklist the Android round
   used ([ANDROID_TEST_CHECKLIST.md](ANDROID_TEST_CHECKLIST.md)).
7. **App Store Connect**: nutrition label, screenshots, description, age
   rating, and the demo-login notes under App Review Information.
8. **TestFlight first**, internal then external. It is the only way to find the
   WKWebView-specific problems before a reviewer does, and per
   [DECISIONOS_MOBILE_APP_PLAN.md](DECISIONOS_MOBILE_APP_PLAN.md) TestFlight is
   also the gate at which `mobile-capacitor` merges back into `karma-redesign`.

Steps 1 and 2 are the ones with calendar risk. 3–5 are an afternoon. Ship
Android first — it is close, and it is not waiting on Apple.

---

## 7 · Producing the `.ipa`

**Still cannot be done here, but the reasons have changed** (2026-09-30).
Xcode is now installed and the simulators exist; what blocks it is §7.1 below
plus the signing situation, which is this:

    security find-identity -v -p codesigning
      1) ... "Apple Development: csaicsai300@gmail.com (6J27BB7MA9)"
         1 valid identities found

    ~/Library/MobileDevice/Provisioning Profiles/   →   0 profiles

An **Apple Development** certificate signs a build for a registered device or
a simulator. It **cannot** produce a distributable `.ipa`: that needs an
*Apple Distribution* certificate and an App Store provisioning profile, and
both require a **paid** Apple Developer Program membership. A free Apple ID
gets exactly what is above. So §6 item 1 — enrolment — is still the gate, and
no amount of building locally gets past it.

### 7.1 · Swift package resolution hangs on this machine

`xcodebuild` never gets as far as compiling. It stops, indefinitely, at:

    Fetching from https://github.com/ionic-team/capacitor-swift-pm.git
    Creating working copy of package 'capacitor-swift-pm'
    Checking out 8.5.2 of package 'capacitor-swift-pm'

and stays there. Reproduced on `build` and on `-resolvePackageDependencies`
alone, so it is resolution, not compilation.

What was ruled out on 2026-09-30, so the next person does not repeat it:

| Suspected | Test | Result |
|---|---|---|
| Network / GitHub reachability | `git ls-remote` that repo | instant, fine |
| The tag itself | `git clone --branch 8.5.2` by hand | **works, instantly** |
| Corrupt SwiftPM cache | deleted `~/Library/Caches/org.swift.swiftpm` (694 MB), retried | same hang |
| Stale derived data / workspace state | fresh `-derivedDataPath` and `-clonedSourcePackagesDirPath` | same hang |
| Two xcodebuilds contending for the lock | killed all, single process | same hang |
| Git credential helper / global config | `git config --global --list` | empty, no helper |
| Command sandbox blocking a write | re-ran with the sandbox off | same hang |
| Xcode licence / first-run not done | `-checkFirstLaunchStatus`, licence record | both fine (26.6) |

So: git can fetch and check out that exact tag in a second, and xcodebuild
cannot. That points at Xcode's own SPM layer rather than the project, the
network or the repo. **Do not start by re-cleaning caches — that was tried.**

Worth trying next, roughly in order of cost: open `App.xcodeproj` in Xcode.app
once and let the GUI resolve packages (a first GUI run may complete something
the CLI is waiting on); check Console.app for a blocked process while it
hangs; `sudo xcode-select --install` / verify the Xcode install; or as a
fallback pin the dependency to a local checkout in `CapApp-SPM/Package.swift`
so no fetch is needed at all.

Everything in §1 and §2 is already done, so once resolution completes this
should build.

### Before you open Xcode

**Install the JS dependencies.** `CapApp-SPM/Package.swift` depends on
`@capacitor/app` by a *relative path* into `node_modules`. A fresh clone
without `npm install` fails Swift package resolution with an error that does
not mention npm, and it is a confusing five minutes.

```bash
cd frontend
npm install
npm run cap:sync:prod     # NOT cap:sync
```

`cap:sync:prod` is not optional, for the same reason it is not optional on
Android: plain `cap:sync` reads `frontend/.env`, which says
`http://localhost:8000`, and on a phone localhost is the phone. Every API call
would fail, and a release build has no cleartext exemption to even try.

### In Xcode

```bash
cd frontend && npx cap open ios
```

1. Select the **App** target → **Signing & Capabilities**.
2. Set **Team** to your Apple Developer team. This is the only setting still
   unset — `DEVELOPMENT_TEAM` is deliberately not committed, because it is
   account-specific.
3. Leave **Automatically manage signing** on. Xcode will create the App ID for
   `com.decisionos.app` and the provisioning profile.
4. Choose **Any iOS Device (arm64)** as the destination — an archive cannot be
   made against a simulator.
5. **Product → Archive.**
6. In the Organizer that opens: **Distribute App**.

### Which distribution to pick

You asked for internal testing on a developer-account phone. There are two
ways, and they are not the same thing:

| | What it is | Review? | Who can install |
|---|---|---|---|
| **TestFlight internal** | upload to App Store Connect, add up to 100 internal testers | **no review** | anyone on your App Store Connect team |
| **Development install** | Xcode installs straight onto a cabled device | none | that one registered device |

**Take TestFlight.** It is the same binary, the same signing and the same
upload pipeline you will use to submit, so it proves the whole path rather than
just the app. Choose **App Store Connect → Upload**, then enable TestFlight
internal testing in App Store Connect. Builds appear after processing, usually
5–15 minutes.

Use the development install only for a quick look before you have App Store
Connect set up.

### What will be checked on upload, and already passes

Xcode validates before it transmits. The keys it fails on are all present and
were verified on 2026-09-29: `CFBundleIdentifier`, `CFBundleShortVersionString`,
`CFBundleVersion`, `CFBundleIconName`, `ITSAppUsesNonExemptEncryption`, the
three usage descriptions, and `PrivacyInfo.xcprivacy` in Copy Bundle Resources.

`ITSAppUsesNonExemptEncryption = false` means it will not stop to ask the export
question.

### After the first upload

Bump **both** numbers for every subsequent upload — App Store Connect rejects a
duplicate `CFBundleVersion` for the same version string. They live in the build
settings as `MARKETING_VERSION` (1.0.1) and `CURRENT_PROJECT_VERSION` (2), and
are currently matched by hand to Android's `variables.gradle`. Keep them in
step.

### Then, and only then, App Store Connect

Screenshots (6.7" and 6.5" iPhone are the required sizes), description,
keywords, support URL, the privacy nutrition label, age rating, and — most
importantly for this app — the **App Review Information** notes carrying the
tap-by-tap for "Try DecisionOS on a live workspace", because a reviewer cannot
receive an Indian OTP. §4 covers why that one matters more than it looks.
