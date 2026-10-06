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
