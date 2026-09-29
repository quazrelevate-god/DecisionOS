# Apple App Store readiness — an audit before the first upload

**2026-09-29 · branch `mobile-capacitor`, commit `0ac7f00`**

The sibling of [PLAY_STORE_READINESS.md](PLAY_STORE_READINESS.md), which covers
Google Play and is in good shape. This one covers Apple, which is **not**.

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

## 0 · Nothing on iOS has ever been built

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
