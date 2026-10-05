"""Device push tokens — the client half of FCM delivery.

A Capacitor install registers its FCM token here once the user grants
notification permission; ``services.push_fcm`` sends to whatever is stored.

One row per token. A token is per-INSTALL, not per-user: signing in as someone
else re-homes the same token to the new user (the upsert keys on the token), and
signing out deletes it, so the next person on a shared phone never inherits the
previous person's notifications — the mobile cousin of the drafts fix in
JOURNEY-1 J12.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core import db, get_current_user, now_iso

router = APIRouter(prefix="/api")


class DeviceInput(BaseModel):
    token: str
    platform: Optional[str] = None


@router.post("/devices")
async def register_device(inp: DeviceInput, user: dict = Depends(get_current_user)):
    token = (inp.token or "").strip()
    if not token:
        return {"ok": False}
    await db.device_tokens.update_one(
        {"token": token},
        {
            "$set": {
                "token": token,
                "user_id": user["id"],
                "tenant_id": user["tenant_id"],
                "platform": (inp.platform or "").strip() or "android",
                "last_seen": now_iso(),
            },
            "$setOnInsert": {"created_at": now_iso()},
        },
        upsert=True,
    )
    return {"ok": True}


@router.delete("/devices/{token}")
async def unregister_device(token: str, user: dict = Depends(get_current_user)):
    # Scoped to the signed-in user so one person cannot drop another's device.
    await db.device_tokens.delete_one({"token": token, "user_id": user["id"]})
    return {"ok": True}
