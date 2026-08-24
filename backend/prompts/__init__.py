"""DecisionOS prompt registry (Epic 3 Sprint 1 -- AI Foundation).

Single home for every LLM system prompt. Import a rendered prompt by name:

    from prompts import render
    system = render("extraction.extract", roles_str=..., cat_desc=..., ...)

Or inspect the whole surface (telemetry / evals / admin):

    from prompts import all_prompts
    for name, p in all_prompts().items():
        print(name, p.version, p.intent)

Domain modules are imported here so their prompts self-register on package load.
As prompts migrate out of the service functions, add the module to the import
list below. Migrated so far: extraction (ai_extract + scoring + meeting +
execution-plan + step-assist).
"""
from prompts.base import Prompt, register, get, render, all_prompts  # noqa: F401

# Importing each domain module runs its register(...) calls.
from prompts import extraction  # noqa: F401,E402

__all__ = ["Prompt", "register", "get", "render", "all_prompts"]
