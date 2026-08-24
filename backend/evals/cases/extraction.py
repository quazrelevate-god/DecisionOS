"""Golden cases for the extraction.* tasks (services.ai.extraction + voice clarify).

Each case pins a realistic recorded model response and asserts the shape the rest
of the app relies on -- so a prompt or model change that drops a field, breaks the
JSON, or lets a score escape 0..100 fails here instead of in production.
"""
from evals.base import (
    register, EvalCase, key_present, is_list, nonempty_list, nonempty_str,
    in_range, one_of, each_item, predicate,
)
from services.ai.extraction import (
    ai_extract, ai_score_tasks, ai_score_contact, ai_meeting_notes,
    ai_execution_plan, ai_step_assist,
)
from routers.voice_notes import ai_clarify_directive


# --- extraction.extract -----------------------------------------------------
register(EvalCase(
    task="extraction.extract", name="directive_with_tasks",
    fn=ai_extract,
    kwargs={
        "transcript": "Call Priya at Sharma Textiles about the pending 2 lakh invoice, "
                      "and tell Rajesh to prepare the September dispatch plan by Friday.",
        "session_id": "eval-extract-1",
        "members": [{"name": "Priya"}, {"name": "Rajesh"}],
    },
    golden="""```json
{
  "summary": "Follow up on Sharma Textiles invoice and prepare September dispatch plan.",
  "decisions": [{"title": "Chase pending invoice and plan dispatch", "rationale": "Cash flow + delivery"}],
  "tasks": [
    {"title": "Call Priya re: 2 lakh pending invoice", "description": "Sharma Textiles", "assignee_role": "finance", "assignee_name": "Priya", "priority": "high"},
    {"title": "Prepare September dispatch plan", "description": "Due Friday", "assignee_role": "operations", "assignee_name": "Rajesh", "priority": "medium"}
  ],
  "workflow_events": [],
  "reminders": [],
  "meeting_events": [],
  "memory_notes": []
}
```""",
    checks=[
        nonempty_str("summary"),
        nonempty_list("tasks"),
        is_list("decisions"), is_list("workflow_events"),
        is_list("reminders"), is_list("meeting_events"), is_list("memory_notes"),
        each_item("tasks", nonempty_str("title"), key_present("assignee_role")),
        predicate("clean extraction not flagged for review", lambda r: r.get("needs_review") is False),
    ],
    note="Core directive extraction: summary + tasks + the six list buckets always present; clean output not review-flagged.",
))

register(EvalCase(
    task="extraction.extract", name="garbage_response_falls_back",
    fn=ai_extract,
    kwargs={"transcript": "some directive text here", "session_id": "eval-extract-2"},
    # single string => returned for BOTH the initial call and the repair re-ask
    golden="I could not produce JSON for this request, sorry.",
    checks=[
        key_present("summary"),
        is_list("tasks"), is_list("decisions"), is_list("workflow_events"),
        predicate("tasks empty on parse-fail", lambda r: r["tasks"] == []),
    ],
    note="Parse-fail resilience: non-JSON on both the first call and the repair re-ask still yields the safe fallback.",
))

register(EvalCase(
    task="extraction.extract", name="auto_repair_recovers",
    fn=ai_extract,
    kwargs={"transcript": "Tell Priya to call the supplier about the delayed order.",
            "session_id": "eval-extract-repair-1"},
    # call 1: a task is missing its required 'title' (schema violation) -> repair.
    # call 2: the corrected JSON. E3-02.1 should return the repaired result.
    golden=[
        """{"summary": "Follow up with supplier on delayed order.",
            "tasks": [{"description": "supplier delay", "assignee_role": "operations", "priority": "high"}]}""",
        """{"summary": "Follow up with supplier on delayed order.",
            "tasks": [{"title": "Call supplier about delayed order", "description": "for Priya",
                       "assignee_role": "operations", "assignee_name": "Priya", "priority": "high"}],
            "decisions": [], "workflow_events": [], "reminders": [], "meeting_events": [], "memory_notes": []}""",
    ],
    checks=[
        nonempty_list("tasks"),
        each_item("tasks", nonempty_str("title"), key_present("assignee_role")),
        predicate("repaired title present", lambda r: r["tasks"][0]["title"].strip() != ""),
    ],
    note="Auto-repair: a first response missing a required field triggers one bounded re-ask; the corrected result is used.",
))

register(EvalCase(
    task="extraction.extract", name="auto_repair_exhausted_coerces",
    fn=ai_extract,
    kwargs={"transcript": "do the needful", "session_id": "eval-extract-repair-2"},
    # both attempts violate the schema (task with no title) -> after the single
    # bounded repair, coercion clamps/keeps a safe shape rather than crashing.
    golden=[
        """{"summary": "", "tasks": [{"assignee_role": "sales", "priority": "urgent"}]}""",
        """{"summary": "", "tasks": [{"assignee_role": "sales", "priority": "urgent"}]}""",
    ],
    checks=[
        key_present("summary"),
        is_list("tasks"), is_list("decisions"),
        predicate("bad priority clamped to medium",
                  lambda r: all(t.get("priority") == "medium" for t in r["tasks"])),
        predicate("flagged for review after failed repair", lambda r: r.get("needs_review") is True),
    ],
    note="Repair-exhausted: after the one re-ask still fails, coercion guarantees the contract (enum clamped), no crash, and it's flagged for review.",
))


# --- extraction.score_tasks -------------------------------------------------
register(EvalCase(
    task="extraction.score_tasks", name="scores_every_task_in_range",
    fn=ai_score_tasks,
    kwargs={
        "tasks": [
            {"id": "t1", "title": "Chase overdue invoice", "priority": "high", "status": "todo"},
            {"id": "t2", "title": "Update product catalogue", "priority": "low", "status": "todo"},
        ],
        "currency": "INR", "session_id": "eval-score-1",
    },
    golden="""{"scores": [
      {"id": "t1", "business_impact": 85, "revenue": 90, "risk": 70, "urgency": 88, "priority_score": 86, "reason": "Overdue cash"},
      {"id": "t2", "business_impact": 30, "revenue": 20, "risk": 15, "urgency": 25, "priority_score": 24, "reason": "Low urgency"}
    ]}""",
    checks=[
        predicate("both task ids scored", lambda r: {"t1", "t2"} <= set(r)),
        predicate("t1 scores 0..100", lambda r: all(0 <= r["t1"][a] <= 100 for a in
                  ("business_impact", "revenue", "risk", "urgency", "priority_score"))),
    ],
    note="Every task gets a scored entry; all 5 axes clamped to 0..100.",
))

register(EvalCase(
    task="extraction.score_tasks", name="out_of_range_clamped",
    fn=ai_score_tasks,
    kwargs={"tasks": [{"id": "t1", "title": "x", "priority": "high", "status": "todo"}],
            "currency": "INR", "session_id": "eval-score-2"},
    golden="""{"scores": [{"id": "t1", "business_impact": 250, "revenue": -40, "risk": "high",
      "urgency": 60, "priority_score": 999, "reason": "extreme"}]}""",
    checks=[
        predicate("t1 present", lambda r: "t1" in r),
        predicate("all clamped 0..100", lambda r: all(0 <= r["t1"][a] <= 100 for a in
                  ("business_impact", "revenue", "risk", "urgency", "priority_score"))),
    ],
    note="Clamp guard: a model returning 250 / -40 / a string still yields 0..100 ints.",
))


# --- extraction.score_contact -----------------------------------------------
register(EvalCase(
    task="extraction.score_contact", name="relationship_and_risk",
    fn=ai_score_contact,
    kwargs={
        "contact": {"name": "Sharma Textiles", "type": "customer", "status": "active"},
        "metrics": {"outstanding": 200000, "total_billed": 800000, "open_complaints": 1},
        "currency": "INR", "session_id": "eval-contact-1",
    },
    golden="""{"relationship_score": 72, "risk_score": 34, "reason": "Good history, some outstanding",
      "signals": ["pays late occasionally", "high lifetime value", "one open complaint"]}""",
    checks=[
        in_range("relationship_score", 0, 100),
        in_range("risk_score", 0, 100),
        nonempty_str("reason"),
        predicate("<=3 signals", lambda r: isinstance(r.get("signals"), list) and len(r["signals"]) <= 3),
    ],
    note="Contact scoring: both scores in range, reason present, signals capped at 3.",
))


# --- extraction.meeting_notes -----------------------------------------------
register(EvalCase(
    task="extraction.meeting_notes", name="minutes_and_actions",
    fn=ai_meeting_notes,
    kwargs={
        "transcript": "We agreed to raise prices 5% from October. Priya will notify top customers. "
                      "Rajesh flagged a supplier delay risk.",
        "members": [{"name": "Priya"}, {"name": "Rajesh"}],
        "session_id": "eval-meeting-1",
    },
    golden="""{"title": "Pricing & ops sync", "summary": "Agreed 5% price rise from October.",
      "key_points": ["5% price increase", "supplier delay risk"],
      "decisions": ["Raise prices 5% from October"],
      "action_items": [{"assignee_name": "Priya", "task": "Notify top customers of price change"}]}""",
    checks=[
        nonempty_str("title"), nonempty_str("summary"),
        is_list("key_points"), is_list("decisions"), nonempty_list("action_items"),
    ],
    note="Meeting minutes: title+summary+the three lists; action_items populated.",
))


# --- extraction.execution_plan ----------------------------------------------
register(EvalCase(
    task="extraction.execution_plan", name="steps_generated",
    fn=ai_execution_plan,
    kwargs={
        "task": {"title": "Onboard new distributor", "description": "North region",
                 "assignee_role": "sales", "priority": "high"},
        "industry": "manufacturing", "currency": "INR", "session_id": "eval-plan-1",
    },
    golden="""{"task_type": "partner_onboarding", "steps": [
      "Verify distributor GST and references", "Sign the distribution agreement",
      "Set credit limit and payment terms", "Schedule first stock order"]}""",
    checks=[
        nonempty_str("task_type"),
        nonempty_list("steps"),
        predicate("<=12 steps", lambda r: len(r["steps"]) <= 12),
        predicate("steps are strings", lambda r: all(isinstance(s, str) and s for s in r["steps"])),
    ],
    note="Execution plan: a task_type + a capped list of non-empty step strings.",
))

register(EvalCase(
    task="extraction.execution_plan", name="empty_steps_get_default",
    fn=ai_execution_plan,
    kwargs={"task": {"title": "x"}, "industry": "", "currency": "INR", "session_id": "eval-plan-2"},
    golden="""{"task_type": "generic", "steps": []}""",
    checks=[
        nonempty_list("steps"),
        predicate("default checklist filled in", lambda r: len(r["steps"]) >= 3),
    ],
    note="A model returning no steps must still yield the generic fallback checklist.",
))


# --- extraction.step_assist -------------------------------------------------
register(EvalCase(
    task="extraction.step_assist", name="suggestion_and_objections",
    fn=ai_step_assist,
    kwargs={
        "task": {"title": "Cold call new lead", "description": "Bulk buyer"},
        "step_text": "Open the call and qualify budget",
        "industry": "wholesale", "session_id": "eval-assist-1",
    },
    golden="""{"suggestion": "Introduce yourself, state the value in one line, then ask about their monthly volume.",
      "objections": [
        {"objection": "We already have a supplier", "response": "Understood -- can I be your backup for urgent orders?"},
        {"objection": "Send me an email", "response": "Happy to -- what's the one thing you'd want it to answer?"}]}""",
    checks=[
        nonempty_str("suggestion"),
        is_list("objections"),
        each_item("objections", nonempty_str("objection"), key_present("response")),
    ],
    note="Step assist: a suggestion plus objection/response pairs (each with a response key).",
))


# --- extraction.clarify -----------------------------------------------------
register(EvalCase(
    task="extraction.clarify", name="incomplete_asks_questions",
    fn=ai_clarify_directive,
    kwargs={"text": "Sort out the delivery thing", "industry": "logistics", "session_id": "eval-clarify-1"},
    golden="""{"complete": false, "questions": [
      {"question": "Which delivery/order are you referring to?", "hint": "customer or order id"},
      {"question": "What's the deadline?", "hint": "date"}]}""",
    checks=[
        one_of("complete", [True, False]),
        predicate("incomplete => questions present", lambda r: r["complete"] or len(r["questions"]) > 0),
        predicate("<=4 questions", lambda r: len(r["questions"]) <= 4),
        predicate("each question has text", lambda r: all(q.get("question") for q in r["questions"])),
    ],
    note="Clarify: a vague directive returns complete=false with up to 4 well-formed questions.",
))

register(EvalCase(
    task="extraction.clarify", name="complete_no_questions",
    fn=ai_clarify_directive,
    kwargs={"text": "Pay the Airtel bill of 2400 rupees today from the current account",
            "industry": "retail", "session_id": "eval-clarify-2"},
    golden="""{"complete": true, "questions": []}""",
    checks=[
        predicate("complete is true", lambda r: r["complete"] is True),
        predicate("no questions when complete", lambda r: r["questions"] == []),
    ],
    note="A fully-specified directive returns complete=true and no questions.",
))
