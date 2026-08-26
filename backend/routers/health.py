"""Health + API-root endpoints (Epic 8 Sprint 3 -- from server.py).

The /api/health readiness ping and the /api/ root banner. (The app-level
/health used by the platform load balancer stays on the app in server.py.)
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api")


@router.get("/health")
async def api_health():
    return {"status": "ok"}


@router.get("/")
async def root():
    return {"message": "DecisionOS API"}
