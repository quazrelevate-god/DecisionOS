"""FIX-002-E tests: shared uploads helper (obj_store + legacy-disk fallback).

Contract this file locks in:
  1. build_key produces the canonical `decisionos/{tenant}/{cat}/{id}.{ext}`
     shape — with tenant prefix so tenant deletion (FIX-001-E) can wipe
     files by prefix.
  2. is_legacy_path correctly distinguishes bare filenames / local paths
     from new obj_store keys.
  3. store_upload calls obj_store.put_object with the right key shape.
  4. read_upload transparently handles both storage backends.
  5. download_to_temp materializes bytes to a real filesystem path.
  6. delete_upload never raises; returns True even for already-gone files.
  7. store_upload rejects empty tenant_id (defensive).

Pure unit tests — mocks obj_store's I/O. No live storage.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services import uploads as up
from services import obj_store as os_mod


# ---------------------------------------------------------------------------
# Fake obj_store — records calls; simulates get/put/delete.
# ---------------------------------------------------------------------------
class _FakeObjStore:
    def __init__(self):
        self.storage = {}          # path -> (bytes, content_type)
        self.put_calls = []        # list of (path, size, content_type)
        self.delete_calls = []     # list of paths
        self.fail_delete_paths = set()

    async def put_object(self, path, data, content_type):
        self.storage[path] = (data, content_type)
        self.put_calls.append((path, len(data), content_type))
        return {"path": path, "size": len(data)}

    async def get_object(self, path):
        if path not in self.storage:
            raise FileNotFoundError(path)
        return self.storage[path]

    async def delete_object(self, path):
        self.delete_calls.append(path)
        if path in self.fail_delete_paths:
            return False
        self.storage.pop(path, None)
        return True


@pytest.fixture
def fake_store(monkeypatch):
    """Swap the real obj_store module functions with fakes for the test."""
    fake = _FakeObjStore()
    monkeypatch.setattr(os_mod, "put_object", fake.put_object)
    monkeypatch.setattr(os_mod, "get_object", fake.get_object)
    monkeypatch.setattr(os_mod, "delete_object", fake.delete_object)
    return fake


# ---------------------------------------------------------------------------
# build_key
# ---------------------------------------------------------------------------
class TestBuildKey:
    def test_shape(self):
        k = up.build_key("ten-1", "voice-notes", "note-abc", "webm")
        assert k == "decisionos/ten-1/voice-notes/note-abc.webm"

    def test_dotted_ext_normalized(self):
        k = up.build_key("ten-1", "meetings", "m-1", ".pdf")
        assert k == "decisionos/ten-1/meetings/m-1.pdf"

    def test_ext_lowercased(self):
        k = up.build_key("ten-1", "meetings", "m-1", "PDF")
        assert k == "decisionos/ten-1/meetings/m-1.pdf"

    def test_missing_ext_defaults_to_bin(self):
        k = up.build_key("ten-1", "voice-notes", "note-1", "")
        assert k == "decisionos/ten-1/voice-notes/note-1.bin"


# ---------------------------------------------------------------------------
# is_legacy_path
# ---------------------------------------------------------------------------
class TestIsLegacyPath:
    def test_new_obj_store_key_is_not_legacy(self):
        assert up.is_legacy_path("decisionos/ten-1/voice-notes/foo.webm") is False

    def test_bare_filename_is_legacy(self):
        assert up.is_legacy_path("wa_voice_abc.ogg") is True

    def test_absolute_local_path_is_legacy(self):
        assert up.is_legacy_path("/app/uploads/foo.webm") is True
        assert up.is_legacy_path("C:\\Users\\x\\uploads\\foo.webm") is True

    def test_empty_is_not_legacy(self):
        """Empty is 'no file'; the read helper raises before hitting this branch."""
        assert up.is_legacy_path("") is False
        assert up.is_legacy_path(None) is False


# ---------------------------------------------------------------------------
# store_upload
# ---------------------------------------------------------------------------
class TestStoreUpload:
    def test_writes_to_tenant_prefixed_key(self, fake_store):
        result = asyncio.run(up.store_upload(
            "ten-A", "voice-notes", b"audio bytes", "webm",
            content_type="audio/webm", file_id="note-xyz"))
        assert result["storage_path"] == "decisionos/ten-A/voice-notes/note-xyz.webm"
        assert result["size"] == len(b"audio bytes")
        assert result["content_type"] == "audio/webm"
        assert result["file_id"] == "note-xyz"
        assert result["category"] == "voice-notes"
        # And obj_store actually got the write:
        assert fake_store.put_calls == [
            ("decisionos/ten-A/voice-notes/note-xyz.webm", 11, "audio/webm")
        ]

    def test_generated_file_id_when_not_provided(self, fake_store):
        r = asyncio.run(up.store_upload("ten-A", "meetings", b"x", "m4a"))
        assert r["file_id"], "file_id should have been auto-generated"
        assert r["storage_path"].startswith(f"decisionos/ten-A/meetings/{r['file_id']}.")

    def test_rejects_empty_tenant_id(self, fake_store):
        with pytest.raises(ValueError, match="tenant_id"):
            asyncio.run(up.store_upload("", "voice-notes", b"x", "webm"))

    def test_content_type_falls_back_to_ext_guess(self, fake_store):
        asyncio.run(up.store_upload("ten-A", "ingestions", b"pdf-bytes", "pdf",
                                     file_id="ing-1"))
        # obj_store.guess_mime should have returned application/pdf for .pdf
        assert fake_store.put_calls[0][2] == "application/pdf"


# ---------------------------------------------------------------------------
# read_upload
# ---------------------------------------------------------------------------
class TestReadUpload:
    def test_reads_from_obj_store_when_new_key(self, fake_store):
        # Seed the fake store
        fake_store.storage["decisionos/ten-A/voice-notes/n1.webm"] = (b"data", "audio/webm")
        data, ctype = asyncio.run(up.read_upload("decisionos/ten-A/voice-notes/n1.webm"))
        assert data == b"data"
        assert ctype == "audio/webm"

    def test_reads_from_local_disk_when_legacy_path(self, tmp_path, monkeypatch, fake_store):
        # Point LEGACY_UPLOAD_DIR at our tmp_path so the test doesn't touch real disk
        monkeypatch.setattr(up, "LEGACY_UPLOAD_DIR", tmp_path)
        legacy_file = tmp_path / "wa_voice_legacy.ogg"
        legacy_file.write_bytes(b"legacy audio")

        data, ctype = asyncio.run(up.read_upload("wa_voice_legacy.ogg"))
        assert data == b"legacy audio"
        # ctype defaults to what obj_store.guess_mime returns for unknown ext
        assert ctype  # non-empty

    def test_raises_when_legacy_file_missing(self, tmp_path, monkeypatch, fake_store):
        monkeypatch.setattr(up, "LEGACY_UPLOAD_DIR", tmp_path)
        with pytest.raises(FileNotFoundError):
            asyncio.run(up.read_upload("does-not-exist.ogg"))

    def test_empty_path_raises(self, fake_store):
        with pytest.raises(FileNotFoundError):
            asyncio.run(up.read_upload(""))


# ---------------------------------------------------------------------------
# download_to_temp
# ---------------------------------------------------------------------------
class TestDownloadToTemp:
    def test_materializes_bytes_to_real_file(self, fake_store):
        fake_store.storage["decisionos/ten-A/meetings/m-1.m4a"] = (b"meeting audio", "audio/m4a")
        tmp = asyncio.run(up.download_to_temp("decisionos/ten-A/meetings/m-1.m4a"))
        try:
            assert tmp.exists()
            assert tmp.suffix == ".m4a"
            assert tmp.read_bytes() == b"meeting audio"
        finally:
            os.unlink(tmp)

    def test_default_suffix_from_storage_path(self, fake_store):
        fake_store.storage["decisionos/ten-A/ingestions/x.pdf"] = (b"pdf", "application/pdf")
        tmp = asyncio.run(up.download_to_temp("decisionos/ten-A/ingestions/x.pdf"))
        try:
            assert tmp.suffix == ".pdf"
        finally:
            os.unlink(tmp)


# ---------------------------------------------------------------------------
# delete_upload
# ---------------------------------------------------------------------------
class TestDeleteUpload:
    def test_deletes_from_obj_store(self, fake_store):
        fake_store.storage["decisionos/ten-A/voice-notes/n1.webm"] = (b"x", "audio/webm")
        ok = asyncio.run(up.delete_upload("decisionos/ten-A/voice-notes/n1.webm"))
        assert ok is True
        assert "decisionos/ten-A/voice-notes/n1.webm" not in fake_store.storage

    def test_deletes_legacy_local_file(self, tmp_path, monkeypatch, fake_store):
        monkeypatch.setattr(up, "LEGACY_UPLOAD_DIR", tmp_path)
        legacy = tmp_path / "legacy.webm"
        legacy.write_bytes(b"bye")
        ok = asyncio.run(up.delete_upload("legacy.webm"))
        assert ok is True
        assert not legacy.exists()

    def test_already_gone_returns_true(self, tmp_path, monkeypatch, fake_store):
        """Idempotent: deleting an already-absent file must not raise."""
        monkeypatch.setattr(up, "LEGACY_UPLOAD_DIR", tmp_path)
        assert asyncio.run(up.delete_upload("never-existed.webm")) is True

    def test_empty_path_treated_as_success(self, fake_store):
        assert asyncio.run(up.delete_upload("")) is True
        assert asyncio.run(up.delete_upload(None)) is True

    def test_obj_store_failure_returns_false(self, fake_store):
        fake_store.storage["decisionos/ten-A/x/f.bin"] = (b"x", "application/octet-stream")
        fake_store.fail_delete_paths.add("decisionos/ten-A/x/f.bin")
        ok = asyncio.run(up.delete_upload("decisionos/ten-A/x/f.bin"))
        assert ok is False


# ---------------------------------------------------------------------------
# End-to-end: write → read → download-to-temp → delete
# ---------------------------------------------------------------------------
class TestRoundTrip:
    def test_full_lifecycle(self, fake_store):
        # 1. Write
        stored = asyncio.run(up.store_upload(
            "ten-B", "ingestions", b"pdf-bytes", "pdf",
            content_type="application/pdf", file_id="ing-99"))
        # 2. Read back
        data, ctype = asyncio.run(up.read_upload(stored["storage_path"]))
        assert data == b"pdf-bytes"
        assert ctype == "application/pdf"
        # 3. Materialize to temp for something that needs a real path (OCR)
        tmp = asyncio.run(up.download_to_temp(stored["storage_path"]))
        try:
            assert tmp.read_bytes() == b"pdf-bytes"
        finally:
            os.unlink(tmp)
        # 4. Delete (tenant offboarding)
        assert asyncio.run(up.delete_upload(stored["storage_path"])) is True
        # 5. Now read fails
        with pytest.raises(FileNotFoundError):
            asyncio.run(up.read_upload(stored["storage_path"]))
