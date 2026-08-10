"""Compat shim — real module now at services/ai/ai_setup.py."""
import sys
import services.ai.ai_setup as _real
sys.modules[__name__] = _real
