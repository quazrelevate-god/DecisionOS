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

# FIX-006-A (S0-09): split JWT secret so tenant tokens and platform-admin
# tokens can't cross-sign. Before this, a compromise of the single
# JWT_SECRET forged both. Falls back to JWT_SECRET when unset so dev/test
# don't need a second env var; server.py logs a WARN at startup in that
# case. Prod deploys should always set both to distinct high-entropy
# values.
PLATFORM_ADMIN_JWT_SECRET = (
    os.environ.get('PLATFORM_ADMIN_JWT_SECRET', '').strip() or JWT_SECRET
)

# FIX-006-A (S0-08): whether login/register/switch-workspace/2fa responses
# include the raw JWT in the JSON body in ADDITION to setting the HttpOnly
# cookie. In prod this is unsafe — any XSS bypasses HttpOnly. Default:
# False in prod, True elsewhere so the ~50 legacy bearer-header integration
# tests keep working locally. Deployers can force it either way via env.
_ENV = os.environ.get('ENV', 'dev').strip().lower()
_ARB_ENV = os.environ.get('AUTH_RETURN_TOKEN', '').strip().lower()
if _ARB_ENV in ('1', 'true', 'yes', 'on'):
    AUTH_RETURN_TOKEN = True
elif _ARB_ENV in ('0', 'false', 'no', 'off'):
    AUTH_RETURN_TOKEN = False
else:
    AUTH_RETURN_TOKEN = (_ENV != 'prod')

# FIX-006-A (S0-01): platform-admin seed policy. By default we NEVER
# overwrite an existing password hash on startup — that blocks credential
# rotation via the DB and, worse, means anyone who can flip an env var
# silently re-owns the account across the whole cluster. Set
# SUPERADMIN_ALLOW_HASH_REFRESH=1 only for the one-off boot where you
# actually intend the env password to replace the DB hash.
SUPERADMIN_ALLOW_HASH_REFRESH = (
    os.environ.get('SUPERADMIN_ALLOW_HASH_REFRESH', '').strip().lower()
    in ('1', 'true', 'yes', 'on')
)


# --- FIX-006-B (S0-02): strict CORS + CSRF ---------------------------------
def _parse_cors_origins() -> list[str]:
    """Comma-separated allow-list. In prod (ENV=prod) we REFUSE to boot
    with an empty list or a literal '*' — the old default of `*` +
    `allow_credentials=True` was echoed back per-origin via
    `allow_origin_regex='.*'`, which sidesteps the CORS spec's
    ban on wildcard+credentials and effectively lets any site the user
    visits make credentialed cross-origin calls carrying their auth
    cookie. Dev/test defaults to the local frontend origins so the
    dev-loop keeps working.
    """
    raw = os.environ.get('CORS_ORIGINS', '').strip()
    if raw:
        origins = [o.strip() for o in raw.split(',') if o.strip()]
    else:
        origins = []
    if _ENV == 'prod':
        if not origins or '*' in origins:
            raise RuntimeError(
                "CORS_ORIGINS must be a comma-separated list of exact "
                "origins (no '*') when ENV=prod. Refusing to boot with a "
                "wildcard CORS + credentials — that's the browser-security "
                "anti-pattern the CORS spec was written to prevent."
            )
        return origins
    # Non-prod fallback: local frontends. Loud enough that a staging
    # deploy without CORS_ORIGINS set won't be mistaken for prod-safe.
    return origins or [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
    ]


CORS_ORIGINS = _parse_cors_origins()

# CSRF: double-submit cookie pattern. On every auth-cookie set, we ALSO
# set a NON-HttpOnly `dos_csrf` cookie carrying a random token. The
# frontend reads it via JS and echoes it back as `X-CSRF-Token` on every
# mutating request. Because the same-origin policy still applies to
# READING cookies even when SameSite=None allows the browser to SEND
# them, evil.com can never construct the matching header.
CSRF_COOKIE_NAME = "dos_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"
# Paths where we do NOT check CSRF. Kept tiny.
#   * webhooks are signature-authenticated by the caller (Meta HMAC etc.)
#   * login endpoints run BEFORE the CSRF cookie exists
#   * health probes
CSRF_EXEMPT_PATHS = frozenset([
    "/api/webhooks/whatsapp",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/2fa/verify-login",
    "/api/admin/login",
    "/api/auth/otp/request",
    "/api/auth/otp/verify",
    "/api/auth/password/forgot",
    "/api/auth/password/reset",
    "/api/auth/verify-email",
    "/api/auth/invite/start",
    "/api/health",
    "/health",
])
# Rollout guard: middleware is ALWAYS installed so we start minting the
# cookie and logging telemetry immediately. But enforcement (returning
# 403 on mismatch) defaults OFF so this batch can ship without a
# breaking frontend change. Flip to CSRF_ENFORCE=1 once the frontend
# starts sending X-CSRF-Token and staging logs show 100% match rate.
CSRF_ENFORCE = (
    os.environ.get('CSRF_ENFORCE', '').strip().lower()
    in ('1', 'true', 'yes', 'on')
)


# --- FIX-006-C (S0-03/04/05): endpoint hardening -----------------------------

# S0-03: legacy local-disk fallback in GET /api/files/{fname}. Post-
# FIX-002-E migration to obj_store this branch should be dead code, but
# leaving it live means any authenticated user (from ANY tenant) can
# request a bare filename and get it back — no tenant-scoping happens on
# the legacy disk path. Default OFF; only opt in explicitly in dev when
# investigating a stale-file complaint.
SERVE_LEGACY_LOCAL_DISK = (
    os.environ.get('SERVE_LEGACY_LOCAL_DISK', '').strip().lower()
    in ('1', 'true', 'yes', 'on')
)

# S0-04: dev-OTP leak. The OTP request response used to include
# `dev_otp` in the JSON body whenever no SMS provider was configured —
# fine for dev, catastrophic for prod (any /auth/otp/request caller
# gets a working code). New rule:
#   * env DEV_OTP_IN_RESPONSE explicitly controls the leak (default off)
#   * server.py raises at boot if ENV=prod AND no SMS provider (APM /
#     Twilio) is configured — "prod without SMS = silent dev mode"
#     stops here.
DEV_OTP_IN_RESPONSE = (
    os.environ.get('DEV_OTP_IN_RESPONSE', '').strip().lower()
    in ('1', 'true', 'yes', 'on')
)

# S0-05: WhatsApp webhook signature. Old code logged on HMAC mismatch
# and PROCESSED the payload anyway — Meta's whole security model relies
# on the recipient rejecting mismatches, so this was equivalent to
# having no signature check at all. New:
#   * mismatch → 403, no processing.
#   * WA_APP_SECRET absent → refuse the webhook entirely in prod;
#     accept with a stern WARN in dev so local tunnels still work.
# Kept as a strict default rather than a flag — signature bypass is
# never the right answer in prod.

# --- LLM providers ----------------------------------------------------------
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
# All Claude Sonnet 4.6 calls use the user's own Anthropic key when set,
# else the Emergent universal key.
CLAUDE_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip() or EMERGENT_LLM_KEY

# ---------------------------------------------------------------------------
# Model routing (Epic 3 Sprint 1, E3-01.2) -- ONE source of truth for which
# model does which AI job. AI call sites resolve their model via
# `model_for(task)` (task names match the prompt registry) instead of hardcoding
# a tuple, so a model can be swapped per-task in ONE place, or overridden per
# task via env `MODEL_ROUTE_<TASK>` (e.g. MODEL_ROUTE_CAPTURES_TRIAGE=...).
# ---------------------------------------------------------------------------
# Catalog: logical name -> (provider, model_id). The ONLY place a model id lives.
# UPGRADE PATH: models here run through emergentintegrations, so before adding a
# new id (e.g. a Claude 5 / newer Gemini), verify that wrapper accepts it. Do NOT
# edit an id in place -- add the new model + repoint the route(s), so the AI
# telemetry (E3-01.3) and eval/benchmark harness (E3-01.4 / E3-10.3) can A/B it.
MODELS = {
    "claude-sonnet": ("anthropic", "claude-sonnet-4-6"),  # default text / reasoning model
    "gemini-flash":  ("gemini", "gemini-2.5-flash"),      # default vision / OCR model
}
DEFAULT_LLM_MODEL = "claude-sonnet"
DEFAULT_VISION_MODEL = "gemini-flash"

# Back-compat: the historical default tuples, now DERIVED from the catalog so
# there is still one source of truth. Existing `from core import LLM_MODEL` and
# `.with_model(*LLM_MODEL)` keep working unchanged.
LLM_MODEL = MODELS[DEFAULT_LLM_MODEL]
VISION_MODEL = MODELS[DEFAULT_VISION_MODEL]

# Routes: task name (= prompt-registry name) -> catalog model. A complete map of
# "every AI task -> its model". All point at the default today; change ONE line
# to route a task (e.g. a cheap triage) to a different model. Unlisted tasks fall
# back to the per-kind default.
MODEL_ROUTES = {
    # extraction / structuring (text)
    "extraction.extract": "claude-sonnet", "extraction.score_tasks": "claude-sonnet",
    "extraction.score_contact": "claude-sonnet", "extraction.meeting_notes": "claude-sonnet",
    "extraction.execution_plan": "claude-sonnet", "extraction.step_assist": "claude-sonnet",
    "extraction.clarify": "claude-sonnet",
    # onboarding generators + wizard (text)
    "generators.lexicon": "claude-sonnet", "generators.operating_model": "claude-sonnet",
    "generators.finance_categories": "claude-sonnet",
    "onboarding.suggest": "claude-sonnet", "onboarding.os_blueprint": "claude-sonnet",
    "onboarding.web_intel": "claude-sonnet", "onboarding.interview": "claude-sonnet",
    "onboarding.blueprint": "claude-sonnet",
    # captures / coaching / people (text)
    "captures.triage": "claude-sonnet", "coaching.work_coach": "claude-sonnet",
    "coaching.leave_impact": "claude-sonnet", "coaching.file_reference": "claude-sonnet",
    # company brain (text)
    "brain.planner": "claude-sonnet", "brain.answer": "claude-sonnet",
    "brain.agent_planner": "claude-sonnet", "brain.agent_synth": "claude-sonnet",
    # finance / ledger (text)
    "ledger.expense_cat": "claude-sonnet", "ledger.analysis": "claude-sonnet",
    "ledger.ask": "claude-sonnet", "documents.csv_map": "claude-sonnet",
    "documents.purchase_class": "claude-sonnet",
    # vision / OCR (Gemini)
    "documents.doc_extract": "gemini-flash", "vision.read_image": "gemini-flash",
    "ledger.ocr": "gemini-flash",
}


def model_for(task, kind="llm"):
    """Resolve the (provider, model_id) tuple for an AI task.

    Order: env override (MODEL_ROUTE_<TASK>) -> MODEL_ROUTES -> per-kind default.
    `kind` ('llm' | 'vision') only selects the fallback when a task is unlisted.
    """
    default = DEFAULT_LLM_MODEL if kind == "llm" else DEFAULT_VISION_MODEL
    env_key = "MODEL_ROUTE_" + task.replace(".", "_").replace("-", "_").upper()
    name = os.environ.get(env_key, "").strip() or MODEL_ROUTES.get(task) or default
    return MODELS.get(name, MODELS[default])


# --- E3-08.4: model-level fallback chains -----------------------------------
# When the routed model fails on EVERY key (provider outage / rate-limit / timeout),
# the resilient chat tries these fallback MODELS (on the Emergent universal key) as a
# last-resort graceful degradation, recorded as degraded in telemetry. Only known
# Emergent-routable models belong here. gemini-flash is already used for vision, so
# it's the proven text fallback; vision has no cross-model fallback (key-fallback covers it).
MODEL_FALLBACKS = {
    "claude-sonnet": ["gemini-flash"],
    "gemini-flash": [],
}


def fallback_models(model_tuple):
    """Ordered list of (provider, model_id) fallbacks for a primary model tuple (E3-08.4).
    Empty when the model is unknown or has no configured fallback."""
    try:
        name = next((n for n, t in MODELS.items() if tuple(t) == tuple(model_tuple)), None)
    except TypeError:
        return []
    return [MODELS[fb] for fb in MODEL_FALLBACKS.get(name, []) if fb in MODELS]


# --- Roles & permissions ----------------------------------------------------
# FIX-004-D (RBAC-16): canonical role list. Prior code had ROLES list
# with "production" but DEFAULT_ROLES with "operations" — silent
# inconsistency that meant code switching on ROLES missed tenants
# who got 'operations' as their default. Canonical name is
# "operations" (matches DEFAULT_ROLES + is the term SME founders
# actually use). Migration below renames any legacy 'production'
# role/membership to 'operations' at boot.
ROLES = ["owner", "sales", "operations", "finance"]

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


# ---------------------------------------------------------------------------
# S3-01 (2026-08-16): Razorpay billing config.
#
# Design: our frontend hands the user off to a pricing landing page
# (BILLING_LANDING_URL) with a signed tenant identity in the query
# string. That page hosts the actual Razorpay Checkout / Payment Link.
# Razorpay POSTs a webhook to us on payment.captured; we verify the
# signature (HMAC-SHA256 using RAZORPAY_WEBHOOK_SECRET) and upgrade
# tenant.plan.
#
# BILLING_LANDING_URL points to the pricing page in the marketing
# domain (or a route in this same app). Must accept
# `plan=<key>&tenant_id=<uuid>&sig=<hmac>&return_to=<url>` params.
# If unset, /api/billing/checkout returns 503 -- the module is inert
# but the routes are wired so the frontend can still probe them.
# ---------------------------------------------------------------------------
BILLING_LANDING_URL = os.environ.get("BILLING_LANDING_URL", "").strip()
BILLING_RETURN_URL = os.environ.get("BILLING_RETURN_URL", "").strip() or "/settings"

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()

# Signing key for the tenant-identity handoff to the landing page.
# Separate from JWT_SECRET so leaking one doesn't compromise the
# other; falls back to JWT_SECRET when unset so dev/test flows work.
BILLING_SIGNING_SECRET = (
    os.environ.get("BILLING_SIGNING_SECRET", "").strip() or JWT_SECRET
)

# Per-plan monthly price in INR paise (Razorpay's unit). Populate via
# env if you're using Payment Links; leave 0 for plans you don't sell.
# The catalogue endpoint uses this to render prices; the checkout
# endpoint just passes plan_key + amount to the landing page.
BILLING_PLAN_PRICES_INR_PAISE = {
    "starter": int(os.environ.get("BILLING_PRICE_STARTER_PAISE", "0") or 0),
    "business": int(os.environ.get("BILLING_PRICE_BUSINESS_PAISE", "0") or 0),
    "enterprise": 0,  # enterprise is talk-to-sales, not self-serve
}
