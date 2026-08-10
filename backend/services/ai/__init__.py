"""AI-domain services.

Groups the runtime services that wrap LLM/agentic calls + guard shared
AI infrastructure:

  ai_setup       — AI generators (lexicon / operating model / finance)
                   with success/failure status tracking (FIX-001-D)
  brain_context  — decision-context capture (Brain writes, RAG source)
  brain_rbac     — intent classifier + role-based intent gate
  llm_limits     — asyncio.wait_for timeout + concurrency semaphore
                   for shared LLM key (FIX-002-B, S1-05)

Old `from services.<name> import X` imports keep working via compat
shims at services/<name>.py.
"""
from services.ai.ai_setup import *  # noqa: F401,F403
from services.ai.brain_context import *  # noqa: F401,F403
from services.ai.brain_rbac import *  # noqa: F401,F403
from services.ai.llm_limits import *  # noqa: F401,F403
