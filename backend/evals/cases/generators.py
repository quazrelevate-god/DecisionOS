"""Golden cases for generators.* -- the onboarding AI that tailors the app's
vocabulary, operating model, and finance categories to a tenant's industry.

These functions always run their output through a normalizer, so the checks
verify BOTH that a good response survives intact AND that the normalized shape
(the contract the rest of the app depends on) holds.
"""
from evals.base import register, EvalCase, nonempty_str, nonempty_list, each_item, key_present, predicate
from services.ai.generators import (
    ai_generate_lexicon, ai_generate_operating_model, ai_generate_finance_categories,
)


register(EvalCase(
    task="generators.lexicon", name="industry_vocabulary",
    fn=ai_generate_lexicon,
    kwargs={"industry": "jewellery retail", "company_size": "10-50",
            "description": "boutique gold jewellery showroom"},
    golden="""{"customer_singular": "Client", "customer_plural": "Clients",
      "vendor_singular": "Karigar", "vendor_plural": "Karigars",
      "task_types": {"operational": "Showroom", "sales": "Sales", "purchase": "Sourcing",
                     "production": "Making", "finance": "Accounts", "hr": "People"}}""",
    checks=[
        nonempty_str("customer_singular"), nonempty_str("vendor_singular"),
        predicate("task_types has all 6 keys", lambda r: set(r["task_types"]) ==
                  {"operational", "sales", "purchase", "production", "finance", "hr"}),
    ],
    note="Lexicon: AI vocabulary merges over defaults; the 6 task_type keys are always present.",
))


register(EvalCase(
    task="generators.operating_model", name="pipelines_and_categories",
    fn=ai_generate_operating_model,
    kwargs={"industry": "cloud kitchen", "company_size": "10-50",
            "description": "multi-brand delivery-only kitchen"},
    golden="""{"pipelines": [
        {"key": "orders", "label": "Orders", "stages": [
            {"key": "received", "label": "Received"}, {"key": "cooking", "label": "Cooking"},
            {"key": "packed", "label": "Packed"}, {"key": "dispatched", "label": "Dispatched"}]},
        {"key": "procurement", "label": "Procurement", "stages": [
            {"key": "requested", "label": "Requested"}, {"key": "received", "label": "Received"}]}],
      "task_categories": [{"key": "kitchen", "label": "Kitchen"}, {"key": "sales", "label": "Sales"}]}""",
    checks=[
        nonempty_list("pipelines"), nonempty_list("task_categories"),
        each_item("pipelines", key_present("key"), nonempty_str("label"), nonempty_list("stages")),
        each_item("task_categories", key_present("key"), nonempty_str("label")),
    ],
    note="Operating model: normalized pipelines (each with stages) + task categories; never empty.",
))

register(EvalCase(
    task="generators.operating_model", name="empty_response_defaults",
    fn=ai_generate_operating_model,
    kwargs={"industry": "", "description": ""},
    golden="""{"pipelines": [], "task_categories": []}""",
    checks=[
        nonempty_list("pipelines"),
        nonempty_list("task_categories"),
    ],
    note="An empty model response must fall back to the default manufacturing operating model.",
))


register(EvalCase(
    task="generators.finance_categories", name="expense_and_asset_lists",
    fn=ai_generate_finance_categories,
    kwargs={"industry": "logistics", "company_size": "50-200",
            "description": "regional trucking and warehousing"},
    golden="""{"expense": ["Fuel", "Toll & Parking", "Vehicle Maintenance", "Driver Wages", "Warehouse Rent"],
      "asset": ["Trucks", "Forklifts", "Warehouse Racking"]}""",
    checks=[
        nonempty_list("expense"), nonempty_list("asset"),
        predicate("expense ends with Other", lambda r: r["expense"][-1] == "Other"),
        predicate("asset ends with Other", lambda r: r["asset"][-1] == "Other"),
    ],
    note="Finance categories: expense + asset lists, each de-duped and always terminated by 'Other'.",
))
