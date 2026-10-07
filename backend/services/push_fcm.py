"""Device push (FCM) — the second delivery channel for notifications.

Every row written by ``services.notifications.push_notification()`` can also
reach the user's phone through Firebase Cloud Messaging, when BOTH halves are
present: a device token (registered by the Capacitor client via
``POST /api/devices``) and a Firebase service-account credential in the
environment.

Guarded on every side so it is safe to ship before either exists:
  • firebase-admin not installed  → disabled (logged once)
  • no service-account in the env → disabled (logged once)
  • no tokens for the recipients  → nothing sent
In those states ``send_push_to_users()`` is a no-op; the in-app bell rows are
written either way, so the product behaves exactly as it does today until the
credential and a device token both exist.

Credential, in order of preference (all optional, all SECRET):
  • FIREBASE_SERVICE_ACCOUNT       — the service-account JSON, inline
  • FIREBASE_SERVICE_ACCOUNT_FILE  — a path to that JSON on disk
  • GOOGLE_APPLICATION_CREDENTIALS — Google's default-credentials path
The service-account key must live in the environment only — never the repo,
never the client. (``google-services.json`` is a different, non-secret file
that ships inside the APK; do not confuse the two.)
"""
import asyncio
import base64
import binascii
import json
import os

from core import db, logger

# FCM accepts at most 500 tokens per multicast call.
_CHUNK = 500

_init_done = False
_enabled = False


def _init() -> bool:
    """Initialise firebase-admin once. Returns whether push is usable."""
    global _init_done, _enabled
    if _init_done:
        return _enabled
    _init_done = True
    try:
        import firebase_admin
        from firebase_admin import credentials
    except Exception:
        logger.info("[push] firebase-admin not installed — device push disabled")
        return False
    try:
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
        path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "").strip()
        if raw:
            # The env var holds the service account as a STRING. Parse it,
            # logging the exact reason on failure, and stop here if it is bad —
            # never fall through to a half-initialised app.
            try:
                sa = _parse_service_account(raw)
            except ValueError as e:
                logger.error(
                    f"[push] FIREBASE_SERVICE_ACCOUNT is set but could not be read "
                    f"({e}); device push disabled"
                )
                return False
            cred = credentials.Certificate(sa)
            logger.info(
                f"[push] service account loaded for project "
                f"'{sa.get('project_id', '?')}'"
            )
        elif path and os.path.exists(path):
            cred = credentials.Certificate(path)
            logger.info(f"[push] service account loaded from file {path}")
        elif os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            cred = credentials.ApplicationDefault()
            logger.info("[push] service account loaded from GOOGLE_APPLICATION_CREDENTIALS")
        else:
            logger.info("[push] no FIREBASE_SERVICE_ACCOUNT in env — device push disabled")
            return False
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        _enabled = True
        logger.info("[push] FCM device push ENABLED")
        return True
    except Exception as e:  # bad key, clock skew, SDK error — never crash a notify
        logger.warning(f"[push] FCM init failed, device push disabled: {e}")
        return False


def _parse_service_account(raw: str) -> dict:
    """Turn the FIREBASE_SERVICE_ACCOUNT env STRING into the credential dict.

    Accepts either the raw JSON (the usual Railway paste) or base64-encoded JSON
    (robust against a dashboard that mangles the multiline ``private_key``).
    Raises ``ValueError`` with a specific, loggable reason — the caller turns
    that into a clear log line and disables push rather than crashing.
    """
    # Drop a UTF-8 BOM (a common artifact of pasting out of a file — it is the
    # "char 0" that breaks json.loads), surrounding whitespace, and one matching
    # outer quote pair (FIREBASE_SERVICE_ACCOUNT="{...}").
    text = raw.strip().lstrip("﻿").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        text = text[1:-1].strip().lstrip("﻿").strip()
    # Base64 payloads never start with '{'; raw JSON always does.
    if not text.startswith("{"):
        # Treat it as base64-of-JSON. A pasted blob is often line-wrapped, so
        # drop whitespace first; then decode STRICTLY, so a value that is really
        # mangled JSON fails with a clear "not base64" message instead of being
        # silently decoded to garbage and then reported as "invalid JSON".
        try:
            text = base64.b64decode("".join(text.split()), validate=True).decode("utf-8")
        except (binascii.Error, ValueError, UnicodeDecodeError) as e:
            raise ValueError(f"not JSON (after BOM/quote strip), and not valid base64 either ({e})")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON ({e})")
    if not isinstance(data, dict):
        raise ValueError("parsed value is not a JSON object")
    missing = [k for k in ("private_key", "client_email", "project_id") if not data.get(k)]
    if missing:
        raise ValueError(f"JSON missing service-account field(s): {', '.join(missing)}")
    return data


def _is_dead_token(exc) -> bool:
    """A token FCM will never accept again — prune it from the store."""
    name = type(exc).__name__
    code = str(getattr(exc, "code", "") or "")
    return (
        "Unregistered" in name
        or "InvalidArgument" in name
        or "SenderIdMismatch" in name
        or code in {"UNREGISTERED", "INVALID_ARGUMENT", "SENDER_ID_MISMATCH"}
    )


def _send_sync(tokens, title, body, data):
    """Blocking FCM send (run off the event loop). Returns (sent, dead_tokens)."""
    from firebase_admin import messaging

    payload = {k: str(v) for k, v in (data or {}).items() if v is not None}
    dead = []
    sent = 0
    for i in range(0, len(tokens), _CHUNK):
        chunk = tokens[i:i + _CHUNK]
        msg = messaging.MulticastMessage(
            tokens=chunk,
            notification=messaging.Notification(title=title, body=body),
            data=payload,
            android=messaging.AndroidConfig(priority="high"),
        )
        resp = messaging.send_each_for_multicast(msg)
        for tok, r in zip(chunk, resp.responses):
            if r.success:
                sent += 1
            elif r.exception is not None and _is_dead_token(r.exception):
                dead.append(tok)
    return sent, dead


async def send_push_to_users(tenant_id, user_ids, title, body, data=None) -> None:
    """Fan a notification out to every registered device of the given users.

    Safe no-op when push is not configured or no recipient has a device token.
    """
    if not _init():
        return
    ids = [u for u in set(user_ids or []) if u]
    if not ids:
        return
    rows = await db.device_tokens.find(
        {"tenant_id": tenant_id, "user_id": {"$in": ids}},
        {"_id": 0, "token": 1},
    ).to_list(2000)
    tokens = sorted({r["token"] for r in rows if r.get("token")})
    if not tokens:
        logger.info(f"[push] '{title}': {len(ids)} recipient(s) but no registered device — nothing to send")
        return
    try:
        sent, dead = await asyncio.to_thread(_send_sync, tokens, title, body, data)
    except Exception as e:  # network, quota — the in-app row already landed
        logger.warning(f"[push] send failed: {e}")
        return
    logger.info(
        f"[push] '{title}' -> sent {sent}/{len(tokens)} to {len(ids)} user(s); pruned {len(dead)}"
    )
    if dead:
        await db.device_tokens.delete_many({"token": {"$in": dead}})
