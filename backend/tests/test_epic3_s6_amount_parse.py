"""Epic 3 Sprint 6 (E3-06.7): tolerant amount / currency parsing for the India market.

parse_amount handles what OCR and manual entry actually produce -- currency tokens,
Indian comma grouping, and scale words (lakh/crore) -- without raising.
"""
from routers.ledger import parse_amount


def test_plain_numbers_pass_through():
    assert parse_amount(5000) == 5000.0
    assert parse_amount(1234.5) == 1234.5
    assert parse_amount("5000") == 5000.0


def test_indian_comma_grouping():
    assert parse_amount("1,20,000") == 120000.0
    assert parse_amount("12,34,567") == 1234567.0


def test_currency_tokens_stripped():
    assert parse_amount("Rs 5,000") == 5000.0
    assert parse_amount("Rs. 5000") == 5000.0
    assert parse_amount("₹1,20,000") == 120000.0
    assert parse_amount("INR 2500") == 2500.0


def test_lakh_scale():
    assert parse_amount("2.5 lakh") == 250000.0
    assert parse_amount("2 lakhs") == 200000.0
    assert parse_amount("₹2.5 lakh") == 250000.0
    assert parse_amount("1 lac") == 100000.0


def test_crore_scale():
    assert parse_amount("1.2 crore") == 12000000.0
    assert parse_amount("3 crores") == 30000000.0
    assert parse_amount("1.2 cr") == 12000000.0


def test_junk_and_empty_are_zero():
    assert parse_amount("") == 0.0
    assert parse_amount(None) == 0.0
    assert parse_amount("n/a") == 0.0
    assert parse_amount("abc") == 0.0


def test_negative():
    assert parse_amount("-500") == -500.0
