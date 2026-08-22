"""External-provider adapters (Epic 8 Sprint 6).

One module per external service — each owns the raw SDK/HTTP transport for that
provider and nothing else. Business orchestration (fallback chains, usage
logging, tenant context) stays in ``services/``, which calls these adapters.

  base.py       ProviderError + with_retry / arun (timeout+backoff) + a mock hook
  llm.py        resilient Claude chat (user Anthropic key -> Emergent fallback)   [S2]
  stt.py        speech-to-text transport: Sarvam REST + batch, OpenAI, Whisper
  gemini.py     Gemini vision client + doc/plain-text generate_content
  whatsapp.py   WhatsApp Cloud API: token/phone-id, media download, text reply
  email.py      email transport: Gmail SMTP -> Resend -> mock
  razorpay.py   Razorpay webhook HMAC verify (no SDK; hosted checkout)
  storage.py    Emergent Object Storage wrapper (put/get/delete)

Layering: adapters import only ``config`` / ``core`` / external SDKs + ``base``;
never ``services`` or ``server`` at module load. The one shared cross-cutting
LLM guard (concurrency + timeout + tenant quota/consent) is ``services.ai.
llm_limits.guarded_llm`` — it is policy, not transport, so it stays in services.

Compat: several services keep thin re-export shims (``services/email.py``,
``services/obj_store.py``, and re-exports inside ``services/whatsapp.py`` /
``services/transcription.py`` / ``services/vision.py``) so existing
``from services.X import Y`` call sites keep resolving while call sites migrate
to ``integrations.X`` over time.
"""
