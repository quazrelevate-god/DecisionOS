"""Golden case for documents.purchase_class -- classifies a purchase bill's
what-was-bought bucket (expense / asset / inventory / unknown) so the ledger
can file it to the right book.
"""
from evals.base import register, EvalCase, one_of, predicate
from services.ingestion import ai_classify_purchase


register(EvalCase(
    task="documents.purchase_class", name="asset_purchase",
    fn=ai_classify_purchase,
    kwargs={
        "text": "Tax invoice: 1x CNC lathe machine, Rs 4,50,000, from Precision Tools Pvt Ltd.",
        "expense_categories": ["Rent", "Utilities", "Repairs"],
        "asset_categories": ["Machinery", "Vehicles", "IT Equipment"],
    },
    golden="""{"purchase_type": "asset", "asset_name": "CNC lathe machine",
      "asset_category": "Machinery", "expense_category": ""}""",
    checks=[
        one_of("purchase_type", ["expense", "asset", "inventory", "unknown"]),
        predicate("asset_name is str", lambda r: isinstance(r["asset_name"], str)),
    ],
    note="Purchase classification: purchase_type stays within the 4-value enum.",
))

register(EvalCase(
    task="documents.purchase_class", name="unknown_type_coerced",
    fn=ai_classify_purchase,
    kwargs={"text": "misc bill", "expense_categories": None, "asset_categories": None},
    golden="""{"purchase_type": "capital_goods"}""",
    checks=[
        predicate("out-of-enum type -> 'unknown'", lambda r: r["purchase_type"] == "unknown"),
    ],
    note="An out-of-enum purchase_type is coerced to 'unknown' so the ledger asks the user.",
))

register(EvalCase(
    task="documents.purchase_class", name="expense_purchase",
    fn=ai_classify_purchase,
    kwargs={
        "text": "Electricity bill - TNEB, billing period Aug 2026, amount Rs 8,450. Consumer no 123.",
        "expense_categories": ["Utilities", "Rent", "Repairs"],
        "asset_categories": ["Machinery", "Vehicles"],
    },
    golden="""{"purchase_type": "expense", "expense_category": "Utilities",
      "asset_name": "", "asset_category": ""}""",
    checks=[
        predicate("classified as expense", lambda r: r["purchase_type"] == "expense"),
        predicate("expense_category is str", lambda r: isinstance(r["expense_category"], str)),
    ],
    note="Labeled set: a recurring utility bill is an expense, not an asset/inventory.",
))

register(EvalCase(
    task="documents.purchase_class", name="inventory_purchase",
    fn=ai_classify_purchase,
    kwargs={
        "text": "Purchase bill: 500 kg raw cotton @ Rs 90/kg from Fibre Mills, for production stock.",
        "expense_categories": ["Utilities", "Repairs"],
        "asset_categories": ["Machinery"],
    },
    golden="""{"purchase_type": "inventory", "inventory_qty": 500, "inventory_unit": "kg",
      "asset_name": "", "asset_category": "", "expense_category": ""}""",
    checks=[
        predicate("classified as inventory", lambda r: r["purchase_type"] == "inventory"),
        predicate("qty carried through", lambda r: r.get("inventory_qty") in (500, 500.0)),
    ],
    note="Labeled set: raw material bought as stock is inventory, with quantity/unit preserved.",
))
