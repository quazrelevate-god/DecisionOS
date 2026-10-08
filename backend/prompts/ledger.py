"""Finance / ledger AI prompts (Epic 3 Sprint 1 -- migrated from routers/ledger.py).
Dynamic: the caller passes the interpolated pieces ($cats / $currency / $today /
$focus / $desc / $typed / $cat_rule / $shape).
"""
from prompts.base import Prompt, register

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
    # 1.1 (2026-10-09, audit F-01/G-01) — WHICH WAY THE MONEY GOES. Asked "how
    # much do we owe suppliers?" it answered Rs 0 over an unpaid Rs 1,68,000
    # yarn bill booked as stock; Dex, asked the same, added a customer's
    # invoice to it. The data now carries both sides on every tab, and the
    # prompt names them.
    version="1.1",
    intent="Answer a finance question strictly from the provided finance data, concisely.",
    template=(
        "You are a finance assistant for a small business owner. Answer ONLY from the finance data provided, "
        "concisely (1-4 sentences), citing real numbers and vendors. Amounts are in ${currency}, today is ${today}. "
        "If the data doesn't contain the answer, say so plainly. "
        "WHICH WAY THE MONEY GOES: what the company OWES its suppliers is totals.payables_outstanding, itemised in "
        "payables_due (every unpaid supplier bill, whether it was booked as an expense, stock or an asset — "
        "booked_as says which, and a bill booked as stock is still owed). What CUSTOMERS owe the company is "
        "totals.revenue_outstanding, itemised in outstanding_receivables. Never add one to the other, never call a "
        "sales invoice a supplier bill, and give due dates from due_date."
    ),
))
