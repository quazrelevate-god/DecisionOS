"""AI output-schema validation + coercion (Epic 3 Sprint 2 -- E3-02.1).

The extraction engine asks the model for a specific JSON shape. Two things can go
wrong: the model returns text that doesn't parse, or it parses but is missing
required fields / has the wrong types. E3-02.1 adds a strict validator so those
cases are DETECTED (and, in ai_extract, trigger one bounded auto-repair re-ask)
instead of silently degrading.

Two entry points, sharing one schema:

* ``validate_extract(data) -> list[str]`` -- concise, bounded list of violations
  (empty == valid). Feeds the repair prompt so the re-ask is specific.
* ``coerce_extract(data, transcript) -> dict`` -- always returns a dict matching
  the downstream contract: the six list buckets present, summary + calibrated
  confidence set, invalid enum values defaulted, non-dict list entries dropped.
  This is the final safety net; validation+repair is what tries to avoid needing it.
"""
from __future__ import annotations

_PRIORITIES = {"low", "medium", "high"}
_DEC_TYPES = {"directive", "approval", "policy", "observation"}

# The six list buckets ai_extract returns, each with the fields the model is told
# to produce. `req` = required (its absence/emptiness is a violation worth a repair).
_LIST_SPECS = {
    "decisions":       {"req": ["title"], "enums": {"type": _DEC_TYPES}},
    "tasks":           {"req": ["title", "assignee_role"], "enums": {"priority": _PRIORITIES}},
    "workflow_events": {"req": ["type", "title"], "enums": {}},
    "reminders":       {"req": ["title"], "enums": {}},
    "meeting_events":  {"req": ["title"], "enums": {}},
    "memory_notes":    {"req": ["text"], "enums": {}},
}

_MAX_VIOLATIONS = 12  # keep the repair prompt bounded


def _nonempty_str(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def validate_extract(data) -> list[str]:
    """Return a bounded list of human-readable schema violations ([] == valid).

    Strict about the things downstream actually needs (a parseable object, a
    summary, and each list item carrying its required fields with valid enums);
    tolerant of extra keys and of empty buckets (nothing to extract is valid)."""
    v: list[str] = []
    if not isinstance(data, dict):
        return ["top-level output is not a JSON object"]
    if not _nonempty_str(data.get("summary")):
        v.append("missing 'summary' (non-empty string required)")
    conf = data.get("confidence")
    if conf is not None and not (isinstance(conf, (int, float)) and 0 <= conf <= 1):
        v.append("'confidence' must be a number between 0 and 1")

    for key, spec in _LIST_SPECS.items():
        if key not in data:
            continue  # absent bucket is coerced to [] -- not a violation
        items = data.get(key)
        if not isinstance(items, list):
            v.append(f"'{key}' must be a list")
            continue
        for i, it in enumerate(items):
            if len(v) >= _MAX_VIOLATIONS:
                return v[:_MAX_VIOLATIONS]
            if not isinstance(it, dict):
                v.append(f"{key}[{i}] is not an object")
                continue
            for f in spec["req"]:
                if not _nonempty_str(it.get(f)):
                    v.append(f"{key}[{i}]: missing '{f}'")
            for f, allowed in spec["enums"].items():
                if f in it and it.get(f) not in allowed:
                    v.append(f"{key}[{i}].{f}={it.get(f)!r} not one of {sorted(allowed)}")
    return v[:_MAX_VIOLATIONS]


def coerce_extract(data, transcript: str = "") -> dict:
    """Guarantee the downstream contract regardless of model output.

    Ensures the six buckets exist as lists, drops non-dict entries, clamps invalid
    priority/decision-type enums to safe defaults, and sets summary + a confidence
    in [0,1]. Never raises. This preserves the previous ai_extract normalization
    and adds the enum/confidence hardening."""
    d = data if isinstance(data, dict) else {}
    out: dict = {}
    out["summary"] = d.get("summary") if _nonempty_str(d.get("summary")) else (transcript or "")[:200]
    conf = d.get("confidence")
    out["confidence"] = float(conf) if isinstance(conf, (int, float)) and 0 <= conf <= 1 else 0.8

    for key, spec in _LIST_SPECS.items():
        src = d.get(key)
        items = [it for it in src if isinstance(it, dict)] if isinstance(src, list) else []
        # clamp invalid enum values to a safe default so downstream never sees a bad enum
        for it in items:
            if key == "tasks" and it.get("priority") not in _PRIORITIES:
                it["priority"] = "medium"
            if key == "decisions" and "type" in it and it.get("type") not in _DEC_TYPES:
                it["type"] = "directive"
        out[key] = items
    return out


# Below this calibrated confidence an extraction is flagged for review priority
# (env-overridable so ops can tune it without a redeploy).
import os  # noqa: E402
REVIEW_CONFIDENCE = float(os.environ.get("EXTRACT_REVIEW_CONFIDENCE", "0.55"))


def calibrate_confidence(extracted: dict, *, raw, repaired: bool,
                         violations_remaining: int, transcript: str = "") -> tuple[float, list[str], bool]:
    """Turn the model's self-reported confidence into a calibrated one (E3-02.2).

    Models are systematically over-confident, so instead of trusting the raw number
    we down-weight it by OBSERVABLE signals of a shaky extraction -- a repair was
    needed, schema issues remained, or a non-empty directive produced nothing
    actionable. Returns (calibrated in [0,1], review_reasons, needs_review).

    This is signal-based calibration, not learned calibration against a labelled set
    -- that belongs in the evals track (E3-10) once thumbs/outcome data exists."""
    c = float(raw) if isinstance(raw, (int, float)) and 0 <= raw <= 1 else 0.7
    reasons: list[str] = []

    if repaired:
        c *= 0.75
        reasons.append("output needed an auto-repair pass")
    if violations_remaining:
        c *= 0.55
        reasons.append(f"{violations_remaining} schema issue(s) remained after repair")

    buckets = ("tasks", "decisions", "reminders", "meeting_events", "workflow_events")
    nothing = not any((extracted.get(b) or []) for b in buckets)
    if (transcript or "").strip() and nothing:
        c *= 0.5
        reasons.append("nothing actionable extracted from a non-empty directive")

    if len((extracted.get("summary") or "").strip()) < 8:
        c *= 0.85
        reasons.append("summary is very short")

    c = round(max(0.0, min(1.0, c)), 2)
    needs_review = c < REVIEW_CONFIDENCE or bool(violations_remaining)
    return c, reasons[:4], needs_review


def calibrate_doc_confidence(records: dict, *, raw, parse_ok: bool,
                             doc_type: str = "") -> tuple[float, list[str], bool]:
    """Calibrate a DOCUMENT extraction's confidence + flag for review (E3-06.6).

    The vision extractor reports its own confidence; this down-weights it by observable
    signals of a shaky OCR read -- the JSON didn't parse, no structured records came out,
    or the document type couldn't be identified. Because the capture flow routes on this
    confidence (auto/confirm/attention thresholds), a low calibrated value automatically
    sends a shaky scan to review instead of auto-filing. Returns (calibrated, reasons, needs_review)."""
    c = float(raw) if isinstance(raw, (int, float)) and 0 <= raw <= 1 else 0.7
    reasons: list[str] = []
    if not parse_ok:
        c *= 0.4
        reasons.append("OCR output did not parse cleanly")
    if not any((records or {}).get(b) for b in ("contacts", "invoices", "payments", "tasks")):
        c *= 0.5
        reasons.append("no structured records were read from the document")
    if (doc_type or "").strip().lower() in ("", "other", "unknown"):
        c *= 0.85
        reasons.append("document type could not be identified")
    c = round(max(0.0, min(1.0, c)), 2)
    needs_review = c < REVIEW_CONFIDENCE or not parse_ok
    return c, reasons[:4], needs_review


def repair_instruction(violations: list[str]) -> str:
    """Build the bounded re-ask sent back to the model after a bad response."""
    bullets = "\n".join(f"- {x}" for x in violations[:_MAX_VIOLATIONS])
    return (
        "Your previous response did not satisfy the required JSON schema. "
        "Problems found:\n" + bullets + "\n"
        "Return the SAME information as corrected JSON that fixes every problem above. "
        "Output ONLY the JSON object, no prose, no code fences."
    )
