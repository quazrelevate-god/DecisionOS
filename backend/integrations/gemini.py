"""Gemini vision provider adapter (Epic 8 Sprint 6 -- from services/vision.py).

Lazy google-genai client (rebuilt on runtime key change) and the two blocking
generate_content calls — JSON-constrained (document extraction) and plain-text
(general reading). Raw transport only; the Gemini-vs-Emergent fallback +
usage logging stay in services/vision.py. Imports stdlib + core + google-genai.
"""
from core import logger, get_ai_key, VISION_MODEL

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
    """JSON-constrained document read. Returns (text, tokens_in, tokens_out)."""
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
