"""Standalone onboarding logic — extracted from backend/routers/signup.py and
backend/core.py so the flow can be tested from a Streamlit UI without any of
the rest of the backend (no FastAPI, no MongoDB, no auth, no tenant setup).

Everything session-related lives in the caller's own dict (Streamlit passes
`st.session_state`-backed dicts) instead of MongoDB `signup_sessions`. The
prompts, constants, templates, and reasoning are UNCHANGED from the current
backend — this is a lift, not a rewrite. If you change a prompt here to test
something, remember it's a copy — the real backend still uses its own.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

# Load .env sitting next to this file (or above it).
load_dotenv(Path(__file__).parent / ".env")

# ---------------------------------------------------------------------------
# Config — the ONLY env vars this test app needs.
# ---------------------------------------------------------------------------
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
SARVAM_KEY = os.environ.get("SARVAM_API_KEY", "").strip()
LLM_MODEL = ("anthropic", "claude-sonnet-4-6")

# TTS speaker config (verbatim from backend/routers/signup.py L33-53).
TTS_SPEAKER_FALLBACK = os.environ.get("SARVAM_TTS_SPEAKER", "shubh").strip() or "shubh"
STT_MODEL = os.environ.get("SARVAM_STT_MODEL", "saaras:v3").strip() or "saaras:v3"

# Best bulbul:v3 speaker per language, from Sarvam's official production
# recommendations (docs.sarvam.ai → "Recommended Speakers by Language").
LANG_SPEAKERS = {
    "en-IN": "ishita", "hi-IN": "priya", "bn-IN": "roopa", "gu-IN": "priya",
    "kn-IN": "ishita", "ml-IN": "pooja", "mr-IN": "priya", "od-IN": "pooja",
    "pa-IN": "mani", "ta-IN": "ishita", "te-IN": "priya",
}


def _speaker_for(lang: str) -> str:
    return LANG_SPEAKERS.get(lang, TTS_SPEAKER_FALLBACK)


def _keys_in_order() -> list[str]:
    """Anthropic first (if set), Emergent as fallback — same order as core.py."""
    keys, seen = [], set()
    for k in (ANTHROPIC_KEY, EMERGENT_LLM_KEY):
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


# ---------------------------------------------------------------------------
# Constants (verbatim from backend/routers/signup.py)
# ---------------------------------------------------------------------------
MIN_QUESTIONS = 2
MAX_QUESTIONS = 6

SUPPORTED_TTS_LANGS = {
    "en-IN": "English", "hi-IN": "Hindi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
    "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "od-IN": "Odia",
    "pa-IN": "Punjabi", "ta-IN": "Tamil", "te-IN": "Telugu",
}

INDUSTRIES = [
    "Manufacturing", "Textile & Apparel", "Retail / E-commerce", "Wholesale / Distribution",
    "Restaurant / Food & Beverage", "Hospitality & Travel", "Professional Services", "Consulting",
    "Construction", "Real Estate", "Healthcare", "Pharmaceuticals", "Beauty & Wellness",
    "Fitness & Sports", "Technology / SaaS", "Media & Entertainment", "Marketing & Advertising",
    "Logistics & Transport", "Automotive", "Education", "Financial Services", "Legal Services",
    "Agriculture", "Event Management", "Import / Export", "Non-profit / NGO", "Other",
]
BUSINESS_MODELS = ["B2B", "B2C", "B2B & B2C", "D2C", "Marketplace", "Services"]

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

OPENERS_WITH_INDUSTRY = {
    "en-IN": "Hi{name} — I can see {company} is in {industry}. Walk me through how your day-to-day operations actually run.",
    "hi-IN": "नमस्ते{name} — मुझे पता है {company}, {industry} क्षेत्र में है। बताइए, आपका रोज़ का कामकाज असल में कैसे चलता है?",
    "bn-IN": "নমস্কার{name} — আমি জানি {company} {industry} ক্ষেত্রে কাজ করে। বলুন, আপনার দৈনন্দিন কাজকর্ম আসলে কীভাবে চলে?",
    "gu-IN": "નમસ્તે{name} — મને ખબર છે {company}, {industry} ક્ષેત્રમાં છે. કહો, તમારું રોજિંદું કામકાજ ખરેખર કેવી રીતે ચાલે છે?",
    "kn-IN": "ನಮಸ್ಕಾರ{name} — {company}, {industry} ಕ್ಷೇತ್ರದಲ್ಲಿದೆ ಎಂದು ನನಗೆ ತಿಳಿದಿದೆ. ನಿಮ್ಮ ದೈನಂದಿನ ಕೆಲಸ ನಿಜವಾಗಿ ಹೇಗೆ ನಡೆಯುತ್ತದೆ ಎಂದು ಹೇಳಿ?",
    "ml-IN": "നമസ്കാരം{name} — {company}, {industry} മേഖലയിലാണെന്ന് എനിക്കറിയാം. നിങ്ങളുടെ ദൈനംദിന പ്രവർത്തനങ്ങൾ യഥാർത്ഥത്തിൽ എങ്ങനെയാണ് നടക്കുന്നതെന്ന് പറയൂ?",
    "mr-IN": "नमस्कार{name} — मला माहीत आहे {company} हे {industry} क्षेत्रात आहे. सांगा, तुमचं रोजचं कामकाज खरंतर कसं चालतं?",
    "od-IN": "ନମସ୍କାର{name} — ମୁଁ ଜାଣେ {company}, {industry} କ୍ଷେତ୍ରରେ ଅଛି। କୁହନ୍ତୁ, ଆପଣଙ୍କ ଦୈନନ୍ଦିନ କାର୍ଯ୍ୟ ପ୍ରକୃତରେ କିପରି ଚାଲେ?",
    "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ{name} — ਮੈਨੂੰ ਪਤਾ ਹੈ {company}, {industry} ਖੇਤਰ ਵਿੱਚ ਹੈ। ਦੱਸੋ, ਤੁਹਾਡਾ ਰੋਜ਼ਾਨਾ ਕੰਮਕਾਜ ਅਸਲ ਵਿੱਚ ਕਿਵੇਂ ਚੱਲਦਾ ਹੈ?",
    "ta-IN": "வணக்கம்{name} — {company}, {industry} துறையில் இருப்பது எனக்குத் தெரியும். உங்கள் அன்றாட வேலைகள் உண்மையில் எப்படி நடக்கின்றன என்று சொல்லுங்கள்?",
    "te-IN": "నమస్తే{name} — {company}, {industry} రంగంలో ఉందని నాకు తెలుసు. మీ రోజువారీ కార్యకలాపాలు నిజంగా ఎలా జరుగుతాయో చెప్పండి?",
}

OPENER_WHY = {
    "en-IN": "Your own words become your OS",
    "hi-IN": "आपके शब्द ही आपका OS बनेंगे",
    "bn-IN": "আপনার কথাই হবে আপনার OS",
    "gu-IN": "તમારા શબ્દો જ તમારું OS બનશે",
    "kn-IN": "ನಿಮ್ಮ ಮಾತುಗಳೇ ನಿಮ್ಮ OS ಆಗುತ್ತವೆ",
    "ml-IN": "നിങ്ങളുടെ വാക്കുകൾ തന്നെ നിങ്ങളുടെ OS ആകും",
    "mr-IN": "तुमचे शब्दच तुमचं OS बनतील",
    "od-IN": "ଆପଣଙ୍କ କଥା ହିଁ ଆପଣଙ୍କ OS ହେବ",
    "pa-IN": "ਤੁਹਾਡੇ ਸ਼ਬਦ ਹੀ ਤੁਹਾਡਾ OS ਬਣਨਗੇ",
    "ta-IN": "உங்கள் வார்த்தைகளே உங்கள் OS ஆகும்",
    "te-IN": "మీ మాటలే మీ OS గా మారతాయి",
}

# ---------------------------------------------------------------------------
# Prompts (verbatim from backend/routers/signup.py — same version the real
# backend runs today).
# ---------------------------------------------------------------------------
INTERVIEW_SYSTEM = (
    "You are Dex, the DecisionOS onboarding interviewer — a sharp, warm COO having a real chat with a founder "
    "so DecisionOS can build a REALISTIC operating system for THEIR company (departments, workflows, recurring tasks, "
    "approval rules) — never a generic template.\n\n"

    "STEP 1 — INFER THE OPERATIONAL DOMAIN BEFORE YOU ASK ANYTHING. Before you generate ANY question, silently "
    "synthesize what THIS specific business actually does day-to-day. Read the profile — industry, business "
    "model, products, website summary, founder's description — and answer these in your head:\n"
    "  • What tangible thing (physical product, service, digital offering, care, education, transport…) does "
    "this business actually deliver?\n"
    "  • For a business like this, what are the natural STAGES between initial customer intent and getting "
    "paid? Name them in vocabulary an insider in that industry would use — not textbook business words.\n"
    "  • What INPUTS does it consume to deliver that (raw materials, staff time, inventory, medical supplies, "
    "engineering hours, patient records, fleet capacity, teacher hours, whatever fits)?\n"
    "  • What TYPE OF FAILURE this industry deals with — what \"goes wrong\" in a business like this?\n"
    "Every question you ask must be shaped by that synthesis. This is not optional — a question that doesn't "
    "reflect the actual domain of the business is a wasted turn.\n\n"

    "STEP 2 — ASK ONLY ABOUT STAGES THAT EXIST IN THIS BUSINESS. Concrete illustrations of the reasoning "
    "(these are EXAMPLES of the pattern, not an exhaustive lookup):\n"
    "  • Manufacturer → order intake, production planning, procurement, quality checks, dispatch. Words: "
    "order, production run, batch, dispatch, supplier.\n"
    "  • Hospital / clinic → patient registration, appointments, admissions, diagnostics, treatment, "
    "discharge, approvals for surgery or high-value spend. Words: patient, case, consultation, discharge.\n"
    "  • SaaS → signup, onboarding, activation, feature requests, deployments, support tickets, renewal. "
    "Words: customer, trial, ticket, release, subscription.\n"
    "  • Retail / e-commerce → purchasing, replenishment, store/site operations, POS, returns. Words: SKU, "
    "stock, order, return.\n"
    "  • Logistics → shipment booking, routing, dispatch, delivery tracking, fleet & driver ops. Words: "
    "shipment, leg, route, vehicle, POD.\n"
    "  • Construction → project execution, procurement, subcontractor management, site ops, milestone "
    "approvals. Words: site, milestone, subcon, vendor.\n"
    "  • Education → admissions, student lifecycle, faculty ops, examinations, fee collection. Words: "
    "student, batch, term, fee.\n"
    "  • Consulting / agency → client onboarding, engagement scoping, delivery, retainer billing. Words: "
    "client, engagement, deliverable, retainer.\n"
    "If the business doesn't fit any of these examples neatly, DERIVE its own natural stages and vocabulary "
    "from the profile — the pattern is the point, not the list.\n\n"

    "HARD RULE — NEVER MIX DOMAINS. Do NOT ask a SaaS company about production runs or inventory. Do NOT ask "
    "a hospital about warehouse dispatch or SKUs. Do NOT ask a consulting firm about manufacturing capacity. "
    "Do NOT ask a school about factory shifts. If a topic wouldn't naturally exist in this specific business, "
    "it's not a gap — it's not a topic at all. Match the founder's world; never impose a different one.\n\n"

    "ESTABLISHED CONTEXT COMES FIRST. Every message you receive includes a company profile — treat every "
    "non-'unknown' field in it as CONFIRMED FACT, not a guess:\n"
    "  • Never ask about anything already stated there — that includes what they do, their industry, their "
    "products, and their business model.\n"
    "  • Use it to aim every question at THEIR specific business from question one — reference their actual "
    "products, services, or something from their website summary by name wherever you can.\n"
    "  • Fields marked 'unknown' are genuine gaps, not facts — do not assume what they'd likely be; ask about "
    "them only if they matter operationally.\n\n"

    "INTERVIEW LENGTH IS DYNAMIC. You have a range: "
    f"MINIMUM {MIN_QUESTIONS} answers, MAXIMUM {MAX_QUESTIONS} answers (including the opening question already answered). "
    "End early (set enough=true) the moment the operational picture is genuinely clear — do NOT pad. "
    "Keep going up to the max if the picture is still fuzzy on the lenses below. Never end before the minimum.\n\n"

    "TEAM SIZE SHAPES WHAT \"OPERATIONS\" LOOK LIKE INSIDE THE DOMAIN. This is not optional.\n"
    "  • 1–10 person team → It's the FOUNDER doing everything. There are usually NO departments, no formal "
    "approvals, no hierarchy. Ask how THEY personally juggle the domain-specific stages you inferred in Step 1. "
    "Ask who covers when they're sick or travelling. Don't invent structure they don't have.\n"
    "  • 11–50 person team → Early handoffs, one or two informal leads, founder still in most decisions. Ask "
    "who owns which slice of the domain flow, how the founder finds out things went wrong, what they still "
    "personally sign off on.\n"
    "  • 50+ person team → Real departments, managers, formal approvals, escalation paths. Ask about "
    "department structure, approval limits, review cadences, cross-team handoffs — but always in the DOMAIN's "
    "vocabulary, never in generic MBA-textbook terms.\n\n"

    "OPERATIONAL LENSES TO COVER (before setting enough=true — verify each, using the domain-specific stages "
    "you inferred in Step 1, not the generic phrasing below):\n"
    "  1. End-to-end flow — the ACTUAL stages this business runs, from first customer intent through to money "
    "received. Named in their vocabulary.\n"
    "  2. Who does what at each stage — roles (or departments if 50+), key handoffs, backups.\n"
    "  3. Approvals & money — who signs off on the decisions and spends that matter for THIS domain "
    "(procurement for a manufacturer, surgery for a hospital, refunds for retail, releases for SaaS, "
    "site-material orders for construction, and so on).\n"
    "  4. Where things slip — the pain points and failure modes specific to THIS industry, in the founder's "
    "own words.\n"
    "  5. Founder's daily/weekly touchpoints — what they personally check, chase, or approve, framed in the "
    "domain's vocabulary.\n"
    "If ANY lens is still fuzzy after accounting for what's already known, keep asking (until you hit the max). "
    "If all are clear enough to design departments/workflows/tasks/approvals, set enough=true.\n\n"

    "QUESTION RULES:\n"
    "  • Exactly ONE question at a time, under 28 words, warm and conversational.\n"
    "  • Open with a brief, NATURAL acknowledgement of something specific — from the profile (\"From your site "
    "it looks like you supply components to OEMs — …\") or from a prior answer (\"You mentioned you take "
    "orders on WhatsApp — …\"), then pivot to the question. Never a flat \"I can see you're in Automotive.\" "
    "Vary the phrasing; never sound scripted.\n"
    "  • Use the DOMAIN's vocabulary. \"Patient\" for a hospital, not \"customer.\" \"Order\" for a "
    "manufacturer, not \"engagement.\" \"Subscriber\" or \"account\" for SaaS, not \"buyer.\" \"Student\" for "
    "a school, not \"user.\" Match the world; never impose one.\n"
    "  • Ground every question in a specific, named detail — never a generic operational category floating "
    "free of their real business.\n"
    "  • Before asking, check silently: is this already answered or clearly implied by the established context "
    "or ANY earlier answer (not just the last one)? If yes, drop it and ask about the next real gap instead.\n"
    "  • Never assume or invent something about their business that wasn't stated in the profile or the "
    "conversation. If you're unsure whether something applies to them, ASK using the domain's vocabulary, "
    "don't ASSUME.\n"
    "  • Purely OPERATIONAL — never strategic, visionary, growth-plan, or 'where do you see the company in 5 "
    "years' style.\n\n"

    "Return ONLY valid JSON: {\"question\": string, \"why\": string (under 10 words, why this matters), "
    f"\"enough\": boolean (true only if the lenses are covered AND at least {MIN_QUESTIONS} answers exist)}}."
)

BLUEPRINT_SYSTEM = (
    "You are the onboarding architect for DecisionOS, an operating system for founder-led SMEs. "
    "You just interviewed a founder, on top of an earlier website analysis. Design THEIR operating system "
    "using ONLY what the profile and interview transcript below actually support — use their terminology, "
    "their real processes, their pain points, their own numbers and thresholds where they gave any. "
    "NOT a generic template.\n\n"

    "GROUNDING IS MANDATORY. Every department, workflow, task, and approval rule must trace back to something "
    "stated in the profile (industry, business model, website summary, products, description) or said during "
    "the interview. If the profile and transcript don't clearly support an item, LEAVE IT OUT — a shorter, "
    "accurate blueprint beats a longer, invented one. Never add a department, workflow, task, or approval rule "
    "just to fill a quota.\n\n"

    "TARGET COUNTS BY TEAM SIZE BAND — read the TEAM SIZE BAND given below the profile and use the matching row. "
    "These are ceilings, not quotas — return fewer if the evidence doesn't support the max:\n"
    "  • 1-10 (founder-led) → 2-4 departments (functional areas the founder personally juggles — not a "
    "hierarchy), 3-5 workflows, 4-8 operational_tasks, 1-3 approval_rules.\n"
    "  • 11-50 (early structure) → 3-6 departments, 4-7 workflows, 6-10 operational_tasks, 2-4 approval_rules.\n"
    "  • 50-200 (departments + managers) → 5-8 departments, 6-9 workflows, 8-14 operational_tasks, "
    "3-6 approval_rules.\n"
    "  • 200+ (full structure) → 6-8 departments, 8-10 workflows, 10-20 operational_tasks, 4-6 approval_rules.\n\n"

    "STAY CONSISTENT WITH THE PROFILE. Departments, workflows, and tasks must fit the industry and business "
    "model already established in the profile — don't contradict it or drift into a different kind of business. "
    "Map what you generate to what the interview actually covered: workflows should reflect the end-to-end flow "
    "they described, approval_rules should reflect who they said signs off on what, and operational_tasks "
    "should reflect the pain points and daily/weekly touchpoints they mentioned — not a generic list.\n\n"

    "USE THEIR EXACT WORDS. Name departments, workflows, tasks, and approval rules the way the founder or their "
    "website would describe them, not the way a textbook would. If they gave a specific number, role, or "
    "threshold (e.g. an amount above which they personally approve something), preserve it in the description "
    "instead of generalizing it away.\n\n"

    "IF A FOUNDER REFINEMENT IS PRESENT in the message below, it is a correction made after seeing the first "
    "draft — treat it as authoritative. Where it conflicts with the original interview transcript or profile, "
    "the refinement wins.\n\n"

    "Return ONLY valid JSON with exactly these keys: "
    "{\"departments\": [string department name] (see target counts above, no 'Owner'), "
    "\"workflows\": [{\"name\": string}] (see target counts above, named after THEIR real processes), "
    "\"operational_tasks\": [{\"title\": string, \"category\": one of "
    "[Presentation,Meeting,Documentation,Proposal,Planning,Review,Administration,Compliance,Marketing,HR Activity,Travel,Event,IT Support,Other]}] "
    "(see target counts above, recurring tasks that address what the founder said slips or matters), "
    "\"approval_rules\": [{\"name\": string, \"description\": short string}] (see target counts above, matching "
    "who they said approves things), "
    "\"products\": [{\"name\": string, \"description\": short string}] (their actual products/services already "
    "named in the profile or interview, up to 5 — do not invent products not already established), "
    "\"welcome_line\": string (ONE warm, specific sentence telling this founder what their new OS will handle for them — "
    "reference something real they said, under 30 words)}."
)


# ---------------------------------------------------------------------------
# Pure helpers (from backend/routers/signup.py + backend/core.py)
# ---------------------------------------------------------------------------
def new_id() -> str:
    return uuid.uuid4().hex


def _norm_lang(code: str) -> str:
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


def _clean_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|svg|iframe)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = re.sub(r"&[a-zA-Z#0-9]+;", " ", html)
    return re.sub(r"\s+", " ", html).strip()


def _extract_json(text: str):
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text.strip("`")
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


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


def _team_size_hint(size_str: str) -> str:
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


def _lang_directive(code: str) -> str:
    code = _norm_lang(code)
    if code == "en-IN":
        return ""
    name = SUPPORTED_TTS_LANGS.get(code, "the founder's language")
    return (
        f"\n\nIMPORTANT: The founder is speaking {name}. Write BOTH the \"question\" and \"why\" fields "
        f"in natural, conversational {name} (native script, not transliteration). Keep it warm and simple."
    )


def _slugify_key(label: str) -> str:
    return (label or "").strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")


def _bp_departments(data: dict) -> list:
    departments, seen = [], set()
    for d in (data.get("departments") or []):
        label = (d if isinstance(d, str) else (d.get("label") or d.get("name") or "")).strip()
        key = _slugify_key(label)
        if key and key != "owner" and key not in seen:
            seen.add(key)
            departments.append({"key": key, "label": label})
    return departments[:12]


def _bp_workflows(data: dict) -> list:
    out = []
    for w in (data.get("workflows") or data.get("workflow_templates") or []):
        name = (w if isinstance(w, str) else (w.get("name") or w.get("title") or "")).strip()
        if name:
            out.append({"name": name})
    return out[:16]


def _bp_op_tasks(data: dict) -> list:
    out = []
    for t in (data.get("operational_tasks") or data.get("operational_task_templates") or []):
        if isinstance(t, str):
            title, cat = t.strip(), "Other"
        else:
            title = (t.get("title") or t.get("name") or "").strip()
            cat = (t.get("category") or "Other").strip() or "Other"
        if title:
            out.append({"title": title, "category": cat})
    return out[:20]


def _bp_rules(data: dict) -> list:
    out = []
    for r in (data.get("approval_rules") or []):
        if isinstance(r, str):
            name, desc = r.strip(), ""
        else:
            name = (r.get("name") or r.get("title") or "").strip()
            desc = (r.get("description") or "").strip()
        if name:
            out.append({"name": name, "description": desc})
    return out[:10]


def normalize_os_blueprint(data: dict) -> dict:
    return {
        "departments": _bp_departments(data),
        "workflows": _bp_workflows(data),
        "operational_tasks": _bp_op_tasks(data),
        "approval_rules": _bp_rules(data),
    }


# ---------------------------------------------------------------------------
# Claude call (sync-wrapped async LlmChat) — replaces core.py _ResilientChat.
# Same fallback order (Anthropic key first, Emergent as backup).
# ---------------------------------------------------------------------------
class LLMError(RuntimeError):
    """Raised when no configured key succeeded. Callers can render this in UI."""


def _call_claude_sync(session_id: str, system_message: str, user_text: str) -> str:
    """Synchronous wrapper around emergentintegrations.LlmChat for Streamlit.
    Streamlit reruns the script per interaction so a fresh event loop each call
    is fine — matches how core.py's stateless-LLM pattern already works."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    keys = _keys_in_order()
    if not keys:
        raise LLMError(
            "No API key configured. Set EMERGENT_LLM_KEY (or ANTHROPIC_API_KEY) "
            "in streamlit_onboarding/.env — see .env.example."
        )

    async def _run():
        last_err: Optional[Exception] = None
        for key in keys:
            try:
                chat = LlmChat(api_key=key, session_id=session_id,
                               system_message=system_message).with_model(*LLM_MODEL)
                return await chat.send_message(UserMessage(text=user_text))
            except Exception as e:
                last_err = e
        raise LLMError(f"All configured keys failed. Last error: {last_err}")

    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Public API — these mirror the /api/signup/* endpoints, but take dicts and
# return dicts. Callers own the session state.
# ---------------------------------------------------------------------------
def analyze_website(url: str, company_name: str = "") -> dict:
    """Mirror of POST /api/signup/website-intel."""
    url = (url or "").strip()
    if not url:
        return {"fetched": False, "reason": "empty_url"}
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    text = ""
    try:
        with httpx.Client(timeout=12, follow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        }) as client:
            r = client.get(url)
            if r.status_code < 400:
                text = _clean_html(r.text)[:7000]
    except Exception as e:
        return {"fetched": False, "reason": "fetch_failed", "error": str(e)}
    if len(text) < 120:
        return {"fetched": False, "reason": "too_little_text", "chars": len(text)}

    system = (
        "You analyse a company's website text for onboarding. The page text may include navigation menus, "
        "cookie notices, footer legal boilerplate, or other non-content noise mixed in with the real copy — "
        "ignore that noise and base every answer only on sentences that actually describe what the company "
        "does, sells, or serves.\n\n"
        "Return ONLY valid JSON, no prose:\n"
        "{\"summary\": string (2 short sentences, second person: 'You ...' — what the company does and for whom),\n"
        f"\"industry\": string (MUST be exactly one of: {', '.join(INDUSTRIES)}. If the site spans more than "
        "one, pick whichever drives the most day-to-day operational work — not whichever is mentioned first "
        "or takes up the most text),\n"
        f"\"business_model\": string (MUST be exactly one of: {', '.join(BUSINESS_MODELS)}. If genuinely "
        "mixed, pick whichever generates most of the revenue),\n"
        "\"products\": [{\"name\": string, \"description\": short string}] (up to 4 real, named products or "
        "services the text actually describes — not services you'd assume a company like this offers),\n"
        "\"highlights\": [string] (3 short facts under 8 words each, distinct from summary and products — "
        "think scale, years in business, credentials, notable clients, or geography, not a restatement of "
        "what they sell)}.\n\n"
        "Be specific. Only state what the text explicitly supports — for summary, products, and highlights, "
        "it's better to return fewer or shorter items than to guess. For industry and business_model you must "
        "still pick the closest valid option even if the signal is thin, since those two fields drive later "
        "logic and cannot be left blank."
    )
    prompt = f"Company: {company_name or 'unknown'}\nWebsite text:\n{text}"
    try:
        raw = _call_claude_sync(f"webintel-{new_id()}", system, prompt)
        data = _extract_json(raw) or {}
    except Exception as e:
        return {"fetched": False, "reason": "analysis_failed", "error": str(e)}

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


def start_interview(payload: dict) -> dict:
    """Mirror of POST /api/signup/interview/start.
    Returns {session, question, why, index, max, language_code}. The `session`
    dict is what callers should hold on to and pass back to answer_question etc.
    """
    lang = _norm_lang(payload.get("language_code"))
    session = {
        "id": new_id(),
        "company_name": (payload.get("company_name") or "").strip(),
        "founder_name": (payload.get("founder_name") or "").strip(),
        "team_size": (payload.get("team_size") or "").strip(),
        "industry": (payload.get("industry") or "").strip(),
        "business_model": (payload.get("business_model") or "").strip(),
        "description": (payload.get("description") or "").strip(),
        "website_summary": (payload.get("website_summary") or "").strip(),
        "products": payload.get("products") or [],
        "qa": [],
        "pending_q": None,
        "language_code": lang,
        "status": "active",
    }
    founder_first = (session["founder_name"].split() or [""])[0]
    templates = OPENERS_WITH_INDUSTRY if session["industry"] else OPENERS
    question = templates.get(lang, OPENERS["en-IN"]).format(
        name=f" {founder_first}" if founder_first else "",
        company=session["company_name"],
        industry=session["industry"],
    )
    session["pending_q"] = question
    return {
        "session": session,
        "question": question,
        "why": OPENER_WHY.get(lang, OPENER_WHY["en-IN"]),
        "index": 1,
        "max": MAX_QUESTIONS,
        "language_code": lang,
    }


def answer_question(session: dict, answer: str, language_code: str = "") -> dict:
    """Mirror of POST /api/signup/interview/answer.
    Returns either {done: True, session, ...} when interview is complete or
    {done: False, session, question, why, index, max, language_code} for next Q.
    """
    answer = (answer or "").strip()
    if not answer:
        raise ValueError("Answer is empty")
    lang = _norm_lang(language_code or session.get("language_code") or "en-IN")
    qa = (session.get("qa") or []) + [{"q": session.get("pending_q") or "", "a": answer}]
    session["qa"] = qa
    session["language_code"] = lang

    if len(qa) >= MAX_QUESTIONS:
        session["pending_q"] = None
        session["status"] = "done"
        return {"done": True, "session": session, "index": len(qa),
                "max": MAX_QUESTIONS, "language_code": lang}

    size_hint = _team_size_hint(session.get("team_size") or "")
    remaining = MAX_QUESTIONS - len(qa)
    prompt = (
        f"{_profile_block(session)}\n\n"
        f"{size_hint}\n\n"
        f"Conversation so far:\n{_qa_block(qa)}\n\n"
        f"You have already collected {len(qa)} answer(s). You may ask up to {remaining} more question(s) "
        f"(hard cap {MAX_QUESTIONS} total). Minimum {MIN_QUESTIONS} answers before you're allowed to end.\n"
        "Walk through the operational-coverage checklist. If ANY item is still fuzzy, ask the single most valuable "
        "next question that closes the biggest gap — built on what they just said, matched to their team-size band "
        "and industry. If the picture is genuinely clear enough to design their OS, set enough=true."
    )
    system = INTERVIEW_SYSTEM + _lang_directive(lang)
    raw = _call_claude_sync(f"iv-{session['id']}-{len(qa)}", system, prompt)
    data = _extract_json(raw) or {}

    enough = bool(data.get("enough")) and len(qa) >= MIN_QUESTIONS
    if enough:
        session["pending_q"] = None
        session["status"] = "done"
        return {"done": True, "session": session, "index": len(qa),
                "max": MAX_QUESTIONS, "language_code": lang}

    question = (data.get("question") or "").strip()
    if not question:
        session["pending_q"] = None
        session["status"] = "done"
        return {"done": True, "session": session, "index": len(qa),
                "max": MAX_QUESTIONS, "language_code": lang}

    session["pending_q"] = question
    session["status"] = "active"
    return {
        "done": False, "session": session,
        "question": question, "why": (data.get("why") or "").strip(),
        "index": len(qa) + 1, "max": MAX_QUESTIONS, "language_code": lang,
    }


def back_question(session: dict) -> dict:
    """Mirror of POST /api/signup/interview/back."""
    qa = session.get("qa") or []
    if not qa:
        raise ValueError("Already at the first question")
    last = qa[-1]
    session["qa"] = qa[:-1]
    session["pending_q"] = last.get("q") or ""
    session["status"] = "active"
    return {
        "session": session,
        "question": last.get("q") or "",
        "prev_answer": last.get("a") or "",
        "index": len(qa),
        "max": MAX_QUESTIONS,
    }


def generate_blueprint(session: dict, language_code: str = "") -> dict:
    """Mirror of POST /api/signup/interview/blueprint."""
    lang = _norm_lang(language_code or session.get("language_code") or "en-IN")
    welcome_note = ""
    if lang != "en-IN":
        lang_name = SUPPORTED_TTS_LANGS.get(lang, "the founder's language")
        welcome_note = (
            f"\n\nIMPORTANT: Write ONLY the \"welcome_line\" field in natural, conversational "
            f"{lang_name} (native script). Keep all other fields (departments, workflow names, "
            f"task titles, categories, approval names) in English."
        )
    size_hint = _team_size_hint(session.get("team_size") or "")
    refinement = (session.get("refinement") or "").strip()
    refine_block = (
        f"\n\nFounder's follow-up refinement (they added this after seeing the first draft — reflect it faithfully):\n{refinement}"
        if refinement else ""
    )
    prompt = (
        f"{_profile_block(session)}\n\n{size_hint}\n\n"
        f"Interview transcript:\n{_qa_block(session.get('qa') or [])}{refine_block}\n\n"
        "Design this company's operating system now — sized to their team band, worded in their industry."
    )
    raw = _call_claude_sync(
        f"bp-{session['id']}-{len(refinement)}",
        BLUEPRINT_SYSTEM + welcome_note, prompt,
    )
    data = _extract_json(raw) or {}
    bp = normalize_os_blueprint(data)
    products = [
        {"name": (p.get("name") or "").strip(), "description": (p.get("description") or "").strip()}
        for p in (data.get("products") or []) if (p.get("name") or "").strip()
    ][:5] or [
        {"name": (p.get("name") or "").strip(), "description": (p.get("description") or "").strip()}
        for p in (session.get("products") or []) if (p.get("name") or "").strip()
    ][:5]
    session["status"] = "blueprint_ready"
    return {**bp, "products": products, "welcome_line": (data.get("welcome_line") or "").strip()}


def refine_blueprint(session: dict, refinement: str, language_code: str = "") -> dict:
    """Mirror of POST /api/signup/interview/refine — store refinement + re-run."""
    refinement = (refinement or "").strip()
    if not refinement:
        raise ValueError("Refinement is empty")
    session["refinement"] = refinement
    return generate_blueprint(session, language_code)


# ---------------------------------------------------------------------------
# Sarvam voice — TTS (bulbul:v3) and STT (saaras:v3).
# Exact same endpoints, headers, model, speaker mapping as backend/routers/signup.py.
# Sync httpx (Streamlit is sync). Return raw bytes / plain text — no HTTPException.
# ---------------------------------------------------------------------------
class VoiceError(RuntimeError):
    """Raised when Sarvam TTS/STT fails or the key is missing."""


def speak(text: str, language_code: str = "en-IN") -> tuple[bytes, str]:
    """Mirror of POST /api/signup/tts. Returns (wav_bytes, mime).
    The backend returns base64 in JSON; we decode it here so Streamlit's
    st.audio() can play the bytes directly."""
    import base64
    if not SARVAM_KEY:
        raise VoiceError(
            "SARVAM_API_KEY not set in streamlit_onboarding/.env — voice is disabled. "
            "Text-only interview still works."
        )
    text = (text or "").strip()
    if not text:
        raise VoiceError("Nothing to speak")
    lang = _norm_lang(language_code)
    try:
        with httpx.Client(timeout=45) as client:
            r = client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": SARVAM_KEY, "Content-Type": "application/json"},
                json={"text": text, "target_language_code": lang, "model": "bulbul:v3",
                      "speaker": _speaker_for(lang), "pace": 1.0},
            )
        r.raise_for_status()
        audios = r.json().get("audios") or []
        if not audios:
            raise VoiceError("Sarvam returned an empty audios list")
        return base64.b64decode(audios[0]), "audio/wav"
    except VoiceError:
        raise
    except Exception as e:
        raise VoiceError(f"TTS failed: {e}")


def transcribe(audio_bytes: bytes, filename: str = "answer.wav",
               content_type: str = "audio/wav") -> tuple[str, str]:
    """Mirror of POST /api/signup/stt. Returns (transcript, detected_language_code).
    Same 8 MB cap as backend. Uses `mode=translate, language_code=unknown` first
    (auto-detects language, translates non-English speech to English). If Sarvam
    rejects that combo, retries without those params so a codec/mode mismatch
    doesn't kill the whole interview."""
    if not SARVAM_KEY:
        raise VoiceError(
            "SARVAM_API_KEY not set in streamlit_onboarding/.env — voice is disabled."
        )
    if not audio_bytes:
        raise VoiceError("Empty audio")
    if len(audio_bytes) > 8 * 1024 * 1024:
        raise VoiceError("Recording too long — keep answers under ~30 seconds")

    # Two attempts: primary matches the backend exactly; fallback drops the
    # translate/language_code parameters (the two most likely reasons for a 400
    # on today's Sarvam API — either the model version no longer accepts the
    # combo, or the audio codec Streamlit gives us doesn't work with translate).
    attempts = [
        {"model": STT_MODEL, "mode": "translate", "language_code": "unknown"},
        {"model": STT_MODEL},
    ]
    last_status = None
    last_body = None
    last_params = None
    for params in attempts:
        try:
            with httpx.Client(timeout=60) as client:
                r = client.post(
                    "https://api.sarvam.ai/speech-to-text",
                    headers={"api-subscription-key": SARVAM_KEY},
                    files={"file": (filename or "answer.wav", audio_bytes, content_type or "audio/wav")},
                    data=params,
                )
            if r.status_code >= 400:
                last_status = r.status_code
                last_body = (r.text or "")[:600]
                last_params = params
                continue
            body = r.json() or {}
            detected = body.get("language_code") or body.get("detected_language_code") or ""
            return (
                (body.get("transcript") or "").strip(),
                _norm_lang(detected) if detected else "",
            )
        except VoiceError:
            raise
        except Exception as e:
            last_status = "network"
            last_body = str(e)
            last_params = params
            continue

    # Both attempts failed. Surface Sarvam's actual complaint + what we sent,
    # plus what we know about the audio, so the fix is obvious next time.
    diag = (
        f"Sarvam STT rejected both attempts.\n"
        f"Last HTTP status: {last_status}\n"
        f"Last params sent: {last_params}\n"
        f"Audio: {len(audio_bytes)} bytes, filename={filename!r}, "
        f"content_type={content_type!r}\n"
        f"Sarvam response body: {last_body}"
    )
    raise VoiceError(diag)
