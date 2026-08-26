"""Id + timestamp helpers (Epic 8 Sprint 2).

Pure, dependency-free. Extracted from core.py; core re-exports both names so
every existing "from core import now_iso, new_id" keeps working.
"""
import uuid
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())
