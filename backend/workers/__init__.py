"""Background jobs — no HTTP (Epic 8 — populated in Sprint 7).

Scheduled / fire-and-forget work that runs outside the request path. Moving it
here shrinks server.py and makes the app's background behaviour auditable in
one place.

Modules (moved out of server.py in Sprint 7 -- U8-07.1):
    schedulers.py   the follow-up/escalation sweep loop (_followup_scheduler_loop)
                    + provider-outage alerts (_notify_provider_outages)
Related (elsewhere):
    run_followup / run_finance_actions live in services/finance_signals.py
    leader_lock single-writer election is services/leader_lock.py

Import rule: workers import core, shared, integrations, and service functions.
Never bootstrap; never a router's internals.
"""
