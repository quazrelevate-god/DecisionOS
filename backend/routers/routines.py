"""The routines promised at sign-up — confirm them once, and they repeat.

See services/routines.py for why they are confirmed rather than created
blind, and services/recurrence.py for how a routine comes back.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core import get_current_user, require_role
from services.routines import apply_setup, setup_view

router = APIRouter(prefix="/api")


class RoutineStart(BaseModel):
    key: str
    every: Optional[str] = None
    interval: Optional[int] = None
    assignee_id: Optional[str] = None


class RoutineSetupInput(BaseModel):
    start: List[RoutineStart] = Field(default_factory=list, max_length=50)
    skip: List[str] = Field(default_factory=list, max_length=50)


@router.get("/routines/setup")
async def routines_setup(user: dict = Depends(get_current_user)):
    """The sign-up routines still waiting for the owner's answer. Anyone else
    sees an empty list — setting the company's routines is the owner's call."""
    if user.get("role") != "owner":
        return {"items": [], "people": [], "started": 0, "pending": 0}
    return await setup_view(user)


@router.post("/routines/setup")
async def routines_setup_apply(inp: RoutineSetupInput, user: dict = Depends(require_role("owner"))):
    return await apply_setup(user, [s.model_dump() for s in inp.start], inp.skip)
