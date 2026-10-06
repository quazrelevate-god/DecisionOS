# DecisionOS — Debugging Log

A running record of issues we investigate and how we resolve them, so we can refer back later.

- **Branch:** mobile-capacitor
- **App under investigation:** React/Capacitor app in `frontend/` (Capacitor 8, appId `com.decisionos.app`)
- **Ground rule for this session:** investigate and report only. No code changed until we decide.

---

## 2026-10-03 — Investigation round 1 (findings only, nothing changed)

Three questions were raised. Status: **all investigated, no fixes applied yet.**

---

### Issue 1 — Is there any push-notification code (Android / iPhone)?

**Verdict: NO. There is no push-notification implementation anywhere in the repo — not Android, not iOS, not Web.** Zero client registration code, zero functional native config/keys, zero backend send code.

What actually exists (and why it's not push):

| Platform | Finding |
|---|---|
| **Android** | Only the **default Capacitor template** google-services hooks in `frontend/android/build.gradle` (`com.google.gms:google-services:4.4.4`) and `frontend/android/app/build.gradle` (conditional `apply plugin`, stock log `"google-services.json not found… Push Notifications won't work"`). **No `google-services.json` exists**, so the plugin never applies and FCM is never wired. No `@capacitor/push-notifications` or `@capacitor/local-notifications` in `package.json`. |
| **iOS** | `frontend/ios/App/App/AppDelegate.swift` is the **unmodified Capacitor stub** — no `didRegisterForRemoteNotifications`, no `UNUserNotificationCenter`. No `aps-environment` entitlement, no `GoogleService-Info.plist`, no `.p8`/`.p12` APNs keys. |
| **Web Push** | `frontend/src/service-worker.js` (Workbox) does precaching / offline / background-sync for captures only. **No `push` event listener, no `PushManager.subscribe`.** `manifest.json` has no `gcm_sender_id`, no VAPID keys. |
| **Flutter (`mobile/`)** | Empty shell — `mobile/lib/` has no real Dart source, no `pubspec.yaml`, no `firebase_messaging`/`flutter_local_notifications`. |
| **Backend** | `backend/services/notifications.py` defines `push_notification(...)` (line 46) but it's a **misnomer** — it only inserts rows into `db.notifications` (line 55) and optionally sends email. No FCM/APNs/device-token/VAPID anywhere. `/api/notifications` is a **read** endpoint for in-app rows, not device registration. |

**Bottom line:** the app uses **in-app notifications (DB rows surfaced in the UI) + email** only. Remote/system push would need to be built from scratch.

---

### Issue 2 — Why does screen size/layout change when switching screens or apps?

**Baseline — how the scale system works:** `frontend/src/hooks/useUiScale.js:75-94` writes `--ui-scale` to `<html>` and adds `.ui-scale` to `<body>`; `index.css:782` = `.ui-scale { zoom: var(--ui-scale,1) }`. The scale is a **width-only stepped table** (`useUiScale.js:61-68`): ≥2560→1.3, 1920→1.2, 1872→1.1, 1440→1.0, 1024→0.9, else→**0.8** (every phone). Computed from `window.innerWidth`, recomputed **only** on `window.resize` (rAF-debounced). It does **not** run on route change (empty dep array), and height changes (keyboard, URL bar) never change it.

**Causes on ROUTE change (navigation):**
1. **Per-route max-width container (the clearest shift).** `Layout.js:913-917` switches the main column width by route: `/my-work` & `/team` edge-to-edge (`WIDE_ROUTES` `Layout.js:129`), `/inbox` → `DESK_WIDE` (`Layout.js:151,916`), everything else capped `lg:max-w-[1400px]`. Moving between Desk / My Work / Team / normal pages visibly changes column width + gutters. **Intentional, but reads as "layout changes."**
2. **Desk-only mobile top bar.** `Layout.js:957-984` adds a 32px top bar + `pt-[calc(var(--sa-top)+0.375rem)]` **only** on `/inbox`; other routes render a zero-height slot. Content start jumps vertically between /inbox and everything else.
3. **iOS input-focus auto-zoom — WEB / installed-PWA only (native store app is immune).** `lockZoomInApp` pins `maximum-scale=1,user-scalable=no` **only inside the native app** (`src/lib/native/viewport.js:35,41-42`, guarded by `isNativeApp()`). `public/index.html:8` does not pin scale. Because `--ui-scale` 0.8 shrinks every field below iOS's 16px threshold, iOS Safari/PWA auto-zooms the page when a text field is focused.
4. **Mobile dvh + URL bar — web/PWA only.** Shell height `h-[calc(100dvh/var(--ui-scale,1))]` (`Layout.js:662`). Mobile browser URL bar collapse/show changes `dvh`, so the fixed-height shell resizes between pages. No URL bar in the Capacitor webview → not a native cause.
5. **Dex route theme/room swap** (`/brain`, `/dex`): `Layout.js:275,292-318` toggles `dark`, 480ms `theme-x` cross-fade, `--sky-art`. Large but intentional.

**Causes on RESUME (background → foreground):**
1. **Flash of wrong scale 1.0 → 0.8 (most likely resume culprit).** `--ui-scale` is set and `.ui-scale` added only inside the effect (`useUiScale.js:78,82`); nothing in `index.html` sets it earlier. On a fresh document `var(--ui-scale,1)` = 1, so **first paint renders full-size, then snaps to 0.8** once React mounts. Warm foregrounding keeps the page (no flash); but when the OS evicts the webview under memory pressure, foregrounding reloads and reproduces the flash. Classic "different size when I came back."
2. **Whole-step rescale when the width bucket changed while away** (rotation, Android split-screen/foldable, desktop resize) — `resize` fires and crosses a boundary (0.8↔0.9 at 1024, etc.).
3. **Content reflow on focus refetch (not scale, but reads as a jump).** `refetchOnWindowFocus: true` (`src/index.js:31`) + `usePulse` on `visibilitychange` (`hooks/usePulse.js:82-86`) refetch on resume; skeleton→data moves layout (e.g. `Team.js:1210`).

**Ruled out as scale causes:** keyboard hooks (`useKeyboardSafeBox`, `useKeyboardInset`, `keepFocusedInView`) only read `--ui-scale`, never write it; they change height, not the width-driven scale. Safe-area insets `--sa-*` are per-device, not per-route. `useUiScale` does not re-run on navigation. Android `configChanges` (`AndroidManifest.xml:24`) keeps the activity on rotation/keyboard except under eviction.

**Bottom line:** navigation shifts ≈ **per-route max-width container** (+ iOS focus-zoom & dvh on web). Resume shifts ≈ **mount-time scale flash 1.0→0.8** on webview reload (+ whole-step rescale when width bucket changed).

---

### Issue 3 — Why does the app feel laggy?

Ranked most → least impactful (mobile webview):

1. **(HIGHEST) No code-splitting — one ~2.88 MB JS bundle on every cold start.** `build/static/js/main.*.js` ≈ 2,884,455 bytes; `App.js:8-65` imports **every** page statically; `React.lazy`/`Suspense` → **0 matches**. Biggest sources: `MyWork.js` 296 KB, `Desk.js` 116 KB, `Team.js` 95 KB, `OperatingScore.js` 82 KB, `Layout.js` 70 KB, `i18n.js` 53 KB. Webview must download/parse/compile all of it before first paint. **Highest-ROI fix: route-level `React.lazy`.**
2. **Global CSS `zoom` on `<body>`, recomputed on resize, double-applied to every Radix popper.** `index.css:782` + per-popper zoom-on-zoom (`index.css:820-821`). `zoom` forces full-document reflow; every dropdown/menu/tooltip pays zoom-nested-in-zoom; every orientation/keyboard `resize` re-lays-out the whole page.
3. **Pervasive `backdrop-blur` / `backdrop-filter` glassmorphism — the classic webview killer.** 76 occurrences / 24 files (38 in `index.css`). Baked into design tokens: `components/karma/glass.js:13,55` (`backdrop-blur-xl`) → every menu/dialog/drawer/card. Re-samples + re-blurs everything behind on every frame it moves → top cause of janky scroll/animation (worst: blur under the `DexSlider` ripple).
4. **Largest list pages: zero memoization, no virtualization.** `MyWork.js` = 105 `.map/.filter/.slice`, **0** `useMemo/useCallback/memo`. No `react-window`/`react-virtual`/etc anywhere → every row in the DOM, big reconciliation on each refetch.
5. **Large unoptimized images, some bundled.** `public/neural-constellation.png` 2.67 MB; `src/assets/inbox-glow1.png` 1.28 MB (imported from `src/`, so bundled); sky backgrounds ~1 MB each. Several are full-screen `position:fixed` layers.
6. **Always-on infinite CSS background animations.** `index.css:1469` `kr-drift 90s infinite`, `:1090` `constellation-spin 44s`, plus `dex-breathe`, `halo-breathe`, etc. (51 `@keyframes`/animation decls). Keeps compositor awake even when idle; stacks with the blur layers.
7. **framer-motion on 11 surfaces** (MyWork, Login, Signup, DexChat, 5 onboarding screens). Adds to bundle + JS-driven transitions compound blur/zoom cost during the moments perceived as "slow transitions."
8. **(LOWER) Polling/timers — mostly fine, but trigger refetch storms.** `usePulse` is well-built (20s, pauses when hidden) BUT invalidates broad keys (`["tasks"]`, `["desk"]`) → refetches many non-memoized/non-virtualized lists at once. Aggressive outliers: `admin/AdminSections.js:663` `setInterval(load,2500)`, `DesignLab.js` 1.2s (owner/dev lab only).

**Not problems:** `CapacitorHttp.enabled` (good — native networking), source maps off in prod, `AuthContext` value is properly `useMemo`'d (not causing whole-tree re-renders).

**Suggested order of attack (when we decide to fix):** (1) route `React.lazy`/`Suspense`; (2) drop `backdrop-blur` on mobile scroll surfaces; (3) reconsider global `zoom` / per-popper zoom-on-zoom; (4) virtualize + memoize MyWork/Team/CRM; (5) optimize images (WebP/resize, move `inbox-glow1` out of `src/`); (6) gate always-on background animations on mobile / `prefers-reduced-motion`.

---

*No files were modified during this investigation.*

---

## 2026-10-05 — Issue 7: Every transition (navigation + dialog open/close) feels laggy/slow  🔍 DIAGNOSED

**Measured (emulator, Android `dumpsys gfxinfo` during navigations + a dialog open/close):**
- **80.9% of frames janky** (93/115). Median frame **89ms** (~11fps; smooth = 16ms). 95th pct 400ms, 99th 1500ms. 65 missed vsyncs.
- Bottleneck is the **GPU** (GPU frame-time percentiles maxed) → **render-bound**. (Caveat: the emulator uses a software GPU, so absolute numbers are worse than a real phone; the *pattern* holds on devices, less extreme.)

**Root cause: `backdrop-filter: blur()` re-samples and re-blurs the whole area behind it every composited frame.** Ranked levers (file:line):

1. **Dialog overlay blur `backdrop-filter: blur(18px)`** on EVERY dialog/alert open+close — [index.css](frontend/src/index.css) `[data-dialog-overlay]` mobile rule. Full-viewport blur running for the 300ms fade each way. **(This is the blur I added for the "frosted backdrop" — biggest per-dialog cost.)** Stacks with the panel's own glass blur + dock blur → 3–5 blurred layers composited at once on a dialog open.
2. **`will-change: transform` left permanently** on `[role=dialog]` (matches open AND closed) → a GPU layer held for the dialog's whole life, not just the 300ms. Memory/compositor pressure that slows the *next* transition too.
3. **300ms** dialog + overlay durations — longer wall-clock + more blur frames; 200ms reads snappier.
4. **Always-mounted dock blur** `backdrop-blur-2xl` ([FloatingDock.jsx:137,218](frontend/src/components/mobile/FloatingDock.jsx)) + sticky blurred bars (MyWork toolbar, etc.) — on screen for 100% of **navigations**, so they re-blur the moving page every frame → this is why *navigation* lags, not just dialogs.
5. **`kr-page-in` 320ms** opacity anim on `<main>` every route (cheap-ish, opacity-only) + Dex `theme-x` 480ms whole-tree transition (only crossing `/brain`).
6. **No route code-splitting** ([App.js](frontend/src/App.js) imports all pages eagerly) → full React reconciliation of heavy trees on each nav (not download — parse already done). Medium effort: `React.lazy` heavy routes.
7. ui-scale zoom reflow — already hardened (width-only guard), not a current culprit; don't regress.
8. Scroll-lock (BottomSheet body-pin + Radix) + 40-frame rAF settle loop — minor main-thread contention at open/close.
9. framer-motion (14 files, concentrated in Dex/onboarding/MyWork) — JS-driven, contributor on those screens.

**Trade-off to decide:** lever #1 (the dialog blur) is the single biggest dialog-open cost — but it's the frosted backdrop the user specifically asked for. Options: flat semi-opaque scrim (fast, no blur), smaller blur radius (cheaper), or keep 18px (laggy).

### UPDATE — REAL root cause found by profiling (the GPU/blur theory was WRONG)

Applied the blur-removal (dialog overlay → flat scrim) + shorter durations + dialog card-pull-up + 28px nav slide. **Still felt laggy.** So I stopped trusting the emulator's `gfxinfo` (it measures Android HWUI, **not** the WebView's Chromium compositor — useless for a Capacitor app) and profiled in a **real Chromium** (the in-app browser at mobile size, logged into the live demo, `PerformanceObserver`/LoAF/forced-reflow timing).

**Findings:**
- Navigation → **140ms + 59ms main-thread long tasks**; dialog open → **149ms + 53ms**. The main thread is **frozen ~150ms per transition** = JavaScript, i.e. **React rendering the heavy page/dialog**.
- **Not GPU/blur** (removing it didn't help — consistent with JS-bound).
- **Not the CSS `zoom`** — A/B tested: disabling `.ui-scale`/`--ui-scale` did NOT change forced-reflow cost (~8–12ms either way). Reflow is not the bottleneck. DOM is only ~1013 nodes.

**So the lag = React render cost of heavy components** (My Work: 296KB, ~105 list ops, 0 memoization; dialogs; Desk; CRM). Fix = code: memoize derived data + list rows (`React.memo`/`useMemo`/`useCallback`), virtualize long lists, `React.lazy` routes. Decision: **start with My Work** (biggest), measure, then extend. Kept the session's dialog pull-up + nav slide + flat scrim.

---

## 2026-10-05 — Issue 8: My Work render cost — lazy-build the per-card drawer + detail dialog  ✅ FIXED (pass 1 of the Issue-7 plan)

**The dominant cost, found by reading [MyWork.js](frontend/src/pages/MyWork.js):** `TaskCard` builds its **~600-line `Sheet` drawer tree** (`const drawer = (…)`, was line 2400) **and** a `<TaskDetailDialog>` (was line 3244) **on every render — for every card, even collapsed ones that were never opened.** Radix only *mounts* those subtrees when `open`, but React still constructs the entire element tree in JS each render. With N cards on My Work, that per-render construction × N is the bulk of the ~140ms transition freeze measured in Issue 7. The file has **zero** memoization.

**Fix (3 edits in [MyWork.js](frontend/src/pages/MyWork.js), behaviour-neutral):**
1. Two render-time latch refs in `TaskCard`: `drawerEverOpened` / `detailEverOpened`, each flipped `false→true` during render when `expanded` / `detailOpen` is true (idempotent ref mutation — safe).
2. `const drawer = (…)` → `const buildDrawer = () => (…)`, then `const drawer = (drawerOnly || drawerEverOpened.current) ? buildDrawer() : null;`. A **never-opened card builds no drawer tree at all**; once opened it stays built so Radix can still play the **close** animation.
3. `<TaskDetailDialog>` wrapped in `{detailEverOpened.current && (…)}` — same lazy-build + stays-mounted-after pattern.

**Why this preserves the animations:** the latch only ever goes false→true, so the subtree is present for the entire open→close lifecycle (Radix drives the exit on `data-state=closed`). The Desk's `drawerOnly` mount is unaffected (`drawerOnly ||` short-circuit).

**Verified on emulator (fresh uninstall+install, Owner demo workspace, release APK):**
- Desk→Work nav, list renders fully.
- Tap card 1 → full task drawer opens with **all** content (Assigned, due date, To do/Doing, AI Execution Guide, Activity, Log update, Complete, Delete). Close (X) → returns to list.
- Tap a different card → its **own** distinct drawer (correct per-card data: description, activity, created date). Confirms the latch is per-card.
- **Video montage (10s screenrecord, ~23fps, frame-by-frame):** open transition = list → flat scrim fade (2 frames) → drawer slides up **already fully laid out as one layer** (frames 137–139) → settled. **No half-painted/tiled frame, no resize-to-fit frame** — the Issue-6e glitch signatures are absent. ~3-frame (~130ms) clean pull-up.

**Status:** behaviour identical, no regression, no glitch, heavy subtrees now built lazily. Remaining Issue-7 plan passes (optional, measure first): memoize derived data (`scoreMap`/`list`/`personOptions` O(n²) `nameOf`), `React.memo(TaskCard)` + stable `cardProps`/`onToggleOpen`, `useDeferredValue(list)`, `content-visibility:auto` on grid cells, then virtualization only if still janky. **Not committed** (per user).

---

## 2026-10-03 — Issue 4: Gradle release build fails — "Unsupported class file major version 69"  ✅ SOLVED

**Symptom:** `gradlew assembleRelease` failed at settings evaluation: *"BUG! exception in phase 'semantic analysis'… Unsupported class file major version 69."*

**Cause:** `JAVA_HOME` was empty, so Gradle used the `java` on PATH — Oracle **Java 25** (`C:\Program Files\Java\jdk-25`, class-file major 69), which this project's Gradle (8.14.3) doesn't support.

**Fix (per-build):** point the build at Android Studio's bundled JBR (Java 21):
```bash
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; $env:Path="$env:JAVA_HOME\bin;$env:Path"
```
then `gradlew assembleRelease`. Builds clean.

**Permanent option (not yet applied):** set user env var `JAVA_HOME` = the JBR path so every Gradle build uses Java 21.

---

## 2026-10-03 — Issue 5: "Can't reach DecisionOS" on the emulator  ✅ SOLVED

**Symptom:** release APK launched but showed the offline screen *"Can't reach DecisionOS — You're still signed in. This phone just can't get through right now."*

**Cause:** `frontend/.env` has `REACT_APP_BACKEND_URL=http://localhost:8000`, which gets baked into the bundle (`src/lib/api.js:13` → `API = REACT_APP_BACKEND_URL || "" + "/api"`). On the Android **emulator**, `localhost` is the emulator itself, not the dev PC — and nothing was listening on `:8000` anyway. So every API call failed while the saved session kept the user "signed in." (capacitor.config.ts comment confirms: the app is served from `https://localhost`, so every API call must use an **absolute** backend URL.)

**Fix:** rebuild pointing at the production Railway backend (matches the repo's `build:prod` script). A shell env var overrides `.env` in CRA, so the tracked `.env` stays as the local-dev default:
```bash
$env:REACT_APP_BACKEND_URL="https://backend-production-c8640.up.railway.app"; $env:GENERATE_SOURCEMAP="false"; npx craco build
```
then `npx cap sync android` → `assembleRelease` (Java 21) → install → launch. Verified the Railway host is baked into `build/static/js/main.*.js`, and the app loaded live demo data.

**Rule of thumb:** any APK you install on a device/emulator must be built with an absolute backend URL (Railway for prod; `http://10.0.2.2:8000` + cleartext for a local backend on the emulator). The default `npm run build` (= `localhost:8000`) never works on a device.

---

## 2026-10-03 — Issue 6c: THE ACTUAL crack = dialog cross-fade ghosting  ✅ FIXED (confirmed by slow-motion capture)

**How it was finally found:** earlier fixes were diagnosed from static screenshots and kept missing the real thing. This time I baked a temporary `*{animation/transition-duration:6s}` debug rule into the build, ran it on the emulator, and captured the dialog open **frame-by-frame in slow motion**. That made the glitch plainly visible.

**What the slow-mo showed (opening a Work task card):** for the duration of the enter animation the dialog is **translucent** (opacity animating 0→1), so:
- the **page behind shows THROUGH** the dialog (a seam across the demo banner), and
- the **bottom nav dock — which sits at `z-10000`, ABOVE the dialog — ghosts over the dialog's own bottom action bar** ("Complete"/camera/mic), so you briefly see "Work / Money / Complete / camera" all layered on top of each other.

Once opacity reaches 1 the frame is clean. **The crack is the opacity cross-fade**, on EVERY mobile dialog (Work, CRM, decision), because the shared `DialogContent` enter animates opacity from 0 (`fade-in-0`). My earlier Issue-6b "fade" change did NOT fix this (a fade can't fix a fade), and my Issue-6a "chrome fade" change actively made the dock-ghosting worse by fading the dock out slowly instead of hiding it instantly.

**Fix (two edits in [index.css](frontend/src/index.css), mobile only `@media max-width:1023.98px`):**
1. **Mobile dialogs appear INSTANTLY** — `[role="dialog"][data-state],[role="alertdialog"][data-state] { animation: none !important }`. Opaque from the first frame → covers the page immediately → nothing shows through, nothing to cross-fade. Desktop keeps the zoom.
2. **Dock/chrome hides INSTANTLY again** — reverted the 180ms `[data-mobile-chrome]` transition from Issue-6a (because the dock is above the dialog, fading it out ghosted it over the dialog). Back to instant `opacity:0;visibility:hidden`.

**First attempt wasn't enough (and why):** making only the dialog panel instant still ghosted, because the **scrim was left fading** — so for the scrim's fade the page still showed through. A second slow-mo/burst capture confirmed a residual one-frame bleed.

**Final fix (what actually works), all in [index.css](frontend/src/index.css) + a marker in [dialog.jsx](frontend/src/components/ui/dialog.jsx)):**
1. Dialog panel: `[role="dialog"][data-state]{ animation:none !important }` + `[data-state="open"]{ opacity:1 !important }` on mobile — opaque from frame one.
2. **Scrim too:** added `data-dialog-overlay` to the Radix overlay in dialog.jsx and `[data-dialog-overlay][data-state]{ animation:none !important }` — the scrim appears instantly, so even a one-frame paint lag on the panel shows the dim scrim behind it, never the live page.
3. Dock/chrome hides instantly (reverted the Issue-6a fade).

**Verified by fast-burst capture (fresh install each time):** Work task card → detail opens as a clean cut (list → full opaque dialog, no intermediate ghost); CRM "+" → New buyer form opens fully opaque. The exact burst timing that previously caught heavy list-bleed + dock-overlap now shows clean frames.

Trade-off: the dialog now pops in with no entrance animation — abrupt but **glitch-free**, which was the priority. A smooth *opaque* slide-up could be added later if desired (must stay opaque, never cross-fade).

---

## 2026-10-04 — Issue 6e: THE ACTUAL ROOT CAUSE = dialog rasterised in tiles under CSS `zoom`  ✅ FIXED (smooth + rounded + clean)

**User corrected me:** it was never a bleach — the glitch "resizes / tries to fit the screen." Re-captured (OpenCV frame extraction of the user's 25fps video + my own 32fps recordings of fresh builds) and confirmed on MY OWN build: the dialog's cards paint top-down and the backdrop a frame late — a Chromium **paint/raster-order** bug. The whole mobile UI is scaled with CSS `zoom: 0.8` (`--ui-scale`), and a `position:fixed` + `translate(-50%,-50%)` panel portalled into the zoomed `<body>` gets re-rasterised IN TILES. No opacity/animation rule can fix paint order (that's why every earlier attempt failed or went full-screen).

**Root-cause fix (mirrors the app's own popover precedent):** the app already counter-zooms Radix poppers (`index.css` `.ui-scale [data-radix-popper-content-wrapper]`) so they escape the body zoom — and poppers never glitch. Gave dialogs the same escape:
1. **[components/ui/dialog.jsx](frontend/src/components/ui/dialog.jsx)** — wrap the dialog PANEL (not the overlay) in `<div data-dialog-scale-root>`. The overlay/scrim stays in normal flow (must cover the full viewport).
2. **[index.css](frontend/src/index.css)** — `.ui-scale [data-dialog-scale-root]` = `position:fixed; inset:0; zoom:calc(1/var(--ui-scale))` (cumulative zoom 1.0 → `inset:0` is exactly the viewport, so the panel still centres against the screen) and `> * { zoom: var(--ui-scale) }` (puts the 0.8 scale back on the panel). This gives the panel its OWN raster layer → no tiling → paints as one clean opaque unit.
3. Reverted the full-screen override and the `animation:none` (restored the smooth shadcn slide/zoom) → **rounded sheets, animated**. Kept `opacity:1 !important` on the panel (open+closed) so the animation is transform-only (opaque, never a translucent cross-fade that reveals the page). Kept the hide-page rule as belt-and-braces.

**Verified frame-by-frame (fresh install, 31–32fps):** task dialog OPEN and CLOSE both slide smoothly, fully opaque, fully rendered, correctly centred, rounded sheet — no bleed, no tile-paint, no resize. CRM settles clean. Desktop unaffected (counter-zoom is a no-op at scale 1.0; mobile media block doesn't apply).

**Known minor residual (CRM only):** the CRM New-buyer sheet uses a GLASS (semi-transparent) background (`GLASS_SHEET`), so while the dark scrim is still fading in on open, the list shows faintly through the glass for ~1 frame. Fix options if wanted: make the scrim instant/faster on mobile, or give the CRM sheet an opaque bg on mobile. Not yet applied.

**Also:** the reason every earlier "fix" seemed not to work on the user's device was a **stale service-worker cache** (Issue 6d) — the app serves the old cached bundle on first launch after an APK update and shows a "Refresh" toast. Always fully uninstall + reinstall to verify.

---

## 2026-10-04 — Issue 6d: why the fix "never took" = STALE SERVICE-WORKER CACHE  ✅ ROOT CAUSE

**Breakthrough:** the user supplied a 25fps screen recording. Extracted frames with OpenCV (`cv2`) since ffmpeg isn't installed. The open-transition frames (239–240) showed the dialog **translucent** — header/footer readable but faded, light list bleaching through the middle. That is a dialog at partial opacity.

**Key deduction:** a translucent dialog is **impossible** with the Issue-6c fix active (`[role=dialog][data-state=open]{opacity:1!important}` forces full opacity). I verified that rule, plus `animation:none` and `data-dialog-overlay`, are all present in the compiled `build/static/css/main.*.css`. So the recording was **running old code**, not the fix.

**Verification the fix works:** fresh uninstall+install of the current APK, then recorded 7 open/close cycles on the emulator (~15fps) and auto-scanned every frame (`cv2`, diff + brightness). **Zero** bleached open frames — every open goes straight list→opaque dialog. The only in-between frames are the dark-scrim *close* frames (dialog opaque = opposite of the user's bleached frames). So the fix is correct.

**Why old code ran:** the app's Workbox service worker precaches the JS/CSS bundle (`src/service-worker.js`, prod only). On the **first launch after an APK update**, the page loads from the already-cached OLD bundle; the new worker installs (`skipWaiting` + `clientsClaim`) and fires `onUpdate` → which shows a **"DecisionOS has been updated — Refresh" toast** ([index.js:53](frontend/src/index.js:53)) that the user must tap (deliberate: don't reload mid-work). Until they tap Refresh (or relaunch, or fully reinstall), they keep running the old cached bundle. The user recorded that first-launch old-cache state. A full uninstall wipes the cache — which is why my verification was clean and their recording wasn't.

**Resolution:** to actually run new code — tap the "Refresh" toast after install, OR relaunch the app, OR (most reliable) **fully uninstall then install** the APK. Optional code change on the table: make `onUpdate` auto-reload (or reload on `controllerchange`) so every future update applies without the toast — trade-off is a possible reload mid-use (drafts are already preserved via lib/drafts).

**Minor residual (not the reported glitch):** on **close** there's a ~1-frame dark scrim flash (the overlay lingers one frame during Radix teardown). Standard modal dim; can be polished if wanted.

**Debug note:** the 6s slow-mo rule was removed from source after capture; the emulator needed a cold reboot (`emulator -avd … -dns-server 8.8.8.8 -no-snapshot-load`) partway through because the heavy builds wedged its DNS/network.

---

## 2026-10-03 — Issue 6b: dialog enter animation (zoom/slide transform)  ✅ FIXED (partial — removed the transform, but the opacity cross-fade in 6c remained)

**User clarified** the main glitch is on **Work** (tapping task cards) and **CRM** (buttons that open floating dialogs like "Create buyer") — a few-ms crack as the dialog renders, then settles.

**Captured on frame-by-frame screenshots:** the dialog **slides in from the side + zoom-pops** (content offset/clipped mid-open, underlying list visible behind), then snaps into place. Not a loading flash here — a transition.

**Root cause:** the shared `DialogContent` ([components/ui/dialog.jsx:39](frontend/src/components/ui/dialog.jsx:39)) ships the shadcn/tailwindcss-animate enter: `data-[state=open]:zoom-in-95` + `slide-in-from-left-1/2` + `slide-in-from-top-[48%]` (transform-based). That's fine for a small centered desktop modal, but the app's **mobile dialogs are near-full-screen sheets** — the Work task detail (`max-w-2xl`/`90vh`, [MyWork.js:1082](frontend/src/pages/MyWork.js:1082)) and the CRM New buyer/supplier form (`max-w-3xl`/`90dvh`, [CRM.js:533](frontend/src/pages/CRM.js:533)) both use this same `DialogContent`. Scaling a full-screen panel 95%→100% and sliding it makes the whole panel (and its sticky footer) visibly shift/snap for ~200ms = the crack.

**Fix:** on mobile only (`@media max-width:1023.98px`), override `[role="dialog"]`/`[role="alertdialog"]` enter/exit to a **pure opacity fade** (`@keyframes kr-dialog-fade`, [index.css](frontend/src/index.css)). The keyframe never sets `transform`, so the element keeps its own centring/positioning transform the whole time — nothing moves geometrically, it just fades. Desktop keeps the original zoom. Popovers/menus/dropdowns are untouched (they looked fine).

**Verified on emulator (fresh install):** Work task card → detail now **fades in centered** (old build caught it mid-slide at the same burst timing); CRM "+" → New buyer form opens **fully in place, no zoom/slide**. No regressions.

> Note: the earlier Issue-6a work (opacity `kr-page-in`, scroll-unlock, chrome fade, ui-scale guard, ErrorBoundary, and the decision-dialog/ContactProfile skeletons) are all still in and are genuine improvements, but THIS dialog-animation change is the one that fixes the Work/CRM crack the user actually sees.

---

## 2026-10-03 — Issue 6a: UI briefly "cracks" when opening a new screen / floating dialog  ✅ FIXED (partial — transition mechanics + loading skeletons)

**Fixes applied (5 edits, verified on emulator — no regressions):**

1. **`.kr-page-in` → opacity-only** · `src/index.css:2352`. Dropped the `translate3d(0,10px,0)` so `<main>` is never transformed and never becomes a containing block for `position:fixed` descendants. Kills the end-of-animation snap on every navigation. Keeps the fade.
2. **Navigation-aware scroll-unlock** · `src/components/mobile/BottomSheet.jsx` (lockState + `lockBodyScroll`/`unlockBodyScroll`). Records `lockedPath` at lock time; if the pathname changed by unlock time (closed-as-part-of-navigation / Android Back), it still fully un-freezes but **skips** restoring the old scroll position and the 40-frame settle loop, so the new page isn't yanked. Same-page close is byte-for-byte unchanged (preserves ASK-47). Also cancels a stale settle rAF on re-lock.
3. **Fade the floating chrome** · `src/index.css:760`. Added `transition: opacity/visibility 180ms` to `[data-mobile-chrome]:not(.kr-vignette)` so the dock/FAB fade instead of blinking when a dialog opens/closes mid-navigation. Scoped off the vignette (it owns its own 260ms transition).
4. **`--ui-scale` width-guard** · `src/hooks/useUiScale.js`. Compare the computed scale and skip the write when unchanged, so a keyboard open/close (height-only, + Android width jitter) no longer re-runs the full-document `zoom` reflow mid-transition. Rotation/desktop resize still apply.
5. **ErrorBoundary resets on navigation** · `src/App.js` (new `RoutedBoundary` wrapper feeds `resetKey={location.pathname}`). A thrown screen now clears on route change instead of sticking on the error card until reload. (Separate latent bug, shipped alongside.)

**Verification:** rebuilt release APK (Railway backend) → emulator. Desk loads at correct scale; decision dialog opens full/clean (dock hidden via fade); closing restores Desk (dock back, correct scroll, no stuck body-pin); Work↔Desk smooth. Note: the glitch was only a few-ms flash even before and is near-invisible on the fast emulator, so the decisive test is the user's physical phone where it was visible — root causes are removed in code with no regressions observed.

---

### (original diagnosis below)

## 2026-10-03 — Issue 6: UI briefly "cracks" when opening a new screen / floating dialog  🔍 DIAGNOSED

**Symptom (user):** a few-millisecond visual glitch *during render* that corrects itself; happens **most when tapping buttons that open new screens / floating dialog screens**, on any screen, seemingly random.

**Reproduction:** on the emulator, tab/card/detail/decision navigations all *recover* and no JS errors appear in the webview logs — confirming it's a **transition/animation timing glitch**, not a crash. The one frame caught: a detail screen slides in briefly **offset-right and clipped**, then settles. On a fast emulator it flashes; on a slower phone it lingers.

**Root cause — no single coordinator for navigation; several effects mutate `<body>`/`<main>`/chrome in the same frames.** The "self-corrects in a few ms" symptom points at these (ranked):

1. **`.kr-page-in` transform on `<main>` every route change** — `Layout.js:338-361` + `index.css:2352-2367`. A 320ms `translate3d` on `<main>` makes it a **containing block for any `position:fixed` descendant**, so a page's own fixed/sticky bars are mis-anchored to `<main>` for 320ms then snap to the viewport. (KM-33 comment at `index.css:2357` documents this exact hazard; they moved `both`→`backwards` so it no longer *sticks*, but the transform is still live for the whole animation.) **This is the classic brief-crack-on-every-new-screen.**
2. **Scroll-lock restore loop (floating dialogs/sheets)** — `components/mobile/BottomSheet.jsx:98-181`. On open it pins the underlying page (`position:fixed; top:-Ypx` or snaps the app-scroller every frame). On close/navigate, `unlockBodyScroll` runs a **40-frame `requestAnimationFrame` loop** calling `window.scrollTo` to beat Radix's lingering `overflow:hidden`; after navigation the new page's height differs, so it visibly yanks the fresh page's scroll for ~40 frames. Depth-counted global singleton → opening a sheet then navigating from inside it can mismatch.
3. **Floating dock / FAB vanish via global `:has()`** — `index.css:760-766`. `body:has([role="dialog"][data-state="open"]) [data-mobile-chrome] { opacity:0; visibility:hidden }`. During the frames where a dialog's `data-state` is `open` while the route is already changing (Radix open/exit vs route timing), the **entire bottom nav briefly disappears** → reads as broken. Intermittent by nature. Directly matches "floating dialog screens."
4. **`--ui-scale` zoom reflow on keyboard** — `useUiScale.js:80-85` + `index.css:782`. Opening a screen/dialog that autofocuses a field (e.g. `DecisionDialog.js:149` `.focus()`) pops the keyboard → `resize` → whole-document `zoom` reflow at the same instant `.kr-page-in` + scroll-restore are running. Three reflow sources on one frame.
5. **Dex `theme-x` cross-fade** — `Layout.js:292-308` + `index.css:1348-1360`. Entering/leaving `/brain` puts a 480ms `transition` on **every node** (`*,*::before,*::after !important`); anything that paints in that window animates its colors unexpectedly.

**Separate latent bug (NOT the user's symptom — would *persist*, not self-correct):** `App.js:189` wraps `<Routes>` in `<ErrorBoundary>` with **no `resetKey`** (`ErrorBoundary.jsx:39-43`), so if any screen throws during render the whole shell is replaced by the "Something broke here" card and **doesn't clear on navigation** — only a reload recovers. Worth fixing, but it's a different failure mode than the brief glitch.

**Most likely fix direction (when we decide):** coordinate the navigation window — e.g. gate/shorten `.kr-page-in`, make the scroll-lock restore navigation-aware (skip the 40-frame yank on route change), and drive the dock-hide off React state tied to a committed "dialog open" rather than a live-DOM `:has()`. Nothing changed yet.
