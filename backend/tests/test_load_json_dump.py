"""Tests for scripts/load_json_dump.py against an in-memory fake MongoClient."""

import importlib.util
import json
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

from bson import ObjectId

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("load_json_dump", ROOT / "scripts" / "load_json_dump.py")
ld = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = ld
_spec.loader.exec_module(ld)

OID = "6a456262217c55c9690cbd86"


class FakeColl:
    def __init__(self):
        self.docs = []

    def insert_many(self, docs, ordered=True):
        self.docs.extend(docs)
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    def count_documents(self, _filter):
        return len(self.docs)


class FakeDB:
    def __init__(self, existing=()):
        self.colls = {n: FakeColl() for n in existing}

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())

    def create_collection(self, name):
        self.colls.setdefault(name, FakeColl())

    def list_collection_names(self):
        return list(self.colls)


class FakeClient:
    def __init__(self, db):
        self.db = db

    def __call__(self, *_a, **_k):
        return self

    def __getitem__(self, _name):
        return self.db

    def close(self):
        pass


def write_zip(tmp_path, files):
    path = tmp_path / "dump.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for name, docs in files.items():
            zf.writestr(name, json.dumps(docs))
    return path


def run(dump, db):
    return ld.main([str(dump), "--target-url", "mongodb://x", "--target-db", "src"], client_factory=FakeClient(db))


def test_loads_zip_restoring_object_ids_and_keeping_values(tmp_path):
    dump = write_zip(
        tmp_path,
        {
            "tenants.json": [{"_id": OID, "id": "t1", "created_at": "2026-07-01T18:54:26.718989+00:00"}],
            "users.json": [{"_id": "not-an-oid", "id": "u1"}, {"_id": OID.replace("a", "b"), "id": "u2"}],
            "empty.json": [],
        },
    )
    db = FakeDB()
    assert run(dump, db) == ld.EXIT_OK
    tenant = db.colls["tenants"].docs[0]
    assert tenant["_id"] == ObjectId(OID)
    assert tenant["created_at"] == "2026-07-01T18:54:26.718989+00:00"  # dates stay ISO strings, as main wrote them
    assert [d["_id"] for d in db.colls["users"].docs][0] == "not-an-oid"
    assert isinstance(db.colls["users"].docs[1]["_id"], ObjectId)
    assert "empty" in db.colls


def test_directory_and_extended_json(tmp_path):
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "otp_codes.json").write_text(
        '[{"_id": {"$oid": "%s"}, "expires_at": {"$date": "2026-09-16T17:31:31Z"}}]' % OID, encoding="utf-8"
    )
    db = FakeDB()
    assert run(tmp_path / "d", db) == ld.EXIT_OK
    doc = db.colls["otp_codes"].docs[0]
    assert doc["_id"] == ObjectId(OID) and doc["expires_at"].year == 2026


def test_ndjson_accepted():
    docs = ld.parse_docs('{"_id": "%s"}\n{"_id": "x"}\n' % OID, "f")
    assert docs[0]["_id"] == ObjectId(OID) and docs[1]["_id"] == "x"


def test_refuses_non_empty_database(tmp_path):
    dump = write_zip(tmp_path, {"users.json": [{"_id": OID}]})
    db = FakeDB(existing=["users"])
    assert run(dump, db) == ld.EXIT_FATAL
    assert db.colls["users"].docs == []


def test_count_mismatch_fails(tmp_path, monkeypatch):
    dump = write_zip(tmp_path, {"users.json": [{"_id": OID}]})
    monkeypatch.setattr(FakeColl, "count_documents", lambda self, _f: 0)
    assert run(dump, FakeDB()) == ld.EXIT_VERIFY_FAILED


def test_rejects_non_documents_and_system_collections(tmp_path):
    assert run(write_zip(tmp_path, {"users.json": [1, 2]}), FakeDB()) == ld.EXIT_FATAL
    assert run(write_zip(tmp_path, {"system.users.json": [{"_id": 1}]}), FakeDB()) == ld.EXIT_FATAL
