# Backup & Restore Runbook (S5-04)

**Objective (RPO/RTO):** RPO ≤ 24h (nightly automated snapshot) or ≤ 1h if PITR
is enabled; **RTO ≤ 1h** to restore into a fresh cluster. A backup you have never
restored is not a backup — the drill below MUST be run before GA and quarterly.

## 1. Automated backups

- **Managed (recommended):** on Mongo Atlas / Railway managed Mongo, enable
  **daily snapshots + continuous PITR** in the provider console; retention ≥ 7
  days. This is the primary backup — configure it once, verify it's on.
- **Self-managed fallback (nightly `mongodump`):** a scheduled job:
  ```bash
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  mongodump --uri "$MONGO_URL" --db "$DB_NAME" --gzip \
            --archive="/backups/decisionos-$STAMP.archive.gz"
  # ship off-box (different region/provider than the DB):
  aws s3 cp "/backups/decisionos-$STAMP.archive.gz" "s3://decisionos-backups/"
  ```
  Alert if the job fails or the newest object is > 26h old.

## 2. Restore

Restore into a **fresh, separate** database first — never overwrite a live DB
blind:
```bash
mongorestore --uri "$TARGET_MONGO_URL" --nsFrom "$DB_NAME.*" \
             --nsTo "restore_check.*" --gzip \
             --archive="/backups/decisionos-<STAMP>.archive.gz"
```
Then point a throwaway app instance at `restore_check`, run
`python scripts/migrate.py`, and smoke-test `/api/health` + a login + a desk read.

## 3. Restore drill (the part that makes this real, not a doc)

A **round-trip drill** — dump a scope, restore to a throwaway DB, verify counts
match — is scripted in `backend/scripts/restore_drill.py`. Run it against a
non-production DB:
```bash
cd backend && MONGO_URL=... DB_NAME=... python scripts/restore_drill.py
```
Record the date + RTO measured in the go/no-go (S5-10). **Do not tick the
Go-Live backup row TRUE until a drill has passed.**

## 4. Escalation

Data-loss incident → declare, stop writes (scale app to 0), identify the last
good snapshot, restore to a NEW cluster, repoint `MONGO_URL` (secrets store),
`scripts/migrate.py`, smoke test, resume. Post-mortem within 48h.
