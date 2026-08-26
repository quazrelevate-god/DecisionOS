"""Reference-file storage + AI analysis (Epic 8 Sprint 4 -- from server.py).

Upload to object storage + a files record, the public projection, task-context
enrichment from an attached image/PDF, and plain-text extraction of any
reference (vision OCR for images/PDFs, pandas for CSV/Excel, docx for Word).
Depends on core + services.obj_store + services.vision.
"""
from fastapi import HTTPException
from emergentintegrations.llm.chat import UserMessage

from core import db, logger, new_id, now_iso, claude_chat, _extract_json
from services import obj_store
from services.vision import ai_read_image_general
from core import model_for
from prompts import render


ATTACH_ALLOWED_EXT = {"jpg", "jpeg", "png", "gif", "webp", "heic", "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"}


ATTACH_MAX_BYTES = 25 * 1024 * 1024  # 25 MB


async def _store_file(tenant_id, user_id, upload, kind, task_id=None):
    """Persist an uploaded file to Object Storage + a `files` DB record. Returns the record."""
    ext = (upload.filename or "file.bin").rsplit(".", 1)[-1].lower() if "." in (upload.filename or "") else "bin"
    if ext not in ATTACH_ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type .{ext}")
    data = await upload.read()
    if len(data) > ATTACH_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    fid = new_id()
    path = f"{obj_store.APP_NAME}/{tenant_id}/{fid}.{ext}"
    content_type = upload.content_type or obj_store.guess_mime(upload.filename)
    result = await obj_store.put_object(path, data, content_type)
    rec = {
        "id": fid, "tenant_id": tenant_id, "storage_path": result.get("path", path),
        "original_filename": upload.filename or f"{fid}.{ext}", "content_type": content_type,
        "size": result.get("size", len(data)), "kind": kind, "task_id": task_id,
        "uploaded_by": user_id, "is_deleted": False, "created_at": now_iso(),
    }
    await db.files.insert_one(dict(rec))
    rec.pop("_id", None)
    return rec


def _file_public(rec):
    return {"id": rec["id"], "kind": rec.get("kind"), "filename": rec.get("original_filename"),
            "content_type": rec.get("content_type"), "size": rec.get("size"),
            "url": f"/api/files/{rec['id']}/download", "at": rec.get("created_at"), "by": rec.get("uploaded_by")}


async def _analyze_reference_file(tenant_id, task_id, rec):
    """AI-analyse an attached reference (image/PDF) and enrich the task with context."""
    try:
        ctype = rec.get("content_type", "")
        if not (ctype.startswith("image/") or ctype == "application/pdf"):
            return  # Phase 1: analyse images & PDFs only
        data, _ = await obj_store.get_object(rec["storage_path"])
        import tempfile
        import os as _os
        ext = rec.get("original_filename", "f.bin").rsplit(".", 1)[-1]
        tmp = _os.path.join(tempfile.gettempdir(), f"ref_{rec['id']}.{ext}")
        from services.uploads import awrite_bytes
        await awrite_bytes(tmp, data)
        raw = await ai_read_image_general(tmp, ctype, session_id=f"ref-{task_id}")
        try:
            _os.remove(tmp)
        except OSError:
            pass
        text = (raw if isinstance(raw, str) else str(raw))[:4000]
        if not text.strip():
            return
        task = await db.tasks.find_one({"id": task_id}, {"_id": 0, "title": 1, "description": 1})
        if not task:
            return
        system = render("coaching.file_reference")
        prompt = f"TASK: {task.get('title')}\n\nREFERENCE FILE CONTENT:\n{text}"
        chat = claude_chat(task="coaching.file_reference", session_id=f"ref-insight-{task_id}", system_message=system,
                           tenant_id=tenant_id).with_model(*model_for("coaching.file_reference"))
        resp = await chat.send_message(UserMessage(text=prompt))
        parsed = _extract_json(resp) or {}
        summary = (parsed.get("summary") or "").strip()
        points = [p for p in (parsed.get("points") or []) if p][:3]
        if not summary:
            return
        note = {"file_id": rec["id"], "filename": rec.get("original_filename"),
                "summary": summary, "points": points, "at": now_iso()}
        await db.tasks.update_one({"id": task_id}, {"$push": {"reference_insights": note},
                                  "$set": {"updated_at": now_iso()}})
        logger.info(f"[reference-ai] enriched task {task_id} from {rec.get('original_filename')}")
    except Exception as e:
        logger.warning(f"[reference-ai] analysis failed for task {task_id}: {e}")


async def _read_reference_text(rec: dict, tenant_id: str = "", max_chars: int = 6000) -> str:
    """Read an attached reference file into plain text so the AI can factor it into a directive.
    Images/PDFs -> Gemini OCR summary; Excel/CSV -> parsed rows; Word/txt -> extracted text.
    ``max_chars`` caps the extracted body (default 6000 for voice attachments; the Company
    Brain RAG ingest passes a larger value so long documents aren't truncated to a few chunks)."""
    try:
        ctype = (rec.get("content_type") or "").lower()
        fname = rec.get("original_filename", "file")
        data, _ = await obj_store.get_object(rec["storage_path"])
    except Exception as e:
        logger.warning(f"[capture-ref] could not fetch {rec.get('id')}: {e}")
        return ""
    try:
        # Images & PDFs -> general vision reader (business cards, lists, notes, invoices — anything).
        if ctype.startswith("image/") or ctype == "application/pdf":
            import tempfile
            import os as _os
            ext = fname.rsplit(".", 1)[-1] if "." in fname else "bin"
            tmp = _os.path.join(tempfile.gettempdir(), f"capref_{rec['id']}.{ext}")
            from services.uploads import awrite_bytes
            await awrite_bytes(tmp, data)
            try:
                text = await ai_read_image_general(tmp, ctype, session_id=f"capref-{tenant_id}")
            finally:
                try: _os.remove(tmp)
                except OSError: pass
            return f"[{fname}]\n" + (text or "")
        # Excel / CSV -> parse to a compact text table.
        if ctype in ("text/csv",) or fname.lower().endswith(".csv"):
            import pandas as pd
            import io as _io
            df = pd.read_csv(_io.BytesIO(data), nrows=200)
            return f"[{fname}]\n" + df.to_csv(index=False)[:max_chars]
        if fname.lower().endswith((".xlsx", ".xls")) or "spreadsheet" in ctype or "excel" in ctype:
            import pandas as pd
            import io as _io
            df = pd.read_excel(_io.BytesIO(data), nrows=200)
            return f"[{fname}]\n" + df.to_csv(index=False)[:max_chars]
        # Word.
        if fname.lower().endswith(".docx") or "wordprocessingml" in ctype:
            import docx
            import io as _io
            doc = docx.Document(_io.BytesIO(data))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            return f"[{fname}]\n" + text[:max_chars]
        # Plain text.
        if ctype.startswith("text/") or fname.lower().endswith(".txt"):
            return f"[{fname}]\n" + data.decode("utf-8", errors="ignore")[:max_chars]
    except Exception as e:
        logger.warning(f"[capture-ref] read failed for {fname}: {e}")
    return ""
