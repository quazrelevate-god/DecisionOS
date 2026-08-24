"""Epic 3 Sprint 6 (E3-06.3): robust spreadsheet / CSV mapping.

Unit tests for the pure table-cleaning helpers that run BEFORE the AI maps a
spreadsheet -- handling the mess real files arrive in (unlabelled columns, blank/
duplicate headers, ragged/empty rows, multi-sheet workbooks) without a file.
"""
from services.ingestion import sanitize_table, combine_sheets


# --- sanitize_table ---------------------------------------------------------
def test_drops_unlabelled_empty_columns():
    headers = ["Name", "Unnamed: 1", ""]
    rows = [["Alice", "", ""], ["Bob", "", ""]]
    h, r = sanitize_table(headers, rows)
    assert h == ["Name"] and r == [["Alice"], ["Bob"]]


def test_relabels_unlabelled_column_that_has_data():
    headers = ["Name", ""]
    rows = [["Alice", "100"], ["Bob", "200"]]
    h, r = sanitize_table(headers, rows)
    assert h == ["Name", "column_2"]
    assert r == [["Alice", "100"], ["Bob", "200"]]


def test_dedupes_duplicate_headers():
    headers = ["Amount", "Amount"]
    rows = [["1", "2"]]
    h, _ = sanitize_table(headers, rows)
    assert h == ["Amount", "Amount_2"]


def test_pads_ragged_rows():
    headers = ["A", "B", "C"]
    rows = [["1"], ["1", "2", "3"]]
    h, r = sanitize_table(headers, rows)
    assert len(h) == 3 and all(len(row) == 3 for row in r)


def test_drops_fully_empty_rows():
    headers = ["A", "B"]
    rows = [["1", "2"], ["", ""], ["nan", "  "]]
    _, r = sanitize_table(headers, rows)
    assert r == [["1", "2"]]


def test_keeps_labelled_empty_column():
    # a meaningful header with no data yet is kept (the AI may still use it)
    headers = ["Name", "Notes"]
    rows = [["Alice", ""]]
    h, _ = sanitize_table(headers, rows)
    assert h == ["Name", "Notes"]


def test_empty_input():
    assert sanitize_table([], []) == ([], [])
    assert sanitize_table(None, None) == ([], [])


# --- combine_sheets ---------------------------------------------------------
def test_concatenates_same_schema_sheets():
    sheets = [
        ("Jan", ["Date", "Amount"], [["2026-01-01", "100"]]),
        ("Feb", ["Date", "Amount"], [["2026-02-01", "200"]]),
    ]
    h, r = combine_sheets(sheets)
    assert h == ["Date", "Amount"] and len(r) == 2


def test_picks_data_sheet_over_cover_sheet():
    sheets = [
        ("Cover", ["Report"], [["Monthly sales"]]),
        ("Data", ["Date", "Amount"], [["2026-01-01", "100"], ["2026-01-02", "200"], ["2026-01-03", "300"]]),
    ]
    h, r = combine_sheets(sheets)
    assert h == ["Date", "Amount"] and len(r) == 3


def test_ignores_empty_sheets():
    sheets = [
        ("Empty", ["A", "B"], [["", ""]]),
        ("Data", ["X"], [["1"], ["2"]]),
    ]
    h, r = combine_sheets(sheets)
    assert h == ["X"] and len(r) == 2


def test_all_empty_returns_empty():
    assert combine_sheets([("S", ["A"], [[""]])]) == ([], [])
    assert combine_sheets([]) == ([], [])
