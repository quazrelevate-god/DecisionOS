"""Compat shim — kept so callers that do `import brain_rbac` continue to work.

Real implementation now lives in `services/brain_rbac.py`. New code should
`import services.brain_rbac as brain_rbac` directly. This shim will be
removed once every downstream import has been migrated.
"""
from services.brain_rbac import (  # noqa: F401
    INTENTS,
    allowed_intents,
    classify_intent,
    refusal_message,
)
