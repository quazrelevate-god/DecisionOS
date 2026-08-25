"""PII redaction for observability (Epic 3 Sprint 8 -- E3-08.2, DPDP-aligned).

POLICY. DecisionOS's core function is to process a business's own operational data
with AI: extracting contacts, invoices, and payments *requires* sending that data
(names, phones, emails, amounts) to the model provider (Anthropic / Google, via the
Emergent gateway, under their data-processing terms). So we do NOT redact PII from
the LLM *request* -- that would break the product.

What we DO enforce is DATA MINIMIZATION in our OWN persisted observability: logs,
per-call telemetry (db.ai_calls), and error records must never store raw PII, so a
breach of our logs/telemetry can't leak personal data. ``redact_pii`` is applied at
those persistence points. Retention of the operational records themselves is governed
by tenant deletion / deprovisioning (Epic 1), not here.

Conservative by design: it masks high-confidence PII formats (email, Indian mobile,
PAN, Aadhaar, formatted card numbers) and leaves ordinary business text/amounts
readable so redacted logs stay useful for debugging.
"""
from __future__ import annotations

import re

# Order matters: most specific / longest formats first. Phone runs before the bare
# 12-digit Aadhaar rule because a +91-prefixed mobile is itself 12 digits -- either
# way it ends up redacted; this just keeps the label right for the common case.
_RULES = [
    ("card", re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b")),          # formatted 16-digit card
    ("email", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    ("pan", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")),                       # Indian PAN
    ("aadhaar", re.compile(r"\b\d{4}\s\d{4}\s\d{4}\b")),                     # Aadhaar, spaced
    ("phone", re.compile(r"(?<![\d\w])(?:\+?91[ -]?|0)?[6-9]\d{9}(?![\d])")),  # Indian mobile
    ("aadhaar", re.compile(r"\b\d{12}\b")),                                  # Aadhaar, bare 12-digit
]


def redact_pii(text) -> str:
    """Return ``text`` with high-confidence PII masked as ``[redacted-<kind>]``.
    Coerces non-strings; never raises. Safe to call on any log/telemetry string."""
    if text is None:
        return ""
    s = text if isinstance(text, str) else str(text)
    for kind, rx in _RULES:
        s = rx.sub(f"[redacted-{kind}]", s)
    return s


def has_pii(text) -> bool:
    """True if any high-confidence PII pattern is present. Never raises."""
    if not text:
        return False
    s = text if isinstance(text, str) else str(text)
    return any(rx.search(s) for _, rx in _RULES)
