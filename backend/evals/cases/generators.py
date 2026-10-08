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


# Audit B-01 (2026-10-08): the interview's approval rules -> settings on real keys.
from services.ai.approval_rules import structure_approval_rules  # noqa: E402

_AR_TEAMS = [{"key": "sales_&_buyer_management", "label": "Sales & Buyer Management"}, {"key": "hr", "label": "HR"}]
_AR_PIPES = [{"key": "order_fulfillment", "label": "Order Fulfillment",
              "stages": [{"key": "inquiry", "label": "Inquiry"}, {"key": "order_confirmed", "label": "Order Confirmed"}]}]
_AR_RULES = [{"name": "Order confirmation", "description": "Sales confirms orders up to 5 lakh; above that the owner"},
             {"name": "Leave", "description": "The HR manager approves leave"},
             {"name": "Discounts", "description": "Discounts over 5% need the owner"}]

register(EvalCase(
    task="generators.approval_rules", name="interview_rules_to_settings",
    fn=structure_approval_rules,
    kwargs={"rules": _AR_RULES, "teams": _AR_TEAMS, "pipelines": _AR_PIPES},
    golden="""{"actions": [
        {"rule": "Order confirmation", "kind": "stage_limit", "pipeline": "order_fulfillment",
         "stage": "order_confirmed", "team": "sales_&_buyer_management", "up_to": 500000},
        {"rule": "Leave", "kind": "leave_approver", "team": "hr", "for_teams": ["*"]},
        {"rule": "Discounts", "kind": "note", "reason": "No discount setting"},
        {"rule": "Made up", "kind": "money_threshold", "amount": 1}]}""",
    checks=[
        predicate("one action per real rule, none invented", lambda r: sorted(a["rule"] for a in r) ==
                  ["Discounts", "Leave", "Order confirmation"]),
        predicate("the order limit is a stage_limit on real keys", lambda r: any(
            a["kind"] == "stage_limit" and a["stage"] == "order_confirmed" and a["up_to"] == 500000 for a in r)),
        predicate("HR approves leave", lambda r: any(a["kind"] == "leave_approver" and a["team"] == "hr" for a in r)),
    ],
    note="Approval rules: every rule accounted for; only the company's own team/stage keys survive.",
))


# Audit B-03 (2026-10-09): a sign-off before work LEAVES a stage, only above a value.
_AR_PIPES_QC = [{"key": "order_fulfillment", "label": "Order Fulfillment",
                 "stages": [{"key": "in_production", "label": "In Production"},
                            {"key": "quality_check", "label": "Quality Check"},
                            {"key": "dispatched", "label": "Dispatched"}]}]

register(EvalCase(
    task="generators.approval_rules", name="sign_off_after_a_stage_above_a_value",
    fn=structure_approval_rules,
    kwargs={"rules": [{"name": "Big orders after QC",
                       "description": "Any order over 2 lakh needs my OK after quality check before it is dispatched"}],
            "teams": _AR_TEAMS, "pipelines": _AR_PIPES_QC},
    golden="""{"actions": [{"rule": "Big orders after QC", "kind": "stage_signoff", "pipeline": "order_fulfillment",
                            "stage": "quality_check", "team": "owner", "above": 200000}]}""",
    checks=[
        predicate("a stage sign-off by the owner on the QC stage, above 2 lakh", lambda r: any(
            a["kind"] == "stage_signoff" and a["stage"] == "quality_check" and a["team"] == "owner"
            and a.get("above") == 200000 for a in r)),
    ],
    note="B-03: 'over 2 lakh needs my OK after QC' is a value gate on leaving QC, not a note.",
))
