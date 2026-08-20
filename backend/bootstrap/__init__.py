"""App-assembly package (Epic 8, Sprint 1 — modular foundation).

`bootstrap/` owns the wiring that turns modules into a running app: router
registration, middleware installation, and (later sprints) the startup /
shutdown lifecycle and one-time seed / migration routines currently living
in server.py.

The app entry point stays ``server:app`` (enforced by Dockerfile, Procfile,
and tests/test_dockerfile.py). This package is imported *by* server.py; it
never imports from server.py.

Import rule (target layering, enforced from Sprint 8):
    bootstrap  ->  config, core, services, routers        (may import anything)
    routers/services/modules  ->  core, shared, integrations  (never bootstrap)
"""
