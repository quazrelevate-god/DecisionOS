"""Background jobs — no HTTP (Epic 8 — populated in Sprint 7).

Scheduled / fire-and-forget work that runs outside the request path. Moving it
here shrinks server.py and makes the app's background behaviour auditable in
one place.

Planned modules (moved out of server.py in Sprint 7):
    scheduler.py    the follow-up / escalation sweep loop (_followup_scheduler_loop)
    followups.py    run_followup, run_finance_actions
    leader_lock.py  single-writer election (today: services/leader_lock.py)

Import rule: workers import core, shared, integrations, and service functions.
Never bootstrap; never a router's internals.
"""
