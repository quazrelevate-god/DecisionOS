# Secrets Management (S5-08)

**Rule:** production secrets live ONLY in the deploy platform's secret store and
GitHub Actions secrets — never in a file in the repo or the image.

## Verified in this repo (the "never in the image/git" half)

- `.env` is git-ignored — `.gitignore` lines 106-108 (`.env`, `.env.*`, `*.env`)
  and `git ls-files` shows no `.env` tracked. ✅
- `.env` is excluded from the Docker image — `backend/.dockerignore` lines 5-8
  exclude `.env*` (keeping only `.env.example`), so `COPY . /app` never bakes it. ✅
- Only `.env.example` (placeholder values) is committed, as the documented shape.

## Secrets inventory (rotate + host in the vault)

`JWT_SECRET`, `PLATFORM_ADMIN_JWT_SECRET`, `MONGO_URL` (DB creds),
`EMERGENT_LLM_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`SARVAM_API_KEY`, `RESEND_API_KEY`, WhatsApp `WA_*`, and (optional) `SENTRY_DSN`,
`RAILWAY_TOKEN`.

## Procedure (one-time before GA, then on any suspected exposure)

1. **Generate fresh values** for every secret above (do NOT reuse any value that
   ever sat in a committed/shared `.env`). e.g. `JWT_SECRET`:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
2. **Store** them in the platform secret store (Railway/Render **Variables**) for
   each environment (staging, production) — never the same DB/keys across envs.
3. **CI/CD secrets:** add `MONGO_URL`, `JWT_SECRET`, `EMERGENT_LLM_KEY`,
   `RAILWAY_TOKEN`, `DB_NAME` as **GitHub Actions repository secrets** (used by
   `tests.yml` + `deploy.yml`).
4. **Rotate** the old values out at the provider (revoke old API keys; change the
   DB user password; the JWT rotation invalidates existing sessions — expected).
5. **Verify** nothing is baked: `docker build` then
   `docker run --rm <img> sh -c 'ls -a /app | grep -c "^\.env$"'` → must print `0`.
6. Record the rotation date here and tick the Go-Live "secrets" row (S5-10).

## Ongoing

- Least-privilege DB user (no cluster-admin for the app).
- Rotate on any suspected exposure or team-member offboarding.
- Never log a secret — `services/ai/pii.py` redaction + the JSON logger (S5-03)
  keep secrets out of observability sinks.
