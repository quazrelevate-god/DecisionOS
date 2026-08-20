"""App-assembly: router registration.

Extracted from the tail of server.py in Epic 8 Sprint 1 (modular foundation).
Mounts the in-file ``api`` router (still defined in server.py — its endpoints
move out in Sprint 3) plus every already-extracted domain router. Include
order and prefixes are unchanged, so the mounted route table is identical.

These router modules only import from ``core`` / ``services`` at module load
time (their ``from server import ...`` calls are deferred inside functions),
so importing them here introduces no import-time cycle.
"""
from routers.onboarding import router as onboarding_router
from routers.ledger import router as ledger_router
from routers.admin import router as admin_router
from routers.brain import router as brain_router
from routers.brain_docs import router as brain_docs_router
from routers.brain_context_api import router as brain_context_router
from routers.brain_router import router as brain_agent_router
from routers.signup import router as signup_router
from routers.auth import router as auth_router
from routers.tasks import router as tasks_router
from routers.decisions import router as decisions_router
from routers.inbox import router as inbox_router
from routers.desk import router as desk_router
from routers.brief import router as brief_router
from routers.team import router as team_router
from routers.crm import router as crm_router
from routers.dex import router as dex_router
from routers.access import router as access_router
from routers.billing import router as billing_router

# Every extracted domain router, in the exact order server.py mounted them.
_DOMAIN_ROUTERS = (
    onboarding_router,
    ledger_router,
    admin_router,
    brain_router,
    brain_docs_router,
    brain_context_router,
    brain_agent_router,
    signup_router,
    auth_router,
    tasks_router,
    decisions_router,
    inbox_router,
    desk_router,       # Epic 2 Sprint 2 (E2-17 / E2-22): Decision Desk aggregation.
    brief_router,
    team_router,
    crm_router,        # Epic 2 Sprint 8 (E2-67): per-contact outstanding aggregation.
    dex_router,        # Epic 2 Sprint 5 (E2-35 / E2-41): Dex persona endpoints.
    access_router,     # Epic 1 Batch 2 (RBAC-26 / RBAC-27): delegation + temp grants.
    billing_router,    # Epic 1 (S3-01): Razorpay billing module.
)


def register_api_routers(app, api) -> None:
    """Mount the in-file ``api`` router and all extracted domain routers."""
    app.include_router(api)
    for router in _DOMAIN_ROUTERS:
        app.include_router(router)
