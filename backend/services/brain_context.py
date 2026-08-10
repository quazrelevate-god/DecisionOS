"""Compat shim — real module now at services/ai/brain_context.py."""
import sys
import services.ai.brain_context as _real
sys.modules[__name__] = _real
