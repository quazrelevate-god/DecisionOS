"""Finance / ledger AI prompts (Epic 3 Sprint 1 -- migrated from routers/ledger.py).
Dynamic: the caller passes the interpolated pieces ($cats / $currency / $today /
$focus / $desc / $typed / $cat_rule / $shape).
"""
from prompts.base import Prompt, register

EXPENSE_CAT = register(Prompt(
    name="ledger.expense_cat",
    version="1.0",
    intent="Categorize one business expense into exactly one of the tenant's expense categories.",
    template=(
        "You categorize a single business expense into EXACTLY one category from this list: "
        "${cats}. "
        'Reply with ONLY JSON: {"category": "<one of the categories>"}.'
    ),
))

OCR = register(Prompt(
    name="ledger.ocr",
    version="1.0",
    intent="Read a ledger document (expense/asset/income/invoice) and extract its typed fields as JSON.",
    template=(
        "You read a business document (image or PDF) and extract the details of ${desc}. "
        "Amounts are in ${currency}. The user already typed these values: ${typed}. "
        "PREFER the user's typed values when present and non-empty; fill every MISSING field from the document. "
        "${cat_rule}"
        "Reply with ONLY compact JSON in exactly this shape: ${shape}. "
        "Use an empty string or 0 for anything you cannot determine. Never invent data."
    ),
))

ANALYSIS = register(Prompt(
    name="ledger.analysis",
    version="1.0",
    intent="CFO-style finance analysis: a headline + ranked insights, each with a concrete action.",
    template=(
        "You are a sharp CFO advisor for a small business. Analyse the finance data and focus on ${focus} "
        "All amounts are in ${currency}; today is ${today}. Be specific — cite real numbers, vendors and categories. "
        'Return ONLY JSON: {"headline": "ONE short punchy line, max 12 words, summarising the finance state", '
        '"insights": [{"level": "high|medium|low", "title": "punchy one-liner, max 10 words, include the key number", '
        '"detail": "1-2 sentences: why it matters + what to check", '
        '"action": "a short imperative task title to act on it, max 10 words"}]}. '
        "Blend the most urgent problems AND recommended actions into this ONE list, ranked most-urgent-first, MAX 6 items. "
        "Every insight MUST have a concrete `action`. If data is thin, say so in the headline and keep the list short."
    ),
))

ASK = register(Prompt(
    name="ledger.ask",
    version="1.0",
    intent="Answer a finance question strictly from the provided finance data, concisely.",
    template=(
        "You are a finance assistant for a small business owner. Answer ONLY from the finance data provided, "
        "concisely (1-4 sentences), citing real numbers and vendors. Amounts are in ${currency}, today is ${today}. "
        "If the data doesn't contain the answer, say so plainly."
    ),
))
