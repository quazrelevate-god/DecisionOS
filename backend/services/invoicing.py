"""Invoices a company can actually send (audit F-03, 2026-10-08).

"Income" recorded a sale — what for, how much, who — but could not produce the
document the buyer is owed: no line items, no GST, no HSN/SAC, no bank
details, no PDF, and amounts only in rupees, so an export sale to a UK buyer
had nowhere to go. This module is the arithmetic and the paper:

  * compute_invoice() — line items -> taxable value, GST per line, and the
    split the law asks for: CGST + SGST inside the seller's state, IGST across
    states, nothing on an export under LUT (zero-rated), in the invoice's own
    currency.
  * amount_in_words() — "Rupees One Lakh Sixty-Eight Thousand Only" (Indian
    grouping for rupees, international for other currencies).
  * invoice_pdf() — an A4 tax invoice with the company header, the buyer, the
    items table, the tax lines, the total in words and the bank details.

Pure functions only: the router (routers/invoicing.py) reads and writes.
"""
import io
from datetime import date as _date
from typing import Any, Dict, List, Optional

EXPORT = "Export (outside India)"

# GST state names (the "place of supply" list). Two-digit GST state codes.
STATES = {
    "Jammu and Kashmir": "01", "Himachal Pradesh": "02", "Punjab": "03", "Chandigarh": "04",
    "Uttarakhand": "05", "Haryana": "06", "Delhi": "07", "Rajasthan": "08", "Uttar Pradesh": "09",
    "Bihar": "10", "Sikkim": "11", "Arunachal Pradesh": "12", "Nagaland": "13", "Manipur": "14",
    "Mizoram": "15", "Tripura": "16", "Meghalaya": "17", "Assam": "18", "West Bengal": "19",
    "Jharkhand": "20", "Odisha": "21", "Chhattisgarh": "22", "Madhya Pradesh": "23", "Gujarat": "24",
    "Dadra and Nagar Haveli and Daman and Diu": "26", "Maharashtra": "27", "Karnataka": "29",
    "Goa": "30", "Lakshadweep": "31", "Kerala": "32", "Tamil Nadu": "33", "Puducherry": "34",
    "Andaman and Nicobar Islands": "35", "Telangana": "36", "Andhra Pradesh": "37", "Ladakh": "38",
}
GST_RATES = (0, 0.25, 3, 5, 12, 18, 28)


def _r2(x: float) -> float:
    return round(float(x) + 0.0, 2)


def _norm_state(s: Optional[str]) -> str:
    s = (s or "").strip()
    if s.lower().startswith("export") or s.lower() in ("outside india", "overseas"):
        return EXPORT
    for name in STATES:
        if name.lower() == s.lower():
            return name
    return s


def tax_mode(seller_state: Optional[str], place_of_supply: Optional[str], currency: str = "INR") -> str:
    """'export' | 'intra' (CGST+SGST) | 'inter' (IGST)."""
    pos = _norm_state(place_of_supply)
    if pos == EXPORT or (currency or "INR").upper() != "INR":
        return "export"
    seller = _norm_state(seller_state)
    if not pos or not seller or pos == seller:
        return "intra"
    return "inter"


def compute_invoice(items: List[Dict[str, Any]], *, seller_state: Optional[str],
                    place_of_supply: Optional[str], currency: str = "INR") -> Dict[str, Any]:
    """Line items -> the invoice's numbers. Each item: description, hsn, qty,
    unit, rate, gst_rate. An export carries no GST (zero-rated under LUT)."""
    mode = tax_mode(seller_state, place_of_supply, currency)
    lines, taxable, cgst, sgst, igst = [], 0.0, 0.0, 0.0, 0.0
    for it in items or []:
        desc = str(it.get("description") or "").strip()
        qty = float(it.get("qty") or 0)
        rate = float(it.get("rate") or 0)
        if not desc or qty <= 0 or rate < 0:
            continue
        gst_rate = 0.0 if mode == "export" else float(it.get("gst_rate") or 0)
        value = _r2(qty * rate)
        tax = _r2(value * gst_rate / 100)
        line = {"description": desc[:200], "hsn": str(it.get("hsn") or "").strip()[:12],
                "qty": qty, "unit": str(it.get("unit") or "").strip()[:12], "rate": _r2(rate),
                "gst_rate": gst_rate, "taxable": value, "tax": tax, "amount": _r2(value + tax)}
        if mode == "intra":
            half = _r2(tax / 2)
            line["cgst"], line["sgst"] = half, _r2(tax - half)
            cgst += line["cgst"]
            sgst += line["sgst"]
        elif mode == "inter":
            line["igst"] = tax
            igst += tax
        lines.append(line)
        taxable += value
    tax_total = _r2(cgst + sgst + igst)
    gross = _r2(taxable + tax_total)
    # Rupee invoices are rounded to the rupee, with the difference shown.
    total = float(round(gross)) if (currency or "INR").upper() == "INR" else gross
    return {"line_items": lines, "tax_mode": mode, "subtotal": _r2(taxable),
            "cgst": _r2(cgst), "sgst": _r2(sgst), "igst": _r2(igst), "tax_total": tax_total,
            "round_off": _r2(total - gross), "amount": _r2(total)}


def financial_year(d: Optional[str] = None) -> str:
    """Indian financial year (April-March) as '26-27'."""
    try:
        dt = _date.fromisoformat(str(d)[:10]) if d else _date.today()
    except ValueError:
        dt = _date.today()
    start = dt.year if dt.month >= 4 else dt.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def default_prefix(company_name: str) -> str:
    words = [w for w in "".join(ch if ch.isalnum() else " " for ch in (company_name or "")).split() if w]
    return ("".join(w[0] for w in words[:3]) or "INV").upper()


# --- amount in words --------------------------------------------------------------------
_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
         "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
_CURRENCY_WORDS = {"INR": ("Rupees", "Paise"), "USD": ("US Dollars", "Cents"), "GBP": ("Pounds", "Pence"),
                   "EUR": ("Euros", "Cents"), "AED": ("Dirhams", "Fils"), "SGD": ("Singapore Dollars", "Cents")}


def _two(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return _TENS[n // 10] + ("-" + _ONES[n % 10] if n % 10 else "")


def _three(n: int) -> str:
    h, rest = divmod(n, 100)
    out = (_ONES[h] + " Hundred") if h else ""
    if rest:
        out += (" and " if h else "") + _two(rest)
    return out


def _indian(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for size, name in ((10 ** 7, "Crore"), (10 ** 5, "Lakh"), (1000, "Thousand")):
        q, n = divmod(n, size)
        if q:
            parts.append(f"{_indian(q) if q >= 100 else _two(q)} {name}")
    if n:
        parts.append(_three(n))
    return " ".join(parts)


def _international(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for size, name in ((10 ** 9, "Billion"), (10 ** 6, "Million"), (1000, "Thousand")):
        q, n = divmod(n, size)
        if q:
            parts.append(f"{_three(q)} {name}")
    if n:
        parts.append(_three(n))
    return " ".join(parts)


def amount_in_words(amount: float, currency: str = "INR") -> str:
    currency = (currency or "INR").upper()
    major, minor = _CURRENCY_WORDS.get(currency, (currency, "Cents"))
    whole = int(round(float(amount or 0), 2))
    frac = int(round((float(amount or 0) - whole) * 100))
    words = (_indian if currency == "INR" else _international)(whole)
    out = f"{major} {words}"
    if frac:
        out += f" and {_two(frac)} {minor}"
    return out + " Only"


# --- the PDF -----------------------------------------------------------------------------
def _money(v: float, currency: str) -> str:
    v = float(v or 0)
    if (currency or "INR").upper() == "INR":
        # Indian grouping: 1,68,000.00
        neg = v < 0
        whole, dec = f"{abs(v):.2f}".split(".")
        head, tail = whole[:-3], whole[-3:]
        if head:
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            whole = ",".join(groups) + "," + tail
        return ("-" if neg else "") + f"{whole}.{dec}"
    return f"{v:,.2f}"


def _day(d) -> str:
    """'2026-10-08' -> '8 Oct 2026' (as printed on the invoice)."""
    try:
        dt = _date.fromisoformat(str(d)[:10])
    except ValueError:
        return str(d or "")
    return f"{dt.day} {dt.strftime('%b %Y')}"


def invoice_pdf(inv: Dict[str, Any], seller: Dict[str, Any]) -> bytes:
    """An A4 tax invoice. `inv` is the stored invoice; `seller` the company."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    def esc(s):
        return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    cur = (inv.get("currency") or "INR").upper()
    sym = "Rs." if cur == "INR" else cur
    mode = inv.get("tax_mode") or ("intra" if inv.get("cgst") else "inter" if inv.get("igst") else "")
    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8.5, leading=11)
    norm = ParagraphStyle("norm", parent=styles["Normal"], fontSize=9.5, leading=12.5)
    title = "EXPORT INVOICE" if mode == "export" else "TAX INVOICE" if inv.get("line_items") and inv.get("tax_total") is not None else "INVOICE"

    bio = io.BytesIO()
    doc = SimpleDocTemplate(bio, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"{title.title()} {inv.get('number') or ''}".strip())
    el = []
    seller_lines = [f"<b><font size=14>{esc(seller.get('name'))}</font></b>"]
    for part in (seller.get("address"), seller.get("state")):
        if part:
            seller_lines.append(esc(part))
    if seller.get("gst"):
        seller_lines.append(f"GSTIN: {esc(seller.get('gst'))}")
    contact = " · ".join(x for x in (seller.get("phone"), seller.get("support_email")) if x)
    if contact:
        seller_lines.append(esc(contact))
    meta = [f"<b><font size=13>{title}</font></b>",
            f"No. <b>{esc(inv.get('number') or '-')}</b>",
            f"Date: {esc(_day(inv.get('date')))}"]
    if inv.get("due_date"):
        meta.append(f"Due: {esc(_day(inv.get('due_date')))}")
    if inv.get("place_of_supply"):
        meta.append(f"Place of supply: {esc(inv.get('place_of_supply'))}"
                    + (f" ({STATES[inv['place_of_supply']]})" if inv.get("place_of_supply") in STATES else ""))
    head = Table([[Paragraph("<br/>".join(seller_lines), norm), Paragraph("<br/>".join(meta), norm)]],
                 colWidths=[110 * mm, 72 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    # Audit B-12 (2026-10-08): the company's logo above its name, kept to its
    # own proportions inside 40 x 18 mm. A picture that will not draw is left out.
    if seller.get("logo_bytes"):
        try:
            from reportlab.lib.utils import ImageReader
            from reportlab.platypus import Image as RLImage
            img = ImageReader(io.BytesIO(seller["logo_bytes"]))
            w, h = img.getSize()
            scale = min((40 * mm) / w, (18 * mm) / h)
            logo = RLImage(io.BytesIO(seller["logo_bytes"]), width=w * scale, height=h * scale)
            logo.hAlign = "LEFT"
            el += [logo, Spacer(1, 3 * mm)]
        except Exception:
            pass
    el += [head, Spacer(1, 6 * mm)]

    buyer = ["<b>Bill to</b>", f"<b>{esc(inv.get('contact_name') or '-')}</b>"]
    if inv.get("customer_address"):
        buyer.append(esc(inv["customer_address"]).replace("\n", "<br/>"))
    if inv.get("customer_gstin"):
        buyer.append(f"GSTIN: {esc(inv['customer_gstin'])}")
    el += [Paragraph("<br/>".join(buyer), norm), Spacer(1, 5 * mm)]

    items = inv.get("line_items") or []
    if not items:   # an invoice recorded before line items existed: one line, the whole amount
        items = [{"description": inv.get("title") or "Goods / services", "qty": 1, "rate": inv.get("amount"),
                  "taxable": inv.get("amount"), "gst_rate": 0, "tax": 0, "amount": inv.get("amount")}]
    show_tax = mode in ("intra", "inter")
    hdr = ["#", "Description", "HSN/SAC", "Qty", "Rate", "Taxable"] + (["GST %", "Tax"] if show_tax else []) + ["Amount"]
    rows = [hdr]
    for i, it in enumerate(items, 1):
        qty = it.get("qty")
        qtxt = (f"{qty:g}" if isinstance(qty, (int, float)) else str(qty or "")) + (f" {it.get('unit')}" if it.get("unit") else "")
        row = [str(i), Paragraph(esc(it.get("description")), small), esc(it.get("hsn") or ""), qtxt,
               _money(it.get("rate"), cur), _money(it.get("taxable", it.get("amount")), cur)]
        if show_tax:
            row += [f"{float(it.get('gst_rate') or 0):g}%", _money(it.get("tax"), cur)]
        row.append(_money(it.get("amount"), cur))
        rows.append(row)
    # Columns add up to the 182 mm between the margins.
    widths = [7, 50, 16, 18, 20, 22] + ([12, 17] if show_tax else []) + [20]
    if not show_tax:
        widths[1] += 29
    t = Table(rows, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"), ("ALIGN", (3, 0), (-1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#d1d5db")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    el += [t, Spacer(1, 4 * mm)]

    tot = [["Taxable value", f"{sym} {_money(inv.get('subtotal', inv.get('amount')), cur)}"]]
    if mode == "intra":
        tot += [["CGST", f"{sym} {_money(inv.get('cgst'), cur)}"], ["SGST", f"{sym} {_money(inv.get('sgst'), cur)}"]]
    elif mode == "inter":
        tot += [["IGST", f"{sym} {_money(inv.get('igst'), cur)}"]]
    if inv.get("round_off"):
        tot += [["Round off", f"{sym} {_money(inv.get('round_off'), cur)}"]]
    tot += [["Total", f"{sym} {_money(inv.get('amount'), cur)}"]]
    total_row = len(tot) - 1
    if float(inv.get("amount_paid") or 0) > 0:
        tot += [["Paid", f"{sym} {_money(inv.get('amount_paid'), cur)}"],
                ["Balance due", f"{sym} {_money(float(inv.get('amount') or 0) - float(inv.get('amount_paid') or 0), cur)}"]]
    tt = Table(tot, colWidths=[40 * mm, 40 * mm], hAlign="RIGHT")
    tt.setStyle(TableStyle([("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                            ("FONTNAME", (0, total_row), (-1, total_row), "Helvetica-Bold"),
                            ("LINEABOVE", (0, total_row), (-1, total_row), 0.6, colors.black)]))
    el += [tt, Spacer(1, 3 * mm),
           Paragraph(f"<b>Amount in words:</b> {esc(amount_in_words(inv.get('amount') or 0, cur))}", norm)]
    if mode == "export":
        el += [Spacer(1, 2 * mm), Paragraph(
            "Supply meant for export under LUT without payment of integrated tax (IGST).", small)]
    bank = [x for x in (
        f"Bank: {esc(seller.get('bank_name'))}" if seller.get("bank_name") else "",
        f"A/c no: {esc(seller.get('bank_account'))}" if seller.get("bank_account") else "",
        f"IFSC: {esc(seller.get('bank_ifsc'))}" if seller.get("bank_ifsc") else "",
        f"UPI: {esc(seller.get('upi_id'))}" if seller.get("upi_id") else "") if x]
    if bank:
        el += [Spacer(1, 5 * mm), Paragraph("<b>Pay to</b><br/>" + "<br/>".join(bank), norm)]
    if inv.get("notes") or seller.get("invoice_terms"):
        el += [Spacer(1, 4 * mm), Paragraph(
            "<b>Notes</b><br/>" + esc(inv.get("notes") or seller.get("invoice_terms")).replace("\n", "<br/>"), small)]
    el += [Spacer(1, 12 * mm), Paragraph(f"For <b>{esc(seller.get('name'))}</b><br/><br/><br/>Authorised signatory",
                                         ParagraphStyle("sig", parent=norm, alignment=2))]
    doc.build(el)
    return bio.getvalue()
