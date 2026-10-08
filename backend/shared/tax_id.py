"""What may go in a contact's "GSTIN / Tax ID" (audit C-06, 2026-10-08).

"ABC123" was accepted as a GSTIN. The field also holds an export buyer's own
tax number, so it is not GSTIN-only, but it must be one of:

  * an Indian GSTIN: 15 characters -- a state code (01-38, or 97/99 for the
    other-territory and centre jurisdictions), the 10-character PAN, the entity
    number, a "Z", and a check character -- e.g. 33ABCDE1234F1Z5;
  * a foreign VAT / tax number in its usual form: the 2-letter country prefix
    and 6 to 13 letters or digits -- e.g. GB123456789, DE811907980.

The check character is not verified: the format and state code catch typing
mistakes and nonsense, and a checksum would refuse the placeholder numbers
people use while they wait for the real one.
"""
import re
from typing import Optional

_GSTIN = re.compile(r"(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]")
_FOREIGN = re.compile(r"[A-Z]{2}[0-9A-Z]{6,13}")
_STATE_CODES = {f"{n:02d}" for n in range(1, 39)} | {"97", "99"}

PROBLEM = ("That GSTIN / Tax ID doesn't look right. A GSTIN is 15 characters, like 33ABCDE1234F1Z5; "
           "a foreign tax number starts with its country code, like GB123456789.")


def clean_tax_id(raw: Optional[str]) -> str:
    """Upper-case, spaces and dashes out."""
    return re.sub(r"[\s\-./]", "", str(raw or "")).upper()


def tax_id_problem(raw: Optional[str]) -> str:
    """"" when it is empty or valid, else what to tell the person."""
    v = clean_tax_id(raw)
    if not v:
        return ""
    m = _GSTIN.fullmatch(v)
    if m:
        return "" if m.group(1) in _STATE_CODES else PROBLEM
    if v.startswith("IN") or v[:2].isdigit():
        return PROBLEM          # looks Indian, so it must be a whole GSTIN
    return "" if _FOREIGN.fullmatch(v) else PROBLEM
