"""Public (pre-auth) signup onboarding endpoints.

Powers the conversational founder onboarding:
  - email availability check
  - website intelligence (fetch + Claude analysis)
  - adaptive voice interview (Claude asks 3-4 tailored questions)
  - personalized OS blueprint generated from the actual conversation
  - Sarvam TTS (bulbul:v3) so the assistant speaks, and STT (saaras:v3) for voice answers

No auth required — these run BEFORE the account exists. Inputs are length-capped.
"""
import os
import re
from typing import List, Optional

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from emergentintegrations.llm.chat import UserMessage

from core import (
    db, claude_chat, LLM_MODEL, _extract_json, new_id, now_iso, logger,
    normalize_os_blueprint, get_ai_key,
)

router = APIRouter(prefix="/api/signup")

# Interview length is DYNAMIC. Dex may finish as early as MIN_QUESTIONS if the
# founder has already painted a clear operational picture, and stretches up to
# MAX_QUESTIONS if the picture is still fuzzy. Progress UI shows "up to N".
MIN_QUESTIONS = 2
MAX_QUESTIONS = 6
TTS_SPEAKER = os.environ.get("SARVAM_TTS_SPEAKER", "shubh").strip() or "shubh"

# Languages Sarvam TTS (bulbul:v3) can speak. Keep in sync with the frontend chip.
SUPPORTED_TTS_LANGS = {
    "en-IN": "English", "hi-IN": "Hindi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
    "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "od-IN": "Odia",
    "pa-IN": "Punjabi", "ta-IN": "Tamil", "te-IN": "Telugu",
}

# Best bulbul:v3 speaker per language, from Sarvam's official production
# recommendations (docs.sarvam.ai → "Recommended Speakers by Language",
# ranked by Critical Error Rate; priya/ishita/mani are Tier-1).
LANG_SPEAKERS = {
    "en-IN": "ishita", "hi-IN": "priya", "bn-IN": "roopa", "gu-IN": "priya",
    "kn-IN": "ishita", "ml-IN": "pooja", "mr-IN": "priya", "od-IN": "pooja",
    "pa-IN": "mani", "ta-IN": "ishita", "te-IN": "priya",
}


def _speaker_for(lang: str) -> str:
    return LANG_SPEAKERS.get(lang, TTS_SPEAKER)

# Fixed interview opener per language — no LLM call, instant start.
# "{name}" is replaced with " <founder first name>" (or "" when unknown).
OPENERS = {
    "en-IN": "Hi{name} — tell me about {company} — what do you do, and how do your day-to-day operations actually run?",
    "hi-IN": "नमस्ते{name} — मुझे {company} के बारे में बताइए — आप क्या करते हैं, और आपका रोज़ का कामकाज कैसे चलता है?",
    "bn-IN": "নমস্কার{name} — {company} সম্পর্কে বলুন — আপনি কী করেন, এবং আপনার দৈনন্দিন কাজকর্ম কীভাবে চলে?",
    "gu-IN": "નમસ્તે{name} — મને {company} વિશે જણાવો — તમે શું કરો છો, અને તમારું રોજિંદું કામકાજ કેવી રીતે ચાલે છે?",
    "kn-IN": "ನಮಸ್ಕಾರ{name} — {company} ಬಗ್ಗೆ ಹೇಳಿ — ನೀವು ಏನು ಮಾಡುತ್ತೀರಿ, ಮತ್ತು ನಿಮ್ಮ ದೈನಂದಿನ ಕೆಲಸ ಹೇಗೆ ನಡೆಯುತ್ತದೆ?",
    "ml-IN": "നമസ്കാരം{name} — {company} എന്ന സ്ഥാപനത്തെക്കുറിച്ച് പറയൂ — നിങ്ങൾ എന്താണ് ചെയ്യുന്നത്, ദൈനംദിന പ്രവർത്തനങ്ങൾ എങ്ങനെയാണ് നടക്കുന്നത്?",
    "mr-IN": "नमस्कार{name} — मला {company} बद्दल सांगा — तुम्ही काय करता, आणि तुमचं रोजचं कामकाज कसं चालतं?",
    "od-IN": "ନମସ୍କାର{name} — ମୋତେ {company} ବିଷୟରେ କୁହନ୍ତୁ — ଆପଣ କଣ କରନ୍ତି, ଏବଂ ଆପଣଙ୍କ ଦୈନନ୍ଦିନ କାର୍ଯ୍ୟ କିପରି ଚାଲେ?",
    "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ{name} — ਮੈਨੂੰ {company} ਬਾਰੇ ਦੱਸੋ — ਤੁਸੀਂ ਕੀ ਕਰਦੇ ਹੋ, ਅਤੇ ਤੁਹਾਡਾ ਰੋਜ਼ਾਨਾ ਕੰਮਕਾਜ ਕਿਵੇਂ ਚੱਲਦਾ ਹੈ?",
    "ta-IN": "வணக்கம்{name} — {company} பற்றி சொல்லுங்கள் — நீங்கள் என்ன செய்கிறீர்கள், உங்கள் அன்றாட வேலைகள் எப்படி நடக்கின்றன?",
    "te-IN": "నమస్తే{name} — {company} గురించి చెప్పండి — మీరు ఏమి చేస్తారు, మీ రోజువారీ కార్యకలాపాలు ఎలా జరుగుతాయి?",
}


def _norm_lang(code: str) -> str:
    """Coerce whatever STT/frontend sends to a supported Sarvam code, defaulting to en-IN."""
    if not code:
        return "en-IN"
    c = str(code).strip()
    if c in SUPPORTED_TTS_LANGS:
        return c
    short = c.split("-")[0].lower()
    for k in SUPPORTED_TTS_LANGS:
        if k.split("-")[0] == short:
            return k
    return "en-IN"

INDUSTRIES = [
    "Manufacturing", "Textile & Apparel", "Retail / E-commerce", "Wholesale / Distribution",
    "Restaurant / Food & Beverage", "Hospitality & Travel", "Professional Services", "Consulting",
    "Construction", "Real Estate", "Healthcare", "Pharmaceuticals", "Beauty & Wellness",
    "Fitness & Sports", "Technology / SaaS", "Media & Entertainment", "Marketing & Advertising",
    "Logistics & Transport", "Automotive", "Education", "Financial Services", "Legal Services",
    "Agriculture", "Event Management", "Import / Export", "Non-profit / NGO", "Other",
]
BUSINESS_MODELS = ["B2B", "B2C", "B2B & B2C", "D2C", "Marketplace", "Services"]


# --------------------------------------------------------------------------
# Email availability
# --------------------------------------------------------------------------
class EmailCheckInput(BaseModel):
    email: str = Field(max_length=200)


@router.post("/check-email")
async def check_email(inp: EmailCheckInput):
    email = inp.email.strip().lower()
    taken = bool(email) and bool(await db.users.find_one({"email": email}, {"_id": 1}))
    return {"available": not taken}


# --------------------------------------------------------------------------
# Website intelligence
# --------------------------------------------------------------------------
class WebsiteIntelInput(BaseModel):
    url: str = Field(max_length=500)
    company_name: Optional[str] = Field(default="", max_length=200)


def _clean_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|svg|iframe)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = re.sub(r"&[a-zA-Z#0-9]+;", " ", html)
    return re.sub(r"\s+", " ", html).strip()


@router.post("/website-intel")
async def website_intel(inp: WebsiteIntelInput):
    url = inp.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Enter a website URL")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    text = ""
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        }) as client:
            r = await client.get(url)
            if r.status_code < 400:
                text = _clean_html(r.text)[:7000]
    except Exception as e:
        logger.warning(f"website-intel fetch failed for {url}: {e}")
    if len(text) < 120:
        return {"fetched": False}

    system = (
        "You analyse a company's website text for onboarding. Return ONLY valid JSON, no prose: "
        "{\"summary\": string (2 short sentences, second person: 'You ...' — what the company does and for whom), "
        f"\"industry\": string (MUST be exactly one of: {', '.join(INDUSTRIES)}), "
        f"\"business_model\": string (MUST be exactly one of: {', '.join(BUSINESS_MODELS)}), "
        "\"products\": [{\"name\": string, \"description\": short string}] (up to 4 real products/services found), "
        "\"highlights\": [string] (3 short facts learned, each under 8 words)}. "
        "Be specific and only state what the text supports."
    )
    prompt = f"Company: {inp.company_name or 'unknown'}\nWebsite text:\n{text}"
    try:
        chat = claude_chat(session_id=f"webintel-{new_id()}", system_message=system).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.error(f"website-intel analysis failed: {e}")
        return {"fetched": False}
    industry = data.get("industry") if data.get("industry") in INDUSTRIES else "Other"
    model = data.get("business_model") if data.get("business_model") in BUSINESS_MODELS else ""
    return {
        "fetched": True,
        "summary": (data.get("summary") or "").strip(),
        "industry": industry,
        "business_model": model,
        "products": [
            {"name": (p.get("name") or "").strip(), "description": (p.get("description") or "").strip()}
            for p in (data.get("products") or []) if (p.get("name") or "").strip()
        ][:4],
        "highlights": [str(h).strip() for h in (data.get("highlights") or []) if str(h).strip()][:3],
    }


# --------------------------------------------------------------------------
# Adaptive interview
# --------------------------------------------------------------------------
class InterviewStartInput(BaseModel):
    company_name: str = Field(max_length=200)
    founder_name: Optional[str] = Field(default="", max_length=120)
    team_size: Optional[str] = Field(default="", max_length=40)
    industry: Optional[str] = Field(default="", max_length=120)
    business_model: Optional[str] = Field(default="", max_length=40)
    description: Optional[str] = Field(default="", max_length=2000)
    website_summary: Optional[str] = Field(default="", max_length=2000)
    products: Optional[List[dict]] = None
    language_code: Optional[str] = Field(default="en-IN", max_length=16)


class InterviewAnswerInput(BaseModel):
    session_id: str = Field(max_length=64)
    answer: str = Field(max_length=4000)
    language_code: Optional[str] = Field(default="", max_length=16)


class InterviewSessionInput(BaseModel):
    session_id: str = Field(max_length=64)
    language_code: Optional[str] = Field(default="", max_length=16)


def _profile_block(s: dict) -> str:
    prods = ", ".join(p.get("name", "") for p in (s.get("products") or []) if p.get("name"))
    return (
        f"Company: {s.get('company_name')}\n"
        f"Founder: {s.get('founder_name') or 'unknown'}\n"
        f"Team size: {s.get('team_size') or 'unknown'}\n"
        f"Industry: {s.get('industry') or 'unknown'}\n"
        f"Business model: {s.get('business_model') or 'unknown'}\n"
        f"What we learned from their website: {s.get('website_summary') or 'no website provided'}\n"
        f"Products/services: {prods or 'unknown'}\n"
        f"Founder's own description: {s.get('description') or 'none'}"
    )


def _qa_block(qa: list) -> str:
    if not qa:
        return "No questions asked yet."
    return "\n".join(f"Q{i + 1}: {x['q']}\nA{i + 1}: {x['a']}" for i, x in enumerate(qa))


INTERVIEW_SYSTEM = (
    "You are Dex, the DecisionOS onboarding interviewer — a sharp, warm COO having a real chat with a founder "
    "so DecisionOS can build a REALISTIC operating system for THEIR company (departments, workflows, recurring tasks, "
    "approval rules) — never a generic template.\n\n"

    "INTERVIEW LENGTH IS DYNAMIC. You have a range: "
    f"MINIMUM {MIN_QUESTIONS} answers, MAXIMUM {MAX_QUESTIONS} answers (including the opening question already answered). "
    "End early (set enough=true) the moment the operational picture is genuinely clear — do NOT pad. "
    "Keep going up to the max if the picture is still fuzzy on the checklist below. Never end before the minimum.\n\n"

    "TAILOR EVERY QUESTION TO THEIR INDUSTRY + TEAM SIZE. This is not optional.\n"
    "  • 1–10 person team → It's the FOUNDER doing everything. There are usually NO departments, no formal approvals, "
    "no hierarchy. Ask how THEY personally juggle sales, delivery, money, and clients. Ask who covers when they're sick "
    "or travelling. Don't invent structure they don't have.\n"
    "  • 11–50 person team → Early handoffs, one or two informal leads, founder still in most decisions. Ask who owns "
    "which slice, how the founder finds out things went wrong, what they still personally sign off on.\n"
    "  • 50+ person team → Real departments, managers, formal approvals, escalation paths. Ask about department "
    "structure, approval limits, review cadences, cross-team handoffs.\n"
    "Industry matters too — a beauty salon runs on appointments + stylists + walk-ins; a textile manufacturer runs "
    "on orders + raw material + production + dispatch; an agency runs on clients + projects + retainers. Speak their "
    "world, not a generic one.\n\n"

    "OPERATIONAL COVERAGE CHECKLIST (mentally verify before setting enough=true):\n"
    "  1. End-to-end flow — from customer enquiry/order right through to delivery + payment.\n"
    "  2. Who does what — roles (or departments if 50+), key handoffs, backups.\n"
    "  3. Approvals & money — who signs off on spends, discounts, hires, refunds.\n"
    "  4. Where things slip — the pain points the founder feels weekly.\n"
    "  5. Founder's daily/weekly touchpoints — what they personally check, chase, or approve.\n"
    "If ANY of 1–5 is still fuzzy, keep asking (until you hit the max). If all are clear enough to design "
    "departments/workflows/tasks/approvals, set enough=true.\n\n"

    "QUESTION RULES:\n"
    "  • Exactly ONE question at a time, under 28 words, warm and conversational.\n"
    "  • Build on what they just said — reference their words.\n"
    "  • Purely OPERATIONAL — never strategic, visionary, growth-plan, or 'where do you see the company in 5 years' style.\n"
    "  • Never re-ask what you already know (industry, size, products, what they do).\n\n"

    "Return ONLY valid JSON: {\"question\": string, \"why\": string (under 10 words, why this matters), "
    f"\"enough\": boolean (true only if the checklist is covered AND at least {MIN_QUESTIONS} answers exist)}}."
)


def _team_size_hint(size_str: str) -> str:
    """Turn '11-50' / '50+' / '5' etc. into an explicit interviewer directive."""
    s = (size_str or "").strip().lower()
    # Extract the largest number in the string to make a sensible band.
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


def _lang_directive(code: str) -> str:
    """Instruct Claude to write the question + why in the founder's language."""
    code = _norm_lang(code)
    if code == "en-IN":
        return ""
    name = SUPPORTED_TTS_LANGS.get(code, "the founder's language")
    return (
        f"\n\nIMPORTANT: The founder is speaking {name}. Write BOTH the \"question\" and \"why\" fields "
        f"in natural, conversational {name} (native script, not transliteration). Keep it warm and simple."
    )


@router.post("/interview/start")
async def interview_start(inp: InterviewStartInput):
    lang = _norm_lang(inp.language_code)
    session = {
        "id": new_id(),
        "company_name": inp.company_name.strip(),
        "founder_name": (inp.founder_name or "").strip(),
        "team_size": (inp.team_size or "").strip(),
        "industry": (inp.industry or "").strip(),
        "business_model": (inp.business_model or "").strip(),
        "description": (inp.description or "").strip(),
        "website_summary": (inp.website_summary or "").strip(),
        "products": inp.products or [],
        "qa": [],
        "pending_q": None,
        "language_code": lang,
        "status": "active",
        "created_at": now_iso(),
    }
    # Question 1 is always the standard opener, in the founder's chosen
    # language — no LLM call, so the interview starts instantly.
    founder_first = (session["founder_name"].split() or [""])[0]
    question = OPENERS.get(lang, OPENERS["en-IN"]).format(
        name=f" {founder_first}" if founder_first else "",
        company=session["company_name"],
    )
    session["pending_q"] = question
    await db.signup_sessions.insert_one(session)
    return {"session_id": session["id"], "question": question,
            "why": "Your own words become your OS",
            "index": 1, "max": MAX_QUESTIONS, "language_code": lang}


@router.post("/interview/back")
async def interview_back(inp: InterviewSessionInput):
    """Step back one question: pop the last answered Q&A and re-open it,
    returning the previous answer so the founder can edit and re-send."""
    s = await db.signup_sessions.find_one({"id": inp.session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Interview session not found")
    qa = s.get("qa") or []
    if not qa:
        raise HTTPException(status_code=400, detail="Already at the first question")
    last = qa[-1]
    await db.signup_sessions.update_one(
        {"id": s["id"]},
        {"$set": {"qa": qa[:-1], "pending_q": last.get("q") or "", "status": "active"}},
    )
    return {"question": last.get("q") or "", "prev_answer": last.get("a") or "",
            "index": len(qa), "max": MAX_QUESTIONS}


@router.post("/interview/answer")
async def interview_answer(inp: InterviewAnswerInput):
    s = await db.signup_sessions.find_one({"id": inp.session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Interview session not found")
    answer = inp.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Answer is empty")
    lang = _norm_lang(inp.language_code or s.get("language_code") or "en-IN")
    qa = (s.get("qa") or []) + [{"q": s.get("pending_q") or "", "a": answer}]
    if len(qa) >= MAX_QUESTIONS:
        await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"qa": qa, "pending_q": None, "language_code": lang, "status": "done"}})
        return {"done": True, "index": len(qa), "max": MAX_QUESTIONS, "language_code": lang}

    size_hint = _team_size_hint(s.get("team_size") or "")
    remaining = MAX_QUESTIONS - len(qa)
    prompt = (
        f"{_profile_block(s)}\n\n"
        f"{size_hint}\n\n"
        f"Conversation so far:\n{_qa_block(qa)}\n\n"
        f"You have already collected {len(qa)} answer(s). You may ask up to {remaining} more question(s) "
        f"(hard cap {MAX_QUESTIONS} total). Minimum {MIN_QUESTIONS} answers before you're allowed to end.\n"
        "Walk through the operational-coverage checklist. If ANY item is still fuzzy, ask the single most valuable "
        "next question that closes the biggest gap — built on what they just said, matched to their team-size band "
        "and industry. If the picture is genuinely clear enough to design their OS, set enough=true."
    )
    system = INTERVIEW_SYSTEM + _lang_directive(lang)
    try:
        chat = claude_chat(session_id=f"interview-{s['id']}-{len(qa)}", system_message=system).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.error(f"interview answer failed: {e}")
        data = {"enough": len(qa) >= MIN_QUESTIONS}
    if data.get("enough") and len(qa) >= MIN_QUESTIONS:
        await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"qa": qa, "pending_q": None, "language_code": lang, "status": "done"}})
        return {"done": True, "index": len(qa), "max": MAX_QUESTIONS, "language_code": lang}
    question = (data.get("question") or "").strip() or "What part of the business slips through the cracks most often when things get busy?"
    await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"qa": qa, "pending_q": question, "language_code": lang}})
    return {"done": False, "question": question, "why": (data.get("why") or "").strip(),
            "index": len(qa) + 1, "max": MAX_QUESTIONS, "language_code": lang}


BLUEPRINT_SYSTEM = (
    "You are the onboarding architect for DecisionOS, an operating system for founder-led SMEs. "
    "You just interviewed a founder. Design THEIR operating system from the actual conversation — "
    "use their terminology, their real processes, their pain points. NOT a generic template.\n"
    "Return ONLY valid JSON with exactly these keys: "
    "{\"departments\": [string department name] (5-8, no 'Owner'), "
    "\"workflows\": [{\"name\": string}] (5-10, named after THEIR real processes), "
    "\"operational_tasks\": [{\"title\": string, \"category\": one of "
    "[Presentation,Meeting,Documentation,Proposal,Planning,Review,Administration,Compliance,Marketing,HR Activity,Travel,Event,IT Support,Other]}] "
    "(8-12 recurring tasks that address what the founder said slips or matters), "
    "\"approval_rules\": [{\"name\": string, \"description\": short string}] (3-6, matching who they said approves things), "
    "\"products\": [{\"name\": string, \"description\": short string}] (their actual products/services, up to 5), "
    "\"welcome_line\": string (ONE warm, specific sentence telling this founder what their new OS will handle for them — "
    "reference something real they said, under 30 words)}."
)


@router.post("/interview/blueprint")
async def interview_blueprint(inp: InterviewSessionInput):
    s = await db.signup_sessions.find_one({"id": inp.session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Interview session not found")
    lang = _norm_lang(inp.language_code or s.get("language_code") or "en-IN")
    welcome_note = ""
    if lang != "en-IN":
        lang_name = SUPPORTED_TTS_LANGS.get(lang, "the founder's language")
        welcome_note = (
            f"\n\nIMPORTANT: Write ONLY the \"welcome_line\" field in natural, conversational "
            f"{lang_name} (native script). Keep all other fields (departments, workflow names, "
            f"task titles, categories, approval names) in English."
        )
    size_hint = _team_size_hint(s.get("team_size") or "")
    refinement = (s.get("refinement") or "").strip()
    refine_block = f"\n\nFounder's follow-up refinement (they added this after seeing the first draft — reflect it faithfully):\n{refinement}" if refinement else ""
    prompt = (
        f"{_profile_block(s)}\n\n{size_hint}\n\n"
        f"Interview transcript:\n{_qa_block(s.get('qa') or [])}{refine_block}\n\n"
        "Design this company's operating system now — sized to their team band, worded in their industry."
    )
    try:
        chat = claude_chat(session_id=f"bp-{s['id']}-{len(refinement)}", system_message=BLUEPRINT_SYSTEM + welcome_note).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.error(f"interview blueprint failed: {e}")
        raise HTTPException(status_code=503, detail="Couldn't generate your operating system. Please try again.")
    bp = normalize_os_blueprint(data)
    products = [
        {"name": (p.get("name") or "").strip(), "description": (p.get("description") or "").strip()}
        for p in (data.get("products") or []) if (p.get("name") or "").strip()
    ][:5] or [{"name": (p.get("name") or "").strip(), "description": (p.get("description") or "").strip()}
              for p in (s.get("products") or []) if (p.get("name") or "").strip()][:5]
    await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"status": "blueprint_ready"}})
    return {**bp, "products": products, "welcome_line": (data.get("welcome_line") or "").strip()}


class InterviewRefineInput(BaseModel):
    session_id: str = Field(max_length=64)
    refinement: str = Field(max_length=4000)
    language_code: Optional[str] = Field(default="", max_length=16)


@router.post("/interview/refine")
async def interview_refine(inp: InterviewRefineInput):
    """Founder saw the first draft blueprint and wants to add/correct something.
    Store the refinement on the session, then re-run blueprint with it in context."""
    s = await db.signup_sessions.find_one({"id": inp.session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Interview session not found")
    refinement = inp.refinement.strip()
    if not refinement:
        raise HTTPException(status_code=400, detail="Refinement is empty")
    await db.signup_sessions.update_one(
        {"id": s["id"]}, {"$set": {"refinement": refinement}}
    )
    return await interview_blueprint(InterviewSessionInput(session_id=s["id"], language_code=inp.language_code))


# --------------------------------------------------------------------------
# Sarvam voice: TTS (bulbul:v3) + STT (saaras:v3, short clips)
# --------------------------------------------------------------------------
class TTSInput(BaseModel):
    text: str = Field(max_length=1200)
    language_code: Optional[str] = Field(default="en-IN", max_length=16)


@router.post("/tts")
async def signup_tts(inp: TTSInput):
    key = get_ai_key("sarvam")
    if not key:
        raise HTTPException(status_code=503, detail="Voice is not configured")
    text = inp.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to speak")
    lang = _norm_lang(inp.language_code)
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": key, "Content-Type": "application/json"},
                json={"text": text, "target_language_code": lang, "model": "bulbul:v3",
                      "speaker": _speaker_for(lang), "pace": 1.0},
            )
        r.raise_for_status()
        audios = r.json().get("audios") or []
        if not audios:
            raise ValueError("empty TTS response")
        return {"audio_b64": audios[0], "mime": "audio/wav", "language_code": lang}
    except Exception as e:
        logger.error(f"signup TTS failed: {e}")
        raise HTTPException(status_code=503, detail="Voice playback unavailable right now")


@router.post("/stt")
async def signup_stt(file: UploadFile = File(...)):
    key = get_ai_key("sarvam")
    if not key:
        raise HTTPException(status_code=503, detail="Voice is not configured")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Recording too long — keep answers under 30 seconds")
    model = os.environ.get("SARVAM_STT_MODEL", "saaras:v3").strip() or "saaras:v3"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": key},
                files={"file": (file.filename or "answer.webm", content, file.content_type or "audio/webm")},
                data={"model": model, "mode": "translate", "language_code": "unknown"},
            )
        r.raise_for_status()
        body = r.json() or {}
        detected = body.get("language_code") or body.get("detected_language_code") or ""
        return {
            "text": (body.get("transcript") or "").strip(),
            "language_code": _norm_lang(detected) if detected else "",
        }
    except Exception as e:
        logger.error(f"signup STT failed: {e}")
        raise HTTPException(status_code=503, detail="Couldn't transcribe — try again or type your answer")
