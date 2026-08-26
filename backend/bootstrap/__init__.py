"""App-assembly package (Epic 8, Sprint 1 — modular foundation).

`bootstrap/` owns the wiring that turns modules into a running app:
    routing.py     router registration (Sprint 1)
    middleware.py  CORS/CSRF installation (Sprint 1)
    lifecycle.py   _bootstrap orchestrator + FastAPI lifespan (Sprint 7)
    seed.py        demo-workspace seeding (Sprint 7)
    migrations.py  one-shot data migrations + platform-admin seed (Sprint 7)

The app entry point stays ``server:app`` (enforced by Dockerfile, Procfile,
and tests/test_dockerfile.py). This package is imported *by* server.py; it
never imports from server.py.

Import rule (target layering, enforced from Sprint 8):
    bootstrap  ->  config, core, services, routers        (may import anything)
    routers/services/modules  ->  core, shared, integrations  (never bootstrap)
"""
