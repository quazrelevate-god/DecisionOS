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

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from core import model_for
from prompts import render
from emergentintegrations.llm.chat import UserMessage

from core import (
    db, claude_chat, _extract_json, new_id, now_iso, logger,
    normalize_os_blueprint, get_ai_key,
)
# FIX-004-A (RBAC-03): rate-limit + SSRF guard for unauth AI endpoints.
from services.rate_limit import check_rate_limit, client_ip
from services.ssrf_guard import is_url_safe_for_fetch
from services.captcha import verify_captcha

router = APIRouter(prefix="/api/signup")


# FIX-004-A (RBAC-03): per-IP quotas on public AI endpoints. Numbers
# are calibrated to a realistic signup funnel: a founder finishing the
# whole flow hits website-intel once, tts a few times, stt 2-6 times.
# 30/hr is comfortably above that, well below what a bot would need to
# drain credit meaningfully.
_SIGNUP_AI_LIMIT_HOURLY = (30, 3600)   # 30/hr per IP for the whole /api/signup surface
_SIGNUP_BURST_LIMIT = (5, 10)          # 5/10s burst — kills tight loops


async def _guard_signup_endpoint(request: Request, kind: str) -> str:
    """Shared gate for the public /api/signup AI endpoints.

    Runs three checks in order:
      1. Sliding-window per-IP rate limit — HTTP 429.
      2. Burst limit (5 requests in 10 seconds) — HTTP 429.
      3. CAPTCHA verification (via header X-Captcha-Token) — HTTP 400
         if a CAPTCHA is required and missing/invalid; skipped in dev
         when no *_SECRET is configured.

    Returns the caller's IP for downstream logging.
    """
    ip = client_ip(request)
    # Hourly ceiling
    ok, retry_after = await check_rate_limit(
        ip, _SIGNUP_AI_LIMIT_HOURLY[0], _SIGNUP_AI_LIMIT_HOURLY[1],
        bucket=f"signup_ai_hour:{kind}",
    )
    if not ok:
        raise HTTPException(
            status_code=429,
            detail=f"Too many {kind} requests from your network. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    # Short burst window — catches scripted loops even inside the hourly quota.
    ok, retry_after = await check_rate_limit(
        ip, _SIGNUP_BURST_LIMIT[0], _SIGNUP_BURST_LIMIT[1],
        bucket=f"signup_ai_burst:{kind}",
    )
    if not ok:
        raise HTTPException(
            status_code=429,
            detail="Too many requests, too fast. Slow down.",
            headers={"Retry-After": str(retry_after)},
        )
    # CAPTCHA — token comes in via header (frontend attaches after
    # widget renders on the signup page). Optional in dev — see
    # services/captcha.py behavior when no *_SECRET is set.
    token = request.headers.get("X-Captcha-Token") or ""
    cap_ok, cap_reason = await verify_captcha(token, remote_ip=ip)
    if not cap_ok:
        raise HTTPException(
            status_code=400,
            detail={"code": f"captcha_{cap_reason}",
                     "message": "We couldn't verify you as human. Refresh the page and try again."},
        )
    return ip

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


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.signup import (
    EmailCheckInput,
    WebsiteIntelInput,
    InterviewStartInput,
    InterviewAnswerInput,
    InterviewSessionInput,
    InterviewRefineInput,
    TTSInput,
)


@router.post("/check-email")
async def check_email(inp: EmailCheckInput, request: Request):
    # FIX-004-A (RBAC-03): rate-limited to prevent email enumeration.
    # CAPTCHA is required in prod so a bot can't sweep a leaked email
    # list. The response is intentionally binary (available: bool) —
    # combining that with the rate limit + CAPTCHA + login rate-limit
    # (S0-07, not shipped) makes enumeration economically infeasible.
    await _guard_signup_endpoint(request, "check_email")
    email = inp.email.strip().lower()
    taken = bool(email) and bool(await db.users.find_one({"email": email}, {"_id": 1}))
    return {"available": not taken}


# --------------------------------------------------------------------------
# Website intelligence
# --------------------------------------------------------------------------


def _clean_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|svg|iframe)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = re.sub(r"&[a-zA-Z#0-9]+;", " ", html)
    return re.sub(r"\s+", " ", html).strip()


@router.post("/website-intel")
async def website_intel(inp: WebsiteIntelInput, request: Request):
    # FIX-004-A (RBAC-03): auth-gate + rate limit + SSRF guard.
    await _guard_signup_endpoint(request, "website_intel")
    url = inp.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Enter a website URL")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    # FIX-004-A (RBAC-03): SSRF guard — refuse to fetch URLs that resolve
    # to private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x
    # cloud metadata), file://, ftp://, or known internal hostnames
    # (localhost, metadata.google.internal, kubernetes.default.svc).
    # Prevents an attacker from using this endpoint to probe/attack
    # our internal network or exfiltrate cloud metadata IAM tokens.
    safe, reason = is_url_safe_for_fetch(url)
    if not safe:
        logger.warning(f"website-intel SSRF blocked: url={url!r} reason={reason}")
        raise HTTPException(
            status_code=400,
            detail="This URL isn't allowed. Enter a public website.",
        )
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

    system = render("onboarding.web_intel",
                    industries=", ".join(INDUSTRIES), business_models=", ".join(BUSINESS_MODELS))
    prompt = f"Company: {inp.company_name or 'unknown'}\nWebsite text:\n{text}"
    try:
        chat = claude_chat(task="onboarding.web_intel", session_id=f"webintel-{new_id()}", system_message=system).with_model(*model_for("onboarding.web_intel"))
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


INTERVIEW_SYSTEM = render("onboarding.interview", min_questions=MIN_QUESTIONS, max_questions=MAX_QUESTIONS)


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
async def interview_start(inp: InterviewStartInput, request: Request):
    # FIX-004-A (RBAC-03): CAPTCHA + rate-limit. Prevents bots from
    # holding open interview sessions and burning per-answer LLM calls.
    await _guard_signup_endpoint(request, "interview_start")
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
async def interview_back(inp: InterviewSessionInput, request: Request):
    # FIX-004-A (RBAC-03): rate-limit only (no LLM here). Prevents
    # tight-loop DB churn on session state.
    await _guard_signup_endpoint(request, "interview_back")
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
async def interview_answer(inp: InterviewAnswerInput, request: Request):
    # FIX-004-A (RBAC-03): every answer triggers an LLM call — gate it.
    await _guard_signup_endpoint(request, "interview_answer")
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
        chat = claude_chat(task="onboarding.interview", session_id=f"interview-{s['id']}-{len(qa)}", system_message=system).with_model(*model_for("onboarding.interview"))
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


BLUEPRINT_SYSTEM = render("onboarding.blueprint")  # prompt in prompts/onboarding.py


@router.post("/interview/blueprint")
async def interview_blueprint(inp: InterviewSessionInput, request: Request):
    # FIX-004-A (RBAC-03): blueprint gen = expensive LLM call — gate it.
    await _guard_signup_endpoint(request, "interview_blueprint")
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
        chat = claude_chat(task="onboarding.blueprint", session_id=f"bp-{s['id']}-{len(refinement)}", system_message=BLUEPRINT_SYSTEM + welcome_note).with_model(*model_for("onboarding.blueprint"))
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




@router.post("/interview/refine")
async def interview_refine(inp: InterviewRefineInput, request: Request):
    # FIX-004-A (RBAC-03): refine re-runs blueprint (LLM) — gate it.
    await _guard_signup_endpoint(request, "interview_refine")
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
    # Pass the same Request so the rate limiter charges once per user
    # action, not twice for the refine + inner blueprint chain.
    return await interview_blueprint(
        InterviewSessionInput(session_id=s["id"], language_code=inp.language_code),
        request,
    )


# --------------------------------------------------------------------------
# Sarvam voice: TTS (bulbul:v3) + STT (saaras:v3, short clips)
# --------------------------------------------------------------------------


@router.post("/tts")
async def signup_tts(inp: TTSInput, request: Request):
    # FIX-004-A (RBAC-03): rate-limited + CAPTCHA-gated so an attacker
    # can't drain the shared Sarvam TTS quota with unauth calls.
    await _guard_signup_endpoint(request, "tts")
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
async def signup_stt(request: Request, file: UploadFile = File(...)):
    # FIX-004-A (RBAC-03): rate-limited + CAPTCHA-gated. STT is
    # per-minute-billed on Sarvam so bot abuse is directly financial.
    await _guard_signup_endpoint(request, "stt")
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
