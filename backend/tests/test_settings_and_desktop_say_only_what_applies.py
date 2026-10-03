"""Settings and the desktop say only what applies (2026-10-03, founder review).

Walked in the browser as the owner, a default member and a finance member:

  - The audit log read "Logout - A member" for everyone who signs in by mobile
    (no email to show). It names them now.
  - "AI keys" listed Wa_access_token and Wa_phone_number_id as if they were AI
    providers. Named, and the card says it holds WhatsApp keys too.
  - Leave approvers pointed at "People -> Employees", a screen retired long ago.
  - "While you're away - hand your approvals" was offered to a member who
    approves nothing. It shows to approvers, managers, or a running hand-over.
  - Finance on desktop offered "Photo", which opened the same file picker as
    "Upload bill / receipt" (a laptop has no camera to point at a receipt).
  - Desktop Chrome was offered the phone app's install bar from the third visit.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fe(rel):
    return (ROOT / "frontend" / "src" / rel).read_text(encoding="utf-8")


def be(rel):
    return (ROOT / "backend" / rel).read_text(encoding="utf-8")


def test_the_audit_log_names_people():
    t = be("routers/tenant_settings.py")
    i = t.index("async def read_audit_log(")
    assert 'r["actor_name"] = names[r["actor_id"]]' in t[i:i + 2600]
    assert "r.actor_name || r.actor_email" in fe("pages/Settings.js")


def test_key_rows_are_named_for_people():
    s = fe("pages/Settings.js")
    assert 'wa_access_token: "WhatsApp Business access token"' in s
    assert 'wa_phone_number_id: "WhatsApp Business phone number ID"' in s
    assert ">AI and WhatsApp keys<" in s


def test_no_screen_points_at_people_employees():
    for rel in ("pages/Settings.js", "pages/Leave.js"):
        assert "People → Employees" not in fe(rel), rel


def test_the_hand_over_is_for_someone_with_approvals():
    s = fe("pages/Settings.js")
    i = s.index("function DelegationCard()")
    body = s[i:i + 4000]
    assert "if (!approves && !ac) return null;" in body
    assert "m.reporting_manager_id === user?.id" in body


def test_desktop_finance_has_no_photo_button():
    led = fe("pages/Ledger.js")
    desktop = led[led.index('data-testid="finance-capture-hero"'):]
    assert 'pick("photo"' not in desktop[:1500]
    mobile = led[led.index('data-testid="finance-capture-hero-mobile"'):led.index('data-testid="finance-capture-hero"')]
    assert 'pick("photo", Camera, "Photo"' in mobile


def test_the_install_bar_is_for_phones():
    p = fe("components/mobile/InstallPrompt.jsx")
    assert "const isMobile = useIsMobile();" in p
    assert "if (!isMobile || (!visible && !iosSheet)) return null;" in p
