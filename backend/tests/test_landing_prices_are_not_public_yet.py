"""The landing pages do not show prices yet (founder, 2026-10-29): each plan's
price slot says "Coming soon" — the plans, their names and what they include
stay."""
import re
from pathlib import Path

PUB = Path(__file__).resolve().parents[2] / "frontend" / "public"
PAGES = ["landing/index.html", "landing-v2/index.html", "landing-v3/index.html"]


def test_no_plan_shows_a_price():
    for rel in PAGES:
        html = (PUB / rel).read_text(encoding="utf-8")
        assert html.count("Coming soon") == 3, rel
        assert not re.search(r"(₹|&#8377;)\s?(0|4,999|12,999)\s?<", html), rel
        assert "4,999" not in html and "12,999" not in html, rel
