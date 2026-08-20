"""External-provider adapters (Epic 8 — populated in Sprint 6).

One module per outside service, each wrapping a single provider behind a small
interface so callers depend on the adapter, not the SDK. Centralizes timeouts,
retries, and SSRF guarding, and gives tests one seam to mock.

Planned modules (moved out of server.py / services in Sprint 6):
    llm.py          claude_chat / resilient chat wrapper + provider keys
    openai_stt.py   OpenAI speech-to-text
    gemini.py       Gemini vision / document reads
    sarvam.py       Sarvam STT
    whatsapp_api.py WhatsApp send / receive / media
    razorpay.py     Razorpay billing
    email_smtp.py   SMTP email
    obj_store.py    object storage (today: services/obj_store.py)
    ssrf_guard.py   outbound-URL SSRF checks (today: services/ssrf_guard.py)

Import rule: integrations import only external SDKs + config. Never routers,
services, or bootstrap.
"""
