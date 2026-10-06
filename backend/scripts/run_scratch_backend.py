"""Start the backend against the THROWAWAY database with every outbound channel off.

Why this exists (2026-10-05): the Windows launch config did this in cmd.exe —

    set DB_NAME=dos_engine_0921c&& set APM_SMS_API_KEY=&& ... python -m uvicorn ...

`set NAME=` in cmd does not set an empty value; it DELETES the variable. The
app then calls load_dotenv(), which fills any missing variable from
backend/.env — the founder's file, with the LIVE SMS key, mail settings and
WhatsApp token. DB_NAME survived (it had a value), so the data stayed on the
scratch database, but a few minutes of browser checks texted a login code to a
seeded phone number and emailed an owner alert. load_dotenv never overrides a
variable that EXISTS, even an empty one, so setting them to "" here, before the
app is imported, is what actually switches them off.

Run from anywhere:  backend/.venv/Scripts/python.exe backend/scripts/run_scratch_backend.py
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SCRATCH_DB = os.environ.get("SCRATCH_DB_NAME") or "dos_engine_0921c"

# Every channel that can reach a real person, set to EMPTY (not removed).
OUTBOUND = [
    "APM_SMS_API_KEY", "APM_OTP_ENDPOINT",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM",
    "RESEND_API_KEY", "RESEND_FROM_EMAIL",
    "WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_API_KEY", "WA_TENANT_ID",
    "WA_ACCESS_TOKEN", "WA_PHONE_NUMBER_ID",
]
for name in OUTBOUND:
    os.environ[name] = ""

os.environ["DB_NAME"] = SCRATCH_DB
os.environ["DEV_OTP_IN_RESPONSE"] = "1"
os.environ["RATE_LIMITS"] = "off"

# A scratch run must never be pointed at the live database by mistake.
if not SCRATCH_DB.startswith(("dos_engine_", "dos_test_", "decisionos-e2e")):
    sys.exit(f"Refusing to start: {SCRATCH_DB!r} does not look like a scratch database.")

os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

import uvicorn  # noqa: E402

if __name__ == "__main__":
    print(f"[scratch] DB_NAME={SCRATCH_DB}; SMS, email and WhatsApp off; dev OTP in responses.")
    uvicorn.run("server:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), log_level="warning")
