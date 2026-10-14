"""The iOS app stays submittable (App Store audit, 2026-10-14).

docs/APP_STORE_READINESS.md has the audit; this pins the parts of it that live
in the repo, so a later change cannot quietly undo one. Every assertion names
the Apple rule it is for.
"""
import plistlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FE = ROOT / "frontend"
SRC = FE / "src"
IOS = FE / "ios" / "App"
INFO = plistlib.loads((IOS / "App" / "Info.plist").read_bytes())
MANIFEST = plistlib.loads((IOS / "App" / "PrivacyInfo.xcprivacy").read_bytes())
PBX = (IOS / "App.xcodeproj" / "project.pbxproj").read_text(encoding="utf-8")
GRADLE = (FE / "android" / "variables.gradle").read_text(encoding="utf-8")


def _no_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"(?<![\"'*])/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


# ── Info.plist and the binary ────────────────────────────────────────────────

def test_every_protected_resource_has_a_purpose_string():
    # 5.1.1(ii): asking for one without its string is an uncatchable crash.
    for key in ("NSMicrophoneUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"):
        assert len(INFO.get(key, "")) > 60, f"{key} must say what the app does with it"


def test_upload_validation_keys():
    assert INFO["ITSAppUsesNonExemptEncryption"] is False   # HTTPS only: exempt, no manual question per build
    assert INFO["CFBundleIconName"] == "AppIcon"
    assert INFO["UILaunchStoryboardName"] == "LaunchScreen"
    assert INFO["UIRequiredDeviceCapabilities"] == ["arm64"]
    assert INFO["UISupportedInterfaceOrientations"] == ["UIInterfaceOrientationPortrait"]
    # The UIScene life cycle is required from the iOS 27 SDK (TN3187); it is already in.
    assert "UIApplicationSceneManifest" in INFO


def test_iphone_only_and_a_supported_deployment_target():
    assert "TARGETED_DEVICE_FAMILY = 1;" in PBX          # 2.4.1: you are graded on what you declare
    assert "TARGETED_DEVICE_FAMILY = \"1,2\"" not in PBX
    for v in re.findall(r"IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);", PBX):
        assert float(v) >= 13.0                           # Apple's floor since 9 Sep 2026


def test_ios_and_android_versions_move_together():
    ios_name = set(re.findall(r"MARKETING_VERSION = ([0-9.]+);", PBX))
    ios_code = set(re.findall(r"CURRENT_PROJECT_VERSION = ([0-9]+);", PBX))
    name = re.search(r'appVersionName = System.getenv\("ANDROID_VERSION_NAME"\) \?: "([0-9.]+)"', GRADLE).group(1)
    code = re.search(r'appVersionCode = \(System.getenv\("ANDROID_VERSION_CODE"\) \?: "([0-9]+)"\)', GRADLE).group(1)
    assert ios_name == {name} and ios_code == {code}, "bump MARKETING_VERSION / CURRENT_PROJECT_VERSION with variables.gradle"


def test_the_privacy_manifest_declares_what_the_app_collects():
    # Since 1 May 2024 an upload without it is refused.
    assert MANIFEST["NSPrivacyTracking"] is False
    reasons = {a["NSPrivacyAccessedAPIType"]: a["NSPrivacyAccessedAPITypeReasons"] for a in MANIFEST["NSPrivacyAccessedAPITypes"]}
    assert reasons.get("NSPrivacyAccessedAPICategoryUserDefaults") == ["CA92.1"]
    declared = {d["NSPrivacyCollectedDataType"] for d in MANIFEST["NSPrivacyCollectedDataTypes"]}
    for needed in (
        "NSPrivacyCollectedDataTypePhoneNumber", "NSPrivacyCollectedDataTypeName",
        "NSPrivacyCollectedDataTypeEmailAddress", "NSPrivacyCollectedDataTypeAudioData",
        # 2026-10-14: bill and receipt photos are uploaded — they were not declared.
        "NSPrivacyCollectedDataTypePhotosorVideos",
        "NSPrivacyCollectedDataTypeOtherUserContent", "NSPrivacyCollectedDataTypeOtherFinancialInfo",
        "NSPrivacyCollectedDataTypeUserID", "NSPrivacyCollectedDataTypeProductInteraction",
        "NSPrivacyCollectedDataTypeOtherDiagnosticData", "NSPrivacyCollectedDataTypeDeviceID",
    ):
        assert needed in declared, needed
    assert all(d["NSPrivacyCollectedDataTypeTracking"] is False for d in MANIFEST["NSPrivacyCollectedDataTypes"])
    assert "PrivacyInfo.xcprivacy in Resources" in PBX, "a manifest not in Copy Bundle Resources is not in the app"


def test_the_app_runs_the_code_it_shipped_with():
    # 2.5.2: no remote server URL in the shipped config — only a dev live-reload, from an env var.
    cfg = (FE / "capacitor.config.ts").read_text(encoding="utf-8")
    assert re.search(r"process\.env\.CAP_LIVE_RELOAD_URL\s*\?\s*\{\s*url: process\.env\.CAP_LIVE_RELOAD_URL", cfg)
    assert not re.search(r"^\s*url:\s*['\"]https?://", cfg, flags=re.M)


# ── What the app says and offers ────────────────────────────────────────────

def _app_sources():
    for path in list(SRC.rglob("*.js")) + list(SRC.rglob("*.jsx")):
        rel = path.relative_to(SRC).as_posix()
        # The admin portal and the design lab are not in the store build (App.js).
        if rel.startswith(("pages/admin/", "pages/designlab/", "fixtures/")) or rel in ("pages/DesignLab.js",) or ".test." in rel:
            continue
        yield rel, path.read_text(encoding="utf-8")


def test_no_other_platform_is_named_to_an_iphone_user():
    # 2.3.10. The privacy policy may describe Android's push (it is true and it
    # is a legal statement); nothing else the iOS app shows may name Android
    # or Google Play.
    offenders = []
    for rel, src in _app_sources():
        code = _no_comments(src)
        for m in re.finditer(r"[\"'`>][^\"'`<]*\b(Google Play|Play Store|Android)\b[^\"'`<]*", code):
            text = m.group(0)
            if rel == "pages/Privacy.js" and re.search(r"on Android|Firebase", text):
                continue
            if re.search(r"getPlatform|=== ?[\"']android|android-sa", text):
                continue
            offenders.append(f"{rel}: {text.strip()[:80]}")
    assert not offenders, offenders


def test_the_microphone_way_out_is_the_phones_own():
    mic = (SRC / "lib" / "native" / "mic.js").read_text(encoding="utf-8")
    assert "Settings › DecisionOS › Microphone" in mic                 # iOS
    assert "Settings › Apps › DecisionOS › Permissions › Microphone" in mic  # Android
    assert "return isIOS()" in mic


def test_nothing_is_sold_or_pointed_to_inside_the_store_build():
    # 3.1.1 / 3.1.3: no purchase, no upgrade call to action, no link out to buy.
    card = (SRC / "components" / "settings" / "PlanCard.jsx").read_text(encoding="utf-8")
    assert "!paidTop && !STORE_BUILD" in card and "p && !STORE_BUILD && <UpgradeDialog" in card
    assert card.count('STORE_BUILD ? ""') >= 2, "the trial lines must not say 'choose a plan' in the store build"
    terms = (SRC / "pages" / "Terms.js").read_text(encoding="utf-8")
    assert "nothing is sold inside the app" in terms


def test_ai_providers_are_named_where_consent_is_given():
    # 5.1.2(i) (13 Nov 2025): disclose where personal data goes, including
    # third-party AI, and get explicit permission first.
    settings = (SRC / "pages" / "Settings.js").read_text(encoding="utf-8")
    card = settings[settings.index('data-testid="ai-consent-disclosure"'):][:1500]
    for name in ("Anthropic", "OpenAI", "Google (Gemini)", "Sarvam"):
        assert name in card, name
    assert "Agree and turn on" in settings and "Turn off AI" in settings
    signup = (SRC / "pages" / "onboarding" / "SignupConsent.js").read_text(encoding="utf-8")
    assert "Anthropic, OpenAI, Google, Sarvam" in signup
    notice = (SRC / "components" / "MicNoticeHost.js").read_text(encoding="utf-8")
    assert "Sarvam or OpenAI" in notice


def test_every_user_can_delete_their_account_in_the_app():
    # 5.1.1(v).
    settings = (SRC / "pages" / "Settings.js").read_text(encoding="utf-8")
    assert settings.count('<Section id="settings-s-delete" label="Delete your account"><DeleteAccountCard /></Section>') == 2
    assert 'api.post("/account/delete"' in settings
    app = (SRC / "App.js").read_text(encoding="utf-8")
    assert 'path="/delete-account"' in app and 'path="/privacy"' in app and 'path="/terms"' in app


def test_reviewers_can_sign_in_without_an_indian_sms():
    # 2.1: the store build has no demo login, so the reviewer account signs in
    # with an email and password — the tab has to be there.
    login = (SRC / "pages" / "Login.js").read_text(encoding="utf-8")
    assert 'data-testid="login-tab-password"' in login and 'data-testid="login-password-input"' in login
    assert "const DEMO = STORE_BUILD ? [] :" in login
