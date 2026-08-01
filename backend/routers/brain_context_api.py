"""Company Brain — Context read API (Phase-2, P2).

Exposes the auto-captured `brain_context` rows so the frontend and the future
multi-agent router (P3) can browse them. Writes happen server-side via
`brain_context.record_context(...)` from wherever a decision, approval or
resolution fires.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core import get_current_user
import brain_context


router = APIRouter(prefix="/api/brain/context")


@router.get("")
async def list_context(
    q: Optional[str] = Query(None, max_length=200),
    kind: Optional[str] = Query(None, max_length=40),
    tag: Optional[str] = Query(None, max_length=40),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """List past decisions/approvals/resolutions the caller may see."""
    rows = await brain_context.query_context(
        tenant_id=user["tenant_id"], user=user,
        kind=kind, tag=tag, q=q, limit=limit,
    )
    return rows
