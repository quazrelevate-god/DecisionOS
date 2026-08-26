"""Pydantic models + constants for the Team / users / attendance / leaves domain."""
from typing import List, Optional

from pydantic import BaseModel


# Canonical vocabularies — mirrored by frontend chip filters.
LEAVE_TYPES = {"casual", "sick", "earned", "permission", "wfh", "other"}
ABSENCE_REASONS = {"sick", "family_emergency", "personal", "other"}


class UserCreateInput(BaseModel):
    name: str
    email: str
    role: str
    phone: Optional[str] = ""
    password: Optional[str] = None            # empty ⇒ passwordless (mobile-OTP only) member
    permissions: Optional[List[str]] = None
    reporting_manager_id: Optional[str] = None


class UserUpdateInput(BaseModel):
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    phone: Optional[str] = None
    reporting_manager_id: Optional[str] = None


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


class AbsenceInput(BaseModel):
    reason: str                               # one of ABSENCE_REASONS
    note: Optional[str] = ""


class LeaveDecisionInput(BaseModel):
    note: Optional[str] = ""


# ---- Consolidated in Epic 8 Sprint 5 ----
class DeprovisionInput(BaseModel):
    reassign_to_user_id: Optional[str] = None
