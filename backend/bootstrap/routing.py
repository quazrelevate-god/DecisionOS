"""App-assembly: router registration.

Extracted from the tail of server.py in Epic 8 Sprint 1 (modular foundation).
Mounts the in-file ``api`` router (still defined in server.py — its endpoints
move out in Sprint 3) plus every already-extracted domain router. Include
order and prefixes are unchanged, so the mounted route table is identical.

These router modules import only from ``core`` / ``services`` / ``models``, so
importing them here introduces no import-time cycle. (As of Sprint 10 there are
no ``from server import ...`` shims left in application code -- every cross-domain
helper is imported from its real home.)
"""
from routers.onboarding import router as onboarding_router
from routers.ledger import router as ledger_router
from routers.admin import router as admin_router
from routers.admin_tenant360 import router as admin_tenant360_router  # Epic 10 S1
from routers.admin_impersonation import router as admin_impersonation_router  # Epic 10 S2
from routers.admin_support import router as admin_support_router  # Epic 10 S3
from routers.support import router as support_router  # Epic 10 S3 (tenant-facing)
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
from routers.workflows import router as workflows_router
from routers.meetings import router as meetings_router
from routers.captures import router as captures_router
from routers.contacts import router as contacts_router
from routers.complaints import router as complaints_router
from routers.brain_search import router as brain_search_router
from routers.operating_score import router as operating_score_router
from routers.calendar import router as calendar_router
from routers.voice_notes import router as voice_notes_router
from routers.dashboard import router as dashboard_router
from routers.auth_otp import router as auth_otp_router
from routers.tenant_settings import router as tenant_settings_router
from routers.finance import router as finance_router
from routers.whatsapp import router as whatsapp_router
from routers.files import router as files_router
from routers.health import router as health_router

# Every extracted domain router, in the exact order server.py mounted them.
_DOMAIN_ROUTERS = (
    onboarding_router,
    ledger_router,
    admin_router,
    admin_tenant360_router,
    admin_impersonation_router,
    admin_support_router,
    support_router,
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
    workflows_router,  # Epic 8 S3: workflows domain extracted from server.py
    meetings_router,   # Epic 8 S3: meetings domain extracted from server.py
    captures_router,   # Epic 8 S3: captures review-queue extracted from server.py
    contacts_router,   # Epic 8 S3: contacts CRUD extracted from server.py
    complaints_router, # Epic 8 S3: complaints + memory extracted from server.py
    brain_search_router, # Epic 8 S3: Company Brain search extracted from server.py
    operating_score_router, # Epic 8 S3: operating-score + work-coach extracted
    calendar_router,   # Epic 8 S3: business calendar + leave-approvers extracted
    voice_notes_router, # Epic 8 S3: voice/dictation capture extracted
    dashboard_router,  # Epic 8 S3: dashboard/daily-brief extracted
    auth_otp_router,   # Epic 8 S3: phone-OTP login + invite flow extracted
    tenant_settings_router, # Epic 8 S3: tenant settings surface extracted
    finance_router,    # Epic 8 S3: finance + document ingestion extracted
    whatsapp_router,   # Epic 8 S3: WhatsApp webhook + status/logs extracted
    files_router,      # Epic 8 S3: file upload/download extracted
    health_router,     # Epic 8 S3: /api/health + /api/ root (last off the api router)
)


def register_api_routers(app) -> None:
    """Mount every extracted domain router.

    As of Epic 8 Sprint 3 the in-file ``api`` router is fully retired -- all
    endpoints now live under routers/, so there is no in-file router to mount.
    """
    for router in _DOMAIN_ROUTERS:
        app.include_router(router)
