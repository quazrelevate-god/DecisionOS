"""Email — moved to the provider adapter at integrations/email.py (Epic 8
Sprint 6). This module is a thin re-export shim so existing
``from services.email import send_email`` call sites keep working; new code
should import from ``integrations.email``.
"""
from integrations.email import (  # noqa: F401
    send_email, _smtp_send_sync,
    SMTP_ENABLED, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
)
