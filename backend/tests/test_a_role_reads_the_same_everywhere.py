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
    # who owns a contact
    ("pages/Contacts.js", "{u.name} ({u.role})"),
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
    "pages/MyWork.js", "pages/Leave.js", "pages/Contacts.js",
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
