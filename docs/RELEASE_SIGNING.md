# Signing a release build

**Created 2026-09-29**, because `assembleRelease` used to emit an unsigned APK
that Android refuses to install — so there was no way to test a real release
build on a phone.

## The two files, and why they are not in git

| File | What it is |
|---|---|
| `frontend/android/release.keystore` | the signing key — RSA 2048, valid 10,000 days |
| `frontend/android/keystore.properties` | its passwords, alias and path |

Both are **gitignored**, and `frontend/android/.gitignore` was changed to make
that true: Android's own template ships those lines commented out, so a
keystore dropped in would have been committed. A signing key in a git history
is a signing key that anyone who can clone the repo can sign as — and an APK
signed with it is one Android accepts as DecisionOS.

Both are `chmod 600`. Neither is printed anywhere; the passwords exist only in
`keystore.properties`.

## Back them up, off this laptop

Right now this key exists in exactly one place. **Copy both files somewhere
that is not this laptop and not this repository** — a password manager's
secure-file slot is ideal.

How much that matters depends on a choice nobody has made yet:

- **With Play App Signing** (the default for new apps on Play, and the one to
  take) Google holds the real app signing key. What is in this repo is then
  only the *upload* key, and if it is lost Google can reset it. Recoverable.
- **Without it**, this key *is* the app's identity for ever. Lose it and the
  app on Play can never be updated again — not by you, not by anyone. The only
  way out is a new listing under a new package name, which means every
  installed copy is orphaned.

Until the app is on Play, neither applies: nothing has been published with this
key, so it can be deleted and regenerated freely.

## Building

```bash
cd frontend
npm run cap:sync:prod
cd android && ./gradlew assembleRelease
```

Out at `frontend/android/app/build/outputs/apk/release/app-release.apk`.

`cap:sync:prod` is the important half — it builds with
`REACT_APP_BACKEND_URL=https://backend-production-c8640.up.railway.app`. Plain
`cap:sync` reads `frontend/.env`, which says `http://localhost:8000`, and on a
phone localhost is the phone: every API call fails, and a release build has no
cleartext exemption to even try. **A release APK must always be built with
`cap:sync:prod`.**

If gradle cannot find a JDK or the SDK:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

## Checking it really is signed

Do not trust the filename — an unsigned build is named `app-release-unsigned.apk`,
but that is a convention, not a guarantee.

```bash
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --verbose --print-certs \
  frontend/android/app/build/outputs/apk/release/app-release.apk
```

`Verifies` and `APK Signature Scheme v2: true` is what you want. v1 (JAR
signing) being false is correct and not a problem: v1 is only needed below
API 24, and minSdk here is 24.

## A checkout without the key still builds

`app/build.gradle` reads `keystore.properties` only if it exists. Without it,
debug builds are unaffected and release builds produce an unsigned APK exactly
as they did before, with a warning saying so. A teammate or a CI box with no
key is no worse off than yesterday — only a build that *can* sign does.

## This key's fingerprint

```
E4:C5:7E:AD:34:CD:99:64:29:79:62:8D:6C:02:FE:7E:5C:A0:8B:65:C3:30:6D:1B:E5:02:57:B8:75:4A:8F:30
```

This is the SHA-256 of the certificate above, and it is exactly what
`ANDROID_APP_FINGERPRINT` wants — the second of the two values
[DEEP_LINKS.md](DEEP_LINKS.md) was waiting on, so invite links can open the app
instead of Chrome. Set it on the deploy that serves the web app.

One caveat: **if you later enable Play App Signing, this is no longer the
fingerprint that matters.** Play re-signs your upload with its own key, so the
installed app's certificate is Google's. Take that fingerprint from Play
Console → Setup → App integrity and use it instead — or list both, comma
separated, while a locally-signed build and a Play build are both in the wild.

## Rotating it

Before anything is published, rotation is just: delete both files and re-run

```bash
keytool -genkeypair -v -keystore release.keystore -alias decisionos \
  -keyalg RSA -keysize 2048 -validity 10000
```

from `frontend/android`, then update `keystore.properties` and the fingerprint
above. After publishing without Play App Signing, it cannot be rotated at all —
which is the whole reason the backup paragraph is near the top of this file.
