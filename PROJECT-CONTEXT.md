# DecisionOS — project context

Repo, branch, tooling and access reference. Companion to `HANDOFF.md` (state of
play) and `MIGRATION-FOLLOWUPS.md` (work queue + backend specs).

> **This repository is PUBLIC.** No tokens, keys or passwords in this file, or in
> any tracked file. Credential *locations* are recorded here; the values live
> outside the repo. See §5.

---

## 1. Repository

| | |
|---|---|
| Owner | `quazrelevate-god` (GitHub account, also holds admin) |
| Repo | `quazrelevate-god/DecisionOS` |
| Visibility | **Public** |
| Web | https://github.com/quazrelevate-god/DecisionOS |
| Clone (HTTPS) | `https://github.com/quazrelevate-god/DecisionOS.git` |
| Default branch | `main` |
| Local clone | `/Users/prasanna/Documents/DecisionOS` |
| Remote configured as | `https://quazrelevate-god@github.com/quazrelevate-god/DecisionOS.git` |

**Why the username is in the remote URL:** the macOS keychain holds several
`github.com` credentials (at least `levelupadmin`, `prsnabuilds`,
`quazrelevate-god`). Without the username in the URL, git picks one arbitrarily
and pushes fail with a confusing `403 denied to <wrong-user>`. Pinning the
username makes the helper select the right entry.

---

## 2. Branches

| Branch | Purpose | State |
|---|---|---|
| `main` | Client's live line. **Written to by the Emergent bot, not by us.** | `da5b238` — untouched since this work began |
| `design-system` | The design system library (tokens, 23 components, gallery) | merged-forward into the migration branch |
| `design-system-migration` | **Active branch.** Full app migration + palette override + type/radius + UX batch | current work |

**Nothing has been merged to `main`.** The merge is gated on branch protection
plus an Emergent workspace re-import — see `HANDOFF.md` §5 and
`MIGRATION-FOLLOWUPS.md`.

### Tags (oldest → newest)

`ds-base` · `ds-phase-1` · `ds-phase-2` · `ds-phase-3` · `ds-phase-4` ·
`ds-phase-4b` · `mig-m2` · `mig-m3` · `mig-m6` · `mig-m7` · `mig-palette-closed` ·
`ds-type-radius` · `ux-frontend-batch`

`ds-base` marks the last Emergent bot commit before any of this work started —
the merge base.

### The Emergent bot

`main` is written by `emergent-agent-e1 <github@emergent.sh>` from a cloud pod.
Verified from the GitHub activity API: it has **only ever touched `refs/heads/main`**
and has **never force-pushed**. It cannot reach this local clone. Its pod has never
seen our branches, which is why a re-import is required before it pushes again
after any merge.

---

## 3. Local layout

```
/Users/prasanna/Documents/DecisionOS      repo root (app root is frontend/)
├── frontend/                             React 19 + CRA/CRACO + Tailwind
│   ├── src/lib/tokens.js                 SOURCE OF TRUTH for design tokens
│   ├── src/index.css                     GENERATED — never hand-edit
│   ├── src/components/ds/                the design system (23 components)
│   ├── src/dev/previewMock.js            dev-only API stub
│   ├── scripts/gen-tokens.js             tokens → CSS
│   └── scripts/sweep.js                  legacy-class codemod + palette audit
├── backend/                              FastAPI + MongoDB (not touched by this work)
├── HANDOFF.md                            state of play
├── MIGRATION-FOLLOWUPS.md                backlog + backend specs
└── PROJECT-CONTEXT.md                    this file

~/Documents/decisionos-ds-backups/        OUTSIDE the repo
├── *.bundle                              per-phase git bundles (verified)
├── CREDENTIALS.local.md                  secrets — never committed
└── tools/                                shoot.js, diff.js, density.js + playwright
```

---

## 4. Commands

```bash
# dev server (port auto-assigns; 3000 is usually taken)
cd frontend && yarn start

# the gate: token drift + ds lint + full test suite (136 tests)
cd frontend && yarn verify:ds

# regenerate CSS custom properties after editing tokens.js
cd frontend && node scripts/gen-tokens.js

# legacy-class sweep / palette audit (dry run first)
cd frontend && node scripts/sweep.js --dry src/pages/Foo.js

# screenshot 42 shots across 17 routes, both themes, then compare two sets
cd ~/Documents/decisionos-ds-backups/tools
node shoot.js <label> <port>
node diff.js <before-label> <after-label>
```

Node 24 builds cleanly. No lockfile is committed (the repo never had one).
`yarn` is not installed globally — the working invocation is
`npx --yes yarn@1.22.22 <cmd>`.

---

## 5. Credentials — where they live

**Nothing secret is stored in this repo.**

| What | Where | Notes |
|---|---|---|
| GitHub PAT (`quazrelevate-god`) | **macOS keychain**, via git's `osxkeychain` helper | Has Contents: write. Verified by dry-run push. **No** Administration scope — cannot set branch protection or rulesets |
| GitHub PAT (`prsnabuilds`) | superseded | Lacked Contents: write on this repo; pushes 403'd |
| Backend `.env` | **does not exist locally** | Mongo URI, JWT secret, LLM keys — held by the client. The backend cannot run on this machine |
| Railway env vars | Railway project settings | See §6 |
| Plaintext copy of the above | `~/Documents/decisionos-ds-backups/CREDENTIALS.local.md` | Outside the repo, untracked, never pushed |

Retrieve the stored GitHub token:

```bash
printf 'protocol=https\nhost=github.com\nusername=quazrelevate-god\n\n' | git credential fill
```

Store or replace one:

```bash
printf 'protocol=https\nhost=github.com\nusername=quazrelevate-god\npassword=<TOKEN>\n\n' | git credential approve
```

### ⚠️ Rotate these

Two personal access tokens were pasted into a chat transcript during this work.
Treat both as compromised and rotate them at
https://github.com/settings/tokens — the `quazrelevate-god` one still has push
access to a public repo. Rotating costs nothing; leaving them does.

When reissuing, note that **Administration: read+write** is required to create
branch-protection rulesets via the API. The current token does not have it, which
is why protection was left to the browser UI.

---

## 6. Deploy

Deployed by the client (**Yokesh**) on **Railway**, from the
`design-system-migration` branch.

- **App root is `frontend/`**, not the repo root.
- Build: `yarn build` (Create React App via CRACO) → `frontend/build/`.
- Env vars, all `REACT_APP_*` and **baked in at build time** — changing one
  requires a rebuild, not a restart:

| Variable | Value | Notes |
|---|---|---|
| `REACT_APP_BACKEND_URL` | backend origin | client calls `${it}/api` |
| `REACT_APP_PREVIEW_MOCK` | **unset or `0`** in production | `1` enables the dev-only API stub in `src/dev/previewMock.js`; also guarded by `NODE_ENV !== "production"`, but do not rely on that alone |

`frontend/.env.local` is gitignored, so these will not arrive from the repo —
they must be set in Railway.

---

## 7. Related services seen in the repo

Present in `backend/requirements.txt` and app config; **all keys held by the
client**, none in this repo:

Anthropic Claude (primary LLM) · OpenAI · Google Gemini · Sarvam AI (Indic
speech-to-text) · Stripe (payments) · Resend (email) · AWS S3 via boto3 (object
storage) · MongoDB (via `motor`) · Emergent (`emergentintegrations`, the platform
that generated the app and still writes to `main`).
