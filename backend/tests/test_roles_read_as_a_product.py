"""Roles read as a product (2026-10-03).

Walked end to end in the browser as the owner: give a team access in
Settings > Teams, add a member to that team with "Use the team's access",
confirm the server resolves the team's access for them, change the team, and
confirm the change reaches them (and not a member with their own access). The
chain works. What the walk found was the screens describing it wrongly:

  - "They will see these menus" was a hand-kept list that still offered CEO
    Brief and Meeting Notes (both retired), called CRM "People", and never
    mentioned Finance -- an Accounts member with Finance on was previewed
    without it. It is now read from Layout's real NAV and its own rule.
  - Three places told the owner "owners always have everything", which stopped
    being true when "What owners can open" shipped.
  - Each team showed its internal key (sales_&_order_management) beside its name.
  - Nineteen permissions in one flat list; now six groups by area.
  - The Desk's "Spend, this month" showed the last month that had ANY spend,
    and "..." (loading) forever when there was none.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def src(rel):
    return (FE / rel).read_text(encoding="utf-8")


def test_the_menu_preview_is_the_real_nav():
    team = src("pages/Team.js")
    assert "const MENU_PREVIEW" not in team
    assert 'import { NAV, navEntryOpen } from "../components/Layout";' in team
    assert "previewMenus(shownPerms).map(" in team
    assert "\"CEO Brief\"" not in team and "\"Meeting Notes\"" not in team  # as on-screen labels
    assert '"Finance (upload only)"' in team


def test_the_nav_and_the_preview_share_one_rule():
    layout = src("components/Layout.js")
    assert "export const NAV = [" in layout
    assert "export function navEntryOpen(n, isOwner, has)" in layout
    assert "NAV.filter((n) => navEntryOpen(n," in layout


def test_no_screen_says_owners_always_have_everything():
    for rel in ("components/CompanyDetails.js", "pages/Team.js"):
        s = src(rel)
        assert "owners always have everything" not in s, rel
    assert "except any area switched off for owners" in src("pages/Team.js")
    # the member profile reads the resolved list, exclusions included
    assert 'const perms = u.role === "owner" ? PERMISSIONS.map' not in src("pages/Team.js")


def test_a_team_is_shown_by_its_name_not_its_key():
    assert '<span className="label-mono text-muted-foreground shrink-0 hidden sm:inline">{r.key}</span>' \
        not in src("components/CompanyDetails.js")


def test_every_permission_is_in_exactly_one_group():
    p = src("lib/perms.js")
    keys = re.findall(r'\{ key: "(\w+)"', p[:p.index("export const PERMISSION_KEYS")])
    block = p[p.index("export const PERMISSION_GROUPS"):p.index("].map((g)")]
    grouped = [k for m in re.findall(r"keys: \[([^\]]*)\]", block) for k in re.findall(r'"(\w+)"', m)]
    assert sorted(grouped) == sorted(keys)
    assert len(grouped) == len(set(grouped))


def test_both_access_editors_are_grouped():
    assert "PERMISSION_GROUPS.map((g) => (" in src("components/CompanyDetails.js")
    assert "PERMISSION_GROUPS.map((g) => (" in src("pages/Team.js")


def test_spend_this_month_is_this_month_and_zero_is_zero():
    m = src("pages/desk/useDeskMetrics.js")
    assert "lastMonthSpend: d.by_month?.length ? Number(d.by_month[d.by_month.length - 1].amount) : null" not in m
    assert "x.month === thisMonthKey())?.amount) || 0" in m
