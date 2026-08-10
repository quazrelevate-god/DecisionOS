"""Application configuration — env vars, LLM model IDs, role/permission
constants. This is the ONLY module that reads from `os.environ` at import
time; everything else imports settings from here.

Split out of the historical `core.py` in Phase A so different concerns
(config vs. DB vs. auth vs. LLM) live in different files. `core.py` still
re-exports the same symbols so no downstream import breaks.
"""
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')

import os

# --- Mongo ------------------------------------------------------------------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

# --- Auth / cookies ---------------------------------------------------------
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
AUTH_COOKIE_NAME = "dos_token"
AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days, matches token exp
ADMIN_COOKIE_NAME = "dos_admin_token"

# --- LLM providers ----------------------------------------------------------
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
# All Claude Sonnet 4.6 calls use the user's own Anthropic key when set,
# else the Emergent universal key.
CLAUDE_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip() or EMERGENT_LLM_KEY
LLM_MODEL = ("anthropic", "claude-sonnet-4-6")
VISION_MODEL = ("gemini", "gemini-2.5-flash")

# --- Roles & permissions ----------------------------------------------------
ROLES = ["owner", "sales", "production", "finance"]

PERMISSION_KEYS = [
    "inbox", "voice_capture", "data_input", "people", "finance", "ledger",
    "workflows", "tasks", "brain", "ask", "brain_export",
    "approvals", "decisions_approve", "leave_approve", "team_manage",
]
# FIX-004-C (RBAC-10): `brain_export` is INTENTIONALLY not in
# ROLE_DEFAULT_PERMS or _BASE_PERMS — it's an elevated privilege
# distinct from `ask` (query). Only owner gets it via the magic
# all-perms shortcut in user_perms(); anyone else needs an explicit
# grant on their user.permissions[] or membership.permissions[].

DEFAULT_ROLES = [
    {"key": "sales", "label": "Sales"},
    {"key": "operations", "label": "Operations"},
    {"key": "finance", "label": "Finance"},
]

# --- Runtime AI provider keys (platform-admin updatable, DB-backed w/ env fallback)
# The DICT is mutated in-place by services.ai_keys — keep it here so the
# environment-provided values are the single source of truth on cold-start.
_AI_KEY_ENV = {
    "anthropic": os.environ.get('ANTHROPIC_API_KEY', '').strip(),
    "openai": os.environ.get('OPENAI_API_KEY', '').strip(),
    "gemini": os.environ.get('GEMINI_API_KEY', '').strip(),
    "sarvam": os.environ.get('SARVAM_API_KEY', '').strip(),
    "wa_access_token": os.environ.get('WA_ACCESS_TOKEN', '').strip(),
    "wa_phone_number_id": os.environ.get('WA_PHONE_NUMBER_ID', '').strip(),
}
AI_KEY_PROVIDERS = list(_AI_KEY_ENV.keys())

# Rough per-provider rates ($/1M tokens: input, output) — estimates for usage
# telemetry, NOT actual billing.
_PROVIDER_RATES = {
    "anthropic": (3.0, 15.0),   # Claude Sonnet
    "emergent": (3.0, 15.0),    # Emergent proxies Claude Sonnet
    "gemini": (0.30, 2.50),     # Gemini 2.5 Flash
}
_OPENAI_STT_PER_MIN = 0.006     # transcription $/minute (approx)
_SARVAM_STT_PER_MIN = 0.0072    # Sarvam Saaras STT ~ Rs 0.60/min (approx)
_COST_IN_PER_M = 3.0
_COST_OUT_PER_M = 15.0
