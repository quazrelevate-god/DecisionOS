"""Finance periods by the calendar (2026-10-29, founder: "when it goes to 2027,
will it change by itself? Build it so that once it's launched nobody has to
touch it").

Runs the real frontend period code (pages/finance/ledgerMath.js) under Node on
fixed dates: the year rolling over at midnight on 31 March, a company whose
year starts in January, a leap year, choices saved by older versions, the
quarters of a year that just closed, a custom range that can't run past today.
Skipped only where Node isn't installed.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "finance" / "ledgerMath.js"
NODE = shutil.which("node")

SCRIPT = r"""
import * as m from "./ledgerMath.mjs";
const at = (s) => new Date(s).getTime();
const w = (v, fy, now) => { const x = m.periodWindow(v, fy, at(now));
  return { value: x.value, kind: x.kind, label: x.label, range: x.range || null, months: x.months || null,
           running: !!x.running, future: !!x.future, start: x.start ? new Date(x.start).toDateString() : null,
           end: x.end ? new Date(x.end).toDateString() : null }; };
const out = {
  oct26: { fy: w("fy", 4, "2026-10-29T12:00:00"), q3: w("q3:2026", 4, "2026-10-29T12:00:00"), q4: w("q4:2026", 4, "2026-10-29T12:00:00"),
           h2: w("h2:2026", 4, "2026-10-29T12:00:00"), last: w("fy:2025", 4, "2026-10-29T12:00:00") },
  eve: w("fy", 4, "2027-03-31T23:30:00"),
  newYear: { fy: w("fy", 4, "2027-04-01T00:30:00"), q4old: w("q4:2026", 4, "2027-04-01T00:30:00"),
             q1: w("q1:2027", 4, "2027-04-01T00:30:00"), q2: w("q2:2027", 4, "2027-04-01T00:30:00") },
  january: { fy: w("fy", 1, "2026-10-29T12:00:00"), q1: w("q1:2026", 1, "2026-10-29T12:00:00"), q4: w("q4:2026", 1, "2026-10-29T12:00:00") },
  july: w("fy", 7, "2026-05-15T12:00:00"),
  leap: { q4: w("q4:2027", 4, "2028-06-01T12:00:00"), feb: w("custom:2028-02-01:2028-02-29", 4, "2028-06-01T12:00:00") },
  legacy: { q3: w("q3", 4, "2026-10-29T12:00:00").value, quarter: w("quarter", 4, "2026-10-29T12:00:00").value,
            fy1: w("fy-1", 4, "2026-10-29T12:00:00").value, d90: w("90d", 4, "2026-10-29T12:00:00").value,
            junk: m.periodOf("drop table").value },
  custom: w("custom:2026-10-20:2026-12-31", 4, "2026-10-29T12:00:00"),
  fyValue: [m.fyValue(2026, 4, at("2026-10-29T12:00:00")), m.fyValue(2025, 4, at("2026-10-29T12:00:00"))],
  years: m.periodChoices(4, at("2023-05-01T00:00:00"), at("2026-10-29T12:00:00")).years,
  yearsNone: m.periodChoices(4, null, at("2026-10-29T12:00:00")).years,
  yearsApril: m.periodChoices(4, null, at("2027-04-01T00:30:00")).years,
};
const rev = { invoices: [{ amount: 9000, date: "2026-05-02" }, { amount: 40000, date: "2026-07-15" }, { amount: 3000, date: "2026-08-10" },
                         { amount: 50000, date: "2026-10-28" }, { amount: 7000, date: "2026-03-20" }], payments: [] };
const billed = (p, now) => m.financeMetrics({ summary: { totals: { revenue_billed: 109000 } }, revenue: rev, expenses: [], assets: [],
  inventory: [], period: p, fyStartMonth: 4, now: at(now) }).billed.value;
out.billed = { fy: billed("fy", "2026-10-29T12:00:00"), q1: billed("q1:2026", "2026-10-29T12:00:00"), q2: billed("q2:2026", "2026-10-29T12:00:00"),
               h1: billed("h1:2026", "2026-10-29T12:00:00"), last: billed("fy:2025", "2026-10-29T12:00:00"),
               all: billed("all", "2026-10-29T12:00:00"), nextYear: billed("fy", "2027-04-10T12:00:00"),
               closedYear: billed("fy:2026", "2027-04-10T12:00:00") };
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def r(tmp_path_factory):
    if not NODE:
        pytest.skip("node is not installed")
    d = tmp_path_factory.mktemp("periods")
    (d / "ledgerMath.mjs").write_text(SRC.read_text(encoding="utf-8"), encoding="utf-8")
    (d / "run.mjs").write_text(SCRIPT, encoding="utf-8")
    p = subprocess.run([NODE, "run.mjs"], cwd=d, capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_the_current_year_its_halves_and_quarters(r):
    o = r["oct26"]
    assert o["fy"]["label"] == "FY 2026–27" and o["fy"]["start"] == "Wed Apr 01 2026" and o["fy"]["running"]
    assert o["q3"]["label"] == "Q3 FY 2026–27" and o["q3"]["months"] == "Oct–Dec" and o["q3"]["running"]
    assert o["q4"]["future"] and o["q4"]["range"] == "1 Jan – 31 Mar 2027", "Q4 hasn't started: offered, not pickable"
    assert o["h2"]["label"] == "H2 FY 2026–27" and o["h2"]["range"] == "1 Oct 2026 – 31 Mar 2027"
    assert o["last"]["label"] == "FY 2025–26" and not o["last"]["running"] and o["last"]["end"] == "Wed Apr 01 2026"


def test_the_year_rolls_over_at_midnight_on_31_march(r):
    assert r["eve"]["label"] == "FY 2026–27", "still the old year at 23:30 on 31 March"
    n = r["newYear"]
    assert n["fy"]["label"] == "FY 2027–28" and n["fy"]["start"] == "Thu Apr 01 2027", "the new year at 00:30, by itself"
    # The quarter that just closed is still one tap away, and complete.
    assert n["q4old"]["label"] == "Q4 FY 2026–27" and not n["q4old"]["future"] and not n["q4old"]["running"]
    assert n["q4old"]["range"] == "1 Jan – 31 Mar 2027"
    assert n["q1"]["running"] and n["q2"]["future"]
    assert r["yearsApril"][:2] == [2027, 2026], "last year's quarters can be picked on 1 April"


def test_other_financial_years(r):
    j = r["january"]
    assert j["fy"]["label"] == "FY 2026", "a January year is named by its one calendar year"
    assert j["q1"]["months"] == "Jan–Mar" and j["q4"]["months"] == "Oct–Dec" and j["q4"]["running"]
    assert r["july"]["label"] == "FY 2025–26" and r["july"]["start"] == "Tue Jul 01 2025"


def test_a_leap_year(r):
    assert r["leap"]["q4"]["range"] == "1 Jan – 31 Mar 2028"
    assert r["leap"]["feb"]["range"] == "1 Feb – 29 Feb 2028"


def test_choices_saved_by_older_versions_still_open(r):
    lg = r["legacy"]
    assert lg["q3"] == "q3:2026" and lg["quarter"] == "q3:2026" and lg["fy1"] == "fy:2025"
    assert lg["d90"] == "fy" and lg["junk"] == "fy"


def test_a_custom_range_never_runs_past_today(r):
    c = r["custom"]
    assert c["start"] == "Tue Oct 20 2026" and c["end"] == "Thu Oct 29 2026"
    assert c["label"] == "20 Oct – 29 Oct 2026"


def test_how_far_back_the_picker_goes(r):
    assert r["fyValue"] == ["fy", "fy:2025"], "the current year stays relative, so it rolls over"
    assert r["years"] == [2026, 2025, 2024, 2023], "back to the oldest record"
    assert r["yearsNone"] == [2026, 2025], "at least last year, even with no records"


def test_each_period_counts_its_own_records(r):
    b = r["billed"]
    assert (b["fy"], b["q1"], b["q2"], b["h1"], b["last"], b["all"]) == (102000, 9000, 43000, 52000, 7000, 109000)
    assert b["nextYear"] == 0 and b["closedYear"] == 102000, "after the rollover, last year's books are where they were"
