"""Business calendar request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from pydantic import BaseModel


class LeaveApproverMapInput(BaseModel):
    approvers: dict  # { role_key: approver_user_id }
