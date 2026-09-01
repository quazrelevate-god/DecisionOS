"""A diverse, realistic Company Brain for a textile/garment SME (Weave Co) --
shared by the offline (test_s9_brain_rag.py) and live (RUN_LIVE_LLM) RAG tests.

Different SOURCE TYPES (policy / SOP / contract / filing / report / note),
different DEPARTMENTS, and different VISIBILITY levels (public / dept / private
with roles_allowed) so retrieval, citation-provenance, and RBAC can all be
exercised on one corpus. Plus brain_context provenance ("how we handled X
before") which is a SEPARATE store from the uploaded documents.
"""

TENANT = "brain-weaveco"
OWNER = "u-owner"

# --- uploaded documents (brain_documents + embedded chunks) -----------------
# body is what _read_reference_text would return; kept plain-text so no OCR.
DOCS = [
    {
        "id": "leave_policy", "title": "Employee Leave Policy", "kind": "policy",
        "department": "hr", "visibility": "public", "roles_allowed": [],
        "body": "Weave Co Leave Policy. Every permanent employee is entitled to 12 casual "
                "leaves and 6 sick leaves per year. Maternity leave is 26 weeks fully paid. "
                "Leave must be approved by the reporting manager at least 3 days in advance. "
                "Unused casual leaves lapse on 31 December and are not carried forward.",
    },
    {
        "id": "refund_policy", "title": "Customer Refund and Return Policy", "kind": "policy",
        "department": "sales", "visibility": "public", "roles_allowed": [],
        "body": "Customer returns are accepted within 15 days of delivery with the original "
                "tax invoice. Defective or damaged fabric qualifies for a full refund or a "
                "free replacement. Cut-to-size and custom-dyed orders are non-returnable. "
                "Refunds are processed to the original payment method within 7 working days.",
    },
    {
        "id": "dispatch_sop", "title": "Order Dispatch SOP", "kind": "sop",
        "department": "operations", "visibility": "public", "roles_allowed": [],
        "body": "Standard Operating Procedure for dispatch. Orders are dispatched within 48 "
                "hours of payment confirmation. A quality-control inspection of every roll is "
                "mandatory before packing. Consignments above 500 kg move by vendor truck; the "
                "LR (lorry receipt) number must be recorded in the system before the truck leaves.",
    },
    {
        "id": "sharma_contract", "title": "Sharma Textiles Supply Agreement", "kind": "contract",
        "department": "procurement", "visibility": "dept", "roles_allowed": [],
        "body": "Supply agreement with Sharma Textiles (vendor). Payment terms are net-30 from "
                "invoice date. A late-payment fee of 2 percent per month applies beyond 30 days. "
                "Minimum order quantity is 500 meters. Prices are locked for 12 months from "
                "January 2026. Either party may terminate with 60 days written notice.",
    },
    {
        "id": "gst_filing", "title": "GST Filing Procedure FY26", "kind": "filing",
        "department": "finance", "visibility": "private", "roles_allowed": ["finance", "ledger"],
        "body": "GST compliance for FY26. GSTR-1 is filed monthly by the 11th and GSTR-3B by "
                "the 20th. Input tax credit is reconciled every quarter against GSTR-2B. The "
                "company GSTIN is 33AABCW1234R1Z9. Any mismatch above 5 percent is escalated to "
                "the CA before filing.",
    },
    {
        "id": "q3_review", "title": "Q3 FY26 Business Review", "kind": "report",
        "department": "finance", "visibility": "private", "roles_allowed": ["finance"],
        "body": "Q3 FY26 review. Revenue was 48 lakh rupees, up 12 percent year on year. The "
                "top customer was Kapoor Retail at 8 lakh. The cotton-nylon blend line was the "
                "best seller. Machine downtime averaged 4 percent; preventive maintenance is "
                "recommended for the looms next quarter.",
    },
    {
        "id": "safety_note", "title": "Factory Floor Safety Note", "kind": "note",
        "department": "operations", "visibility": "public", "roles_allowed": [],
        "body": "Factory floor safety. Ear protection is mandatory near the looms. A fire drill "
                "is conducted on the first Monday of every month. A first-aid box is stationed at "
                "each work station. Report any machine fault to the floor supervisor immediately.",
    },
    {
        "id": "pricing_note", "title": "Wholesale Pricing and Discounts", "kind": "note",
        "department": "sales", "visibility": "dept", "roles_allowed": [],
        "body": "Wholesale pricing. A 5 percent discount applies on orders above 1000 meters and "
                "10 percent above 5000 meters. Retail MRP is fixed and not negotiable. No extra "
                "discount is given during the festival season as demand is already high.",
    },
]

# --- decision provenance (brain_context -- 'how we handled X before') --------
CONTEXTS = [
    {
        "kind": "finance", "title": "Held Kumar Garments order over overdue payment",
        "outcome": "cleared in 8 days",
        "why": "Kumar Garments had 1.68 lakh overdue beyond 30 days, so we held their new order "
               "until it cleared. Sunitha followed up daily; payment arrived in 8 days and the "
               "order was released.",
        "department": "finance", "visibility": "public",
    },
    {
        "kind": "decision", "title": "Pre-produced cotton-nylon stock for Diwali",
        "outcome": "sold out",
        "why": "For Diwali 2025 we pre-produced 2000 pieces of the cotton-nylon blend ahead of "
               "demand. It sold out within two weeks. Decision: repeat the pre-production every "
               "festival season.",
        "department": "operations", "visibility": "public",
    },
    {
        "kind": "resolution", "title": "Fixed loom number 3 recurring downtime",
        "outcome": "downtime 4pct to 1pct",
        "why": "Loom number 3 was the main source of machine downtime. We replaced its drive belt "
               "and added a monthly grease schedule; downtime dropped from 4 percent to 1 percent.",
        "department": "operations", "visibility": "public",
    },
]

# --- scenarios: question -> the ONE source that should be cited --------------
# Each question is answerable from exactly one document, for a clean citation assertion.
DOC_SCENARIOS = [
    ("how many casual leaves do employees get in a year", "leave_policy"),
    ("can a customer return defective fabric for a refund", "refund_policy"),
    ("how quickly must orders be dispatched after payment", "dispatch_sop"),
    ("what are the payment terms in the Sharma Textiles contract", "sharma_contract"),
    ("when is GSTR-3B filed each month", "gst_filing"),
    ("what was our revenue in the Q3 review", "q3_review"),
    ("what safety gear is required near the looms", "safety_note"),
    ("what wholesale discount applies above 5000 meters", "pricing_note"),
]

# provenance questions -> a distinctive substring of the expected context title
CONTEXT_SCENARIOS = [
    ("how did we handle Kumar Garments overdue payment last time", "Kumar Garments"),
    ("what did we decide about Diwali production", "Diwali"),
    ("how did we fix the loom downtime problem", "loom"),
]

# questions with NO supporting document -- must not fabricate a citation
NEGATIVE_QUESTIONS = [
    "what is the capital of France",
    "who won the cricket world cup in 2011",
    "what is the boiling point of water",
]

# RBAC: (role, question, expected_doc_id, should_retrieve)
# a finance-private doc must be invisible to sales/operations, visible to finance/owner.
RBAC_SCENARIOS = [
    ("finance", "when is GSTR-3B filed", "gst_filing", True),
    ("owner", "when is GSTR-3B filed", "gst_filing", True),
    ("sales", "when is GSTR-3B filed", "gst_filing", False),
    ("operations", "what was Q3 revenue", "q3_review", False),
]


def doc_record(d):
    """A full brain_documents row for Mongo (mirrors routers/brain_docs.upload_document)."""
    from shared.ids import now_iso
    kw = " ".join([d["title"], d["kind"], d["department"], d["body"]]).lower().split()
    return {
        "id": d["id"], "tenant_id": TENANT, "title": d["title"], "kind": d["kind"],
        "tags": [], "department": d["department"], "visibility": d["visibility"],
        "roles_allowed": d["roles_allowed"], "summary": d["body"][:160],
        "keywords": sorted(set(w.strip(".,()") for w in kw if len(w) > 3)),
        "storage_path": f"x/{d['id']}.txt", "original_filename": f"{d['id']}.txt",
        "content_type": "text/plain", "size": len(d["body"]),
        "uploaded_by": OWNER, "is_deleted": False,
        "created_at": now_iso(), "updated_at": now_iso(),
    }


def bodies():
    return {d["id"]: d["body"] for d in DOCS}
