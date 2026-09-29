# B19 · Making an invite link open the app

**Status: one value left, and it is a deploy setting.** Both sides are in
place and the host is now real — `www.decisionos.biz`, set 2026-09-29. What
remains is `ANDROID_APP_FINGERPRINT` on the Railway deploy; the value is in
this file.

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

### 1. ~~The host~~ — set 2026-09-29

`frontend/android/variables.gradle`:

```groovy
appLinkHost = 'www.decisionos.biz'
```

**www only, deliberately.** Checked on 2026-09-29:

| Host | DNS | https |
|---|---|---|
| `www.decisionos.biz` | CNAME → `9iqmrlup.up.railway.app` | 200 |
| `decisionos.biz` | A → `69.46.46.71`, no CNAME | **no listener — the request never completes** |

Android verifies by fetching `https://<host>/.well-known/assetlinks.json`, and
**below Android 12 one unverifiable host fails verification for every host in
the filter.** minSdk here is 24, so adding the apex today would break the www
links on a large share of real phones and gain nothing. Add it to the filter
once it resolves over https and serves the same file.

**The links have to USE that host.** The backend builds invite, reset and
verification URLs from `APP_BASE_URL` (falling back to `REACT_APP_BACKEND_URL`,
then `FRONTEND_ORIGIN` — `routers/auth._app_base_url`). If that says anything
other than `https://www.decisionos.biz`, the emails point somewhere the filter
does not claim and nothing opens the app. Check it on the deploy.

### 2. The signing fingerprint — the one thing left

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
