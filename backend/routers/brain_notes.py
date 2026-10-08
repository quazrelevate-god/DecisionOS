"""Company Brain — NOTES (2026-10-06, founder: "a company brain separately where
we will store all the data like policies, things, so they can upload it directly
to the brain").

The Brain is the company's knowledge: uploaded DOCUMENTS (routers/brain_docs)
and short NOTES ("Bluewave pays 30% advance", "Kumar Traders: call before 11").
Notes used to have no screen of their own -- they were written by the AI from
captures and shown only in the owner's Journal beside decisions. Now:

  GET    /api/brain/notes            everyone with Brain access; filtered by
                                     services/record_access.memory_scope
  POST   /api/brain/notes            owner + Manage Team (can_manage_brain)
  PATCH  /api/brain/notes/{id}       owner + Manage Team
  DELETE /api/brain/notes/{id}       owner + Manage Team -- gone from the index too

Each note carries the same "who can see" as a document, and is indexed beside
the documents (services/ai/brain_embed.index_note) so Dex finds it by meaning.
The Journal is decision history only.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, require_perm, new_id, now_iso
from services.record_access import can_manage_brain, memory_scope, FINANCE_TAGS

router = APIRouter(prefix="/api/brain/notes")

VISIBILITY = {"public", "dept", "private"}


class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    tag: Optional[str] = Field(default="note", max_length=40)
    visibility: Optional[str] = Field(default="public", max_length=20)
    department: Optional[str] = Field(default="", max_length=60)
    roles_allowed: Optional[str] = Field(default="", max_length=400)


class NotePatch(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    tag: Optional[str] = Field(default=None, max_length=40)
    visibility: Optional[str] = Field(default=None, max_length=20)
    department: Optional[str] = Field(default=None, max_length=60)
    roles_allowed: Optional[str] = Field(default=None, max_length=400)


def _roles(raw: Optional[str]) -> list:
    return [r.strip().lower() for r in (raw or "").split(",") if r.strip()][:20]


def _tag(raw: Optional[str]) -> str:
    t = re.sub(r"[^a-z0-9 _-]", "", (raw or "note").strip().lower())[:40]
    return t or "note"


def _source(n: dict) -> str:
    """Where a note came from, in words the owner reads."""
    if n.get("source"):
        return n["source"]
    if n.get("decision_id"):
        return "capture"
    if (n.get("tag") or "") in FINANCE_TAGS:
        return "finance"
    return "manual"


async def _names(tid: str) -> dict:
    return {u["id"]: u.get("name") for u in await db.users.find(
        {"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}


def _public(n: dict, names: dict) -> dict:
    return {
        "id": n["id"], "text": n.get("text") or "", "tag": n.get("tag") or "note",
        "visibility": n.get("visibility") or "public", "department": n.get("department") or "",
        "roles_allowed": n.get("roles_allowed") or [], "source": _source(n),
        "decision_id": n.get("decision_id"), "created_by": n.get("created_by"),
        "created_by_name": names.get(n.get("created_by")) or "Dex",
        "created_at": n.get("created_at"), "updated_at": n.get("updated_at"),
        "index_state": (n.get("index") or {}).get("state"),
    }


def _manage_or_403(user: dict) -> None:
    if not can_manage_brain(user):
        raise HTTPException(status_code=403, detail="Only the owner or someone with Manage Team can change the Company Brain.")


@router.get("")
async def list_notes(q: str = "", tag: str = "", user: dict = Depends(require_perm("brain"))):
    tid = user["tenant_id"]
    flt: dict = {"tenant_id": tid, "text": {"$nin": [None, ""]}, **memory_scope(user)}
    words = [re.escape(w) for w in q.split() if len(w) >= 2]
    if words:
        flt = {"$and": [flt, {"text": {"$regex": "|".join(words), "$options": "i"}}]}
    if tag.strip():
        flt = {"$and": [flt, {"tag": _tag(tag)}]}
    rows = await db.memory.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
    names = await _names(tid)
    return {"notes": [_public(n, names) for n in rows], "can_manage": can_manage_brain(user)}


@router.post("")
async def create_note(inp: NoteInput, user: dict = Depends(require_perm("brain"))):
    _manage_or_403(user)
    vis = (inp.visibility or "public").strip().lower()
    doc = {
        "id": new_id(), "tenant_id": user["tenant_id"], "text": inp.text.strip(), "tag": _tag(inp.tag),
        "visibility": vis if vis in VISIBILITY else "public",
        "department": (inp.department or "").strip().lower()[:60], "roles_allowed": _roles(inp.roles_allowed),
        "source": "manual", "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.memory.insert_one(dict(doc))
    from services.ai import brain_embed
    brain_embed.spawn(brain_embed.index_note(dict(doc)))
    return _public(doc, {user["id"]: user.get("name")})


async def _fetch(note_id: str, user: dict) -> dict:
    n = await db.memory.find_one({"id": note_id, "tenant_id": user["tenant_id"], **memory_scope(user)}, {"_id": 0})
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    return n


@router.patch("/{note_id}")
async def update_note(note_id: str, inp: NotePatch, user: dict = Depends(require_perm("brain"))):
    _manage_or_403(user)
    n = await _fetch(note_id, user)
    patch: dict = {"updated_at": now_iso()}
    if inp.text is not None:
        patch["text"] = inp.text.strip()
    if inp.tag is not None:
        patch["tag"] = _tag(inp.tag)
    if inp.visibility is not None:
        v = inp.visibility.strip().lower()
        patch["visibility"] = v if v in VISIBILITY else "public"
    if inp.department is not None:
        patch["department"] = inp.department.strip().lower()[:60]
    if inp.roles_allowed is not None:
        patch["roles_allowed"] = _roles(inp.roles_allowed)
    await db.memory.update_one({"id": note_id, "tenant_id": user["tenant_id"]}, {"$set": patch})
    merged = {**n, **patch}
    if "text" in patch and patch["text"] != n.get("text"):
        # Only the words change what is indexed; who may see it is checked live.
        from services.ai import brain_embed
        brain_embed.spawn(brain_embed.index_note(dict(merged)))
    return _public(merged, await _names(user["tenant_id"]))


@router.delete("/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(require_perm("brain"))):
    _manage_or_403(user)
    await _fetch(note_id, user)
    await db.memory.delete_one({"id": note_id, "tenant_id": user["tenant_id"]})
    from services.ai import brain_embed
    brain_embed.spawn(brain_embed.deindex_note(user["tenant_id"], note_id))
    return {"ok": True, "deleted": note_id}
