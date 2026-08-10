"""Compat shim — real module now at services/ai/llm_limits.py.

Uses the `sys.modules` alias trick so `import services.llm_limits as ll`
and `import services.ai.llm_limits as ll` return the SAME module
object. That's important because tests do
`monkeypatch.setattr(ll, 'LLM_MAX_CONCURRENT', 3)` — a plain
`from services.ai.llm_limits import *` shim would bind a snapshot of
the value at import time and the monkeypatch wouldn't propagate to
`_reset_for_test()` which reads from the real module's namespace.
"""
import sys
import services.ai.llm_limits as _real
sys.modules[__name__] = _real
