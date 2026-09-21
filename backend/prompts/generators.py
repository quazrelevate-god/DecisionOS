"""Onboarding AI-generator prompts (Epic 3 Sprint 1 -- migrated from
services/ai/generators.py). All three system prompts are static; the tenant
context (industry / size / departments) is passed in the USER message, not the
system prompt, so these carry no placeholders.
"""
from prompts.base import Prompt, register

LEXICON = register(Prompt(
    name="generators.lexicon",
    version="1.0",
    intent="Localize DecisionOS's fixed vocabulary (customer/vendor/workflows/task_types) to a tenant's industry.",
    template=(
        "You localize the vocabulary of DecisionOS (a business operations app) to a specific industry. "
        "The app has fixed internal concepts; give the MOST NATURAL word a business in this industry actually uses for each. "
        "Return ONLY valid JSON, no prose, EXACTLY this shape: "
        '{"customer_singular": str, "customer_plural": str, "vendor_singular": str, "vendor_plural": str, '
        '"workflows": {"production": {"label": str, "sub": str}, "distribution": {"label": str, "sub": str}, '
        '"purchase_payment": {"label": str, "sub": str}}, '
        '"task_types": {"operational": str, "sales": str, "purchase": str, "production": str, "finance": str, "hr": str}}. '
        "Concept meanings: customer = the people/orgs who buy or receive your product/service "
        "(e.g. a coaching institute → 'Student'/'Students', a clinic → 'Patient'/'Patients'). "
        "vendor = who you buy/source from (e.g. 'Partner', 'Supplier', 'Publisher'). "
        "workflows.production = your CORE delivery/fulfilment pipeline (turning an order/enrollment into a delivered outcome, "
        "e.g. 'Enrollment', 'Course Delivery', 'Case'); "
        "workflows.distribution = handing over / dispatching the finished outcome to the customer "
        "(e.g. 'Onboarding', 'Handover', 'Delivery'); "
        "workflows.purchase_payment = procuring goods/services and paying vendors (e.g. 'Procurement'). "
        "task_types are the department buckets tasks fall into — keep them relevant to the industry. "
        "'sub' is a short 2-4 word arrow subtitle like 'Order → Ready'. Keep every label 1-2 words, Title Case. "
        "Use the industry's real terminology; never invent nonsense."
    ),
))

OPERATING_MODEL = register(Prompt(
    name="generators.operating_model",
    version="1.1",
    intent="Design the tenant's operating model: workflow pipelines (role-owned stages, each with the work that stage needs) + task categories.",
    template=(
        "You design the OPERATING MODEL for a business inside DecisionOS. The model has two parts and MUST fit "
        "the specific industry — a salon has NO 'production' or 'dispatch'; it has a service/appointment flow. "
        "Return ONLY valid JSON, no prose, EXACTLY this shape: "
        '{"pipelines": [{"key": lowercase_snake_case, "label": str, "sub": short \'A → B\' subtitle, '
        '"stages": [{"key": lowercase_snake_case, "label": str, "role": role_slug_or_empty, '
        '"tasks": [{"title": str, "role": role_slug_or_empty}]}], '
        '"approval_stage": key of the stage that needs owner sign-off or null}], '
        '"task_categories": [{"key": lowercase_snake_case, "label": str}]}. '
        "PIPELINES = the core multi-step operational flows this business tracks on a kanban board, from start to finish. "
        "Design 2-4 pipelines that genuinely match how THIS industry operates. Each pipeline has 3-6 ordered stages "
        "(the real steps work moves through). Examples: a SALON → 'Appointments' (Booked→Confirmed→In Service→Completed) "
        "and 'Procurement' (Requested→Approved→Received→Paid); a COACHING INSTITUTE → 'Enrollment' "
        "(Inquiry→Counselling→Enrolled→Onboarded) and 'Course Delivery' (Scheduled→Ongoing→Completed); a RESTAURANT → "
        "'Orders' and 'Procurement'. Set approval_stage only where an owner must sign off (e.g. procurement 'approved'), else null. "
        'WE-01.5: For each stage set "role" to the ONE department that primarily owns work at that stage -- must be a slug '
        "matching one of the tenant's departments (lowercase, e.g. 'sales', 'finance', 'operations', 'owner'). This is what "
        "routes decision-spawned tasks to the correct stage. Examples: procurement.requested → 'operations', "
        "procurement.approved → 'owner', procurement.paid → 'finance'; sales.order_received → 'sales', "
        "sales.confirmed → 'finance' (they raise the invoice), sales.ready → 'operations'. Set role='' only if truly "
        "no single department owns the stage. "
        # 2026-09-21: stages have always been ABLE to carry the work they need
        # (WE-03 normalizes tasks[] per stage, and the engine spawns them the
        # moment a card lands on a stage) — and this prompt never asked for
        # them, so every tenant's stages came back empty and the whole
        # mechanism sat dead. A card arriving at "In production" with nobody
        # told to do anything is why boards stall.
        'STAGE TASKS: for each stage give 1-3 "tasks" — the concrete pieces of work somebody must actually DO while '
        "work sits at that stage, in this industry's own words, as an instruction ('Confirm the order with the "
        "customer', 'Check stock and reserve it', 'Photograph the finished goods', 'Collect the signed delivery "
        "note'). These are created automatically and assigned the moment a card reaches the stage, so they must be "
        "real, repeatable work — not restatements of the stage name ('Do the cooking' for a Cooking stage is "
        "useless). Set each task's \"role\" to the department that does it, usually the stage's own role. A final "
        "stage that is purely a resting state (Delivered, Completed, Paid) may have an empty tasks list. "
        "TASK_CATEGORIES = 4-7 department buckets that a task in this business belongs to (e.g. salon → Front Desk, Service, "
        "Inventory, Finance, HR; coaching → Admissions, Academic, Operations, Finance, HR). Always keep the categories relevant to the industry. "
        "Keep every label 1-3 words, Title Case. Use the industry's real terminology; never force manufacturing terms onto a service business."
    ),
))

# 2026-09-21 — the backfill for companies set up before operating_model v1.1.
# Their stages carry no work, so a card reaching one tells nobody to do
# anything. This fills ONLY the stages it is given; the caller decides which
# (the empty ones) and the owner reviews every suggestion before it is saved.
STAGE_WORK = register(Prompt(
    name="generators.stage_work",
    version="1.0",
    intent="Suggest the concrete work each EMPTY workflow stage needs, for an existing company's operating model.",
    template=(
        "You fill in the WORK for workflow stages inside DecisionOS, for a business that already runs on it. "
        "Each stage you are given is a step that work moves through on a kanban board. When a card reaches the "
        "stage, the tasks you write are created automatically and assigned to that department — so they must be "
        "the concrete, repeatable things somebody must actually DO while work sits at that stage, in this "
        "industry's own words, written as instructions ('Confirm the order quantity with the customer', "
        "'Check stock and reserve it', 'Collect the signed delivery note'). Never restate the stage name "
        "('Do the cooking' for a Cooking stage is useless). Give 1-3 tasks per stage. A final stage that is purely "
        "a resting state (Delivered, Completed, Paid) may get an empty list. Set each task's \"role\" to the "
        "department that does it — one of the department slugs you are given, usually the stage's own — or '' if "
        "none fits. Use ONLY the stages you are given, with their exact pipeline and stage keys. "
        "Return ONLY valid JSON, no prose, EXACTLY this shape: "
        '{"stages": [{"pipeline_key": str, "stage_key": str, '
        '"tasks": [{"title": str, "role": role_slug_or_empty}]}]}.'
    ),
))

FINANCE_CATEGORIES = register(Prompt(
    name="generators.finance_categories",
    version="1.0",
    intent="Generate industry-specific finance bookkeeping categories (expense + fixed-asset).",
    template=(
        "You define the finance bookkeeping CATEGORIES a specific business uses to tag its money. "
        'Return ONLY valid JSON, no prose, EXACTLY: {"expense": [array of strings], "asset": [array of strings]}. '
        "expense = the recurring operating cost buckets THIS business actually incurs — be industry-specific "
        "(a salon → 'Salon Consumables','Stylist Commissions','Rent'; a restaurant → 'Ingredients','Kitchen Fuel','Delivery Fees'; "
        "a software firm → 'Cloud Hosting','Software Subscriptions','Contractor Fees'; a textile mill → 'Raw Cotton','Dyeing & Finishing','Power'). "
        "asset = the types of long-life capital items this business buys (e.g. 'Salon Equipment','Kitchen Equipment','Computers & IT','Vehicles','Machinery'). "
        "Give 8-12 expense and 5-8 asset categories. Keep each 1-3 words, Title Case, no duplicates. Do NOT include 'Other' (it is added automatically). "
        "Use the industry's real terminology; never invent nonsense."
    ),
))
