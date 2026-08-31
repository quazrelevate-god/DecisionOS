"""Onboarding generation core (Epic 10 S4: extracted from routers/signup.py so
the interview + blueprint AI is a callable, evaluable unit -- not logic buried in
an HTTP handler.

Two public functions, both keyed to a prompt-registry task so the golden-set eval
harness (evals/cases/onboarding.py) and telemetry stay aligned with the prompt
that produced the output:

  * next_interview_question(profile, qa, lang_name=None) -> {question, why, enough}
      one adaptive Dex question, grounded in the established profile + transcript.
  * generate_blueprint(profile, transcript, refinement="", welcome_lang_name=None)
      -> normalized {departments, operational_tasks, approval_rules, products,
      welcome_line} -- the founder's operating system, designed from the interview.

The prompt text lives in prompts/onboarding.py (registry); the user-message
construction (profile block, team-size band, transcript) lives here so it is the
single source of truth for both the signup endpoints and the evals.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from core import claude_chat, model_for, _extract_json, new_id, normalize_os_blueprint
from prompts import render
from emergentintegrations.llm.chat import UserMessage


# Interview length is DYNAMIC: Dex may finish as early as MIN_QUESTIONS once the
# operational picture is clear, and is hard-capped at MAX_QUESTIONS.
MIN_QUESTIONS = 2
MAX_QUESTIONS = 6


# ---------------------------------------------------------------------------
# User-message builders (shared by the endpoints + the evals)
# ---------------------------------------------------------------------------
def profile_block(profile: Dict[str, Any]) -> str:
    """The established company context every interview/blueprint message carries."""
    prods = ", ".join(p.get("name", "") for p in (profile.get("products") or []) if p.get("name"))
    return (
        f"Company: {profile.get('company_name')}\n"
        f"Founder: {profile.get('founder_name') or 'unknown'}\n"
        f"Team size: {profile.get('team_size') or 'unknown'}\n"
        f"Industry: {profile.get('industry') or 'unknown'}\n"
        f"Business model: {profile.get('business_model') or 'unknown'}\n"
        f"What we learned from their website: {profile.get('website_summary') or 'no website provided'}\n"
        f"Products/services: {prods or 'unknown'}\n"
        f"Founder's own description: {profile.get('description') or 'none'}"
    )


def qa_block(qa: List[Dict[str, str]]) -> str:
    if not qa:
        return "No questions asked yet."
    return "\n".join(f"Q{i + 1}: {x['q']}\nA{i + 1}: {x['a']}" for i, x in enumerate(qa))


def team_size_hint(size_str: str) -> str:
    """Turn '11-50' / '50+' / '5' etc. into an explicit team-size band directive."""
    s = (size_str or "").strip().lower()
    nums = [int(n) for n in re.findall(r"\d+", s)]
    if not nums:
        return ""
    top = max(nums)
    if top <= 10:
        band = "1-10 (FOUNDER-LED — no departments yet; the founder personally does most operational work)"
    elif top <= 50:
        band = "11-50 (early structure — one or two informal leads, founder still signs off on most things)"
    elif top <= 200:
        band = "50-200 (departments and managers exist, formal approval limits, cross-team handoffs)"
    else:
        band = "200+ (full department structure, layered approvals, review cadences)"
    return f"TEAM SIZE BAND: {band}. Every question and the resulting OS design MUST fit this reality."


# ---------------------------------------------------------------------------
# Generation functions
# ---------------------------------------------------------------------------
async def next_interview_question(
    *,
    profile: Dict[str, Any],
    qa: List[Dict[str, str]],
    lang_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Ask Dex for the single most valuable next question. Returns
    {question, why, enough}. `lang_name` (e.g. 'Tamil') makes Dex write the
    question + why in that language; None => English."""
    system = render("onboarding.interview", min_questions=MIN_QUESTIONS, max_questions=MAX_QUESTIONS)
    if lang_name:
        system += (
            f"\n\nIMPORTANT: The founder is speaking {lang_name}. Write BOTH the \"question\" and \"why\" "
            f"fields in natural, conversational {lang_name} (native script, not transliteration). "
            f"Keep it warm and simple."
        )
    remaining = MAX_QUESTIONS - len(qa)
    prompt = (
        f"{profile_block(profile)}\n\n"
        f"{team_size_hint(profile.get('team_size') or '')}\n\n"
        f"Conversation so far:\n{qa_block(qa)}\n\n"
        f"You have already collected {len(qa)} answer(s). You may ask up to {remaining} more question(s) "
        f"(hard cap {MAX_QUESTIONS} total). Minimum {MIN_QUESTIONS} answers before you're allowed to end.\n"
        "Walk through the operational-coverage checklist. If ANY item is still fuzzy, ask the single most valuable "
        "next question that closes the biggest gap — built on what they just said, matched to their team-size band "
        "and industry. If the picture is genuinely clear enough to design their OS, set enough=true."
    )
    chat = claude_chat(
        task="onboarding.interview", session_id=f"interview-{new_id()}",
        system_message=system).with_model(*model_for("onboarding.interview"))
    data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    return {
        "question": (data.get("question") or "").strip(),
        "why": (data.get("why") or "").strip(),
        "enough": bool(data.get("enough")),
    }


async def generate_blueprint(
    *,
    profile: Dict[str, Any],
    transcript: List[Dict[str, str]],
    refinement: str = "",
    welcome_lang_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Design the founder's operating system from the interview transcript.
    Returns the normalized blueprint plus products + welcome_line. `refinement`
    is an authoritative post-draft correction; `welcome_lang_name` localizes only
    the welcome_line (structure stays English)."""
    system = render("onboarding.blueprint")
    if welcome_lang_name:
        system += (
            f"\n\nIMPORTANT: Write ONLY the \"welcome_line\" field in natural, conversational "
            f"{welcome_lang_name} (native script). Keep all other fields (departments, workflow names, "
            f"task titles, categories, approval names) in English."
        )
    refine_block = ""
    if (refinement or "").strip():
        refine_block = ("\n\nFounder's follow-up refinement (they added this after seeing the first draft — "
                        f"reflect it faithfully):\n{refinement.strip()}")
    prompt = (
        f"{profile_block(profile)}\n\n{team_size_hint(profile.get('team_size') or '')}\n\n"
        f"Interview transcript:\n{qa_block(transcript)}{refine_block}\n\n"
        "Design this company's operating system now — sized to their team band, worded in their industry."
    )
    chat = claude_chat(
        task="onboarding.blueprint", session_id=f"bp-{new_id()}",
        system_message=system).with_model(*model_for("onboarding.blueprint"))
    data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    bp = normalize_os_blueprint(data)
    products = [
        {"name": (p.get("name") or "").strip(), "description": (p.get("description") or "").strip()}
        for p in (data.get("products") or []) if (p.get("name") or "").strip()
    ][:5]
    return {**bp, "products": products, "welcome_line": (data.get("welcome_line") or "").strip()}
