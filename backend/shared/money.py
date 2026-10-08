"""Money in the words the company uses (moved from routers/desk 2026-10-06 so services
-- services/calculated -- can use it without importing a router)."""


_CUR_SYMBOL = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED ", "SGD": "S$"}


def money_words(amount, currency: str = "INR") -> str:
    """An amount the way the company says it (JOURNEY-1, 2026-09-22): rupees
    in lakh and crore — "₹6.85 lakh" — never "$685,000". The briefing's model
    was handed a bare number and wrote it in dollars on an Indian company's
    Desk."""
    a = float(amount or 0)
    cur = (currency or "INR").upper()
    sym = _CUR_SYMBOL.get(cur, f"{cur} ")
    if cur == "INR":
        if a >= 1e7:
            return f"{sym}{a / 1e7:.2f}".rstrip("0").rstrip(".") + " crore"
        if a >= 1e5:
            return f"{sym}{a / 1e5:.2f}".rstrip("0").rstrip(".") + " lakh"
        whole = f"{int(round(a))}"
        if len(whole) > 3:  # Indian grouping: 12,34,567
            head, tail = whole[:-3], whole[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            whole = ",".join(groups + [tail])
        return f"{sym}{whole}"
    return f"{sym}{a:,.0f}"


# --- One company currency for every total ----------------------------------------
# One company currency for every total (product audit 2026-10-08).
#
# An export invoice of GBP 160 was added to "Revenue billed" as if it were
# Rs 160: every total summed `amount` whatever its currency. A document in
# another currency now carries the rate it was raised at (`fx_rate`, company
# currency per one unit — "1 GBP = 107.50"), and totals add its value in the
# company's currency. One without a rate is NOT guessed at: it is left out of
# the totals and reported (`needs_rate`) so the screen can ask for the rate.
#
# Pure helpers: callers pass the company's currency.
from typing import Any, Dict, Iterable, List, Optional


def _f(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def rate_of(doc: Dict[str, Any], base: str) -> Optional[float]:
    """1 for the company's own currency; the stored rate for another; None
    when another currency has no rate yet."""
    cur = str(doc.get("currency") or base or "INR").upper()
    if cur == str(base or "INR").upper():
        return 1.0
    r = _f(doc.get("fx_rate"))
    return r if r > 0 else None


def in_base(amount, doc: Dict[str, Any], base: str) -> Optional[float]:
    """`amount` (in the document's currency) in the company's currency, or None."""
    r = rate_of(doc, base)
    return None if r is None else round(_f(amount) * r, 2)


def total_in_base(items: Iterable[Dict[str, Any]], base: str, amount_of) -> float:
    """Sum of amount_of(doc) in the company's currency, skipping unconverted docs."""
    out = 0.0
    for d in items:
        v = in_base(amount_of(d), d, base)
        if v is not None:
            out += v
    return round(out, 2)


def needs_rate(items: Iterable[Dict[str, Any]], base: str, amount_of) -> List[Dict[str, Any]]:
    """What was left out of the totals: [{currency, count, amount}] per currency."""
    by: Dict[str, Dict[str, Any]] = {}
    for d in items:
        if rate_of(d, base) is None:
            cur = str(d.get("currency")).upper()
            row = by.setdefault(cur, {"currency": cur, "count": 0, "amount": 0.0})
            row["count"] += 1
            row["amount"] = round(row["amount"] + _f(amount_of(d)), 2)
    return list(by.values())


def as_base_rows(items: Iterable[Dict[str, Any]], base: str, field: str = "amount") -> List[Dict[str, Any]]:
    """Copies of the rows with `field` in the company's currency. Rows in
    another currency with no rate yet are dropped (they are listed by
    needs_rate instead) -- so every sum over the result is one currency."""
    out = []
    for d in items:
        v = in_base(d.get(field), d, base)
        if v is not None:
            out.append({**d, field: v})
    return out
