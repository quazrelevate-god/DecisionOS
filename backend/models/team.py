"""Pydantic models + constants for the Team / users / attendance / leaves domain."""
from typing import List, Optional

from pydantic import BaseModel


# Canonical vocabularies — mirrored by frontend chip filters.
LEAVE_TYPES = {"casual", "sick", "earned", "permission", "wfh", "other"}
ABSENCE_REASONS = {"sick", "family_emergency", "personal", "other"}


class UserCreateInput(BaseModel):
    name: str
    # 2026-09-19 — members sign in with their mobile and a texted code, so an
    # email is contact detail only and may be left out. The mobile is required.
    email: Optional[str] = None
    role: str
    phone: Optional[str] = ""
    # Refused if sent: a password a manager chose is one the manager knows.
    password: Optional[str] = None
    permissions: Optional[List[str]] = None
    reporting_manager_id: Optional[str] = None
    title: Optional[str] = None               # job title on the Team tree, e.g. "Sales Lead"
    follow_role: Optional[bool] = None        # True: the role's access; False: their own list (empty = no access)


class UserUpdateInput(BaseModel):
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    phone: Optional[str] = None
    reporting_manager_id: Optional[str] = None
    title: Optional[str] = None               # "" clears it
    name: Optional[str] = None
    email: Optional[str] = None               # owner only (it is how they sign in)
    follow_role: Optional[bool] = None        # True: the role's access; False: their own list (empty = no access)


class AttendanceInput(BaseModel):
    user_id: str
    status: str = "absent"                    # "present" | "absent" | "half_day"
    date: Optional[str] = None                # ISO date; default = today


class LeaveRequestInput(BaseModel):
    leave_type: str
    from_date: str                            # ISO date
    to_date: str                              # ISO date
    day_portion: Optional[str] = "full"       # "full" | "half"
    reason: Optional[str] = ""
    # ASK-5 / J11-02 (founder 24 Sep): who holds this person's approvals while
    # they are away. Only meaningful for somebody who approves things; the
    # service ignores it for everybody else, and it is switched on by the
    # APPROVAL of the leave, for exactly its days.
    delegate_user_id: Optional[str] = None


class AbsenceInput(BaseModel):
    reason: str                               # one of ABSENCE_REASONS
    note: Optional[str] = ""


class LeaveDecisionInput(BaseModel):
    note: Optional[str] = ""


# ---- Consolidated in Epic 8 Sprint 5 ----
class DeprovisionInput(BaseModel):
    reassign_to_user_id: Optional[str] = None
