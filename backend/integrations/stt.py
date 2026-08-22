"""Speech-to-text provider adapter (Epic 8 Sprint 6 -- from services/transcription.py).

Raw transport for the three STT providers — Sarvam (REST + batch job), OpenAI
gpt-4o-transcribe, and Whisper via the Emergent universal key. Each function is
one vendor call and nothing else; the multi-provider fallback chain + usage
logging stay in services/transcription.py (that IS the resilience, so no
per-call retry here). Imports only stdlib + core + external SDKs.
"""
import os

from emergentintegrations.llm.openai import OpenAISpeechToText

from core import logger, get_ai_key, EMERGENT_LLM_KEY

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


def _sarvam_mime(path: str) -> str:
    ext = (path.rsplit(".", 1)[-1] if "." in path else "").lower()
    return {"webm": "audio/webm", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
            "wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4", "mp4": "audio/mp4",
            "aac": "audio/aac", "flac": "audio/flac"}.get(ext, "audio/webm")


def sarvam_rest(path: str) -> dict:
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


def sarvam_batch(path: str) -> dict:
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


async def openai_stt(client, path: str, lang: str = None, prompt: str = None) -> str:
    """OpenAI gpt-4o-transcribe on an open client. Returns the transcript text."""
    kwargs = {"model": OPENAI_STT_MODEL, "response_format": "json"}
    if lang:
        kwargs["language"] = lang
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        resp = await client.audio.transcriptions.create(file=f, **kwargs)
    return resp.text


async def whisper_stt(path: str, lang: str = None, prompt: str = None) -> str:
    """Whisper-1 via the Emergent universal key (final backstop). Returns transcript text."""
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    kwargs = {"model": "whisper-1", "response_format": "json"}
    if lang:
        kwargs["language"] = lang
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        resp = await stt.transcribe(file=f, **kwargs)
    return resp.text
