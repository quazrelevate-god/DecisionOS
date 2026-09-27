# DecisionOS as a native app — plan

Started 2026-09-27. Scope: packaging the existing web app as an iOS and Android
app with Capacitor, and the branch rhythm that keeps the two from drifting.
Redesigning screens for mobile is **out** of scope — the whole point is that
there is nothing to redesign.

---

## The shape of it

Capacitor is a native shell around a webview. The webview loads the output of
`npm run build` — the same bytes the web app serves — from inside the app
bundle. There is no second copy of the UI, no mobile-only source tree, and no
port of any screen.

That is the entire reason this approach was chosen over the Flutter app that
used to live in `mobile/`. That app was a parallel implementation, and a
parallel implementation drifts: it was last touched in `e3ac453` and by the time
it was retired it was 318 commits behind the design system it was supposed to
mirror. It is archived at the tag **`mobile-flutter-archive`** and is not coming
back. Nothing is lost — `git checkout mobile-flutter-archive -- mobile/` brings
all 176 files back if anyone ever needs to look.

What Capacitor added to this repo is additive and small:

| Path | What it is |
|---|---|
| `frontend/capacitor.config.ts` | appId, appName, `webDir: 'build'` |
| `frontend/package.json` | `@capacitor/core`, `/ios`, `/android`; `@capacitor/cli` + `typescript` as dev deps |
| `frontend/ios/` | generated Xcode project — signing, icons, splash, permission strings live here |
| `frontend/android/` | generated Gradle project — same |

No existing screen, component or stylesheet was touched.

### What is committed and what is not

The native projects **are** committed, because that is where the things you
cannot regenerate live: signing configuration, app icons, the splash screen, and
the `Info.plist` / `AndroidManifest.xml` permission strings you will write the
first time the app asks for a camera or a file.

The web assets copied *into* those projects are **not** committed —
`ios/App/App/public/`, `android/app/src/main/assets/public/`, and the generated
`capacitor.config.json` in each. Capacitor's own `.gitignore` files exclude
them, and that is deliberate: those are build output. If they were committed,
someone would eventually ship a store build carrying a snapshot of the UI from
whenever they were last staged. Keeping them out means the only way to get web
assets into a build is to run `npm run build && npx cap sync`, which always
takes the current source.

`ios/.gitignore` also excludes `App/Pods`. As it happens this project uses Swift
Package Manager rather than CocoaPods, so no `Pods` directory is ever generated
— but the rule is there, so the belt and the braces both hold.

---

## The merge rhythm

Nobody should have to guess at this.

**Daily, while the app is pre-TestFlight: `karma-redesign` merges INTO
`mobile-capacitor`.** One direction only. The pilot client is live on
`karma-redesign` and nothing native goes near it until the app is proven. This
branch absorbs the web app's changes every day so the gap never grows to
something that has to be reconciled in one sitting:

```bash
git checkout mobile-capacitor
git merge karma-redesign
cd frontend && npm run build && npx cap sync
```

The `cap sync` is not optional. A merge that brings in a screen change and stops
at the merge leaves the native projects holding the *previous* build, and the
next thing you open in Xcode will show you yesterday's UI and you will spend an
hour wondering why.

**Once the app is in TestFlight: `mobile-capacitor` merges back into
`karma-redesign`.** At that point the packaging is proven and the additive files
belong on the main line, so that whoever is working on the web app also builds
the native projects without a special branch.

**Every store build comes from a tagged commit.** Never from a working copy,
never from whatever HEAD happened to be. Tag first, build from the tag, so that
a crash report from the store maps to an exact tree:

```bash
git tag mobile-1.0.0-build7
cd frontend && npm run build && npx cap sync
```

Use `mobile-<version>-build<n>`; `n` is the store build number and only ever
goes up.

---

## Running it locally

Two servers. The API is the repo's fixture server, not the real backend —
`backend/` needs MongoDB and the only `MONGO_URL` configured here points at a
live Railway instance, which is not something to aim a test stack at.

```bash
npm run build --prefix frontend   # only if you want the bundled assets fresh
node frontend/scripts/fixture-server.mjs --port 8000
cd frontend && BROWSER=none npm start
```

Both are also registered in `.claude/launch.json` as `mac-fixture-api` and
`mac-frontend`. The four configs that were already in that file are Windows-only
— `cmd.exe`, `D:\QE\...` — so they cannot run on macOS or Linux; the two `mac-`
entries use relative paths and work from any checkout.

### Live reload on a device

`npm run cap:dev` prints the exact three commands to run, with your LAN IP
already filled in. The reason it exists is that the same address has to appear
in three places, and each wrong one fails in a way that looks like a different
bug: `server.url` (webview shows a blank screen — on a phone, `localhost` is the
phone), `REACT_APP_BACKEND_URL` (UI loads, every request fails), and
`FIXTURE_CORS_ORIGIN` (requests are made, then refused, which reads in the
console like an auth problem).

Live reload is opt-in through `CAP_LIVE_RELOAD_URL`. That guard is the point:
a store build carrying a `server.url` would load the app from whichever laptop
was on that network and fail to start anywhere else. Since the variable is unset
in every normal build, `npm run build && npx cap sync` cannot produce that
binary. Verified both ways — with the variable, `capacitor.config.json` gains
`url` and `cleartext`; without it, the `server` block is just `androidScheme`.

## Talking to the real backend

The API is `https://backend-production-c8640.up.railway.app`. Two things had to
be settled before a native app could reach it, and both were measured against
the live backend on 2026-09-27 rather than assumed.

**CORS refuses the app's origin.** A preflight from `capacitor://localhost`
(iOS) or `https://localhost` (Android) returns `400 Disallowed CORS origin` with
no `Access-Control-Allow-Origin`. So does `http://localhost:3000`. This is not a
misconfiguration — `backend/config.py` refuses to boot with `'*'` in prod on
purpose, and the allow-list simply does not contain the app's origins.

**Auth is cookies, which is worse.** `HttpOnly; SameSite=None; Secure` plus a
CSRF double-submit and `allow_credentials=True`. From a `capacitor://` page
those are third-party cookies, and WKWebView blocks them by default. Widening
`CORS_ORIGINS` would have fixed the first problem and left this one.

So `CapacitorHttp` is enabled instead. It routes `fetch`/`XHR` through native
code: native requests are not made by a browser, so CORS never applies, and
cookies use the platform cookie jar rather than the webview's. Nothing on the
production backend had to change — which matters during a pilot week.

### Building against production

```bash
cd frontend && npm run cap:sync:prod
```

`build:prod` sets `REACT_APP_BACKEND_URL` inline. It has to be inline:
`craco.config.js` calls `require('dotenv').config()` at the top, which loads
`.env` before react-scripts gets a turn, and `dotenv` never overwrites a key
that is already set. A `.env.production` file is therefore silently ignored in
this project — the build succeeds and quietly bakes in `http://localhost:8000`.
That was tried and rejected before `build:prod` was added; do not re-add it.

### Android APK

```bash
cd frontend && npm run cap:sync:prod
cd android && ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

Toolchain, on the machine this was first built on: **JDK 21** (not 17 —
`@capacitor/android`'s `build.gradle` sets `sourceCompatibility 21`, and 17
fails with `invalid source release: 21`), Android SDK platform 36 and
build-tools 36.0.0, with `sdk.dir` in `android/local.properties` (gitignored,
machine-specific).

## Before the first store build

Two things must be settled. Neither is a code change and neither is done.

**1. `REACT_APP_BACKEND_URL` must be absolute.** `src/lib/api.js` falls back to
a relative `/api` when the variable is unset. That is right for the web app,
where the API is same-origin. It is wrong inside a native app: the webview
serves from `capacitor://localhost` on iOS and `https://localhost` on Android,
so a relative `/api` resolves to the app bundle itself and reaches no backend at
all. Worse, a store build made on a developer machine with the current
`frontend/.env` would bake in `http://localhost:8000` — a build that works
perfectly on the machine that made it and is inert everywhere else. Set the
production API URL in the build environment before `npm run build`, and check
the built bundle for `localhost` before shipping.

**2. The service worker needs a decision.** The build emits
`build/service-worker.js` (Workbox, from the PWA work). Inside a webview whose
assets are already local, it caches local files against local files, and its
main effect is that it can serve a stale asset across an app update. It should
probably be disabled for native builds. It has not been, and nothing here
changes it.

A third, cosmetic: the generated iOS and Android projects still carry
Capacitor's placeholder launcher icons and splash images. They need the real
artwork before submission.

---

## What has actually been proven (2026-09-27)

The design system survives packaging. This was measured, not assumed.

The packaged payload was compared against the web build byte for byte. Every
file in `frontend/build` is byte-identical inside both native projects. The only
difference is two files Capacitor injects, `cordova.js` and
`cordova_plugins.js`, both of which are zero bytes because there are no Cordova
plugins.

Then the repo's own mobile audit (`npm run audit:mobile`, the MPWA-00 harness)
was run twice against a live fixture API: once against the assets inside the iOS
app bundle, once against `frontend/build` served directly as a control. Both
runs walked 24 routes at 390×844 and 360×640:

| | packaged payload | web control |
|---|---|---|
| routes walked | 24 | 24 |
| findings | 962 | 962 |
| console errors | 0 | 0 |

The two reports are identical — the same counts on all nine rules, and zero
findings present in one run and absent from the other. The app was also driven
by hand at a 375×812 viewport from the packaged bundle: Desk and Finance render
with the gauge, the gradient ground, the segment control, the sparklines and the
bottom tab bar all intact.

**Those 962 findings are the web app's, not the packaging's.** The audit is red
on `karma-redesign` today — 715 touch targets under 44px, 140 text runs under
13px, 38 currency values not in Indian digit grouping. Capacitor neither caused
them nor hid them, which is exactly what the control run establishes. They are
worth their own piece of work; they are not this one.

### What has *not* been proven

The app has never been compiled or run in a simulator. The machine this was done
on has no Xcode (Command Line Tools only), no CocoaPods, no Java and no Android
SDK, so neither `xcodebuild` nor `gradlew` can run here at all.

So: the evidence above is that the *payload* is correct and renders correctly.
The remaining unknowns are the ones only a real device build can answer —
WKWebView rendering versus Chromium, the `capacitor://` scheme, safe-area insets
against a physical notch, and keyboard behaviour. The first person with Xcode
should run `npx cap open ios`, build to a simulator, and add what they find
here.
