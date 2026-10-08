"""Document-ingestion prompts (Epic 3 Sprint 1 -- migrated from
services/ingestion.py).

``documents.doc_extract`` and ``documents.csv_map`` keep their literal
``{company}`` / ``{currency}`` markers -- the caller still fills them with
``.replace()`` (they are NOT $-placeholders, and the surrounding JSON braces
mean $-substitution would be error-prone). ``documents.purchase_class`` is a
real template with ``$asset_list`` / ``$expense_list``.
"""
from prompts.base import Prompt, register

DOC_EXTRACT = register(Prompt(
    name="documents.doc_extract",
    # 1.1 (2026-10-08, audit F-05) — GST. A bill showing the supplier's GSTIN
    # and CGST 2.5% + SGST 2.5% came back with neither: the schema had nowhere
    # to put them, so the supplier's GSTIN stayed empty and stock was costed at
    # the price INCLUDING GST (normally claimable input credit).
    version="1.1",
    intent="Read a business document (invoice/bill/receipt/PO) and extract contacts/invoices/payments/tasks JSON.",
    template=(
        "You are the document ingestion engine of DecisionOS, an operating brain for small businesses. "
        "Read the attached business document (a sales invoice, purchase bill, payment receipt, purchase order, "
        "or a photo/WhatsApp screenshot of one) and extract structured operational data. Return ONLY valid JSON, no prose. "
        "Schema: {"
        '"summary": string (one short line describing the document), '
        '"doc_type": one of [sales_invoice, purchase_bill, payment, purchase_order, other], '
        '"confidence": number between 0 and 1, '
        '"contacts": [{"type": one of [customer, vendor], "name": string, "company": string, "phone": string, "email": string, "address": string, "tax_id": string}], '
        '"invoices": [{"type": one of [sales_invoice, purchase_bill], "purchase_type": one of [expense, asset, inventory, unknown] (only for purchase_bill; else empty), "asset_name": string (for asset purchases), "inventory_qty": number, "inventory_unit": string, "number": string, "contact_name": string, "date": string, "due_date": string, "amount": number, "currency": string, "gstin": string, "taxable_value": number or null, "cgst": number or null, "sgst": number or null, "igst": number or null, "tax_total": number or null, "line_items": [{"description": string, "qty": number, "rate": number, "amount": number, "gst_rate": number or null}]}], '
        '"payments": [{"direction": one of [in, out], "amount": number, "date": string, "method": string, "reference": string, "contact_name": string, "invoice_number": string}], '
        '"tasks": [{"title": string, "priority": one of [low,medium,high], "due_in_days": integer or null}]}. '
        'Rules: Our own company (the DecisionOS user filing this) is "{company}". '
        "NEVER create a contact for our own company — only ever extract the OTHER party (the counterparty). "
        "Decide direction by WHO ISSUED the document: if our company is the seller/issuer (the 'from'/'billed by' party), it is a sales_invoice and the counterparty is the buyer (type=customer); "
        "if our company is the buyer/recipient (the 'bill to'/'ship to' party), it is a purchase_bill and the counterparty is the issuer/seller (type=vendor). "
        "The contact_name on every invoice and payment MUST be the counterparty, never our own company. "
        "A sales invoice is money owed TO us by a customer (party type=customer). "
        "A purchase bill is money we owe a vendor/supplier (party type=vendor). "
        "For each purchase_bill, ALSO set purchase_type by WHAT was bought: "
        '"asset" for capital/fixed goods that last over a year (machinery, equipment, tools, vehicles, furniture, computers/IT hardware, buildings) — put the item in asset_name; '
        '"inventory" for stock, raw materials, trading goods or components bought to resell or consume in production — put quantity in inventory_qty and its unit (kg, pcs, box, litre) in inventory_unit; '
        '"expense" for everything else (rent, salaries, utilities, transport, services, consumables, subscriptions, taxes). When unsure, use "expense". '
        "sales_invoice must have purchase_type empty. "
        "For every unpaid invoice or bill, add ONE follow-up task (e.g. 'Collect payment for invoice #123 from Acme' or 'Pay vendor bill #45 to XYZ'). "
        "A payment 'in' reduces a customer receivable; 'out' settles a vendor bill. "
        "GST (Indian documents): read the OTHER party's GSTIN (15 characters, e.g. 33ABCDE1234F1Z5) into both that "
        "contact's tax_id and the invoice's gstin; leave both empty when none is printed, and never put our own "
        "company's GSTIN there. amount is the GRAND TOTAL payable, tax included. taxable_value is the total before GST. "
        "cgst, sgst and igst are the tax AMOUNTS as printed (CGST + SGST within a state, IGST between states) and "
        "tax_total is their sum; gst_rate on a line is its percentage (5 for 5%). When the document shows no GST, "
        "leave all of them null. "
        "Dates as YYYY-MM-DD when readable else empty string. Amounts are plain numbers without currency symbols. "
        "Default currency to {currency}. Documents may be in English, Tamil or Tanglish — understand them and output all values in English. "
        "Use empty arrays where nothing applies."
    ),
))

CSV_MAP = register(Prompt(
    name="documents.csv_map",
    version="1.0",
    intent="Classify a business spreadsheet + map every row to contacts/invoices/payments/tasks JSON.",
    template=(
        "You classify and map spreadsheet data for DecisionOS. Given the column headers and rows of a business spreadsheet, "
        "decide which entity it represents and map EVERY row to structured records. Return ONLY valid JSON, no prose. "
        'Schema: {"entity": one of [customers, vendors, invoices, payments], "summary": string, '
        '"contacts": [{"type": one of [customer, vendor], "name": string, "company": string, "phone": string, "email": string, "address": string, "tax_id": string}], '
        '"invoices": [{"type": one of [sales_invoice, purchase_bill], "number": string, "contact_name": string, "date": string, "due_date": string, "amount": number, "currency": string}], '
        '"payments": [{"direction": one of [in, out], "amount": number, "date": string, "method": string, "reference": string, "contact_name": string, "invoice_number": string}], '
        '"tasks": [{"title": string, "priority": one of [low,medium,high], "due_in_days": integer or null}]}. '
        "If the file is a customer/vendor list, fill 'contacts'. If it lists invoices/bills, fill 'invoices' (and add a follow-up task per unpaid row). "
        'Our own company is "{company}" — NEVER map our own company as a contact; only extract the other parties. '
        "If it lists payments/receipts, fill 'payments'. Map each spreadsheet row to exactly one record. Amounts are plain numbers. "
        "Default currency to {currency}. Use empty arrays for the entities that do not apply."
    ),
))

