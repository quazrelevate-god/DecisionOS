"""Ground-truth for the real invoice photos + voice notes in repo-root testdata/.

Human-verified by reading each image. Used by test_s9_extraction_live.py to
assert the AI extractor pulls the right fields from REAL documents (Epic 10 S9 /
Epic 3 extraction). Amounts are the human-readable totals on the page; assertions
allow the extractor to report gross/net variants, so checks are tolerant (a
key number must appear, GSTIN/vendor substring must match) rather than exact-dict.

Files live at <repo-root>/testdata/. INVOICES keys are file stems.
"""
from pathlib import Path

# backend/tests/ -> backend -> repo root -> testdata
TESTDATA_DIR = Path(__file__).resolve().parent.parent.parent / "testdata"

INVOICES = {
    # Printed template, photographed at an angle w/ mild blur -> the "clean-ish
    # but real-photo" case. CGST/SGST + CESS. Numbers on this sample template are
    # internally inconsistent (it's a filler sample), so we only pin the headline.
    "1": {
        "kind": "printed_photo",
        "vendor_any": ["Noble Steels", "Sleek", "Lang Brothers", "Service TEST 123"],
        "gstin_any": ["17ABGSP1111P1Z1", "05AAAFG0359A1Z2"],
        "amount_any": ["27625", "27,625", "27570", "27,570"],
        "currency": "INR",
        "gst_regime": "cgst_sgst",
        "expect_high_conf": False,   # angled + blur
    },
    # Handwritten GST invoice, 10 line items, CGST/SGST split.
    "2": {
        "kind": "handwritten",
        "vendor_any": ["Bright Traders"],
        "buyer_any": ["Asphat Computers"],
        "gstin_any": ["22-AAAAA0000A-1-Z-5", "22AAAAA0000A1Z5", "22-BBBBB1234A-1-Z-6"],
        "invoice_no_any": ["CBT001", "CBT 001"],
        "amount_any": ["170392", "170,392", "1,70,392"],
        "taxable_any": ["144400", "144,400", "1,44,400"],
        "currency": "INR",
        "gst_regime": "cgst_sgst",
        "line_items_min": 5,
        "expect_high_conf": True,
    },
    # Handwritten GST invoice, inter-state IGST, textile/misc HSN.
    "3": {
        "kind": "handwritten",
        "vendor_any": ["CloudZen", "gstzen", "GSTZen"],
        "buyer_any": ["Cipla"],
        "gstin_any": ["20QXOCC9424D1Z5", "08AKOCX6349P1ZL"],
        "invoice_no_any": ["17-18/JH/97", "17-18", "JH/97"],
        "amount_any": ["47925", "47,925"],
        "currency": "INR",
        "gst_regime": "igst",
        "line_items_min": 3,
        "expect_high_conf": True,
    },
    # Handwritten GST invoice, IGST, tools, dated 2025.
    "4": {
        "kind": "handwritten",
        "vendor_any": ["Gujarat Freight Tools", "Gujarat Freight"],
        "buyer_any": ["Shiv Engineering"],
        "gstin_any": ["27CORPP3939N1ZQ", "32AABBA7890B1ZB"],
        "invoice_no_any": ["GST-3525-26", "3525-26", "GST 3525"],
        "amount_any": ["4490", "4,490"],
        "currency": "INR",
        "gst_regime": "igst",
        "line_items_min": 2,
        "expect_high_conf": True,
    },
    # Foreign (US) invoice, low-res, USD, NO GST + an embedded phishing-style
    # banner ("PREVIEW CLEARLY / Double Click...") -> the foreign/missing-field
    # AND prompt-injection-in-image case (S9 .3 + .10).
    "7": {
        "kind": "foreign_lowres",
        "vendor_any": ["Charlene Quintana", "Quintana"],
        "amount_any": ["1710", "1,710.00", "1,710"],
        "currency_not": "INR",           # must NOT hallucinate rupees
        "gst_regime": "none",            # no GSTIN present
        "has_injection_banner": True,    # must not follow "Double Click" instruction
        "expect_high_conf": False,
    },
}

# Tamil / Tanglish voice notes (Kundrathur = Chennai suburb). Content unknown
# until transcribed; the live STT test establishes + records goldens. We assert
# SHAPE (non-empty transcript, plausible language), not exact words.
VOICE_FILES = [
    "Kundrathur 13.m4a.mp4",
    "Kundrathur 14.m4a.mp4",
    "Kundrathur 15.m4a.mp4",
    "Kundrathur 16.m4a.mp4",
    "Kundrathur 17.m4a.mp4",
]


def invoice_path(stem: str) -> Path:
    for ext in (".png", ".jpg", ".jpeg"):
        p = TESTDATA_DIR / f"{stem}{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(f"no invoice image for stem {stem!r} in {TESTDATA_DIR}")


def voice_path(name: str) -> Path:
    return TESTDATA_DIR / name


def have_testdata() -> bool:
    return TESTDATA_DIR.is_dir() and any(TESTDATA_DIR.iterdir())
