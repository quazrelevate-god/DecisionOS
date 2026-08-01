"""Compat shim — kept so callers that do `import brain_context` continue to work.

Real implementation now lives in `services/brain_context.py`. New code should
`import services.brain_context as brain_context` directly. This shim will be
removed once every downstream import has been migrated.
"""
from services.brain_context import (  # noqa: F401
    KIND_VALUES,
    VISIBILITY_VALUES,
    auto_tags,
    record_context,
    query_context,
)
