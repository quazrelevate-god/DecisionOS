"""A role reads the same on every screen, out of one function (2026-09-29).

Yokesh, after the header fix: "sweep the rest of the role labels .. COMPLETE
APPLICATION".

The sweep found the real reason the key kept leaking onto screens. It was not
carelessness at any one call site — it was that the codebase held SIX
implementations of "name this role":

    lib/departments.deptName      the 2026-09-21 one, whose own docstring
                                  already said "one helper, so every screen
                                  that names a department says the same words"
    lib/perms.roleLabel           which I added that same morning, without
                                  noticing the file above existed
    MyWork.teamLabel
    Team.roleName
    Team.roleNameFor  (+ its own `humanize`)
    OperatingScore.roleLabelFor
    Tasks.NewTaskDialog's own     a `const` inside the component, so it
                                  SHADOWED the shared one for the whole of
                                  the New Task form

Six copies is how a screen ends up printing `sales_&_order_management`: not
because anyone chose to, but because the copy within reach did not have the
fix. They all call one function now, in lib/departments — the oldest and best
of them, since it already handled `_&_`.

What a reader sees, everywhere: the label the owner typed in Settings, else
the key read as words. The keys are slugs of the labels, so the fallback lands
on the right words by itself, which is what makes it safe in the two places
that cannot know the labels — the workspace switcher (a role held in ANOTHER
company) and the platform admin console (someone else's company entirely).
"""
from pathlib import Path

import pytest

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def src(rel):
    return (FE / rel).read_text(encoding="utf-8")


# ───────────────────────── one implementation ──────────────────────────────
def test_the_words_come_from_one_place():
    d = src("lib/departments.js")
    assert "export function roleWords(key)" in d
    assert "export function roleLabel(key, roles = null, fallback" in d
    assert "export function deptName(tenant, key)" in d
    assert "return roleLabel(key, tenant?.roles, \"\");" in d, "deptName delegates, it does not duplicate"


def test_the_label_the_owner_typed_wins_over_the_key():
    d = src("lib/departments.js")
    i_named = d.index("const named = (roles || []).find")
    i_words = d.index("return (named && named.label) || roleWords(key);")
    assert i_named < i_words


def test_the_fallback_reads_an_ai_generated_key_as_words():
    """`sales_&_order_management` has to come out as "Sales & Order
    Management": `_&_` first, then the rest of the underscores, then a capital
    on every word — the last of which Team's `humanize` did and this file's
    own fallback did not."""
    d = src("lib/departments.js")
    body = d[d.index("export function roleWords"):d.index("/** A role in the company")]
    assert '.replace(/_&_/g, " & ")' in body
    assert '.replace(/_/g, " ")' in body
    assert ".replace(/\\b\\w/g, (c) => c.toUpperCase())" in body


@pytest.mark.parametrize("rel,gone", [
    ("lib/perms.js", "roleLabel"),
    ("pages/Team.js", "const humanize ="),
])
def test_the_duplicates_are_gone(rel, gone):
    assert gone not in src(rel)


@pytest.mark.parametrize("rel,call", [
    ("pages/MyWork.js", "const teamLabel = (key) => roleLabel(key, roleOptions);"),
    ("pages/Team.js", 'const roleNameFor = (roles, key) => roleLabel(key, roles, "Unassigned");'),
    ("pages/Team.js", "const roleName = (key) => roleLabel(key, roleOptions);"),
    ("pages/OperatingScore.js", "const roleLabelFor = (roles, key) => roleLabel(key, roles);"),
])
def test_what_is_left_of_each_local_copy_is_a_call_to_the_one(rel, call):
    assert call in src(rel)


# ───────────────────────── no screen prints the key ────────────────────────
@pytest.mark.parametrize("rel,raw", [
    # the picker that chooses who does a task, who helps, who is waited on
    ("pages/MyWork.js", "${m.name} · ${m.role}"),
    # who covers your approvals while you are away, and who approves a team
    ("pages/Leave.js", "${m.name} · ${m.role}"),
    # (pages/Contacts.js was the sixth; E2-01 had retired it to a redirect and
    #  nothing imported it, so this sweep was maintaining a file nobody could
    #  reach. Deleted 2026-10-03 — see test_a_picker_does_not_invite_a_duplicate.)
    # the stage-work review
    ("components/StageWorkReview.js", "· {r.role}</span>"),
    # the header, both lines
    ("components/Layout.js", 'capitalize text-muted-foreground">{user?.role'),
    ("components/Layout.js", 'capitalize text-slate-500">{r.role}'),
    # "Among the <role> peers" on a person's Ops page
    ("pages/OperatingScore.js", ">{peer.role}<"),
    # the platform admin console looks at other people's companies
    ("pages/admin/AdminSections.js", "uppercase text-white/50\">{u.role}"),
    ("pages/admin/Tenant360Section.js", "· {u.role}</span>"),
    ("pages/admin/Tenant360Section.js", "· {m.role}</span>"),
])
def test_the_stored_key_is_not_rendered(rel, raw):
    assert raw not in src(rel), f"{rel} still prints the key"


@pytest.mark.parametrize("rel", [
    "pages/MyWork.js", "pages/Leave.js",
    "components/StageWorkReview.js", "components/Layout.js", "pages/Team.js",
    "pages/OperatingScore.js", "pages/admin/AdminSections.js",
    "pages/admin/Tenant360Section.js",
])
def test_every_screen_that_names_a_role_imports_the_one_function(rel):
    s = src(rel)
    assert "lib/departments" in s, rel
    # and the import is a top-level statement, not wedged into a multi-line
    # one — which is exactly how this sweep broke the build the first time.
    line = next(l for l in s.split("\n") if "lib/departments" in l and l.startswith("import "))
    assert line.rstrip().endswith(";"), f"{rel}: {line[:70]}"


def test_a_person_with_no_role_is_not_called_none():
    """Each caller gives its own word for nobody: the header says "Member",
    the Team page "Unassigned", and a picker just leaves it blank."""
    assert 'roleLabel(user?.role, tenant?.roles, "Member")' in src("components/Layout.js")
    assert '"Unassigned"' in src("pages/Team.js")
    assert 'roleLabel(r.role, null, "")' in src("components/Layout.js")


# ───────────── the rest of the application (2026-09-29, mobile pass) ───────
@pytest.mark.parametrize("rel,raw", [
    # the WhatsApp capture card, in the Finance inbox
    ("pages/Captures.js", "review: {c.reviewer_role}"),
    ("pages/Captures.js", "` (${c.sender_role})`"),
    ("pages/Captures.js", "`routed to the ${c.reviewer_role} team`"),
    # a contact's open work
    ("pages/ContactProfile.js", "<Chip value={t.assignee_role}"),
    # what Dex reads back about a decision it just captured
    ("hooks/useDexConversation.js", "`${t.assignee_role} team`"),
    # the platform admin's impersonation list
    ("pages/admin/ImpersonationSection.js", "· {s.target_role}</span>"),
    # and the one inside MyWork that had the logic but not the helper
    ("pages/MyWork.js", "roleOptions.find((r) => r.key === t.assignee_role)?.label"),
])
def test_the_last_of_the_stored_keys_are_gone(rel, raw):
    assert raw not in src(rel), f"{rel} still prints the key"


def test_the_copy_that_shadowed_the_shared_one_is_gone():
    """Tasks.js had `const roleLabel = (key) => ...` INSIDE NewTaskDialog, so
    for that whole component — the live New Task form — the import resolved to
    the local copy instead. A seventh implementation, and an invisible one."""
    t = src("pages/Tasks.js")
    assert "const roleLabel = (key) =>" not in t
    assert 'import { roleLabel } from "../lib/departments";' in t
    # every call in the file now hands over a role list or takes the fallback
    for call in ("roleLabel(teamKey, roleOptions)", "roleLabel(m.role, roleOptions)",
                 "roleLabel(user?.role, tenant?.roles)"):
        assert call in t, call


def test_a_component_without_a_role_list_takes_the_fallback_rather_than_throwing():
    """CaptureCard and ContactProfile's Table are plain components with no
    tenant in scope; reaching for `tenant?.roles` there would have been a
    ReferenceError, not a label."""
    assert "roleLabel(c.reviewer_role)" in src("pages/Captures.js")
    assert "roleLabel(t.assignee_role)" in src("pages/ContactProfile.js")


def test_the_phone_shows_no_role_of_its_own():
    """Asked directly: is this done on mobile too. The mobile shell has no
    role text of its own — the avatar line that carried it is desktop-only
    (`hidden xl:block`) — so what a phone shows is the same pickers, Team
    list and Ops page as the desktop, all of which read the shared function.
    Asserted so that a mobile header gaining a role line does not quietly
    reintroduce the key."""
    from pathlib import Path
    mobile = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "mobile"
    for f in mobile.rglob("*.jsx"):
        text = f.read_text(encoding="utf-8")
        for bad in ("{user.role}", "{user?.role}", "${user.role}", "${m.role}", "{m.role}"):
            assert bad not in text, f"{f.name} renders a role key"
