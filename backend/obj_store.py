"""Compat shim — kept so callers that do `import obj_store` continue to work.

Real implementation now lives in `services/obj_store.py`. New code should
`import services.obj_store as obj_store` directly. This shim will be
removed once every downstream import has been migrated.
"""
from services.obj_store import (  # noqa: F401
    APP_NAME,
    EMERGENT_KEY,
    MIME_TYPES,
    STORAGE_URL,
    guess_mime,
    init_storage,
    put_object,
    get_object,
)
