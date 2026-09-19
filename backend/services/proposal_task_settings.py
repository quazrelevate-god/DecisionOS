"""ASK-50 — priority, proof and approval on a decision's PROPOSED tasks.

A decision Dex drafts is a proposal until someone approves it; nothing exists
yet, so what the founder decides about the tasks it will create has to live on
the proposal and be applied when approval creates them. ASK-32 Phase 3 gave the
proposal "who does it" and "when"; this adds the three things New Task asks
that a proposal could not say: how urgent it is, whether it needs proof before
it can be done, and whether — and when — someone must approve it.

Kept free of the database and of FastAPI on purpose. These are the RULES —
what a valid setting is, how it reads in the decision's history, and what task
fields it becomes — and a rule that needs a Mongo client to be tested is a rule
that does not get tested. The callers (services.decision_flow for the edit,
services.voice for the creation) do the reads and writes and turn a ValueError
into a 400.
"""
from typing import Optional

PRIORITIES = ("low", "medium", "high")

# ASK-28 TK-05 — when the approval happens:
#   "start"  before work starts (the task is locked until approved; the default)
#   "close"  before it's marked done (worked freely; Complete asks the approver)
# The one definition — services.tasks imports it from here.
APPROVAL_STAGES = ("start", "close")

_STAGE_WORDS = {"start": "before work starts", "close": "before it's marked done"}


def apply_settings(task: dict, *, priority: Optional[str] = None,
                   evidence_required: Optional[bool] = None,
                   approval_required: Optional[bool] = None,
                   approval_stage: Optional[str] = None,
                   approver: Optional[dict] = None,
                   clear_approver: bool = False) -> list:
    """Apply the settings that were sent to one proposed task, in place.

    None means "not sent — leave it". `approver` is the already-resolved person
    ({"id", "name"}) the caller checked may approve; `clear_approver` goes back
    to the default (the creator's manager, else the owner — chosen when the task
    is created, as New Task does). Returns the changes in words, for the
    decision's history; an empty list when nothing changed. Raises ValueError
    with the sentence to show when a value is not one this app knows.
    """
    changes = []

    if priority is not None:
        if priority not in PRIORITIES:
            raise ValueError("Priority is low, medium or high.")
        if priority != (task.get("priority") or "medium"):
            task["priority"] = priority
            changes.append(f"{priority} priority")

    if evidence_required is not None:
        want = bool(evidence_required)
        if want != bool(task.get("evidence_required")):
            task["evidence_required"] = want
            changes.append("needs proof to be completed" if want else "no proof needed")

    if approval_stage is not None and approval_stage not in APPROVAL_STAGES:
        raise ValueError("Approval happens before work starts or before it's marked done.")

    if approval_required is False:
        if task.get("approval_required"):
            for k in ("approval_required", "approval_stage", "approver_id", "approver_name"):
                task.pop(k, None)
            changes.append("no approval")
        return changes

    turning_on = approval_required is True and not task.get("approval_required")
    if turning_on:
        task["approval_required"] = True
        task["approval_stage"] = approval_stage or "start"
        changes.append(f"approval {_STAGE_WORDS[task['approval_stage']]}")
    elif task.get("approval_required") and approval_stage and approval_stage != task.get("approval_stage"):
        task["approval_stage"] = approval_stage
        changes.append(f"approval {_STAGE_WORDS[approval_stage]}")

    # Who approves only means something while approval is on.
    if task.get("approval_required"):
        if approver and approver.get("id") != task.get("approver_id"):
            task["approver_id"] = approver["id"]
            task["approver_name"] = approver.get("name")
            changes.append(f"approved by {approver.get('name') or 'them'}")
        elif clear_approver and task.get("approver_id"):
            task.pop("approver_id", None)
            task.pop("approver_name", None)
            changes.append("approved by the usual approver")
    elif approver or clear_approver:
        raise ValueError("Turn approval on before choosing who approves.")

    return changes


def creation_fields(proposed: dict, default_approver_id: Optional[str]) -> dict:
    """The task fields a proposed task's settings become when approval creates
    it — the same shape POST /tasks writes for a task made in New Task:

      approval before work starts  → created "blocked" with approval "pending",
                                     so the doer cannot start until approved
      approval before it's done    → created "todo"; Complete asks the approver
      no approval                  → created "todo"

    `default_approver_id` is who approves when the proposal named nobody (the
    caller picks it the way New Task does). Priority is not here: the proposal
    has always carried it and task creation already reads it.
    """
    needs = bool(proposed.get("approval_required"))
    stage = (proposed.get("approval_stage") if proposed.get("approval_stage") in APPROVAL_STAGES
             else "start") if needs else None
    lock_now = stage == "start"
    return {
        "evidence_required": bool(proposed.get("evidence_required")),
        "approval_required": needs,
        "approval_stage": stage,
        "approver_id": (proposed.get("approver_id") or default_approver_id) if needs else None,
        "status": "blocked" if lock_now else "todo",
        "approval_status": "pending" if lock_now else None,
    }


def waits_on_approval(task: dict) -> bool:
    """A created task that cannot be started until someone approves it — the
    one whose APPROVER is told on approval, not its doer."""
    return (bool(task.get("approval_required")) and task.get("approval_stage", "start") != "close"
            and task.get("approval_status") == "pending" and task.get("status") == "blocked")
