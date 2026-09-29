# Publishing DecisionOS to Google Play — the steps

**Written 2026-09-29.** The companion to
[PLAY_STORE_READINESS.md](PLAY_STORE_READINESS.md), which says what would get
you rejected. This one is the running order.

Console UIs move. Where a menu path is given, it is a signpost, not a promise —
if the wording has changed, the *thing being asked for* has not.

**You need:** a Google account, a one-off **$25** registration fee, and the
signed bundle. Everything else below is forms.

**Your bundle is already built and signed:**

```
~/Documents/DecisionOS-release-v1.0.1/DecisionOS-v1.0.1-2.aab
```

11 MB, `versionCode 2`, `versionName 1.0.1`, signed, verified, and run on an
emulator.

---

## 0 · Two things to settle before you touch the Console

**Move the signing key off this laptop.** It is staged at
`~/Documents/DecisionOS-SIGNING-KEY-BACKUP/` with a README. Put it in a
password manager's secure-file slot. Do this first, because step 3 is where
losing it starts to matter.

**Decide which key survives.** Two exist — one on this Mac, one on the laptop
that made the first release build. Both are valid, neither has published.
**Whoever uploads first silently decides which is the app's identity for ever.**
Pick one, put it on both machines, delete the other.
[RELEASE_SIGNING.md](RELEASE_SIGNING.md) has both fingerprints.

---

## 1 · Register as a developer

play.google.com/console → pay the **$25 one-off**.

Choose the account type deliberately: **Organisation** if this ships as a
company, **Personal** if not. Changing it later is painful, and an organisation
account needs a D-U-N-S number and verification that takes days. Start this
early if you are going the company route.

---

## 2 · Create the app

**All apps → Create app.**

| Field | Answer |
|---|---|
| App name | DecisionOS |
| Default language | English (India) or English (US) |
| App or game | **App** |
| Free or paid | **Free** |
| Declarations | tick both (Play policies, US export law) |

The name is 30 characters maximum and appears under the icon on the phone.

---

## 3 · Opt into Play App Signing — the irreversible one

You meet this while creating your first release. **Opt in.**

- **With it**: Google holds the real signing key. Yours becomes an *upload* key
  — if it is lost, Google resets it. Recoverable.
- **Without it**: your keystore **is** the app's identity for ever. Lose it and
  the listing can never be updated by anyone. The only way out is a new listing
  under a new package name, which orphans every install.

There is no good reason to decline, and no way back afterwards.

One consequence worth knowing now: once Play re-signs your uploads, the
certificate on people's phones is **Google's**, not yours. So the
`ANDROID_APP_FINGERPRINT` that makes invite links open the app must be taken
from **Setup → App integrity** in the Console, not from your local keystore.
See [DEEP_LINKS.md](DEEP_LINKS.md).

---

## 4 · App content — the questionnaires that gate release

**Policy → App content.** Play will not let you roll out to *any* track,
internal testing included, until these are done. Most are minutes.

### 4.1 Privacy policy

```
https://www.decisionos.biz/privacy
```

Must be live and reachable signed-out before you submit. Confirm it is.

### 4.2 Data safety — the long one

**You already have every answer.** [PRIVACY.md](PRIVACY.md) was written in the
shape this form asks for; it is transcription, not thinking. Open it alongside.

The shape of it: mobile number, name, email, workspace records, money records,
voice recordings, uploaded files, IP and device info, screens opened, audit log
— all **collected**, all **linked to identity**, none used for tracking or ads,
all in transit over HTTPS.

Three answers that matter more than the rest:

- **Is data encrypted in transit?** Yes.
- **Can users request deletion?** Yes — and give the URL:
  `https://www.decisionos.biz/delete-account`
- **Is data shared with third parties?** Yes. The list is in PRIVACY.md
  (hosting, database, SMS, WhatsApp, analytics, AI providers, object storage).

Analytics is currently **off in production** because `REACT_APP_POSTHOG_KEY` is
unset on Railway. PRIVACY.md describes it as it behaves *with* the key, which
is over-disclosure — the safe direction. Declare it as described.

**Do not understate this form.** A false Data Safety declaration is a removable
offence, independent of anything else.

### 4.3 Content rating

A questionnaire about violence, sexual content, drugs, gambling. A business
tool answers "no" throughout and rates for everyone. Ten minutes.

### 4.4 Target audience

**18 and over.** No children. This avoids the Families policy programme
entirely.

### 4.5 The remaining declarations

Ads: **no**. News app: **no**. COVID-19 contact tracing: **no**. Government
app: **no**.

**Financial features: no.** The Console will ask, and the answer is worth
saying out loud: DecisionOS tracks a business's *own* money. It does not lend,
invest, transfer funds or broker anything, so none of the financial-services
declarations apply.

---

## 5 · Store listing

**Grow → Store presence → Main store listing.** This is the slowest step,
because two assets do not exist yet.

| Asset | Spec | State |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | **have it** — `frontend/public/icon-512.png` |
| Feature graphic | 1024×500 PNG/JPG | **does not exist** — design work |
| Phone screenshots | ≥2, 16:9 or 9:16, 320–3840px | **not captured** |
| Short description | 80 chars | to write |
| Full description | 4000 chars | to write |

For screenshots, `frontend/scripts/shots.mjs` captures phone-sized screens
(needs `npx playwright install` first). Raw captures are a starting point, not
a finished listing — but they are faster than staging a device by hand.

**Put the microphone and the offline state in the screenshots.** Reviewers look
at listings, and those two are the strongest evidence this is a real app rather
than a wrapped website — which is the policy risk
[PLAY_STORE_READINESS.md §3](PLAY_STORE_READINESS.md) describes.

---

## 6 · App access — do not skip this

**Policy → App access.**

This is where login-gated apps die. DecisionOS signs in by **OTP to an Indian
mobile number**, which a reviewer in another country cannot receive. Left
blank, the reviewer cannot get in and rejects the app.

You already have the answer. On the sign-in screen, **"Try DecisionOS on a live
workspace"** signs in as a role in one tap, no OTP, and the workspace is marked
as a demo.

Choose **"All or some functionality is restricted"** and write the taps out
literally:

> 1. Open the app.
> 2. On the sign-in screen, tap **"Try DecisionOS on a live workspace"**.
> 3. Choose any role. You are signed in — no code, no password.

No credentials required, so there is nothing to rotate afterwards.

---

## 7 · Internal testing — upload here first

**Testing → Internal testing → Create new release.**

1. Upload `DecisionOS-v1.0.1-2.aab`.
2. Release name defaults to `2 (1.0.1)`. Fine.
3. Release notes: "First internal build" will do.
4. **Save → Review release → Start rollout to internal testing.**

Then **Testers**: create an email list, add yourself and anyone testing, and
copy the opt-in link. Testers must accept it before the app appears for them.

Internal testing has **no review**, so builds are live in minutes rather than
days. Up to 100 testers.

### Read the pre-launch report

**Testing → Pre-launch report**, a few hours after upload.

Google installs the app on **real physical devices** and reports crashes, ANRs,
accessibility findings and screenshots across several models and Android
versions. It is the closest thing to a free device lab, and it will exercise
hardware neither the emulator nor this repo's testing has touched. Read it
before promoting anything.

---

## 8 · Promote onwards

Internal → **Closed testing** (a wider group, still no full review) →
**Production**.

Production review takes **a few days to a couple of weeks** for a new
developer account. First reviews are slower; later ones are faster.

---

## 9 · Every upload after the first

**`versionCode` must increase.** Play rejects a duplicate outright.

```bash
cd frontend
ANDROID_VERSION_CODE=3 ANDROID_VERSION_NAME=1.0.2 npm run cap:sync:prod
cd android && ./gradlew bundleRelease
```

Both variables are read by `android/variables.gradle`; unset, they default to
`2` / `1.0.1`. Bump the iOS numbers in step — they are matched by hand, in the
Xcode build settings (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`).

Per [DECISIONOS_MOBILE_APP_PLAN.md](DECISIONOS_MOBILE_APP_PLAN.md), **every
store build comes from a tagged commit** — tag first, build from the tag, so a
crash report maps to an exact tree:

```bash
git tag mobile-1.0.2-build3
```

---

## The short version

1. Back up the key; pick which of the two keys survives
2. Register, $25
3. Create the app
4. **Opt into Play App Signing**
5. App content: privacy policy, Data safety (from PRIVACY.md), rating, 18+
6. Store listing — feature graphic and screenshots are the long pole
7. **App access: the demo-login taps**
8. Internal testing → upload the `.aab` → read the pre-launch report
9. Closed testing → Production

Steps 5 and 6 are most of the clock. Everything else is an afternoon.
