"""Golden cases for captures.triage -- the WhatsApp Smart-Capture classifier that
decides what an inbound message is and how confidently, so persist_capture_draft
can route it to the right review queue.
"""
from evals.base import register, EvalCase, one_of, in_range, nonempty_str, predicate
from services.captures import ai_capture_triage, CAPTURE_CLASSES


register(EvalCase(
    task="captures.triage", name="invoice_classified",
    fn=ai_capture_triage,
    kwargs={"text": "Invoice #4821 from Gupta Traders for Rs 1,20,000, due 15 Oct.",
            "roles": ["finance", "sales", "operations"]},
    golden="""{"classification": "invoice", "intent": "finance", "summary": "Invoice from Gupta Traders Rs 1.2L",
      "priority": "high", "department": "finance", "confidence": 0.93, "amount": 120000, "unrelated": false}""",
    checks=[
        one_of("classification", CAPTURE_CLASSES),
        one_of("priority", ["low", "medium", "high"]),
        in_range("confidence", 0.0, 1.0),
        nonempty_str("summary"),
        predicate("unrelated is bool", lambda r: isinstance(r["unrelated"], bool)),
    ],
    note="Capture triage: classification within the enum, priority valid, confidence in 0..1.",
))

register(EvalCase(
    task="captures.triage", name="terse_instruction_not_unrelated",
    fn=ai_capture_triage,
    kwargs={"text": "send quotation to Kumar", "roles": ["sales", "finance", "operations"]},
    # E3-07.2: a terse (or Tanglish) instruction is a REAL task -> unrelated must stay
    # false and it routes to a department. Live-validated against the v1.1 prompt.
    golden="""{"classification": "sales", "intent": "send quotation", "summary": "Send a quotation to Kumar",
      "department": "sales", "priority": "medium", "confidence": 0.92, "unrelated": false}""",
    checks=[
        predicate("terse instruction not dropped as unrelated", lambda r: r["unrelated"] is False),
        one_of("classification", CAPTURE_CLASSES),
        nonempty_str("summary"),
    ],
    note="E3-07.2 precision: a brief genuine instruction is kept (unrelated=false), not dropped.",
))

register(EvalCase(
    task="captures.triage", name="bad_values_coerced",
    fn=ai_capture_triage,
    kwargs={"text": "random chatter with no clear intent", "roles": ["sales"]},
    golden="""{"classification": "banana", "priority": "urgent", "confidence": "very high"}""",
    checks=[
        predicate("bad class -> 'other'", lambda r: r["classification"] == "other"),
        predicate("bad priority -> 'medium'", lambda r: r["priority"] == "medium"),
        predicate("unparseable confidence -> 0.7", lambda r: r["confidence"] == 0.7),
        nonempty_str("summary"),
    ],
    note="Coercion guard: an out-of-enum class/priority and a non-numeric confidence get safe defaults.",
))
