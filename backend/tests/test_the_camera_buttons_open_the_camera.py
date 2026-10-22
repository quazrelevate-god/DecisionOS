"""The camera buttons open the camera (BUG-14, XCODITS QA report, 2026-10-21).

The testers: "The application does not appear to request the necessary
permission for uploads of images, media or documents." No prompt is correct —
the system pickers need no permission on Android 13+. The fault behind it:
Money › Photo, a task's camera and Dex's Photo opened the GALLERY, not the
camera. Capacitor asks the package manager for a camera app before launching
IMAGE_CAPTURE, and since targetSdk 30 that answer is "none" unless the
manifest declares the intent in <queries>. Reproduced on the Android 16
emulator (logcat: "AppsFilter … com.android.camera2 BLOCKED", "Media capture
intent could not be launched. Falling back to default file picker."); with
the declaration the same tap opened com.android.camera2's CaptureActivity and
the photo came back to the app as an upload.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend"
MANIFEST = (FE / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")


def _no_comments(xml):
    return re.sub(r"<!--.*?-->", "", xml, flags=re.S)


def test_the_app_may_see_a_camera_app():
    xml = _no_comments(MANIFEST)
    queries = xml[xml.index("<queries>"): xml.index("</queries>")]
    assert '<action android:name="android.media.action.IMAGE_CAPTURE" />' in queries


def test_no_camera_permission_is_asked_for():
    # Declaring CAMERA would make Capacitor demand it first and fail silently
    # on a "no"; the camera app holds the permission, not us.
    assert "android.permission.CAMERA" not in _no_comments(MANIFEST)
    assert "READ_MEDIA_IMAGES" not in _no_comments(MANIFEST)
    assert "READ_EXTERNAL_STORAGE" not in _no_comments(MANIFEST)


def test_the_same_photo_can_be_picked_again():
    src = (FE / "src" / "pages" / "MyWork.js").read_text(encoding="utf-8")
    on_photo = src[src.index("const onPhoto = (e) => {"):]
    on_photo = on_photo[: on_photo.index("\n  };")]
    assert 'e.target.value = "";' in on_photo
