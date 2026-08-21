"""Email delivery (Epic 8 Sprint 4 -- extracted from server.py).

Gmail SMTP (primary), Resend (fallback), else a logged mock. Sender/host/
creds all come from .env so the account can be swapped anytime. Pure leaf
service: depends only on core.logger + stdlib, imports nothing from server.
"""
import os
import ssl
import asyncio
import smtplib
from email.message import EmailMessage

from core import logger

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465") or "465")
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM") or SMTP_USER
SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _smtp_send_sync(to_list: list, subject: str, html: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(to_list)
    msg.set_content("This message requires an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=25) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=25) as s:
            s.starttls(context=ctx)
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)


async def send_email(to, subject: str, html: str) -> dict:
    """Send an HTML email. Returns {sent, provider|mocked, to, [error]}."""
    to_list = [to] if isinstance(to, str) else [t for t in to if t]
    if not to_list:
        return {"sent": False, "to": [], "error": "no recipients"}
    if SMTP_ENABLED:
        try:
            await asyncio.to_thread(_smtp_send_sync, to_list, subject, html)
            return {"sent": True, "provider": "gmail_smtp", "to": to_list}
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP auth failed (need a Gmail App Password?): {e}")
            return {"sent": False, "to": to_list, "error": "smtp_auth_failed"}
        except Exception as e:
            logger.error(f"SMTP send failed: {e}")
            return {"sent": False, "to": to_list, "error": "smtp_error"}
    resend_key = os.environ.get("RESEND_API_KEY", "")
    if resend_key:
        try:
            import resend
            resend.api_key = resend_key
            resend.Emails.send({
                "from": os.environ.get("RESEND_FROM_EMAIL", "DecisionOS <onboarding@resend.dev>"),
                "to": to_list, "subject": subject, "html": html,
            })
            return {"sent": True, "provider": "resend", "to": to_list}
        except Exception as e:
            logger.error(f"Resend send failed: {e}")
            return {"sent": False, "to": to_list, "error": "resend_error"}
    logger.info(f"[EMAIL MOCK] To {to_list}: {subject}")
    return {"sent": False, "mocked": True, "to": to_list}
