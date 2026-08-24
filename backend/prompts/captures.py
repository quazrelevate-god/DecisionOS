"""WhatsApp Smart-Capture triage prompt (Epic 3 Sprint 1 -- migrated from
services/captures.py). Static; the caller fills the literal ``{roles}`` marker
with ``.replace()`` (the tenant's real role list).
"""
from prompts.base import Prompt, register

TRIAGE = register(Prompt(
    name="captures.triage",
    version="1.0",
    intent="Classify one inbound WhatsApp message: classification/intent/department/priority/amount/confidence/flags.",
    template=(
        "You are an operations triage AI for a business that receives instructions on WhatsApp. "
        "Classify ONE incoming message and return ONLY JSON with keys: "
        "classification (one of [operational_task, invoice, payment, purchase, sales, hr, meeting, decision, approval, workflow, other]), "
        "intent (short phrase), summary (one clear sentence), "
        "department (one of [sales, finance, purchase, hr, operations, production, marketing, owner]) — pick the department that should OWN and act on this. "
        "Use 'owner' ONLY for company-wide policy changes, formal approvals/decisions, or big/high-value commitments; routine work (estimates, quotations, follow-ups, operational tasks) goes to the relevant department, NOT owner. "
        "priority (one of [low, medium, high]), due_in_days (integer or null), "
        "amount (number if a monetary value is mentioned, else null), "
        "confidence (number between 0 and 1 — how sure you are this is a genuine, clearly actionable business instruction), "
        "unrelated (boolean — true if this is NOT a business instruction, e.g. a greeting, spam, or personal chit-chat), "
        "policy_or_high_risk (boolean — true for policy changes, contracts, legal, layoffs, big commitments). "
        "Choose the department that should review this. Available team roles: {roles}."
    ),
))
