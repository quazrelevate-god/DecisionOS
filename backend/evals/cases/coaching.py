"""Golden cases for coaching.* -- the work-review generator and the leave-impact
analyzer (both consumed directly by the UI, so their shape must stay stable).
"""
from evals.base import register, EvalCase, key_present, is_list, nonempty_str, predicate
from services.operating_score import ai_work_coach
from services.leave import ai_leave_impact


register(EvalCase(
    task="coaching.work_coach", name="review_shape",
    fn=ai_work_coach,
    kwargs={
        "target": {"name": "Rajesh", "role": "operations"},
        "stats": {"tasks_done": 42, "on_time_rate": 0.78, "overdue": 3},
        "session_id": "eval-coach-1",
    },
    golden="""{"headline": "Strong, reliable operator with a follow-through gap",
      "strengths": ["High throughput", "Owns dispatch end to end"],
      "improvements": ["Tighten overdue follow-ups"],
      "recommendation": "Pair with finance on the 3 overdue items this week."}""",
    checks=[
        nonempty_str("headline"),
        is_list("strengths"), is_list("improvements"),
        key_present("recommendation"),
        predicate("<=4 strengths", lambda r: len(r["strengths"]) <= 4),
        predicate("<=3 improvements", lambda r: len(r["improvements"]) <= 3),
    ],
    note="Work coach: headline + capped strengths/improvements lists + a recommendation.",
))


register(EvalCase(
    task="coaching.leave_impact", name="at_risk_tasks",
    fn=ai_leave_impact,
    kwargs={
        "person_name": "Priya", "from_date": "2026-09-01", "to_date": "2026-09-07",
        "tasks": [{"id": "t1", "title": "Close Q3 books", "priority": "high", "status": "todo", "due_date": "2026-09-05"}],
        "members": [{"id": "m2", "name": "Anil", "role": "finance", "load": 4}],
    },
    golden="""{"summary": "One high-priority finance task is due during Priya's leave.",
      "suggestions": [{"task_id": "t1", "reassign_to": "m2", "reason": "Anil has finance context and capacity"}]}""",
    checks=[
        nonempty_str("summary"),
        is_list("suggestions"),
    ],
    note="Leave impact: a summary plus a list of coverage suggestions.",
))

register(EvalCase(
    task="coaching.leave_impact", name="no_tasks_short_circuits",
    fn=ai_leave_impact,
    kwargs={"person_name": "Priya", "from_date": "2026-09-01", "to_date": "2026-09-02",
            "tasks": [], "members": []},
    golden="""{"summary": "ignored", "suggestions": ["ignored"]}""",
    checks=[
        nonempty_str("summary"),
        predicate("no suggestions when no tasks", lambda r: r["suggestions"] == []),
    ],
    note="No affected tasks => the function returns its safe no-op WITHOUT calling the model.",
))
