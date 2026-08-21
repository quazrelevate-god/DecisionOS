"""Epic 8 Sprint 2 — unit tests for the generic helpers extracted to shared/.

Covers shared/ids.py (now_iso, new_id) and shared/json_utils.py (_extract_json).
Pure, in-process (no backend / Mongo). Also pins the core re-export contract.
"""
import uuid
from datetime import datetime

import pytest

from shared.ids import now_iso, new_id
from shared.json_utils import _extract_json


# --- ids -------------------------------------------------------------------
def test_now_iso_is_tz_aware_iso():
    s = now_iso()
    dt = datetime.fromisoformat(s)          # must round-trip
    assert dt.tzinfo is not None            # timezone-aware (UTC)
    assert dt.utcoffset().total_seconds() == 0


def test_new_id_is_unique_uuid4():
    a, b = new_id(), new_id()
    assert a != b
    u = uuid.UUID(a)                        # valid UUID string
    assert u.version == 4
    assert len(a) == 36


# --- json extraction -------------------------------------------------------
def test_extract_bare_json():
    assert _extract_json('{"a": 1, "b": "x"}') == {"a": 1, "b": "x"}


def test_extract_fenced_json_label():
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_extract_fenced_plain():
    assert _extract_json('```\n{"a": 2}\n```') == {"a": 2}


def test_extract_json_embedded_in_prose():
    assert _extract_json('Sure! Here it is: {"ok": true} — hope that helps') == {"ok": True}


def test_extract_json_invalid_raises():
    with pytest.raises(Exception):
        _extract_json("not json at all")


# --- core re-export contract ----------------------------------------------
def test_core_reexports_helpers():
    core = pytest.importorskip("core")
    assert core.now_iso is now_iso
    assert core.new_id is new_id
    assert core._extract_json is _extract_json
