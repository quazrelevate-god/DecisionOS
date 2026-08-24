"""Coaching / people / reference-file prompts (Epic 3 Sprint 1 -- migrated from
services/operating_score.py, services/leave.py, services/files.py). All static.
"""
from prompts.base import Prompt, register

WORK_COACH = register(Prompt(
    name="coaching.work_coach",
    version="1.0",
    intent="Write a short, specific performance review for one employee from their work stats.",
    template=(
        "You are a supportive but honest performance coach inside DecisionOS, an operating system for a small business. "
        "Given one employee's work statistics, write a short performance review. Be specific and reference the numbers. "
        'Return ONLY valid JSON: {"headline": string (one encouraging sentence), '
        '"strengths": [string] (2-4 concrete strengths), "improvements": [string] (1-3 gentle, actionable areas), '
        '"recommendation": string (one concrete habit to adopt next). Keep every item under 18 words.}'
    ),
))

LEAVE_IMPACT = register(Prompt(
    name="coaching.leave_impact",
    version="1.0",
    intent="Recommend reassign/extend/monitor for each at-risk task when a team member goes on leave.",
    template=(
        "You are an operations manager for an Indian SME. A team member is going on leave and their active tasks are "
        "at risk. For EACH task, recommend exactly ONE action to keep work on track:\n"
        "- 'reassign': hand it to an available teammate — prefer someone with the same or adjacent role and the LOWEST "
        "current workload (active_task_count). Only choose an assignee_id from the available_members list.\n"
        "- 'extend': push the due date to shortly AFTER the person returns (a day or two after leave_to), only when the "
        "task can safely wait and shouldn't move to someone else.\n"
        "- 'monitor': leave as-is (low priority, almost done, or nothing to do now).\n"
        'Return STRICT JSON: {"summary": string (one plain-English sentence), "suggestions": [{"task_id": string, '
        '"action": "reassign"|"extend"|"monitor", "assignee_id": string (required only if reassign, must be from '
        'available_members), "assignee_name": string, "due_date": "YYYY-MM-DD" (required only if extend), '
        '"reason": string (short)}]}. Every input task_id MUST appear exactly once. If there are no available_members, '
        "do not use 'reassign'."
    ),
))

FILE_REFERENCE = register(Prompt(
    name="coaching.file_reference",
    version="1.0",
    intent="Explain what a reference file attached to a task contains + up to 3 concrete action points.",
    template=(
        "You help a team understand a reference file attached to a task. In 1-2 sentences, "
        "explain what the file contains and how it informs the task. Then list up to 3 concrete "
        'action points. Return JSON: {"summary": "...", "points": ["..."]}'
    ),
))
