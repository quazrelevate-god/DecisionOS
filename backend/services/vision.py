"""Vision / document reading via Gemini (Epic 8 Sprint 4 -- from server.py).

Lazy Gemini OCR client (rebuilt on runtime key change), the JSON + plain-text
sync readers, and ai_read_image_general (Gemini primary, Emergent-key vision
fallback). Depends on core + emergentintegrations + services.ai.llm_limits
(deferred); imports nothing from server.
"""
import asyncio

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

from core import logger, get_ai_key, log_usage, _est_tokens, EMERGENT_LLM_KEY, VISION_MODEL

_gemini_state = {"key": None, "client": None}


def get_gemini_client():
    key = get_ai_key("gemini")
    if not key:
        _gemini_state.update(key=None, client=None)
        return None
    if _gemini_state["key"] != key:
        try:
            from google import genai as _genai
            _gemini_state["client"] = _genai.Client(api_key=key)
            _gemini_state["key"] = key
            logger.info(f"Gemini document-OCR client ready (model '{VISION_MODEL[1]}').")
        except Exception as _e:
            logger.warning(f"Could not init Gemini client, will fall back to Emergent key: {_e}")
            _gemini_state.update(key=None, client=None)
    return _gemini_state["client"]


def _gemini_doc_sync(file_path: str, mime_type: str, system: str, user_text: str):
    """Returns (text, tokens_in, tokens_out) so callers can log usage."""
    import pathlib
    from google.genai import types as _gtypes
    resp = get_gemini_client().models.generate_content(
        model=VISION_MODEL[1],
        contents=[
            _gtypes.Part.from_bytes(data=pathlib.Path(file_path).read_bytes(), mime_type=mime_type),
            user_text,
        ],
        config=_gtypes.GenerateContentConfig(system_instruction=system, response_mime_type="application/json"),
    )
    um = getattr(resp, "usage_metadata", None)
    ti = getattr(um, "prompt_token_count", 0) or 0
    to = getattr(um, "candidates_token_count", 0) or 0
    return (resp.text or "", ti, to)


def _gemini_read_sync(file_path: str, mime_type: str, system: str, user_text: str):
    """General plain-text vision read (no JSON constraint). Returns (text, tokens_in, tokens_out)."""
    import pathlib
    from google.genai import types as _gtypes
    resp = get_gemini_client().models.generate_content(
        model=VISION_MODEL[1],
        contents=[
            _gtypes.Part.from_bytes(data=pathlib.Path(file_path).read_bytes(), mime_type=mime_type),
            user_text,
        ],
        config=_gtypes.GenerateContentConfig(system_instruction=system),
    )
    um = getattr(resp, "usage_metadata", None)
    ti = getattr(um, "prompt_token_count", 0) or 0
    to = getattr(um, "candidates_token_count", 0) or 0
    return (resp.text or "", ti, to)


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

