"""Leave has a page of your own again (2026-09-19).

Yokesh: "in the mobile PWA, Leave redirects to the Team section. It has to go
to the leave section, where we can raise a leave request, and it has to show
the leave history. Don't add a leave approval section — that's in Approvals.
On desktop, in My Work, just add a Request leave button."

ASK-6 (2026-09-12) retired /leave to Team, which holds the company's leave
register — so the phone's Leave tile opened Team and a phone had no way to ask
for time off. The backend never changed: POST /leaves, POST /leaves/absence
and GET /leaves?scope=mine are open to every signed-in person. These guard the
wiring the screens now depend on.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


def test_leave_is_a_page_not_a_redirect_to_team():
    app = _fe("App.js")
    assert '<Route path="/leave" element={<Protected><Leave /></Protected>} />' in app
    assert '<Route path="/leave" element={<Navigate to="/team" replace />} />' not in app


def test_the_phones_leave_tile_opens_it():
    panel = _fe("components", "mobile", "AllAppsPanel.jsx")
    assert '{ key: "leave", to: "/leave",' in panel


def test_the_page_is_the_requesters_side_only():
    page = _fe("pages", "Leave.js")
    body = page[page.index("export default function Leave()"):]
    assert '"/leaves?scope=mine"' in body, "your own requests"
    assert "<RequestLeaveDialog" in body and "<AbsenceDialog" in body, "raise one, or report today"
    assert 'data-testid="leave-history"' in body and 'data-testid="leave-upcoming"' in body
    # approving lives in Approvals; approver settings in Settings › Operations
    assert "scope=approvals" not in body and "canAct={false}" in body
    assert "leave-settings-toggle" not in body and "<ApproverConfig" not in body


def test_my_work_on_desktop_can_request_leave():
    mywork = _fe("pages", "MyWork.js")
    assert "import { LeaveCard, RequestLeaveDialog } from \"./Leave\";" in mywork
    assert "<RequestLeaveDialog" in mywork
    assert "export function RequestLeaveDialog" in _fe("pages", "Leave.js"), "one form, shared"


def test_a_decision_on_your_leave_opens_your_request():
    notif = _fe("lib", "notif.js")
    # the approver's "X asked for leave" still goes to the queue ...
    assert 'n?.type === "approval") return `/inbox?leave=${n.entity_id}`' in notif
    # ... and "your leave was approved / rejected / needs info" opens yours
    assert "return `/leave?leave=${n.entity_id}`" in notif
