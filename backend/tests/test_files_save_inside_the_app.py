"""A file can be saved inside the Android and iOS apps (2026-10-22).

Capacitor's webview has no download handler on either platform, so the
browser's way of saving a file — a blob URL and a click on an <a download> —
did nothing in the app: "Download PDF" on an invoice, a Company Brain
document and Dex's export were dead buttons on a phone. A link to a stored
file (a bill, a request's attachment, a task's proof) opened the phone's
browser instead, which has no session, so it answered "not signed in".

Now every one of them goes through frontend/src/lib/native/files.js: the same
download on the web; in the app the file is fetched signed in, written to the
app's cache and handed to the phone's share sheet (Save to Files / Drive, or
straight to WhatsApp or mail). Checked on the Android emulator: the old code
left no file and no screen; the invoice PDF and the Finance copy each opened
the share sheet with the file under the server's own name.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "src"
FILES = (SRC / "lib" / "native" / "files.js").read_text(encoding="utf-8")


def _read(rel):
    return (SRC / rel).read_text(encoding="utf-8")


def test_no_screen_saves_a_file_the_browser_way_any_more():
    """Only the helper may click an <a download> — its web half."""
    offenders = []
    for p in SRC.rglob("*.js*"):
        if "fixtures" in p.parts or p.name == "files.js":
            continue
        text = p.read_text(encoding="utf-8")
        if re.search(r"\.download\s*=", text):
            offenders.append(str(p.relative_to(SRC)))
    assert offenders == [], offenders


def test_every_download_goes_through_the_helper():
    assert 'downloadFrom(`/invoices/${inv.id}/pdf`' in _read("pages/finance/MoneyActions.jsx")
    assert 'downloadFrom(`/brain/documents/${doc.id}/download`' in _read("pages/BrainDocuments.js")
    assert 'downloadFrom("/brain/export"' in _read("pages/brain/DexAnswer.jsx")
    # 2026-10-22 admin redesign: the console's JSON exports share one helper.
    assert "await saveFile(new Blob(" in _read("pages/admin/adminUi.jsx")
    for rel in ("pages/admin/ComplianceSection.js", "pages/admin/WorkspacePage.js"):
        assert "await downloadJSON(" in _read(rel), rel
    assert "downloadFrom(url, null" in _read("pages/finance/FinanceDelete.jsx")


def test_every_link_to_a_stored_file_opens_signed_in_in_the_app():
    links = {
        "components/requests/RequestCard.jsx": 1,
        "pages/Captures.js": 2,
        "pages/MyWork.js": 3,
        "pages/finance/financeKit.jsx": 1,
    }
    for rel, n in links.items():
        assert _read(rel).count("{...fileLink(") == n, rel
    review = _read("pages/finance/ReviewPanel.js")
    assert "else if (isNativeApp()) downloadFrom(src, filename);" in review
    # No file link opens a bare new tab on its own any more.
    for rel in links:
        assert not re.search(r'href=\{[^}]*(/api/files|att\.url|a\.url|fileSrc)[^}]*\}\s+target="_blank"', _read(rel)), rel


def test_the_helper_shares_in_the_app_and_downloads_on_the_web():
    assert "if (!isNativeApp()) {" in FILES and "a.download = name;" in FILES
    assert 'import("@capacitor/filesystem")' in FILES and 'import("@capacitor/share")' in FILES
    assert "directory: Directory.Cache" in FILES and "Share.share({ title: name, files: [uri]" in FILES
    assert 'return { href, target: "_blank", rel: "noopener noreferrer" };' in FILES, "the web link is unchanged"


def test_both_apps_carry_the_plugins_and_android_can_share_the_cache():
    pkg = (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
    assert '"@capacitor/filesystem": "8.1.4"' in pkg and '"@capacitor/share": "8.0.3"' in pkg
    spm = (ROOT / "frontend" / "ios" / "App" / "CapApp-SPM" / "Package.swift").read_text(encoding="utf-8")
    assert '"CapacitorFilesystem"' in spm and '"CapacitorShare"' in spm
    gradle = (ROOT / "frontend" / "android" / "capacitor.settings.gradle").read_text(encoding="utf-8")
    assert "capacitor-filesystem" in gradle and "capacitor-share" in gradle
    paths = (ROOT / "frontend" / "android" / "app" / "src" / "main" / "res" / "xml" / "file_paths.xml").read_text(encoding="utf-8")
    assert '<cache-path name="my_cache_images" path="." />' in paths, "Share hands the cached file through this"


def test_the_app_can_read_a_downloads_file_name():
    mw = (ROOT / "backend" / "bootstrap" / "middleware.py").read_text(encoding="utf-8")
    assert 'expose_headers=["X-CSRF-Token", "Content-Disposition"]' in mw
