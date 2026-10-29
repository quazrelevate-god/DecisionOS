"""Finance periods follow the company's financial year (2026-10-29, founder).

The Overview used to open on "Last 30 days" and count a record by the date on
it: an invoice entered today but dated in July moved nothing, and the client
read that as "it doesn't save". It now opens on This financial year, and the
half and the quarter are the FY's own (Settings › Company › Financial year
starts in, April when unset).
"""
from pathlib import Path

import pytest
from pydantic import ValidationError

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _src(rel):
    return (SRC / rel).read_text(encoding="utf-8")


def test_the_financial_year_start_is_a_month():
    from models.tenant import TenantUpdateInput
    assert TenantUpdateInput(fy_start_month=4).fy_start_month == 4
    assert TenantUpdateInput().fy_start_month is None, "unset means April"
    for bad in (0, 13):
        with pytest.raises(ValidationError):
            TenantUpdateInput(fy_start_month=bad)


def test_saving_company_details_keeps_the_financial_year_start():
    src = (Path(__file__).resolve().parents[1] / "routers" / "tenant_settings.py").read_text(encoding="utf-8")
    assert 'updates["fy_start_month"] = int(inp.fy_start_month)' in src


def test_finance_opens_on_this_financial_year_and_its_periods_follow_it():
    math = _src("pages/finance/ledgerMath.js")
    assert 'export const PERIODS = [{ value: "fy"' in math, "the year is the default"
    # Every quarter and half of the year, last year, 30 days, a custom range, all time.
    assert r"(fy|30d|all|(fy|q[1-4]|h[12]):\d{4}|custom:" in math, "a pick names its year"
    assert "export function periodWindow(period, fyStartMonth" in math
    assert "export function periodChoices(fyStartMonth" in math
    assert "fyStartMonth" in math.split("export function financeMetrics", 1)[1].splitlines()[0]
    # Standard labels: "FY 2026-27", "Q2 FY 2026-27" -- no "(so far)".
    assert "(so far)" not in math and "`${head.toUpperCase()} ${fyLabel(year, fy)}`" in math
    # A running window compares with the same point of the one before; a
    # finished one ends where it ended, not today.
    assert "sumIn(list, prevStart, prevEnd)" in math
    assert "const end = windowed ? p.end : now;" in math
    ledger = _src("pages/Ledger.js")
    assert "<PeriodPicker value={period} onChange={setPeriod} fyStartMonth={tenant?.fy_start_month} earliest={earliest} now={now} />" in ledger
    assert "sessionStorage.getItem(PERIOD_KEY)" in ledger, "each new visit opens on the current year"
    assert "function useToday()" in ledger, "a page left open over midnight moves to the new day"
    assert "fyStartMonth={tenant?.fy_start_month}" in ledger


def test_the_picker_chooses_a_kind_then_which_one():
    picker = _src("pages/finance/PeriodPicker.jsx")
    for k in ('"fy"', '"half"', '"quarter"', '"30d"', '"custom"', '"all"'):
        assert f"{{ key: {k}" in picker
    assert "choices.quarter(year)" in picker and "choices.half(year)" in picker
    assert 'data-testid="period-year-prev"' in picker, "any year's quarters, not only this year's"
    assert "disabled={w.future}" in picker, "a quarter that hasn't started can't be picked"
    assert 'data-testid="period-custom-apply"' in picker


def test_settings_asks_when_the_financial_year_starts():
    company = _src("components/CompanyDetails.js")
    assert 'data-testid="company-field-fy_start_month"' in company
    assert "fy_start_month: tenant.fy_start_month ?? 4" in company
