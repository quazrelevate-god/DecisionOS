"""Tiny, stateless helpers reused across modules (Epic 8 — filled in Sprint 5).

The lowest layer above core: pure functions with no domain knowledge and no
side effects, so any module may import them without creating a cycle. This is
where the small helpers currently scattered through server.py / core.py land.

Planned modules:
    ids.py          now_iso, new_id
    json.py         _extract_json (lenient LLM-JSON parsing)
    normalizers.py  blueprint / lexicon / operating-model normalizers
    schemas.py      shared base Pydantic models

Import rule: shared imports only core (and the standard library). Never
routers, services, integrations, workers, or bootstrap.
"""
