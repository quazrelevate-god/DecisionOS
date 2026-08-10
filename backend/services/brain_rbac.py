"""Compat shim — real module now at services/ai/brain_rbac.py."""
import sys
import services.ai.brain_rbac as _real
sys.modules[__name__] = _real
