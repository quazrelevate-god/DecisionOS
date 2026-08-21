"""Speech-to-text / transcription (Epic 8 Sprint 4 -- from server.py).

Sarvam (primary: auto-detect + translate-to-English), OpenAI gpt-4o-transcribe,
and Whisper (Emergent key) backstop, plus language helpers and STT usage
logging. Lazy OpenAI client is rebuilt when the runtime key changes. Depends
on core + services.uploads (deferred) only; imports nothing from server.
"""
import os
import asyncio

from emergentintegrations.llm.openai import OpenAISpeechToText

from core import (
    logger, get_ai_key, log_usage, EMERGENT_LLM_KEY,
    _OPENAI_STT_PER_MIN, _SARVAM_STT_PER_MIN,
)

OPENAI_STT_MODEL = os.environ.get("OPENAI_STT_MODEL", "gpt-4o-transcribe").strip() or "gpt-4o-transcribe"
SARVAM_API_KEY = os.environ.get("SARVAM_API_KEY", "").strip()
SARVAM_STT_MODEL = os.environ.get("SARVAM_STT_MODEL", "saaras:v3").strip() or "saaras:v3"

_openai_stt_state = {"key": None, "client": None}


def get_openai_stt_client():
    key = get_ai_key("openai")
    if not key:
        _openai_stt_state.update(key=None, client=None)
        return None
    if _openai_stt_state["key"] != key:
        try:
            from openai import AsyncOpenAI
            _openai_stt_state["client"] = AsyncOpenAI(api_key=key)
            _openai_stt_state["key"] = key
            logger.info(f"OpenAI transcription client ready (model '{OPENAI_STT_MODEL}').")
        except Exception as _e:
            logger.warning(f"Could not init OpenAI client, will fall back to Whisper (Emergent key): {_e}")
            _openai_stt_state.update(key=None, client=None)
    return _openai_stt_state["client"]


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


def _sarvam_mime(path: str) -> str:
    ext = (path.rsplit(".", 1)[-1] if "." in path else "").lower()
    return {"webm": "audio/webm", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
            "wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4", "mp4": "audio/mp4",
            "aac": "audio/aac", "flac": "audio/flac"}.get(ext, "audio/webm")


def _sarvam_stt_sync(path: str) -> dict:
    """Sarvam REST speech-to-text (saaras:v3): auto-detect language + translate to English.
    REST handles audio under ~30s; raises on error so the caller can fall back to batch/OpenAI."""
    import requests
    with open(path, "rb") as f:
        r = requests.post(
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": get_ai_key("sarvam")},
            files={"file": (os.path.basename(path), f, _sarvam_mime(path))},
            data={"model": SARVAM_STT_MODEL, "mode": "translate", "language_code": "unknown"},
            timeout=90,
        )
    r.raise_for_status()
    return r.json()


def _sarvam_batch_sync(path: str) -> dict:
    """Sarvam Batch STT (async job) for long recordings (>30s, up to 2h). Blocking — run in a thread."""
    import tempfile, glob, json as _json
    from sarvamai import SarvamAI
    client = SarvamAI(api_subscription_key=get_ai_key("sarvam"))
    job = client.speech_to_text_job.create_job(model=SARVAM_STT_MODEL, mode="translate", language_code="unknown")
    job.upload_files(file_paths=[path])
    job.start()
    job.wait_until_complete(poll_interval=5, timeout=1500)
    outdir = tempfile.mkdtemp(prefix="sarvam_batch_")
    job.download_outputs(output_dir=outdir)
    transcript, lang = "", ""
    for jf in glob.glob(os.path.join(outdir, "*.json")):
        try:
            with open(jf) as fh:
                d = _json.load(fh)
            transcript = (transcript + " " + (d.get("transcript") or "")).strip()
            lang = lang or (d.get("language_code") or "")
        except Exception:
            pass
    return {"transcript": transcript, "language_code": lang, "language_probability": None}


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
    """Internal: expects `path` to be a local filesystem path. All STT
    engines are invoked from here. Split out from transcribe_audio_full
    so the obj_store-download wrapper can wrap the whole thing without
    duplicating engine-selection logic."""
    if get_ai_key("sarvam"):
        # 1) REST (fast, <30s)
        try:
            out = await asyncio.to_thread(_sarvam_stt_sync, path)
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
            out = await asyncio.to_thread(_sarvam_batch_sync, path)
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
    _openai_stt_client = get_openai_stt_client()
    if _openai_stt_client is not None:
        try:
            kwargs = {"model": OPENAI_STT_MODEL, "response_format": "json"}
            if lang:
                kwargs["language"] = lang
            if prompt:
                kwargs["prompt"] = prompt
            with open(path, "rb") as f:
                resp = await _openai_stt_client.audio.transcriptions.create(file=f, **kwargs)
            await _log_stt_usage(resp.text, OPENAI_STT_MODEL)
            return {"transcript": resp.text, "language_code": "", "language_name": "",
                    "language_probability": None, "engine": "openai"}
        except Exception as e:
            logger.warning(f"OpenAI STT ({OPENAI_STT_MODEL}) failed; falling back to Whisper (Emergent key): {e}")
    # 4) Whisper via Emergent key
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    kwargs = {"model": "whisper-1", "response_format": "json"}
    if lang:
        kwargs["language"] = lang
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        resp = await stt.transcribe(file=f, **kwargs)
    await _log_stt_usage(resp.text, "whisper-1")
    return {"transcript": resp.text, "language_code": "", "language_name": "",
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

