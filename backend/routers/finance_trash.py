"""Deleting Finance records: one, a selection, an import, or everything; and
putting them back (2026-10-22, client — services/finance_trash has the rules).

Owner and Finance, as for every Finance record (routers/ledger.require_ledger).
Two things are the owner's alone: deleting a GST invoice issued from
DecisionOS, and deleting everything.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from core import db
from models.finance import FinanceDeleteInput, FinanceEverythingInput
from routers.ledger import require_ledger
from services import finance_trash as trash

router = APIRouter(prefix="/api/finance")


def _owner_for_issued(user: dict, include_issued: bool) -> None:
    if include_issued and user.get("role") != "owner":
        raise HTTPException(status_code=403,
                            detail="Only the owner can delete a GST invoice issued from DecisionOS.")


def _preview(plan, user: dict) -> dict:
    return {**trash.summary(plan), "label": trash.label_for(plan),
            "can_include_issued": user.get("role") == "owner"}


async def _do(plan, user: dict, kind: str, label: str, ingestion_id: str = None) -> dict:
    res = await trash.remove(plan, user, kind=kind, label=label, ingestion_id=ingestion_id)
    return {**res, "message": trash.done_text(plan, label, undo_import=kind == "import")}


# ── one record, or a selection ───────────────────────────────────────────────
@router.post("/delete/preview")
async def preview_delete(inp: FinanceDeleteInput, user: dict = Depends(require_ledger)):
    _owner_for_issued(user, inp.include_issued)
    plan = await trash.plan_items(user["tenant_id"], [i.model_dump() for i in inp.items], bool(inp.include_issued))
    return _preview(plan, user)


@router.post("/delete")
async def delete_records(inp: FinanceDeleteInput, user: dict = Depends(require_ledger)):
    _owner_for_issued(user, inp.include_issued)
    plan = await trash.plan_items(user["tenant_id"], [i.model_dump() for i in inp.items], bool(inp.include_issued))
    return await _do(plan, user, "single" if len(inp.items) == 1 else "selected", trash.label_for(plan))


# ── an import, taken back out ────────────────────────────────────────────────
async def _filed_import(user: dict, ingestion_id: str) -> dict:
    ing = await db.ingestions.find_one({"id": ingestion_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="That import isn't here.")
    if ing.get("status") == "undone":
        raise HTTPException(status_code=409, detail="This import has already been undone.")
    if ing.get("status") != "filed":
        raise HTTPException(status_code=400, detail="Only a filed import can be undone. Discard it instead.")
    return ing


def _import_label(ing: dict) -> str:
    return f"the import '{(ing.get('filename') or 'upload')[:80]}'"


@router.post("/imports/{ingestion_id}/undo/preview")
async def preview_undo_import(ingestion_id: str, user: dict = Depends(require_ledger)):
    ing = await _filed_import(user, ingestion_id)
    plan = await trash.plan_import(user["tenant_id"], ing)
    return {**_preview(plan, user), "label": _import_label(ing)}


@router.post("/imports/{ingestion_id}/undo")
async def undo_import(ingestion_id: str, user: dict = Depends(require_ledger)):
    ing = await _filed_import(user, ingestion_id)
    plan = await trash.plan_import(user["tenant_id"], ing)
    return await _do(plan, user, "import", _import_label(ing), ingestion_id=ingestion_id)


# ── everything ───────────────────────────────────────────────────────────────
def _owner(user: dict) -> None:
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can delete every Finance record.")


def _same_name(a: str, b: str) -> bool:
    norm = lambda s: re.sub(r"\s+", " ", str(s or "")).strip().casefold()  # noqa: E731
    return bool(norm(a)) and norm(a) == norm(b)


@router.get("/everything/preview")
async def preview_everything(include_issued: bool = False, user: dict = Depends(require_ledger)):
    _owner(user)
    plan = await trash.plan_everything(user["tenant_id"], include_issued)
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1})
    return {**_preview(plan, user), "label": "all Finance records", "company_name": (t or {}).get("name") or ""}


@router.post("/everything/delete")
async def delete_everything(inp: FinanceEverythingInput, user: dict = Depends(require_ledger)):
    _owner(user)
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1})
    if not _same_name(inp.confirm_name, (t or {}).get("name")):
        raise HTTPException(status_code=400, detail="Type your company's name exactly as it is shown to confirm.")
    if not await trash.export_was_downloaded(user["tenant_id"], inp.export_id, user):
        raise HTTPException(status_code=400, detail="Download a copy of your Finance records first.")
    plan = await trash.plan_everything(user["tenant_id"], bool(inp.include_issued))
    return await _do(plan, user, "everything", "all Finance records")


# ── a copy of the books ──────────────────────────────────────────────────────
@router.post("/export-link")
async def finance_export_link(user: dict = Depends(require_ledger)):
    return await trash.new_export_link(user["tenant_id"], user)


@router.get("/export/{token}")
async def finance_export(token: str):
    """The token is the sign-in: single-purpose, tied to one company and one
    person, and alive fifteen minutes."""
    ex = await trash.take_export(token)
    t = await db.tenants.find_one({"id": ex["tenant_id"]}, {"_id": 0, "name": 1})
    body = await trash.export_workbook(ex["tenant_id"])
    stem = re.sub(r"[^A-Za-z0-9]+", "-", (t or {}).get("name") or "company").strip("-")[:40] or "company"
    name = f"{stem}-finance-{ex['created_at'][:10]}.xlsx"
    return Response(content=body,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ── recently deleted ─────────────────────────────────────────────────────────
@router.get("/trash")
async def list_recently_deleted(user: dict = Depends(require_ledger)):
    return {"batches": await trash.list_trash(user["tenant_id"]), "restore_days": trash.KEEP_DAYS}


@router.post("/trash/{batch_id}/restore")
async def restore_deleted(batch_id: str, user: dict = Depends(require_ledger)):
    return await trash.restore(user["tenant_id"], batch_id, user)
