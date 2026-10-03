"""Every read says who may make it (RBAC audit, 2026-10-03).

test_s3_role_matrix has long made every WRITE endpoint declare a gate. Nothing
did the same for READS, and the audit found what that let through: a member
with no access at all could read every voice-note transcript, every pending
decision (/dashboard), every workflow and its tasks, every complaint, every
task title (via the calendar), what each customer owes, uploaded bills, the
retired meetings' transcripts and the invitees' phone numbers -- while the
screens themselves showed that member almost nothing.

Measured before and after with the same four people (owner, a default member,
a finance member, and a member given no access): every change was a refusal
or a narrowing for the three members, and the owner's answers were identical
on every endpoint.

The inventory test below is the guard that was missing. A read open to any
signed-in member must be on OPEN_TO_EVERY_MEMBER with the reason it is safe
-- usually that the handler itself narrows the rows to the caller -- so a new
read cannot arrive without someone deciding who it is for.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FE = ROOT / "frontend" / "src"
BE = ROOT / "backend"


def fe(rel):
    return (FE / rel).read_text(encoding="utf-8")


def be(rel):
    return (BE / rel).read_text(encoding="utf-8")


# ───────────────────────── the inventory ─────────────────────────
# Reads any signed-in member may make, and why that is safe.
OPEN_TO_EVERY_MEMBER = {
    # about the caller themselves
    "/api/auth/me": "self", "/api/auth/me/sessions": "self", "/api/auth/me/workspaces": "self",
    "/api/account/deletion": "self", "/api/me/acting-as": "self", "/api/notifications": "self",
    "/api/dex/inflight-count": "self", "/api/work-coach": "self, or owner-only for others (_resolve_coach_target)",
    "/api/operating-score": "self view for members; company view for owners (handler)",
    "/api/routines/setup": "people list owner-only inside the handler",
    # the company's plan and switches, no business data
    "/api/announcements/active": "platform notices", "/api/billing/plans": "price list",
    "/api/billing/status": "plan state", "/api/tenant/plan": "plan state", "/api/tenant/usage": "quota meters",
    "/api/tenant/ai-consent": "whether AI is on", "/api/tenant/ai-setup/status": "setup health",
    "/api/whatsapp/status": "configured or not, no messages",
    # narrowed to the caller inside the handler
    "/api/tasks": "task_list_query", "/api/tasks/{task_id}": "_can_work_task etc.",
    "/api/tasks/{task_id}/activity": "same rule as the task",
    "/api/decisions": "participants", "/api/decisions/{decision_id}": "_decision_participants",
    "/api/decisions/{decision_id}/timeline": "_decision_participants",
    "/api/decisions/{decision_id}/moves": "_decision_participants (2026-10-03)",
    "/api/decisions/{decision_id}/approvers": "participants",
    "/api/voice-notes": "owner, recorder, or the decision's people (2026-10-03)",
    "/api/voice-notes/{note_id}": "same", "/api/voice-notes/{note_id}/audio": "same",
    "/api/complaints": "complaint_scope: contacts you may open (2026-10-03)",
    "/api/contacts": "crm_types", "/api/crm/outstanding": "crm_types (2026-10-03)",
    "/api/calendar": "each event by its own screen's rule (2026-10-03)",
    "/api/captures": "reviewer role or permission", "/api/captures/pending-count": "same",
    "/api/leaves": "own, or leave_approve", "/api/leaves/on-leave": "who is away today (availability)",
    "/api/leaves/{leave_id}": "own, approver, or leave_approve", "/api/leaves/{leave_id}/impact": "same",
    "/api/whatsapp/logs": "finance/owner inside the handler",
    "/api/desk": "per-person cards", "/api/desk/summary": "per-person narrative",
    "/api/brief": "per-person brief", "/api/brief/details": "per-person brief", "/api/pulse": "per-person change stamps",
    # the team is visible to everyone by design (U7-09.TEAM)
    "/api/users": "roster, read-only for members", "/api/users/{uid}/temp-grants": "transparency by design (RBAC-27)",
    # the company's own support conversation with us
    "/api/support/tickets": "company tickets", "/api/support/tickets/{ticket_id}": "company tickets",
    # by unguessable id only; see the report on file access
    "/api/files/{file_id}/download": "may_read_file: the record the file belongs to (2026-10-03)",
    "/api/files/{fname}": "may_read_file, Finance/Data Input for bills, the review queue for drafts",
}


def _gates(route):
    out = []

    def walk(d):
        c = getattr(d, "call", None)
        if c is not None:
            name = getattr(c, "__name__", "")
            if name == "checker":
                env = dict(zip(c.__code__.co_freevars, [x.cell_contents for x in (c.__closure__ or ())]))
                if "perm" in env:
                    out.append(("perm", env["perm"]))
                elif "perms" in env:
                    out.append(("any", tuple(env["perms"])))
                elif "roles" in env:
                    out.append(("role", tuple(env["roles"])))
            elif name in ("require_ledger", "require_crm", "get_platform_admin", "get_current_admin"):
                out.append((name, None))
        for s in getattr(d, "dependencies", []):
            walk(s)
    walk(route.dependant)
    return out


@pytest.fixture(scope="module")
def routes():
    from server import app
    from fastapi.routing import APIRoute
    return {(m, r.path): _gates(r) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}


PUBLIC_READS = {"/api/health", "/api/", "/api/brochure", "/api/auth/email/verify/{token}",
                "/api/auth/invite/{token}", "/api/onboarding/draft/{draft_id}", "/api/webhooks/whatsapp"}


def test_every_read_is_gated_or_on_the_reviewed_list(routes):
    from server import app
    from fastapi.routing import APIRoute
    authed = set()
    for r in app.routes:
        if isinstance(r, APIRoute) and "GET" in r.methods:
            names = set()

            def walk(d):
                c = getattr(d, "call", None)
                if c is not None:
                    names.add(getattr(c, "__name__", ""))
                for s in getattr(d, "dependencies", []):
                    walk(s)
            walk(r.dependant)
            if names & {"get_current_user"} and not _gates(r):
                authed.add(r.path)
    unreviewed = sorted(p for p in authed if p not in OPEN_TO_EVERY_MEMBER and p not in PUBLIC_READS)
    assert not unreviewed, (
        "Reads open to every signed-in member that nobody has decided about. Gate "
        "them (require_perm / require_role / require_any_perm), or add them to "
        "OPEN_TO_EVERY_MEMBER with the reason it is safe:\n  " + "\n  ".join(unreviewed))


@pytest.mark.parametrize("path,gate", [
    ("/api/workflows", ("perm", "workflows")),
    ("/api/workflows/counts", ("perm", "workflows")),
    ("/api/workflows/{workflow_id}", ("perm", "workflows")),
    ("/api/workflows/{workflow_id}/leftover", ("perm", "workflows")),
    ("/api/memory", ("perm", "brain")),
    ("/api/brain/context", ("perm", "brain")),
    ("/api/brain/documents", ("perm", "brain")),
    ("/api/brain/documents/{doc_id}", ("perm", "brain")),
    ("/api/brain/documents/{doc_id}/download", ("perm", "brain")),
    ("/api/invites", ("perm", "team_manage")),
    ("/api/attendance", ("perm", "team_manage")),
    ("/api/inbox", ("role", ("owner",))),
    ("/api/dashboard", ("role", ("owner",))),
    ("/api/meetings", ("role", ("owner",))),
    ("/api/meetings/{meeting_id}", ("role", ("owner",))),
    ("/api/ingest", ("any", ("finance", "data_input"))),
    ("/api/ingest/{ingestion_id}", ("any", ("finance", "data_input"))),
])
def test_the_reads_the_audit_closed(routes, path, gate):
    assert gate in routes[("GET", path)], (path, routes[("GET", path)])


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/brain/agent"), ("POST", "/api/brain/agent/run"), ("POST", "/api/brain/agent/create-task"),
])
def test_the_agent_asks_for_ask_as_ask_does(routes, method, path):
    assert ("perm", "ask") in routes[(method, path)]
    assert ("perm", "ask") in routes[("POST", "/api/ask")]


def test_the_inbox_status_write_follows_its_read(routes):
    assert ("role", ("owner",)) in routes[("POST", "/api/inbox/{item_id}/status")]


# ───────────────────────── narrowed inside the handler ─────────────────────────
def test_a_transcript_follows_the_recording_rule():
    v = be("routers/voice_notes.py")
    assert "async def _may_read_note(user: dict, note: dict) -> bool:" in v
    assert 'if not await _may_read_note(user, note):' in v
    assert 'q["$or"] = [{"created_by": user["id"]}, {"id": {"$in": await _notes_heard_via_decisions(user)}}]' in v


def test_complaints_follow_the_contact():
    c = be("routers/complaints.py")
    assert "q.update(await complaint_scope(user))" in c
    assert 'return {"$or": [{"customer_id": {"$in": ids}}, {"created_by": user["id"]}]}' in c


def test_what_a_contact_owes_follows_crm_access():
    c = be("routers/crm.py")
    assert "visible = crm_types(user)" in c
    assert "out = {cid: b for cid, b in out.items() if cid in allowed}" in c


def test_the_calendar_shows_each_thing_by_its_own_rule():
    c = be("routers/calendar.py")
    assert "tq = task_list_query(user," in c
    assert '**(await complaint_scope(user))' in c
    assert '"type": {"$in": list(crm_types(user))}' in c
    assert 'if "workflows" in perms else []' in c


def test_a_decisions_moves_follow_the_decision():
    d = be("routers/decisions.py")
    i = d.index("async def decision_moves(")
    assert "_decision_participants" in d[i:i + 900]


def test_seeing_a_draft_and_acting_on_it_are_one_rule():
    c = be("routers/captures.py")
    assert 'on_queue = d.get("reviewer_role") == user["role"] or d.get("reviewer_perm") in user_perms(user)' in c


# ───────────────────────── what owners were switched off from ─────────────────────────
def test_owner_access_is_read_from_permissions_so_exclusions_hold():
    """Settings > What owners can open removes keys from an owner's
    permissions; a `role == "owner" or <perm>` shortcut walked around it."""
    import re
    pat = re.compile(r'role"?\)?\s*==\s*"owner"\s+or\s+"(\w+)"\s+in\s+(user_perms|perms)')
    for rel in ("routers/tasks.py", "routers/team.py", "routers/calendar.py",
                "services/operating_score.py", "services/tasks.py"):
        left = [m.group(1) for m in pat.finditer(be(rel)) if m.group(1) != "team_manage"]
        assert not left, (rel, left)


def test_owner_exclusions_are_unit_true():
    from core.permissions import user_perms
    owner = {"role": "owner", "_owner_exclusions": ["finance"]}
    assert "finance" not in user_perms(owner)
    from services.tasks import can_see_all_tasks
    assert can_see_all_tasks({"role": "owner"}, user_perms({"role": "owner"}))
    assert not can_see_all_tasks({"role": "owner"},
                                 user_perms({"role": "owner", "_owner_exclusions": ["tasks_view_all"]}))


# ───────────────────────── the screens ask what the server asks ─────────────────────────
def test_the_ui_reads_resolved_permissions_for_owners_too():
    p = fe("lib/perms.js")
    i = p.index("export function userPerms(user)")
    body = p[i:i + 900]
    assert body.index("user.effective_permissions") < body.index('user.role === "owner"')
    j = p.index("export function hasPerm(user, perm)")
    assert 'if (user.role === "owner") return true;' not in p[j:j + 200]


def test_sign_in_fetches_the_resolved_permissions():
    a = fe("context/AuthContext.js")
    i = a.index("const persist = (data) => {")
    assert "askMe();" in a[i:i + 1200]


def test_no_screen_walks_around_an_owner_exclusion():
    import re
    pat = re.compile(r'role === "owner" \|\| (hasPerm\(user, "\w+"\)|userPerms\(user\)\.includes\("\w+"\))')
    hits = []
    for f in list(FE.rglob("*.js")) + list(FE.rglob("*.jsx")):
        if "fixtures" in f.parts:
            continue
        if pat.search(f.read_text(encoding="utf-8")):
            hits.append(str(f.relative_to(FE)))
    assert not hits, hits


def test_ai_draft_actions_need_the_approve_permission():
    c = fe("pages/Captures.js")
    assert '!hasPerm(user, "captures_approve") ?' in c
    assert "capture-needs-approver-" in c


def test_export_needs_brain_export():
    assert '!hasPerm(user, "brain_export")' in fe("pages/AskAI.js")


def test_approve_needs_decisions_approve_even_for_the_named_approver():
    d = fe("components/DecisionDialog.js")
    assert 'const mayDecide = canDecide && userPerms(user).includes("decisions_approve")' in d


def test_the_desk_does_not_ask_for_workflows_it_may_not_read():
    d = fe("pages/Desk.js")
    assert 'const seesWorkflows = hasPerm(user, "workflows");' in d
    assert "enabled: seesWorkflows," in d
    assert "{seesWorkflows && (" in d


def test_a_workflow_name_is_a_door_only_for_those_who_may_enter():
    # (and, since the pipeline scoping, only into a pipeline their team works in)
    assert 'if (hasPerm(user, "workflows") && canSeePipeline(user, type))' in fe("components/workflow/WorkflowLink.js")
    assert fe("pages/MyWork.js").count("<WorkflowLink") == 2
    assert "<WorkflowLink" in fe("components/DecisionDialog.js")


def test_asking_without_ask_access_says_so():
    b = fe("pages/Brain.js")
    assert 'const canAsk = hasPerm(user, "ask");' in b
    assert "e?.response?.status === 403 ? NO_ASK" in b
