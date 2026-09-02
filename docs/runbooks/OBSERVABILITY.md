# Observability (S5-03)

Error tracking, structured logs, and request correlation — all opt-in via env,
implemented in `backend/core/observability.py` and wired in `server.py`.

## What's shipped

- **Sentry** error + performance tracking (`init_sentry`) — active when
  `SENTRY_DSN` is set and `sentry-sdk` is installed (in `requirements.txt`). PII
  is never sent (`send_default_pii=False`). No-op when unset.
- **Structured JSON logs** (`configure_logging`) — set `LOG_FORMAT=json` to emit
  one JSON object per line (`ts, level, logger, msg, request_id`) for a log
  aggregator. Default stays human-readable.
- **Request-id correlation** — every request gets an `X-Request-ID` (honored from
  the header or generated); it's returned in the response and attached to every
  log line and Sentry event, so one request is traceable end to end.

## Enable in production (deploy platform env)

```
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
SENTRY_TRACES_SAMPLE_RATE=0.1     # perf sampling; 0.0 = errors only
ENV=production
RELEASE=$GIT_SHA                  # ties an error to the exact build
LOG_FORMAT=json
```

Nothing else changes; the app runs identically with these unset.

## Verify

- Boot logs show `Sentry error tracking initialised (env=production)` when the DSN
  is set; a missing `sentry-sdk` logs a warning and continues (never crashes boot).
- `curl -i .../api/health` returns an `X-Request-ID` header.
- With `LOG_FORMAT=json`, log lines are valid JSON carrying `request_id`.

## Dashboards / alerts (wire on the platform)

- Sentry alert on new-issue + error-rate spike → ops channel (feeds S5-09
  checkpoints and the rollback trigger).
- Log-based alerts on 5xx rate and p95 latency from the JSON logs / APM.
