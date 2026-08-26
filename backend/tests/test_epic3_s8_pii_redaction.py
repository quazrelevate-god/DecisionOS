"""Epic 3 Sprint 8 (E3-08.2): PII redaction for observability.

redact_pii masks high-confidence PII before it lands in logs / telemetry, while
leaving ordinary business text and amounts readable.
"""
from services.ai.pii import redact_pii, has_pii


def test_redacts_email():
    assert redact_pii("mail me at priya@acme.co.in please") == "mail me at [redacted-email] please"


def test_redacts_indian_mobile():
    for phone in ("9876543210", "+91 9876543210", "+919876543210", "09876543210"):
        assert "[redacted-phone]" in redact_pii(f"call {phone} now"), phone


def test_redacts_pan():
    assert redact_pii("PAN ABCDE1234F on file") == "PAN [redacted-pan] on file"


def test_redacts_aadhaar_spaced_and_bare():
    assert "[redacted-aadhaar]" in redact_pii("aadhaar 1234 5678 9012")
    assert "[redacted-aadhaar]" in redact_pii("id 123456789012 verified")


def test_redacts_formatted_card():
    assert "[redacted-card]" in redact_pii("card 4111 1111 1111 1111 expiry")


def test_does_not_redact_amounts():
    # ordinary money/invoice text must stay readable in logs
    assert redact_pii("invoice INV-77 for 5000 rupees, total 1,20,000") == \
        "invoice INV-77 for 5000 rupees, total 1,20,000"


def test_does_not_redact_short_numbers():
    assert redact_pii("quantity 500 units at 90 each") == "quantity 500 units at 90 each"


def test_multiple_pii_in_one_string():
    out = redact_pii("Priya priya@acme.in 9876543210 PAN ABCDE1234F")
    assert "[redacted-email]" in out and "[redacted-phone]" in out and "[redacted-pan]" in out
    assert "priya@acme.in" not in out and "9876543210" not in out


def test_none_and_non_string():
    assert redact_pii(None) == ""
    assert redact_pii(12345) == "12345"  # short, not redacted
    assert isinstance(redact_pii({"a": 1}), str)  # coerced, no raise


def test_has_pii():
    assert has_pii("reach me at x@y.com") is True
    assert has_pii("send the quotation to Kumar for 5000") is False
    assert has_pii(None) is False
    assert has_pii("") is False
