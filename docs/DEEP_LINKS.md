# B19 · Making an invite link open the app

**Status: built, not switched on.** The code is in place on both sides. Two
values are missing, and neither of them is code.

## What happens today

An invite, a password reset or an email verification opens Chrome. The person
lands in the **web** app, signs in there, and the DecisionOS they installed is
still sitting on their home screen untouched.

Nothing is broken by this — the web app works — and it is why this was left
until last. It starts to matter the day push notifications ship, because a
notification that opens a browser instead of the screen it is about is
genuinely wrong, and both use the routing below.

## What is already done

| Piece | Where |
|---|---|
| The app lands on the right screen when Android hands it a link | `frontend/src/lib/native/links.js`, mounted in `hooks/useNativeBack.js` |
| Links that arrive while the app is open, and links that **started** it | same file — `appUrlOpen` and `getLaunchUrl` |
| The intent-filter Android needs | `frontend/android/app/src/main/AndroidManifest.xml` |
| The host it points at | `frontend/android/variables.gradle` → `appLinkHost` |
| The `assetlinks.json` Android fetches to verify it | `frontend/server.js`, route `/.well-known/assetlinks.json` |

Only `/login`, `/signup`, `/reset-password` and `/verify-email` are claimed.
The marketing site, the blog and the PDFs live on the same host and belong to
the browser, which is why the filter lists paths rather than the bare host —
and `links.js` makes the same decision again, because a link can also arrive
while the app is already running.

## The two missing values

### 1. The host

`frontend/android/variables.gradle`:

```groovy
appLinkHost = 'set-me.invalid'        // ← the host that serves DecisionOS
```

It is a placeholder on purpose. The web app's hostname is not in this
repository — the backend's is in `capacitor.config.ts`, the frontend's exists
only on the deploy — and a guessed host in a shipped manifest is worse than an
obvious blank, because it looks settled.

Set it to whatever serves the app (today a `*.up.railway.app` name, later the
real domain) and rebuild.

### 2. The signing fingerprint

Android verifies the link by fetching `https://<host>/.well-known/assetlinks.json`
and matching the **release** signing certificate of the installed app.

**As of 2026-09-29 this value exists.** There is now a release keystore
([RELEASE_SIGNING.md](RELEASE_SIGNING.md)), and its fingerprint is:

```
ANDROID_APP_FINGERPRINT=E4:C5:7E:AD:34:CD:99:64:29:79:62:8D:6C:02:FE:7E:5C:A0:8B:65:C3:30:6D:1B:E5:02:57:B8:75:4A:8F:30
```

Set that on the deploy that serves the web app. With the host below, that is
both missing values, and invite links start opening the app.

To read it again from the keystore yourself:

```bash
keytool -list -v -keystore frontend/android/release.keystore -alias decisionos | grep SHA256
```

Comma-separate several while a Play-signed build and a locally-signed one are
both in the wild — **Play App Signing re-signs your upload**, so once the app
is on Play the fingerprint that matters is Play's, from Play Console → Setup →
App integrity, and the one above stops applying to installs that came from the
store. Unset, the route answers 404, which is the honest answer: no
fingerprint means no claim, and Android keeps opening the browser. A file with
the *wrong* fingerprint is worse, because it looks configured and silently
never verifies.

## Turning it on

1. Set `appLinkHost`, rebuild, install.
2. Set `ANDROID_APP_FINGERPRINT` on the deploy; check
   `curl https://<host>/.well-known/assetlinks.json` returns the JSON over
   https with no redirect.
3. Verify Android agrees:
   ```bash
   adb shell pm get-app-links com.decisionos.app
   ```
   You want `verified` next to the host. `legacy_failure` or `1024` means the
   file could not be fetched or did not match.
4. Then test for real:
   ```bash
   adb shell am start -a android.intent.action.VIEW \
     -d "https://<host>/login?invite=abc123"
   ```
   The app should open on the invite sign-in, not Chrome.

## Until then

The finish screens for reset and verification could say "now open the
DecisionOS app and sign in with {number}". One line, and it stops the dead end
being silent. Say the word and I will add it.
