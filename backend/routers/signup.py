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

MAX_QUESTIONS = 4
TTS_SPEAKER = os.environ.get("SARVAM_TTS_SPEAKER", "shubh").strip() or "shubh"

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


class InterviewAnswerInput(BaseModel):
    session_id: str = Field(max_length=64)
    answer: str = Field(max_length=4000)


class InterviewSessionInput(BaseModel):
    session_id: str = Field(max_length=64)


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
    "You are the DecisionOS onboarding interviewer — think of a sharp, warm COO having a quick chat with a founder "
    "to understand how their company actually runs, so DecisionOS can build a REALISTIC operating system "
    "(departments, workflows, recurring tasks, approval rules) — not a generic template.\n"
    f"Rules: you get at most {MAX_QUESTIONS} questions TOTAL, so every question must earn its place. "
    "Ask exactly ONE question at a time, under 28 words, conversational and specific to what you already know. "
    "Never ask what you already know (industry, size, products). Adapt to company size: a 5-person shop runs on the founder; "
    "a 200-person company has managers, approvals and handoffs — ask accordingly.\n"
    "Good areas: how work flows from order/enquiry to delivery, where things get stuck or slip, who approves money/decisions, "
    "what the founder personally checks daily.\n"
    "Return ONLY valid JSON: {\"question\": string, \"why\": string (under 10 words, why this matters), "
    "\"enough\": boolean (true if you already have enough to design their OS — only allowed after 2+ answers)}."
)


@router.post("/interview/start")
async def interview_start(inp: InterviewStartInput):
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
        "status": "active",
        "created_at": now_iso(),
    }
    prompt = (
        f"{_profile_block(session)}\n\nThis is question 1 of {MAX_QUESTIONS}. "
        "Start with the most important thing: how the company actually operates day to day "
        "(how work comes in and gets delivered). Make it specific to their industry and size."
    )
    try:
        chat = claude_chat(session_id=f"interview-{session['id']}", system_message=INTERVIEW_SYSTEM).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.error(f"interview start failed: {e}")
        data = {}
    question = (data.get("question") or "").strip() or (
        f"Walk me through how {session['company_name']} works day to day — how does an order or enquiry come in, and what happens until it's delivered?"
    )
    session["pending_q"] = question
    await db.signup_sessions.insert_one(session)
    return {"session_id": session["id"], "question": question, "why": (data.get("why") or "").strip(),
            "index": 1, "max": MAX_QUESTIONS}


@router.post("/interview/answer")
async def interview_answer(inp: InterviewAnswerInput):
    s = await db.signup_sessions.find_one({"id": inp.session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Interview session not found")
    answer = inp.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Answer is empty")
    qa = (s.get("qa") or []) + [{"q": s.get("pending_q") or "", "a": answer}]
    if len(qa) >= MAX_QUESTIONS:
        await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"qa": qa, "pending_q": None, "status": "done"}})
        return {"done": True, "index": len(qa), "max": MAX_QUESTIONS}

    prompt = (
        f"{_profile_block(s)}\n\nConversation so far:\n{_qa_block(qa)}\n\n"
        f"That was answer {len(qa)} of max {MAX_QUESTIONS}. If you have enough to design a realistic operating system, "
        "set enough=true. Otherwise ask the single most valuable next question (build on their answers, don't repeat)."
    )
    try:
        chat = claude_chat(session_id=f"interview-{s['id']}-{len(qa)}", system_message=INTERVIEW_SYSTEM).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.error(f"interview answer failed: {e}")
        data = {"enough": len(qa) >= 2}
    if data.get("enough") and len(qa) >= 2:
        await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"qa": qa, "pending_q": None, "status": "done"}})
        return {"done": True, "index": len(qa), "max": MAX_QUESTIONS}
    question = (data.get("question") or "").strip() or "What part of the business slips through the cracks most often when things get busy?"
    await db.signup_sessions.update_one({"id": s["id"]}, {"$set": {"qa": qa, "pending_q": question}})
    return {"done": False, "question": question, "why": (data.get("why") or "").strip(),
            "index": len(qa) + 1, "max": MAX_QUESTIONS}


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
    prompt = (
        f"{_profile_block(s)}\n\nInterview transcript:\n{_qa_block(s.get('qa') or [])}\n\n"
        "Design this company's operating system now."
    )
    try:
        chat = claude_chat(session_id=f"bp-{s['id']}", system_message=BLUEPRINT_SYSTEM).with_model(*LLM_MODEL)
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


# --------------------------------------------------------------------------
# Sarvam voice: TTS (bulbul:v3) + STT (saaras:v3, short clips)
# --------------------------------------------------------------------------
class TTSInput(BaseModel):
    text: str = Field(max_length=1200)


@router.post("/tts")
async def signup_tts(inp: TTSInput):
    key = get_ai_key("sarvam")
    if not key:
        raise HTTPException(status_code=503, detail="Voice is not configured")
    text = inp.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to speak")
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": key, "Content-Type": "application/json"},
                json={"text": text, "target_language_code": "en-IN", "model": "bulbul:v3",
                      "speaker": TTS_SPEAKER, "pace": 1.0},
            )
        r.raise_for_status()
        audios = r.json().get("audios") or []
        if not audios:
            raise ValueError("empty TTS response")
        return {"audio_b64": audios[0], "mime": "audio/wav"}
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
        return {"text": (r.json().get("transcript") or "").strip()}
    except Exception as e:
        logger.error(f"signup STT failed: {e}")
        raise HTTPException(status_code=503, detail="Couldn't transcribe — try again or type your answer")
