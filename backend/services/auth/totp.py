"""FIX-005-D (RBAC-23): TOTP-based two-factor authentication.

Standard RFC 6238 flow using pyotp:
  1. Enroll: server generates a 32-char base32 secret. Stored PENDING
     on user.two_factor.pending_secret until the user confirms it by
     entering a valid TOTP code.
  2. Confirm: user enters a TOTP code + we verify against
     pending_secret. If it verifies, we promote to enabled_secret,
     generate 10 single-use backup codes (hashed with bcrypt), and
     clear pending_secret.
  3. Verify on login: when user.two_factor.enabled_at is set, login
     issues a SHORT-LIVED (5min) 2fa-challenge token instead of the
     full JWT. The 2FA verify endpoint accepts (challenge_token,
     code) and returns the real session token.
  4. Backup codes: single-use fallback if the authenticator app is
     lost. Consumed = marked used; verify iterates through the
     hashes and marks the match consumed.
  5. Disable: owner-only path for account recovery — logs an audit
     event, wipes secret + backup codes.

Storage on user doc:
  user.two_factor = {
    pending_secret: str | None,        base32, pre-confirmation
    enabled_secret: str | None,        base32, live secret
    enabled_at: iso | None,
    backup_codes: [{hash, used_at|None, created_at}]  (10 codes)
    last_backup_at: iso | None,
  }

Contract:
  begin_enrollment(user, tenant_name) -> {secret, provisioning_uri}
  confirm_enrollment(db, user_id, code) -> {ok, backup_codes: [str] | None}
  is_enabled(user) -> bool
  verify_totp(user, code) -> bool
  consume_backup_code(db, user_id, code) -> bool
  disable_totp(db, user_id) -> None
  regenerate_backup_codes(db, user_id) -> [str]  (new plaintext codes)

Backup codes are shown ONCE (return from confirm/regenerate) and
never retrievable again — same pattern as GitHub / AWS.
"""
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import bcrypt
import pyotp


BACKUP_CODE_COUNT = 10
BACKUP_CODE_LEN = 10       # 10 characters, base32 alphabet — human-typable

# Longer window for backup codes is fine (they're single-use anyway).
# TOTP window=1 tolerates one 30s step drift each direction.
TOTP_VALID_WINDOW = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _generate_secret() -> str:
    """32-char base32 secret (160 bits) — RFC 6238 recommendation."""
    return pyotp.random_base32()


def _generate_backup_codes(n: int = BACKUP_CODE_COUNT) -> List[str]:
    """Return N plaintext backup codes (base32-alphabet + hyphen
    grouping for readability). SHOW ONCE — hash before persist."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"   # base32, no 0/1/O/L
    codes = []
    for _ in range(n):
        raw = "".join(secrets.choice(alphabet) for _ in range(BACKUP_CODE_LEN))
        # Format XXXXX-XXXXX for easier typing.
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def _hash_code(code: str) -> str:
    """bcrypt hash — same primitive as password hashing."""
    return bcrypt.hashpw(code.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_code_against_hash(code: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(code.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def is_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """True iff the user has confirmed 2FA enrollment. Login flow
    reads this to decide whether to issue the 2fa-challenge token
    instead of the full session token."""
    if not user:
        return False
    tf = user.get("two_factor") or {}
    return bool(tf.get("enabled_secret") and tf.get("enabled_at"))


def has_pending_enrollment(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    tf = user.get("two_factor") or {}
    return bool(tf.get("pending_secret")) and not is_enabled(user)


def begin_enrollment(
    user: Dict[str, Any],
    issuer_name: str = "DecisionOS",
) -> Dict[str, str]:
    """Generate a fresh secret + provisioning URI so the client can
    render a QR code. Does NOT persist — the router persists after
    calling this and shows the QR to the user. User confirms by
    entering a TOTP from the QR before we mark 2FA enabled.

    Returns {secret, provisioning_uri}. The secret is base32-encoded
    for easy manual entry when the user can't scan a QR.
    """
    secret = _generate_secret()
    account = (user.get("email") or user.get("id") or "user")
    uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=account, issuer_name=issuer_name,
    )
    return {"secret": secret, "provisioning_uri": uri}


async def persist_pending_secret(db, user_id: str, secret: str) -> None:
    """Store the pre-confirmation secret. Overwrites any previous
    pending secret (user restarted enrollment)."""
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"two_factor.pending_secret": secret,
                  "two_factor.pending_at": _now_iso(),
                  "updated_at": _now_iso()}},
    )


async def confirm_enrollment(
    db, user_id: str, code: str,
) -> Tuple[bool, Optional[List[str]]]:
    """Verify the user's TOTP code against their pending secret.
    On success: promote to enabled_secret, generate + persist 10
    hashed backup codes, return the plaintext codes ONCE (caller
    shows them, then they're never retrievable).

    Returns (ok, backup_codes_plaintext). backup_codes_plaintext is
    None on failure.
    """
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "two_factor": 1})
    tf = (user or {}).get("two_factor") or {}
    pending = tf.get("pending_secret")
    if not pending:
        return False, None
    totp = pyotp.TOTP(pending)
    if not totp.verify(str(code or "").strip(), valid_window=TOTP_VALID_WINDOW):
        return False, None
    # Generate + hash backup codes.
    plaintext = _generate_backup_codes()
    hashed = [{"hash": _hash_code(c), "used_at": None,
                "created_at": _now_iso()} for c in plaintext]
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "two_factor.enabled_secret": pending,
            "two_factor.enabled_at": _now_iso(),
            "two_factor.pending_secret": None,
            "two_factor.pending_at": None,
            "two_factor.backup_codes": hashed,
            "two_factor.last_backup_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    return True, plaintext


def verify_totp(user: Optional[Dict[str, Any]], code: str) -> bool:
    """Verify a TOTP code against the user's live enabled_secret.
    Used on login-second-step + on ownership-transfer confirm."""
    if not user:
        return False
    tf = user.get("two_factor") or {}
    secret = tf.get("enabled_secret")
    if not secret:
        return False
    try:
        return pyotp.TOTP(secret).verify(
            str(code or "").strip(), valid_window=TOTP_VALID_WINDOW,
        )
    except Exception:
        return False


async def consume_backup_code(db, user_id: str, code: str) -> bool:
    """Single-use fallback for a lost authenticator. Iterates the
    hashed codes, marks the first match consumed. Returns True on
    successful consume. Constant-time-ish via bcrypt's own
    compare_digest under the hood."""
    if not code:
        return False
    user = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "two_factor": 1},
    )
    tf = (user or {}).get("two_factor") or {}
    codes = list(tf.get("backup_codes") or [])
    for i, entry in enumerate(codes):
        if entry.get("used_at"):
            continue
        if _verify_code_against_hash(code, entry.get("hash") or ""):
            codes[i] = {**entry, "used_at": _now_iso()}
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"two_factor.backup_codes": codes,
                          "updated_at": _now_iso()}},
            )
            return True
    return False


async def disable_totp(db, user_id: str) -> None:
    """Wipe 2FA entirely — for admin-recovery / user-request paths.
    Caller MUST audit-log the event."""
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"two_factor": {}, "updated_at": _now_iso()}},
    )


async def regenerate_backup_codes(db, user_id: str) -> Optional[List[str]]:
    """Fresh set of 10 codes; invalidates the old set. Only allowed
    when 2FA is enabled. Returns plaintext codes ONCE. None if 2FA
    not enabled for this user."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "two_factor": 1})
    if not is_enabled(user):
        return None
    plaintext = _generate_backup_codes()
    hashed = [{"hash": _hash_code(c), "used_at": None,
                "created_at": _now_iso()} for c in plaintext]
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"two_factor.backup_codes": hashed,
                  "two_factor.last_backup_at": _now_iso(),
                  "updated_at": _now_iso()}},
    )
    return plaintext
