"""Company Brain — Documents catalog (Phase-2, P1).

Companies dump their real documents (policies, GST filings, contracts, SOPs,
old reports) here. Files sit in Object Storage; metadata + permissions live in
Mongo (`brain_documents`). Employees ask questions like:
  - "Where's the GST filing for last week?"        (metadata + date filter)
  - "What's our leave policy?"                       (title / tag / summary match)
  - "Show me the vendor contract with Acme"          (title + tag search)

No embeddings yet — this layer is deterministic keyword + tag + date search.
The multi-agent router (P3) will call this as one of its tools.

Permission model:
  - Owner + team_manage → sees everything, may upload/edit/delete.
  - Uploader           → sees their own docs (even private).
  - public             → visible to all users in the tenant.
  - dept               → visible to users whose `role` == doc.department
                          OR whose role appears in doc.roles_allowed.
  - private            → only uploader + owner + team_manage + roles_allowed.
"""
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services import obj_store
from services.tenancy import tenant_filter  # FIX-001-C
from core import db, get_current_user, new_id, now_iso, logger, user_perms


router = APIRouter(prefix="/api/brain/documents")

# Same allowlist / cap as the main /files endpoint so behaviour is consistent.
ALLOWED_EXT = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "txt", "md", "csv", "json",
    "png", "jpg", "jpeg", "webp", "gif",
}
MAX_BYTES = 25 * 1024 * 1024  # 25 MB
KIND_VALUES = {"policy", "filing", "contract", "sop", "report", "note", "other"}
VISIBILITY_VALUES = {"public", "dept", "private"}


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------
def _can_manage(user: dict) -> bool:
    """Who can upload, edit, or delete brain documents."""
    return user.get("role") == "owner" or "team_manage" in user_perms(user)


def _visibility_filter(user: dict) -> dict:
    """Mongo `$or` clause that selects documents the current user can see.
    Owner + team_manage bypasses this (see `list_documents`)."""
    uid = user.get("id")
    role = user.get("role") or ""
    return {
        "$or": [
            {"visibility": "public"},
            {"uploaded_by": uid},
            {"visibility": "dept", "$or": [{"department": role}, {"roles_allowed": role}]},
            {"visibility": "private", "roles_allowed": role},
        ]
    }


def _user_can_see(doc: dict, user: dict) -> bool:
    """Python-side visibility check for single-doc endpoints (mirror of the Mongo filter)."""
    if _can_manage(user) or doc.get("uploaded_by") == user.get("id"):
        return True
    role = user.get("role") or ""
    vis = doc.get("visibility") or "public"
    if vis == "public":
        return True
    if vis == "dept":
        return doc.get("department") == role or role in (doc.get("roles_allowed") or [])
    return role in (doc.get("roles_allowed") or [])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_KEYWORD_STOP = {
    "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "at", "with", "by",
    "is", "are", "was", "were", "be", "this", "that", "these", "those", "it", "as",
    "our", "your", "their", "we", "you", "they", "from",
}


def _keywords(*parts: str) -> List[str]:
    """Extract normalized keywords from title/tags/summary for cheap BM25-style search."""
    text = " ".join(p or "" for p in parts).lower()
    words = re.findall(r"[a-z0-9][a-z0-9\-_/]{1,}", text)
    seen, out = set(), []
    for w in words:
        if w in _KEYWORD_STOP or len(w) < 3:
            continue
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out[:40]


def _clean_tags(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    parts = [t.strip().lower() for t in re.split(r"[,\n]", raw) if t.strip()]
    seen, out = set(), []
    for t in parts:
        if t not in seen and len(t) <= 40:
            seen.add(t)
            out.append(t)
    return out[:15]


def _clean_roles(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [r.strip().lower() for r in re.split(r"[,\n]", raw) if r.strip()][:15]


def _public(doc: dict) -> dict:
    """Wire-safe shape returned to the frontend."""
    return {
        "id": doc["id"],
        "title": doc.get("title") or doc.get("original_filename"),
        "kind": doc.get("kind"),
        "tags": doc.get("tags") or [],
        "department": doc.get("department") or "",
        "visibility": doc.get("visibility") or "public",
        "roles_allowed": doc.get("roles_allowed") or [],
        "summary": doc.get("summary") or "",
        "filename": doc.get("original_filename"),
        "content_type": doc.get("content_type"),
        "size": doc.get("size"),
        "uploaded_by": doc.get("uploaded_by"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "download_url": f"/api/brain/documents/{doc['id']}/download",
    }


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@router.post("")
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    kind: str = Form("other"),
    tags: str = Form(""),
    department: str = Form(""),
    visibility: str = Form("public"),
    roles_allowed: str = Form(""),
    summary: str = Form(""),
    user: dict = Depends(get_current_user),
):
    """Upload a document to the Company Brain. Owner + team_manage only."""
    if not _can_manage(user):
        raise HTTPException(status_code=403, detail="Only workspace owners and managers can add documents")

    filename = (file.filename or "file.bin").strip()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type .{ext}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")

    kind_v = kind.strip().lower() if kind.strip().lower() in KIND_VALUES else "other"
    vis_v = visibility.strip().lower() if visibility.strip().lower() in VISIBILITY_VALUES else "public"
    title_v = (title or filename.rsplit(".", 1)[0]).strip()[:200]
    tags_v = _clean_tags(tags)
    roles_v = _clean_roles(roles_allowed)
    dept_v = (department or "").strip().lower()[:60]
    summary_v = (summary or "").strip()[:800]

    fid = new_id()
    storage_path = f"{obj_store.APP_NAME}/brain/{user['tenant_id']}/{fid}.{ext}"
    content_type = file.content_type or obj_store.guess_mime(filename)
    try:
        result = await obj_store.put_object(storage_path, data, content_type)
    except Exception as e:
        logger.error(f"brain_docs upload failed: {e}")
        raise HTTPException(status_code=503, detail="Storage is unavailable — try again")

    doc = {
        "id": fid,
        "tenant_id": user["tenant_id"],
        "title": title_v,
        "kind": kind_v,
        "tags": tags_v,
        "department": dept_v,
        "visibility": vis_v,
        "roles_allowed": roles_v,
        "summary": summary_v,
        "keywords": _keywords(title_v, " ".join(tags_v), summary_v, filename),
        "storage_path": result.get("path", storage_path),
        "original_filename": filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": user["id"],
        "is_deleted": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.brain_documents.insert_one(dict(doc))
    doc.pop("_id", None)
    return _public(doc)


# ---------------------------------------------------------------------------
# List / search
# ---------------------------------------------------------------------------
@router.get("")
async def list_documents(
    q: Optional[str] = Query(None, max_length=200),
    kind: Optional[str] = Query(None, max_length=40),
    department: Optional[str] = Query(None, max_length=60),
    tag: Optional[str] = Query(None, max_length=40),
    from_date: Optional[str] = Query(None, alias="from", max_length=32),
    to_date: Optional[str] = Query(None, alias="to", max_length=32),
    limit: int = Query(100, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    """List documents visible to this user, with optional filters + a `q` free-text search."""
    filt: dict = {"tenant_id": user["tenant_id"], "is_deleted": False}
    if kind and kind.lower() in KIND_VALUES:
        filt["kind"] = kind.lower()
    if department:
        filt["department"] = department.lower()
    if tag:
        filt["tags"] = tag.lower()
    if from_date:
        filt.setdefault("created_at", {})["$gte"] = from_date
    if to_date:
        filt.setdefault("created_at", {})["$lte"] = to_date
    if q:
        tokens = _keywords(q)
        if tokens:
            # E2-58 fix: escape the user-supplied `q` before feeding it to
            # $regex. An unescaped payload like "(a+)+$" causes exponential
            # regex backtracking (ReDoS) and pins one Mongo connection for
            # seconds -- a single curl loops that into a cheap tenant DoS.
            # We only need substring-match, not regex, so re.escape is a
            # proper fix rather than a defense-in-depth patch.
            q_esc = re.escape(q)
            regex_or = [{"title": {"$regex": q_esc, "$options": "i"}},
                        {"summary": {"$regex": q_esc, "$options": "i"}},
                        {"original_filename": {"$regex": q_esc, "$options": "i"}},
                        {"keywords": {"$in": tokens}},
                        {"tags": {"$in": tokens}}]
            filt.setdefault("$and", []).append({"$or": regex_or})

    # Permission filter (owner + team_manage bypass)
    if not _can_manage(user):
        filt.setdefault("$and", []).append(_visibility_filter(user))

    cursor = db.brain_documents.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(limit)
    return [_public(d) for d in docs]


# ---------------------------------------------------------------------------
# Read / update / delete / download
# ---------------------------------------------------------------------------
class PatchInput(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    kind: Optional[str] = Field(default=None, max_length=40)
    tags: Optional[str] = Field(default=None, max_length=400)
    department: Optional[str] = Field(default=None, max_length=60)
    visibility: Optional[str] = Field(default=None, max_length=40)
    roles_allowed: Optional[str] = Field(default=None, max_length=400)
    summary: Optional[str] = Field(default=None, max_length=800)


async def _fetch(doc_id: str, tenant_id: str) -> dict:
    doc = await db.brain_documents.find_one({"id": doc_id, "tenant_id": tenant_id, "is_deleted": False}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{doc_id}")
async def get_document(doc_id: str, user: dict = Depends(get_current_user)):
    doc = await _fetch(doc_id, user["tenant_id"])
    if not _user_can_see(doc, user):
        raise HTTPException(status_code=403, detail="You don't have access to this document")
    return _public(doc)


@router.patch("/{doc_id}")
async def update_document(doc_id: str, inp: PatchInput, user: dict = Depends(get_current_user)):
    doc = await _fetch(doc_id, user["tenant_id"])
    if not (_can_manage(user) or doc.get("uploaded_by") == user["id"]):
        raise HTTPException(status_code=403, detail="Only the uploader or a manager can edit this document")

    patch: dict = {"updated_at": now_iso()}
    if inp.title is not None:
        patch["title"] = inp.title.strip()[:200]
    if inp.kind is not None:
        k = inp.kind.strip().lower()
        patch["kind"] = k if k in KIND_VALUES else "other"
    if inp.tags is not None:
        patch["tags"] = _clean_tags(inp.tags)
    if inp.department is not None:
        patch["department"] = inp.department.strip().lower()[:60]
    if inp.visibility is not None:
        v = inp.visibility.strip().lower()
        patch["visibility"] = v if v in VISIBILITY_VALUES else "public"
    if inp.roles_allowed is not None:
        patch["roles_allowed"] = _clean_roles(inp.roles_allowed)
    if inp.summary is not None:
        patch["summary"] = inp.summary.strip()[:800]

    # Recompute keywords whenever title/tags/summary change.
    merged = {**doc, **patch}
    patch["keywords"] = _keywords(merged.get("title") or "",
                                  " ".join(merged.get("tags") or []),
                                  merged.get("summary") or "",
                                  merged.get("original_filename") or "")

    await db.brain_documents.update_one(tenant_filter(doc_id, user["tenant_id"]), {"$set": patch})  # FIX-001-C
    return _public({**doc, **patch})


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(get_current_user)):
    doc = await _fetch(doc_id, user["tenant_id"])
    if not (_can_manage(user) or doc.get("uploaded_by") == user["id"]):
        raise HTTPException(status_code=403, detail="Only the uploader or a manager can delete this document")
    await db.brain_documents.update_one(tenant_filter(doc_id, user["tenant_id"]), {"$set": {"is_deleted": True, "updated_at": now_iso()}})  # FIX-001-C
    return {"ok": True, "deleted": doc_id}


@router.get("/{doc_id}/download")
async def download_document(doc_id: str, user: dict = Depends(get_current_user)):
    doc = await _fetch(doc_id, user["tenant_id"])
    if not _user_can_see(doc, user):
        raise HTTPException(status_code=403, detail="You don't have access to this document")
    try:
        data, ctype = await obj_store.get_object(doc["storage_path"])
    except Exception as e:
        logger.error(f"brain_docs download failed for {doc_id}: {e}")
        raise HTTPException(status_code=503, detail="Storage is unavailable — try again")
    fname = doc.get("original_filename") or doc_id
    return Response(
        content=data,
        media_type=doc.get("content_type") or ctype or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )
