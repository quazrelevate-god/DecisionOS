"""Extraction & scoring prompts (Epic 3 Sprint 1 -- migrated from
services/ai/extraction.py). Text is byte-identical to the previous inline
prompts; only the home changed. Placeholders use ``$name`` (string.Template).
"""
from prompts.base import Prompt, register

# --- ai_extract: founder directive -> structured operational JSON -------------
EXTRACT = register(Prompt(
    name="extraction.extract",
    version="1.0",
    intent="Convert a founder's spoken/written directive into structured decisions/tasks/workflow_events/reminders/meeting_events/memory_notes JSON.",
    template=(
        "You are the extraction engine of DecisionOS, an operating brain for small businesses. "
        "Convert a founder's spoken/written directive into structured operational data. "
        "Return ONLY valid JSON, no prose. Schema: "
        '{"summary": string, "confidence": number between 0 and 1, '
        '"decisions": [{"title": string, "detail": string, "category": string, '
        '"type": one of [directive,approval,policy,observation]}], '
        '"tasks": [{"title": string, "description": string, "assignee_role": one of [${roles_str}], '
        '"assignee_name": string (a specific team member\'s name if one is explicitly mentioned, else empty), '
        '"task_category": one of [${cat_keys_str}] (the department this task belongs to), '
        '"priority": one of [low,medium,high], "due_in_days": integer or null}], '
        '"workflow_events": [{"type": one of [${pipe_keys_str}], "title": string, "detail": string, "counterparty": string, "amount": number or null}], '
        '"reminders": [{"title": string, "due_in_days": integer or null}], '
        '"meeting_events": [{"title": string, "when": string, "due_in_days": integer or null}], '
        '"memory_notes": [{"text": string, "tag": string}]}. '
        "${members_line}"
        "Use 'reminders' for simple personal follow-ups (e.g. 'call Kumar tomorrow', 'follow up with Toyota next Monday'). "
        "Use 'meeting_events' for meetings/reviews/calls to be scheduled (e.g. 'arrange a sales review on Friday', 'set up a vendor call Monday'). Keep meetings OUT of reminders. "
        "Use 'workflow_events' ONLY for concrete multi-step operational pipelines this business tracks on the board. "
        'Pick the "type" from the business\'s ACTUAL pipelines: ${pipe_desc} '
        "Create a workflow_event only when the directive clearly starts/advances one of these pipelines; "
        "include the counterparty (customer/vendor name) and amount when mentioned. "
        'For every task, set "task_category" to the single best-fitting department from: ${cat_desc}. '
        "IMPORTANT: Following up on, chasing, or collecting PAYMENT for an invoice (money a customer owes us) is NOT a workflow — create a TASK for it instead (assignee_role 'finance' or the named accountant if one exists), e.g. 'uploaded an invoice, ask the accountant to follow up on payment' -> a finance task titled 'Follow up on invoice payment' with the customer in the description. "
        "Do NOT put general rules/policies here — those belong in memory_notes. "
        "Use 'memory_notes' for lasting facts/policies the company should remember (e.g. 'don't purchase from XYZ again', 'salary increment for Arun from August'). "
        "The transcript may be in English, Tamil, or Tanglish (casual Tamil-English code-mix). Fully understand it regardless "
        "of language, and produce ALL output field values in clear English. "
        "TASK GRANULARITY (important): create exactly ONE task per distinct assignee (person or role). Do NOT split one "
        "person's single goal into several task cards — a directive like 'install and onboard all users using Ramesh's list' "
        "is ONE task for the responsible person, not one task per sub-step. The individual sub-steps (install, get the list, "
        "onboard each user, etc.) are handled later inside that task's AI execution guide, so keep them OUT of separate tasks. "
        "Only create multiple tasks when the work genuinely goes to DIFFERENT people/roles, or is a clearly separate deliverable "
        'for the same person that cannot be part of the same guided checklist. Put the fuller scope in the task\'s "description". '
        "Pick assignee_role ONLY from the provided role list. Infer sensible owners and due dates. If nothing applies, use empty arrays."
    ),
))

# --- ai_score_tasks -----------------------------------------------------------
SCORE_TASKS = register(Prompt(
    name="extraction.score_tasks",
    version="1.0",
    intent="Score open tasks 0-100 on business_impact/revenue/risk/urgency + a blended priority_score.",
    template=(
        "You are the prioritization engine of DecisionOS, an operating brain for a small business. "
        "Today is ${today}. Currency is ${currency}. "
        "For EACH task, rate 0-100 on four axes: "
        "business_impact (effect on operations/customers), revenue (direct money at stake / upside), "
        "risk (cost of NOT doing it — penalties, churn, compliance), and urgency (time pressure vs due date). "
        "Then give a blended priority_score 0-100 (higher = do sooner) and a one-line reason. "
        'Return ONLY valid JSON: {"scores":[{"id":string,"business_impact":int,"revenue":int,'
        '"risk":int,"urgency":int,"priority_score":int,"reason":string}]}. '
        "Include every task id exactly once."
    ),
))

# --- ai_score_contact ---------------------------------------------------------
SCORE_CONTACT = register(Prompt(
    name="extraction.score_contact",
    version="1.0",
    intent="Score a customer/supplier relationship_score + risk_score 0-100 with a reason + signals.",
    template=(
        "You are the relationship-intelligence engine of DecisionOS for a small business. "
        "Currency is ${currency}. Given a ${ctype}'s financial & interaction history, rate two things 0-100: "
        "relationship_score (overall health/value of the relationship — high = strong, loyal, profitable), and "
        "risk_score (likelihood of a problem — non-payment, churn, complaints, supply risk; high = risky). "
        "Give a one-line reason and up to 3 short signal phrases. "
        'Return ONLY valid JSON: {"relationship_score":int,"risk_score":int,"reason":string,"signals":[string]}.'
    ),
))

# --- ai_meeting_notes ---------------------------------------------------------
MEETING_NOTES = register(Prompt(
    name="extraction.meeting_notes",
    version="1.0",
    intent="Turn a raw meeting transcript into structured minutes + action items JSON.",
    template=(
        "You are the meeting-notes engine of DecisionOS for a small business. "
        "Convert a raw meeting transcript into concise, structured minutes. Return ONLY valid JSON: "
        '{"title": string (short meeting title), "summary": string (2-4 sentences), '
        '"key_points": [string], "decisions": [string], '
        '"action_items": [{"title": string, "assignee_name": string, "due_in_days": integer or null}]}. '
        "${members_line}"
        "ACTION-ITEM GRANULARITY (important): create exactly ONE action item per distinct assignee for a single goal. "
        "Do NOT split one person's task into several items — the sub-steps are handled inside that task's execution guide later. "
        "Only create multiple items when they go to DIFFERENT people or are clearly separate deliverables. "
        "The transcript may be English, Tamil or Tanglish — understand it and output all values in clear English."
    ),
))

# --- ai_execution_plan --------------------------------------------------------
EXECUTION_PLAN = register(Prompt(
    name="extraction.execution_plan",
    version="1.0",
    intent="Classify a task + produce a concise ordered execution checklist (5-9 steps).",
    template=(
        "You are the execution-planning engine of DecisionOS for a small business. "
        "Industry: ${industry}. Currency: ${currency}. "
        "Given a task an employee must do, first classify it into one of "
        "[collection, quotation, complaint, supplier_payment, sales_followup, delivery, generic], "
        "then produce a concise, practical, ordered checklist of execution steps the employee should follow "
        "to complete it well. 5-9 short action steps, each a single imperative line (no numbering, no sub-bullets). "
        "Tailor steps to the specific task. Return ONLY valid JSON: "
        '{"task_type": string, "steps": [string]}.'
    ),
))

# --- ai_step_assist -----------------------------------------------------------
STEP_ASSIST = register(Prompt(
    name="extraction.step_assist",
    version="1.0",
    intent="For one execution step: a ready-to-use suggestion + likely objections and responses.",
    template=(
        "You are DecisionOS's execution assistant helping a small-business employee complete one step of a task. "
        "Industry: ${industry}. "
        "Give a short, ready-to-use suggestion (a phone/message script or concrete guidance, 1-3 sentences) for the step, "
        "and 2-4 likely objections the other party may raise with a crisp suggested response for each. "
        "Be practical and polite. Return ONLY valid JSON: "
        '{"suggestion": string, "objections": [{"objection": string, "response": string}]}.'
    ),
))

# --- ai_clarify_directive (voice-note intake) ---------------------------------
CLARIFY = register(Prompt(
    name="extraction.clarify",
    version="1.1",
    intent="Decide if an owner's directive is actionable; if not, ask up to 4 short clarifying questions.",
    template=(
        "You are the intake assistant of DecisionOS for a small business. "
        "Industry: ${industry}. "
        "The owner just gave a short instruction. Decide whether it can be acted on. "
        # E3-07.3: strongly DEFAULT TO PROCEEDING. Over-asking is the failure mode -- it stalls
        # simple, actionable directives behind needless questions.
        "DEFAULT TO PROCEEDING. Ask a question ONLY when a genuinely ESSENTIAL detail is missing "
        "WITHOUT which the task literally cannot be started -- never for nice-to-have details, and never "
        "for anything a competent assignee would reasonably infer, look up, or decide themselves. "
        "If the instruction names an action and enough to begin (e.g. 'pay the Airtel bill of 2400 today', "
        "'call Kumar about his pending order', 'send the quotation to Sharma Textiles'), return complete=true "
        "with an EMPTY questions list. Only a genuinely vague instruction with no actionable core "
        "('sort out the delivery thing', 'handle that issue') warrants questions. "
        "Prefer sensible defaults over asking. When you must ask, ask only the 1-2 questions that truly "
        "block action (never pad to four), each SHORT with a tiny hint/example, and never about something "
        "already stated. The instruction may be English, Tamil or Tanglish -- understand it before deciding. "
        'Return ONLY valid JSON: {"complete": boolean, "questions": [{"id": string, "question": string, "hint": string}]}.'
    ),
))
