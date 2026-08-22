"""Speech-to-text orchestration (Epic 8 Sprint 4; adapters split out in S6).

Owns the multi-provider fallback chain (Sarvam REST -> Sarvam batch -> OpenAI
gpt-4o-transcribe -> Whisper), obj_store download, language labelling, and STT
usage logging. The raw vendor transport lives in integrations/stt.py.
"""
import os
import asyncio

from core import logger, get_ai_key, log_usage, _OPENAI_STT_PER_MIN, _SARVAM_STT_PER_MIN
from integrations import stt as _stt
from integrations.stt import (  # noqa: F401  (re-exported: some callers import these here)
    get_openai_stt_client, OPENAI_STT_MODEL, SARVAM_STT_MODEL, SARVAM_API_KEY, _sarvam_mime,
)

# Back-compat aliases for the pre-S6 private names (kept so any deferred
# `from services.transcription import _sarvam_stt_sync` style import still works).
_sarvam_stt_sync = _stt.sarvam_rest
_sarvam_batch_sync = _stt.sarvam_batch


def _stt_lang_prompt(language: str):
    lang, prompt = None, None
    if language == "en":
        lang = "en"
    elif language == "ta":
        lang = "ta"
    elif language == "tanglish":
        prompt = ("This is Tanglish — casual code-mixed Tamil and English speech from an Indian "
                  "small-business owner. Keep English words in English.")
    return lang, prompt


_LANG_NAMES = {
    "en-IN": "English", "en-US": "English", "hi-IN": "Hindi", "ta-IN": "Tamil",
    "te-IN": "Telugu", "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi",
    "gu-IN": "Gujarati", "bn-IN": "Bengali", "pa-IN": "Punjabi", "od-IN": "Odia",
    "or-IN": "Odia", "as-IN": "Assamese", "ur-IN": "Urdu", "unknown": "Unknown",
}


def _lang_name(code: str) -> str:
    if not code:
        return ""
    return _LANG_NAMES.get(code) or code.split("-")[0].upper()


async def transcribe_audio_full(path: str, language: str = "auto") -> dict:
    """Returns {transcript, language_code, language_name, language_probability, engine}.
    Sarvam is primary (auto-detect + translate-to-English); batch handles long clips; OpenAI/Whisper backstop.

    FIX-002-E: `path` may now be either a legacy local filesystem path OR an
    obj_store key. If it's an obj_store key we download it to a temp file
    first so the STT libs (which expect a real path) work unchanged.
    """
    from services.uploads import is_legacy_path, download_to_temp
    _tmp_to_cleanup = None
    if not is_legacy_path(path):
        _tmp_to_cleanup = await download_to_temp(path)
        path = str(_tmp_to_cleanup)
    try:
        return await _transcribe_audio_full_local(path, language)
    finally:
        if _tmp_to_cleanup is not None:
            try:
                os.unlink(_tmp_to_cleanup)
            except Exception:
                pass


async def _transcribe_audio_full_local(path: str, language: str = "auto") -> dict:
    """Internal: expects `path` to be a local filesystem path. Runs the STT
    provider fallback chain via the integrations.stt adapter."""
    if get_ai_key("sarvam"):
        # 1) REST (fast, <30s)
        try:
            out = await asyncio.to_thread(_stt.sarvam_rest, path)
            transcript = (out.get("transcript") or "").strip()
            if transcript:
                code = out.get("language_code") or ""
                await _log_stt_usage(transcript, f"sarvam:{SARVAM_STT_MODEL}", provider="sarvam")
                return {"transcript": transcript, "language_code": code, "language_name": _lang_name(code),
                        "language_probability": out.get("language_probability"), "engine": "sarvam"}
        except Exception as e:
            logger.warning(f"Sarvam REST STT failed (likely >30s); trying Sarvam batch: {e}")
        # 2) Batch (long audio)
        try:
            out = await asyncio.to_thread(_stt.sarvam_batch, path)
            transcript = (out.get("transcript") or "").strip()
            if transcript:
                code = out.get("language_code") or ""
                await _log_stt_usage(transcript, f"sarvam-batch:{SARVAM_STT_MODEL}", provider="sarvam")
                return {"transcript": transcript, "language_code": code, "language_name": _lang_name(code),
                        "language_probability": None, "engine": "sarvam-batch"}
            logger.warning("Sarvam batch returned empty transcript; falling back to OpenAI.")
        except Exception as e:
            logger.warning(f"Sarvam batch STT failed; falling back to OpenAI: {e}")
    # 3) OpenAI gpt-4o-transcribe
    lang, prompt = _stt_lang_prompt(language)
    _client = _stt.get_openai_stt_client()
    if _client is not None:
        try:
            text = await _stt.openai_stt(_client, path, lang, prompt)
            await _log_stt_usage(text, OPENAI_STT_MODEL)
            return {"transcript": text, "language_code": "", "language_name": "",
                    "language_probability": None, "engine": "openai"}
        except Exception as e:
            logger.warning(f"OpenAI STT ({OPENAI_STT_MODEL}) failed; falling back to Whisper (Emergent key): {e}")
    # 4) Whisper via Emergent key
    text = await _stt.whisper_stt(path, lang, prompt)
    await _log_stt_usage(text, "whisper-1")
    return {"transcript": text, "language_code": "", "language_name": "",
            "language_probability": None, "engine": "whisper"}


async def transcribe_audio(path: str, language: str = "auto") -> str:
    return (await transcribe_audio_full(path, language)).get("transcript", "")


async def _log_stt_usage(transcript: str, model: str, provider: str = "openai"):
    # STT bills by audio duration; estimate ~15 chars/sec of speech from the transcript.
    secs = max(1, len(transcript or "") / 15)
    per_min = _SARVAM_STT_PER_MIN if provider == "sarvam" else _OPENAI_STT_PER_MIN
    await log_usage("transcribe", provider, model=model,
                    units=round(secs), unit_type="audio_sec",
                    cost=secs / 60 * per_min)
