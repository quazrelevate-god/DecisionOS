# DecisionOS — project context

Orientation for the repo: branches, tags, layout, commands, deploy. Companion to
`HANDOFF.md` (state of play) and `MIGRATION-FOLLOWUPS.md` (work queue + backend
specs).

> **This repository is public.** Nothing about credentials, access, accounts or
> local machine paths belongs in this file or any other tracked file. Access
> details are held privately by the repo owner.

---

## 1. Repository

| | |
|---|---|
| Repo | [`quazrelevate-god/DecisionOS`](https://github.com/quazrelevate-god/DecisionOS) |
| Visibility | Public |
| Clone | `https://github.com/quazrelevate-god/DecisionOS.git` |
| Default branch | `main` |

---

## 2. Branches

| Branch | Purpose | State |
|---|---|---|
| `main` | The client's live line, written by the Emergent platform rather than by hand | untouched by this work |
| `design-system` | The design system library — tokens, 23 components, the gallery | merged forward into the migration branch |
| `design-system-migration` | **Active branch.** App migration, palette override, type/radius, UX batch | current work |

**Nothing has been merged to `main`.** The merge is gated on branch protection
plus an Emergent workspace re-import — see `HANDOFF.md` §5.

### Tags, oldest to newest

`ds-base` · `ds-phase-1` · `ds-phase-2` · `ds-phase-3` · `ds-phase-4` ·
`ds-phase-4b` · `mig-m2` · `mig-m3` · `mig-m6` · `mig-m7` · `mig-palette-closed` ·
`ds-type-radius` · `ux-frontend-batch`

`ds-base` marks the last platform-generated commit before this work began — the
merge base.

### How `main` is written

`main` is written by an automated Emergent agent from a cloud environment.
Verified from the GitHub activity API: it has only ever touched `refs/heads/main`
and has never force-pushed. That environment has never seen these branches, which
is why a re-import is required before it pushes again after any merge.

---

## 3. Layout

```
DecisionOS/                          repo root — app root is frontend/
├── frontend/                        React 19 + CRA/CRACO + Tailwind
│   ├── src/lib/tokens.js            SOURCE OF TRUTH for design tokens
│   ├── src/index.css                GENERATED — never hand-edit
│   ├── src/lib/whatMatters.js       editorial layer: what matters today
│   ├── src/lib/safeText.js          render-layer guard for internal strings
│   ├── src/components/ds/           the design system (23 components)
│   ├── src/dev/previewMock.js       dev-only API stub
│   ├── scripts/gen-tokens.js        tokens → CSS
│   └── scripts/sweep.js             legacy-class codemod + palette audit
├── backend/                         FastAPI + MongoDB (untouched by this work)
├── HANDOFF.md                       state of play
├── MIGRATION-FOLLOWUPS.md           backlog + backend specs
└── PROJECT-CONTEXT.md               this file
```

Screenshot tooling and per-phase `git bundle` backups are kept outside the repo.

---

## 4. Commands

```bash
# dev server (port auto-assigns; 3000 is often taken)
cd frontend && yarn start

# the gate: token drift + ds lint + full test suite
cd frontend && yarn verify:ds

# regenerate CSS custom properties after editing tokens.js
cd frontend && node scripts/gen-tokens.js

# legacy-class sweep / palette audit — dry run first
cd frontend && node scripts/sweep.js --dry src/pages/Foo.js
```

Node 24 builds cleanly. No lockfile is committed — the repo never had one. `yarn`
is not assumed to be installed globally; `npx --yes yarn@1.22.22 <cmd>` works.

---

## 5. Deploy

Deployed on **Railway** from the `design-system-migration` branch.

- **App root is `frontend/`**, not the repo root.
- Build: `yarn build` (Create React App via CRACO) → `frontend/build/`.
- Environment variables are `REACT_APP_*` and are **baked in at build time** —
  changing one needs a rebuild, not a restart:

| Variable | Production value |
|---|---|
| `REACT_APP_BACKEND_URL` | the backend origin; the client calls `${it}/api` |
| `REACT_APP_PREVIEW_MOCK` | **unset or `0`** — `1` enables the dev-only API stub in `src/dev/previewMock.js` |

`frontend/.env.local` is gitignored, so these never arrive from the repo and must
be set in the deploy environment.

---

## 6. Third-party services

Referenced in `backend/requirements.txt` and app config. **All keys are held by
the client; none are in this repo.**

Anthropic Claude (primary LLM) · OpenAI · Google Gemini · Sarvam AI (Indic
speech-to-text) · Stripe · Resend · AWS S3 · MongoDB · Emergent.
