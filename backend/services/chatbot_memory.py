"""Chatbot conversation memory — the ONE place that reads/writes the two
`chatbot_conversations` and `chatbot_messages` collections.

Design invariant (do NOT weaken):
  Every function's first parameter is `user: dict` (the authenticated user
  from get_current_user), not a bare user_id string. The mandatory `_scope(user)`
  filter is prepended to every DB query. This makes it structurally impossible
  to accidentally query without a user_id — the code cannot be written that way.

Collections:
  chatbot_conversations {
    id, tenant_id, user_id, user_role, title, message_count,
    is_deleted, created_at, updated_at,
  }
  chatbot_messages {
    id, conversation_id, tenant_id, user_id, role: "user"|"assistant",
    content, sources, kpis, table, refusal_reason, source_engine, created_at,
  }
"""
from typing import Optional

from core import db, new_id, now_iso


# ---------------------------------------------------------------------------
# THE ONLY DB FILTER — do not query these collections without going through it.
# ---------------------------------------------------------------------------
def _scope(user: dict) -> dict:
    """The mandatory tenant+user scope filter for ALL chatbot reads/writes.
    A `user` dict without both id and tenant_id would already fail auth upstream
    (get_current_user rejects). This is defence-in-depth."""
    if not user or not user.get("id") or not user.get("tenant_id"):
        raise ValueError("chatbot_memory: user missing id or tenant_id")
    return {"tenant_id": user["tenant_id"], "user_id": user["id"]}


# ---------------------------------------------------------------------------
# Conversation lifecycle
# ---------------------------------------------------------------------------
async def create_conversation(user: dict, first_message: str = "") -> dict:
    """Create a new conversation owned by `user`. Title is inferred from the
    first message (first ~60 chars); the user can rename later."""
    title = (first_message or "New chat").strip()[:60] or "New chat"
    doc = {
        "id": new_id(),
        **_scope(user),
        "user_role": user.get("role") or "",
        "title": title,
        "message_count": 0,
        "is_deleted": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.chatbot_conversations.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def get_or_create_conversation(user: dict, conversation_id: Optional[str],
                                     first_message: str = "") -> dict:
    """If `conversation_id` is provided AND belongs to `user`, return it.
    Otherwise create a new one. Never returns another user's conversation —
    if the id is bogus or belongs to a different user, we transparently create
    a new conversation (the caller sees the new id back)."""
    if conversation_id:
        existing = await get_conversation(user, conversation_id)
        if existing:
            return existing
    return await create_conversation(user, first_message)


async def get_conversation(user: dict, conversation_id: str) -> Optional[dict]:
    """Return one conversation OWNED BY `user`, or None. Never leaks another
    user's conversation — the scope filter enforces ownership at the query."""
    if not conversation_id:
        return None
    filt = {**_scope(user), "id": conversation_id, "is_deleted": {"$ne": True}}
    return await db.chatbot_conversations.find_one(filt, {"_id": 0})


async def list_conversations(user: dict, limit: int = 40) -> list:
    """Every conversation the caller owns, newest first. Scoped by user_id."""
    filt = {**_scope(user), "is_deleted": {"$ne": True}}
    return await db.chatbot_conversations.find(
        filt, {"_id": 0}
    ).sort("updated_at", -1).limit(limit).to_list(limit)


async def rename_conversation(user: dict, conversation_id: str, title: str) -> bool:
    filt = {**_scope(user), "id": conversation_id, "is_deleted": {"$ne": True}}
    r = await db.chatbot_conversations.update_one(
        filt, {"$set": {"title": title[:120].strip() or "New chat", "updated_at": now_iso()}}
    )
    return r.matched_count > 0


async def soft_delete_conversation(user: dict, conversation_id: str) -> bool:
    filt = {**_scope(user), "id": conversation_id}
    r = await db.chatbot_conversations.update_one(
        filt, {"$set": {"is_deleted": True, "updated_at": now_iso()}}
    )
    return r.matched_count > 0


# ---------------------------------------------------------------------------
# Message read/write
# ---------------------------------------------------------------------------
async def append_message(user: dict, conversation_id: str, role: str,
                         content: str, extras: Optional[dict] = None) -> dict:
    """Append one message. Every row carries tenant_id + user_id + conversation_id
    so a raw find({conversation_id: X}) still can't leak cross-user."""
    if role not in ("user", "assistant"):
        raise ValueError("role must be 'user' or 'assistant'")
    msg = {
        "id": new_id(),
        "conversation_id": conversation_id,
        **_scope(user),
        "role": role,
        "content": (content or "")[:20000],
        "created_at": now_iso(),
    }
    if extras:
        # Whitelist keys allowed on a message document.
        for k in ("sources", "kpis", "table", "refusal_reason", "source_engine",
                  "response_type", "applied_filters"):
            if k in extras:
                msg[k] = extras[k]
    await db.chatbot_messages.insert_one(dict(msg))
    # Bump the conversation's counter + updated_at (only if THIS user owns it)
    await db.chatbot_conversations.update_one(
        {**_scope(user), "id": conversation_id},
        {"$inc": {"message_count": 1}, "$set": {"updated_at": now_iso()}},
    )
    msg.pop("_id", None)
    return msg


async def load_recent_messages(user: dict, conversation_id: str, cap: int = 12) -> list:
    """Load the last `cap` messages of this user's conversation, oldest→newest.
    Filters by user_id so another user's row physically cannot come back."""
    if not conversation_id:
        return []
    filt = {**_scope(user), "conversation_id": conversation_id}
    # newest-first, take cap, then reverse for chronological order
    latest = await db.chatbot_messages.find(
        filt, {"_id": 0}
    ).sort("created_at", -1).limit(cap).to_list(cap)
    return list(reversed(latest))
