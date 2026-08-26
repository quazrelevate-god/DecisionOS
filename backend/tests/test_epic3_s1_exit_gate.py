"""Epic 3 Sprint 1 exit gate (E3-01.5): the AI-foundation invariants, enforced.

Sprint 1 stood up four things -- a prompt registry (versioned prompts), central
model routing, per-call telemetry, and a golden-set eval harness. This test is
the gate that keeps them true: it walks every AI call site under services/ and
routers/ and fails the build if the foundation regresses.

  Gate 1  no inline prompts     -- every claude_chat(...) system_message is a
                                    render()-derived value, never a string/f-string literal.
  Gate 2  telemetry everywhere  -- every claude_chat(...) passes task= (so prompt_version
                                    + db.ai_calls get attributed); every module that calls
                                    LlmChat directly for AI also records ai_call telemetry.
  Gate 3  routing centralized   -- no call site pins .with_model(*LLM_MODEL / *VISION_MODEL);
                                    every real site routes through model_for().
  Gate 4  registry + evals wired-- the registry is populated and every eval case targets a
                                    registered prompt (the golden set itself is run green by
                                    test_epic3_s1_evals.py).

Documented exception: routers/admin.py's key-probe pings the model with a literal
"Reply with OK." on the default model -- a connectivity health check, not a
prompt-registry task -- so admin.py is whitelisted for the literal-prompt and
raw-model rules below.
"""
import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
ROOTS = [BACKEND / "services", BACKEND / "routers"]
PY_FILES = sorted(p for root in ROOTS for p in root.rglob("*.py"))

# The one connectivity health-probe that legitimately uses a literal prompt on
# the default model instead of the registry + model_for().
PROBE_WHITELIST = {"admin.py"}


def _func_name(call: ast.Call) -> str:
    f = call.func
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return ""


def _is_literal(node) -> bool:
    """A raw string literal or an f-string -- i.e. an inline prompt."""
    return isinstance(node, ast.Constant) and isinstance(node.value, str) or isinstance(node, ast.JoinedStr)


def _system_arg(call: ast.Call):
    for kw in call.keywords:
        if kw.arg == "system_message":
            return kw.value
    return None


def _has_task(call: ast.Call) -> bool:
    return any(kw.arg == "task" for kw in call.keywords)


def _is_raw_model_withmodel(call: ast.Call) -> bool:
    """.with_model(*LLM_MODEL) / .with_model(*VISION_MODEL) -- a pinned model
    instead of model_for(...)."""
    f = call.func
    if not (isinstance(f, ast.Attribute) and f.attr == "with_model"):
        return False
    for a in call.args:
        if isinstance(a, ast.Starred) and isinstance(a.value, ast.Name) \
                and a.value.id in ("LLM_MODEL", "VISION_MODEL"):
            return True
    return False


def _collect():
    claude, llmchat, raw_models = [], [], []
    for p in PY_FILES:
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = _func_name(node)
            rec = (p, node.lineno)
            if name == "claude_chat":
                claude.append((p, node.lineno, _has_task(node), _system_arg(node)))
            elif name == "LlmChat":
                llmchat.append((p, node.lineno, _has_task(node), _system_arg(node)))
            if _is_raw_model_withmodel(node):
                raw_models.append(rec)
    return claude, llmchat, raw_models


CLAUDE, LLMCHAT, RAW_MODELS = _collect()


def test_call_sites_discovered():
    """Sanity: the AST walk actually found the AI surface (guards against a bad
    scan silently passing every gate)."""
    assert len(CLAUDE) >= 25, f"only found {len(CLAUDE)} claude_chat calls -- scan broken?"


# --- Gate 1: no inline prompts ----------------------------------------------
def test_gate1_no_inline_prompts_in_claude_chat():
    offenders = [f"{p.name}:{ln}" for (p, ln, _task, sysarg) in CLAUDE
                 if sysarg is not None and _is_literal(sysarg)]
    assert not offenders, ("inline prompt literal passed to claude_chat (must come "
                           f"from prompts.render): {offenders}")


def test_gate1_no_inline_prompts_in_llmchat_except_probe():
    offenders = [f"{p.name}:{ln}" for (p, ln, _task, sysarg) in LLMCHAT
                 if sysarg is not None and _is_literal(sysarg) and p.name not in PROBE_WHITELIST]
    assert not offenders, f"inline prompt literal passed to LlmChat: {offenders}"


# --- Gate 2: telemetry everywhere -------------------------------------------
def test_gate2_every_claude_chat_passes_task():
    missing = [f"{p.name}:{ln}" for (p, ln, has_task, _s) in CLAUDE if not has_task]
    assert not missing, ("claude_chat call missing task= (telemetry can't attribute "
                         f"prompt_version / group ai_calls): {missing}")


def test_gate2_direct_llmchat_modules_record_telemetry():
    """A module that calls LlmChat directly (bypassing the instrumented adapter)
    must record its own ai_call -- except the admin key-probe, which is not an
    AI feature call."""
    files = {p for (p, _ln, _t, _s) in LLMCHAT if p.name not in PROBE_WHITELIST}
    missing = [p.name for p in files if "record_ai_call" not in p.read_text(encoding="utf-8")]
    assert not missing, f"direct-LlmChat module missing record_ai_call telemetry: {missing}"


# --- Gate 3: routing centralized --------------------------------------------
def test_gate3_no_pinned_models_except_probe():
    offenders = [f"{p.name}:{ln}" for (p, ln) in RAW_MODELS if p.name not in PROBE_WHITELIST]
    assert not offenders, (".with_model(*LLM_MODEL/*VISION_MODEL) pins a model instead of "
                           f"routing via model_for(): {offenders}")


# --- Gate 4: registry + evals wired -----------------------------------------
def test_gate4_registry_populated():
    from prompts import all_prompts
    assert len(all_prompts()) >= 25, "prompt registry unexpectedly small"


def test_gate4_every_eval_case_targets_a_registered_prompt():
    import evals  # noqa: F401 -- registers cases
    from evals.base import all_cases
    from prompts import all_prompts
    known = set(all_prompts())
    orphans = [f"{c.task}/{c.name}" for c in all_cases() if c.task not in known]
    assert not orphans, f"eval cases target unknown prompts: {orphans}"


def test_gate4_every_routed_task_is_a_registered_prompt():
    """Model routing keys and prompt names must be the same namespace -- a route
    for a task that no longer exists as a prompt is dead config."""
    from config import MODEL_ROUTES
    from prompts import all_prompts
    known = set(all_prompts())
    orphans = [t for t in MODEL_ROUTES if t not in known]
    assert not orphans, f"MODEL_ROUTES targets unknown prompts: {orphans}"
