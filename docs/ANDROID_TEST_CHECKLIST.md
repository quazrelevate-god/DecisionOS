# Android APK — what to test on a real phone

For the fixes made against `DecisionOS_Android_Bug_Report.md` on 2026-09-29.
Branch `mobile-capacitor`. Everything below was either verified in a browser or
on the Android 16 emulator; this list is the part that needs a **real phone**,
and the part I could not reach from here.

Tick a line, or write what actually happened. "Didn't get that far" is a useful
answer too.

---

## 0 · Building the APK you'll test

**Updated 2026-09-29: there is now a signed release build, and it is the one
to test.** A release APK is a different binary from a debug one — no
`debuggable` flag, no cleartext exemption, assets compressed — so it is the
only build that tells you what a real user gets.

```bash
cd frontend
npm run cap:sync:prod            # builds against the Railway backend, syncs android/
cd android && ./gradlew assembleRelease
adb install app/build/outputs/apk/release/app-release.apk
```

Three things to know before you install:

- **Uninstall any existing DecisionOS first.** The debug and release builds are
  signed with different keys, so installing one over the other fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. `adb uninstall com.decisionos.app`, or
  long-press the icon and uninstall. This also means **you lose the session**
  and start from sign-in each time you swap build types.
- **It talks to the live Railway backend.** `cap:sync:prod` bakes in
  `https://backend-production-c8640.up.railway.app`. Anything you create in
  this app is real: real workspace, real invites, real SMS. Plain `cap:sync`
  points at `localhost:8000`, which on a phone is the phone — never use it for
  a build you intend to install.
- **The signing key is in `frontend/android/`** and is gitignored. See
  [RELEASE_SIGNING.md](RELEASE_SIGNING.md) — it needs backing up off the
  laptop before this app ever goes to Play.

If gradle can't find a JDK or the SDK:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

---

## 0.5 · ROUND 2 — what changed since the first APK you had

**Build `versionCode 2` / `versionName 1.0.1`.** Everything in §1 onwards is
still the original bug-report list and still stands; this is the shorter list
of what is NEW since then. Each line says what to do and what a pass looks
like, so "it didn't do that" is a useful answer.

- [ ] **An invite link opens the app, not Chrome.** THE BIG ONE — it has never
  worked before. Send yourself an invite from Team on a phone that has the app
  installed, and tap the link from WhatsApp or SMS. **Pass:** DecisionOS opens
  on the sign-in screen with the invite on it. **Fail:** Chrome opens.
  If it fails, first check the link itself reads
  `https://www.decisionos.biz/login?invite=...` — if it is missing `https://`
  or says localhost, that is the backend's `APP_BASE_URL`, not the app.

- [ ] **The invite link is the right address at all.** Team → add a member →
  look at the link BEFORE sending. Pass: it starts
  `https://www.decisionos.biz/`. This is worth a look even if you do not
  complete the invite.

- [ ] **First launch with no signal says the right thing.** Turn on aeroplane
  mode, force-stop, open the app. **Pass:** "Can't reach DecisionOS — this
  phone can't get through to us right now", and the text is in the DecisionOS
  typeface, not the phone's default. **Fail:** it claims "You're still signed
  in" when you have never signed in on that device, or the letters look like
  ordinary Android text (that means the bundled fonts did not load).

- [ ] **It comes back on its own.** From that screen, turn the network back on
  and wait. Pass: it moves to sign-in or your Desk without you touching it.

- [ ] **Delete your own account.** Settings → Account → **Delete your
  account**. Press it and READ the screen, then press *Keep my account*.
  Pass: it lists each workspace and says what would happen to it. If you own a
  workspace with other people in it, it must REFUSE and tell you to hand it
  over first. Only go through with it on a throwaway account.

- [ ] **The web way out works too.** Open `www.decisionos.biz/delete-account`
  in a browser while signed out. Pass: it explains and offers sign-in. This is
  the URL Play is given, so it has to work for somebody who has uninstalled.

- [ ] **The privacy policy is reachable without an account.** Tap *Privacy* at
  the bottom of the sign-in screen, and check `www.decisionos.biz/privacy`
  in a browser.

- [ ] **Nothing is recording your screen.** Nothing to see — the check is that
  analytics now sends page views only, no session replay and no capture of
  button text. Flagged here so it is on the record, not because you can watch
  it happen.

- [ ] **Sanity: the app still signs in and loads.** Sign in with your number,
  open the Desk, open Money. Pass: no blank screens. Three teammates' work
  landed in this build alongside mine, so this is the "did anything collide"
  check.

**Note.** Installing this over an older DecisionOS will fail with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` if that one was a debug build — different
signing keys. Uninstall first, which also means you start from sign-in.

---

## 1 · THE ONE I MOST NEED YOU TO CHECK — the microphone (B02)

This is the P0 I fixed but could not watch work. The permission is declared and
Android now lists DecisionOS under Microphone, which is exactly what was
missing — but I never got a signed-in session on the emulator to see the prompt
appear.

- [ ] **First mic tap raises Android's permission dialog.** Desk → the big mic
      in the middle. A dialog should appear asking to allow the microphone.
      *(If nothing appears and you get an error toast: stop, tell me, this is
      still broken.)*
- [ ] **Allow → speak → the ripple responds to your voice → stop → the words
      come back** in the "What you said" pop-up.
- [ ] **Next → Dex reads it → the decision appears** with tasks and people.
- [ ] Repeat from the **✦ button**, the **onboarding interview**, and a **voice
      note on a task** in My Work.
- [ ] **Deny the permission once** (or turn it off in Settings → Apps →
      DecisionOS → Permissions). The message should name the Android settings
      path and offer typing — not just "Microphone not available".
- [ ] DecisionOS appears in **Settings → Privacy → Permission manager →
      Microphone**.

---

## 2 · The back gesture (B01 — fixed earlier, verified on the emulator)

Worth re-checking on a real phone, because gesture navigation differs by
manufacturer (Samsung and Xiaomi especially).

- [ ] Desk → Money → back gesture → **Desk**, app still open.
- [ ] Finance → "Add expense" → back → **the pop-up closes, you stay on
      Finance**.
- [ ] A task sheet in My Work → back → **sheet closes, My Work stays**.
- [ ] The Dex capture pop-up mid-read → back → closes, and the decision still
      lands in Decisions.
- [ ] Desk with nothing behind it → back → **"Press back again to leave
      DecisionOS"** → back again inside 2s → app exits.
- [ ] Sign-up: back walks the steps backwards rather than leaving.
- [ ] If your phone uses the **three-button** navigation, check the same list
      with the Back button.

---

## 3 · Invites (B03)

**This one needs the backend deployed** — the fix is server-side. If Railway
hasn't been redeployed since today, you'll still see `localhost` and that is
expected, not a regression.

- [ ] Team → a member → invite link → **Copy**. Paste it somewhere and read it:
      it should start with your real domain, **not `https://localhost`**.
- [ ] Share the same link on **WhatsApp** — check the link in the message.
- [ ] Send it to a second phone, open it, and **sign in as that member**.
- [ ] Do the same for a **newly added** member (the link offered right after
      you add someone).

---

## 4 · A bad connection (B04)

- [ ] Sign in. Force-stop the app. **Turn on airplane mode.** Reopen.
      → You should see **"Can't reach DecisionOS · You're still signed in"**,
      *not* the sign-in screen.
- [ ] Turn airplane mode off without touching the app. → It should find its way
      to the Desk **on its own** within about 15 seconds.
- [ ] Press **"Try now"** while still offline — it should stay put and not
      throw you out.
- [ ] Ride a lift or walk into a basement with the app open. Nothing should
      bounce you to sign-in.
- [ ] On a genuinely slow connection, screens should give up and show something
      within ~30s rather than spinning forever.

## 5 · Signing out (B07)

- [ ] Settings → **Sign out** → force-stop → reopen. → Sign in screen.
- [ ] Do it again on a **shared phone** if you have one: after signing out,
      the next person must not see your Desk.
- [ ] Sign out while **offline** — it should still let you go within a few
      seconds rather than hanging.

## 6 · The Desk when something fails (B10)

- [ ] Airplane mode, then open the Desk. Tiles should read **"—"**, never sit
      on "…" for ever, and **Workflows must not say 0**.
- [ ] A strip should appear saying some numbers couldn't be loaded, with
      **Refresh**. Press it once you're back online — the numbers should fill in.

## 7 · Invite links that have gone bad (B09)

- [ ] Open an **expired or already-used** invite link on a phone.
      → "This invite link doesn't work any more", naming what to do.
      → **"Start a new company with this number" must NOT be offered.**
- [ ] While an invite is opening, the form should be replaced by "Opening your
      invite…" rather than being typeable.

## 8 · The OTP screen (B11)

- [ ] Sign in with your number on the **production** build.
      → **No "Dev OTP" toast**, and the boxes are **not** auto-filled.
      *(If you ever see that toast on a production build, tell me immediately —
      it would mean the server is sending the code back in the response.)*

---

## 9 · Sanity sweep while you're in there

- [ ] The app opens on the sign-in screen with **no "Create a workspace" button
      in the middle of the header** (it was removed on your instruction).
- [ ] Nothing scrolls sideways on any screen.
- [ ] Type a decision (no mic) on the Desk and approve it end to end.
- [ ] Add a task, complete it, attach a photo.
- [ ] Set the phone's font size to the largest setting and look at the Desk —
      the report flagged overlap there and I have not touched it yet.

---

## What I already know is still broken (don't waste time on these)

These are on my list, not yours:

- Onboarding loses the website scan and interview answers if the app is killed
  mid-signup (B05).
- "Apply to my OS" does nothing when you skipped the interview (B06).
- The APK still carries ~25 MB it doesn't need — source maps and internal PDFs
  (B08). Being fixed now.
- Currency sometimes uses the phone's locale (₹6,486,000 instead of ₹64,86,000)
  (B13).
- Invite, reset and verify links open in Chrome rather than the app (B19) —
  needs a domain and `assetlinks.json`.
- No push notifications (B33).

## How to report back

Line number or ID, and what you saw. A screenshot beats a description for
anything visual. If the mic still fails, the most useful thing you can send is:

```bash
adb logcat -d | grep -i -E "permission|audio|capacitor" | tail -40
```
