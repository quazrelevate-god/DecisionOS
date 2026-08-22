"""Object storage — moved to the provider adapter at integrations/storage.py
(Epic 8 Sprint 6). Thin re-export shim so existing ``from services import
obj_store`` / ``obj_store.put_object`` call sites keep working; new code should
import from ``integrations.storage``.
"""
from integrations.storage import (  # noqa: F401
    STORAGE_URL, EMERGENT_KEY, APP_NAME, MIME_TYPES,
    guess_mime, init_storage, put_object, get_object, delete_object,
)
