"""Vision / document reading (Epic 8 Sprint 4; Gemini transport split out in S6).

ai_read_image_general orchestrates Gemini (user key, primary) with an
Emergent-key vision fallback + usage logging. The raw google-genai client +
generate_content calls live in integrations/gemini.py; they're re-exported here
so `from services.vision import get_gemini_client, _gemini_doc_sync` keeps
working (services/ingestion.py imports them).
"""
import asyncio

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

from core import logger, log_usage, _est_tokens, EMERGENT_LLM_KEY, VISION_MODEL
from integrations.gemini import (  # noqa: F401  (re-exported for ingestion.py)
    get_gemini_client, _gemini_doc_sync, _gemini_read_sync,
)


_IMAGE_READ_SYSTEM = (
    "You are a vision reader. Look at the attached image or document and TRANSCRIBE and DESCRIBE everything "
    "a person would need, verbatim. Capture ALL readable content: names, job titles, company names, phone "
    "numbers, emails, websites, addresses, dates, amounts, line items, table rows, headings and any handwritten "
    "or printed text. If it is a business/visiting card, clearly list the person's name, title, company, phone(s), "
    "email, website and address. If it is a list or table, preserve the rows. Never invent anything not in the image. "
    "Return a concise PLAIN-TEXT extraction — no JSON, no commentary."
)


async def ai_read_image_general(file_path: str, mime_type: str, session_id: str) -> str:
    """Read ANY image/PDF into plain text (business cards, notes, lists, screenshots, documents)."""
    user_text = "Read this file and output all of its content as plain text."
    if get_gemini_client() is not None:
        try:
            text, ti, to = await asyncio.to_thread(_gemini_read_sync, file_path, mime_type, _IMAGE_READ_SYSTEM, user_text)
            await log_usage((session_id or "read").split("-")[0], "gemini", model=VISION_MODEL[1],
                            tokens_in=ti, tokens_out=to, units=1, unit_type="document")
            if (text or "").strip():
                return text.strip()
        except Exception as e:
            logger.warning(f"Gemini general-read (user key) failed; falling back: {e}")
    try:
        fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id or "read",
                       system_message=_IMAGE_READ_SYSTEM).with_model(*VISION_MODEL)
        # FIX-002-B: semaphore + timeout guard shared across all LLM calls.
        from services.ai.llm_limits import guarded_llm
        resp = await guarded_llm(chat.send_message(UserMessage(text=user_text, file_contents=[fc])),
                                  label="gemini:doc-read")
        await log_usage((session_id or "read").split("-")[0], "gemini", model=VISION_MODEL[1],
                        tokens_in=_est_tokens(_IMAGE_READ_SYSTEM + user_text), tokens_out=_est_tokens(resp or ""),
                        units=1, unit_type="document")
        return (resp or "").strip()
    except Exception as e:
        logger.warning(f"general image read failed: {e}")
        return ""

