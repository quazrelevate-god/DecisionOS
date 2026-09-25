"""J14-14 — the stock/capital split, pushed at from every side.

The founder's note on this row: "this is one of the case scenarios, but I
wanted to check for multiple edge-case scenarios and solve the major ones in a
better way. Even though we solved it, we have to check these things."

So this is the adversarial pass on _is_stock_category and _spend_split. The
original fix widened a single exact string ('raw material') into a word match,
and a word match is exactly the kind of rule that starts saying yes to things it
should not. Each case below is a real category name a workshop or a shop would
actually type.

Where a case is a JUDGEMENT rather than a bug, it is marked and asserted the way
the product currently behaves, so that changing it later is a deliberate act and
not an accident.
"""
import pytest

from routers.ledger import _is_stock_category, _spend_split


# ---------------------------------------------------------------------------
# The ones that MUST count as stock: cash turned into goods, not spent.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name", [
    "Raw Material",
    "Raw Materials",
    "raw material",
    "RAW MATERIALS",
    "  Raw   Materials  ",          # a person typing into a box
    "Materials",
    "Material",
    "Stock",
    "Opening Stock",
    "Stock purchase",
    "Inventory",
    "Inventory purchases",
    "Goods",
    "Trading goods",
    "Purchases",
    "Purchase",
    "Raw material - steel",         # a suffix nobody thought about
    "Steel / raw material",
])
def test_these_are_stock(name):
    assert _is_stock_category(name) is True, f"{name!r} should be stock"


# ---------------------------------------------------------------------------
# The ones that MUST NOT: money that has genuinely left the business. These are
# the dangerous direction — a running cost wrongly called stock inflates profit,
# which is the error a founder acts on.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name", [
    "Rent",
    "Wages",
    "Salaries",
    "Freight & Logistics",
    "Power & Utilities",
    "GST Compliance",
    "Office & Admin",
    "Insurance",
    "Sales Commissions",
    "Quality Control",
    "Equipment Maintenance",        # maintaining a machine is a running cost
    "Material handling charges",    # a SERVICE, not the material
    "Purchase ledger fees",         # a fee, not a purchase
    "Raw water charges",            # 'raw' next to something that is not stock
    "Factory Overhead",
    "Direct Labour",
    "Packaging Materials",          # see the judgement note below
    "",
    None,
])
def test_these_are_not_stock(name):
    assert _is_stock_category(name) is False, f"{name!r} should not be stock"


# ---------------------------------------------------------------------------
# Two judgement calls, pinned so they cannot drift by accident.
# ---------------------------------------------------------------------------
def test_packaging_materials_is_a_running_cost_not_stock():
    """JUDGEMENT. 'Packaging Materials' contains the word materials, and the
    rule still says running cost, because the multi-word test only lets
    'material(s)' through when it stands alone or with 'raw'. That is the right
    answer commercially too: cartons and tape are consumed in dispatching, not
    goods sitting in the godown waiting to be sold. If a shop genuinely stocks
    packaging to resell, they would name the category for what they sell."""
    assert _is_stock_category("Packaging Materials") is False


def test_material_handling_is_a_service():
    """JUDGEMENT. The word 'material' is in there, but what was bought is
    somebody's labour. A single-word rule would have called this stock and
    quietly added it to the profit figure."""
    assert _is_stock_category("Material handling charges") is False


# ---------------------------------------------------------------------------
# And the split as a whole, on a month that looks like a real one.
# ---------------------------------------------------------------------------
def _e(amount, category):
    return {"amount": amount, "category": category}


def test_a_whole_month_splits_three_ways():
    operating, stock, capital = _spend_split([
        _e(86400, "Raw Materials"),          # steel sheet — stock
        _e(50000, "Stock"),                  # more of it, named differently
        _e(600000, "Asset Purchase"),        # the press brake — capital
        _e(45000, "Rent"),                   # running
        _e(220000, "Salaries"),              # running
        _e(12400, "Freight & Logistics"),    # running
        _e(14500, "Material handling"),      # running, despite the word
        _e(5000, None),                      # uncategorised is a running cost
    ])
    assert stock == 136400
    assert capital == 600000
    assert operating == 296900
    # Nothing is lost or double-counted on the way through the split.
    assert operating + stock + capital == 86400 + 50000 + 600000 + 45000 + 220000 + 12400 + 14500 + 5000


def test_amounts_that_are_not_numbers_do_not_take_the_month_down():
    """A row with a missing or broken amount is a data problem, not a reason for
    the whole Finance page to stop answering."""
    operating, stock, capital = _spend_split([
        _e(None, "Rent"),
        _e("", "Raw Materials"),
        _e("12,400", "Freight"),             # a string that came from a form
        _e(45000, "Rent"),
    ])
    assert capital == 0
    assert operating >= 45000
    assert stock >= 0
