"""Coaching / people / reference-file prompts (Epic 3 Sprint 1 -- migrated from
services/operating_score.py, services/leave.py, services/files.py). All static.
"""
from prompts.base import Prompt, register

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


# 2026-10-05: desk.narrative removed -- the Desk briefing is a template (routers/desk._narrative).
