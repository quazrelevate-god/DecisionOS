"""External integrations and cross-cutting business services.

Currently empty scaffolding — Phase B will move the third-party API
wrappers here (LLM chat, Sarvam TTS/STT, object storage, notifications).

Today those live at:
  • `backend/obj_store.py`        — Emergent Object Storage wrapper
  • `backend/brain_context.py`    — decision-context capture (P2)
  • `backend/brain_rbac.py`       — RBAC intent gate
  • `backend/core.py`             — Claude chat + AI keys + usage tracking

They will move here as `services/obj_store.py`, `services/brain_context.py`,
`services/brain_rbac.py`, `services/llm.py`, `services/usage.py`.
"""
