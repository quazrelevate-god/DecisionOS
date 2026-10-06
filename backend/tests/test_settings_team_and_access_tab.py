"""Settings › Team & access (2026-10-05, founder: "Teams and their access are
hard to find").

Teams and their Access editor sat at the bottom of Business › Company Details,
under the GST number and the product list; who approves leave was on
Operations; what owners can open was on Workspace. One subject, three tabs.
They share a tab now. Task templates, the other passenger in Company Details,
moved to Operations, whose own description already said they lived there.

Also from the walk-through of every Settings card:
  - four cards (Company Details, Business Vocabulary, Operating Model, Leave
    approvers) were still on the old square-bordered style beside rounded glass
    cards, with square uppercase buttons;
  - on a phone the tab labels were cut ("Team & a...", "Operati...");
  - the tab row said role="tablist" while its buttons said aria-pressed;
  - a member could not see what they can open.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def src(rel):
    return (FE / rel).read_text(encoding="utf-8")


def test_team_and_access_is_its_own_tab():
    s = src("pages/Settings.js")
    assert '{ key: "team", label: "Team & access", icon: UsersThree,' in s
    body = s[s.index('{tab === "team" && ('):s.index('{tab === "operations" && (')]
    assert "<TeamsCard />" in body and "<LeaveApproversCard />" in body
    assert '{user?.role === "owner" && <Section id="settings-s-owners" label="What owners can open"><OwnerExclusionsCard /></Section>}' in body


def test_the_other_tabs_gave_their_access_cards_up():
    s = src("pages/Settings.js")
    ops = s[s.index('{tab === "operations" && ('):s.index('{tab === "money" && (')]
    assert "<LeaveApproversCard />" not in ops and "<TaskTemplatesCard />" in ops
    ws = s[s.index('{tab === "workspace" && user?.role === "owner" && ('):]
    assert "<OwnerExclusionsCard />" not in ws[:400]


def test_company_details_is_only_the_company():
    c = src("components/CompanyDetails.js")
    assert "roles-manage-list" not in c and "RoleAccessEditor" not in c
    assert "os-blueprint-section" not in c and "operational_task_templates" not in c
    assert 'data-testid="roles-manage-list"' in src("components/settings/TeamsCard.js")
    assert 'data-testid="os-blueprint-section"' in src("components/settings/TaskTemplatesCard.js")


def test_a_team_with_people_cannot_be_deleted_from_the_screen():
    t = src("components/settings/TeamsCard.js")
    assert "disabled={roleBusy || n > 0}" in t
    assert '"Move its people to another team first"' in t


def test_no_settings_card_is_on_the_old_style():
    for rel in ("components/CompanyDetails.js", "components/BusinessVocabulary.js",
                "components/OperatingModelEditor.js", "components/settings/TeamsCard.js",
                "components/settings/TaskTemplatesCard.js", "components/RegenerateWithAi.js"):
        s = src(rel)
        for old in ("nm-tile", "border-nm-edge", "text-brand-blue", "bg-brand-paper"):
            assert old not in s, f"{rel} still uses {old}"
    leave = src("pages/Leave.js")
    assert '<div className="kr-bento p-5 sm:p-6" data-testid="leave-approver-config">' in leave


def test_phone_tabs_scroll_with_whole_labels_and_are_real_tabs():
    s = src("pages/Settings.js")
    assert "overflow-x-auto rounded-pill p-1" in s
    # (since the two-pane layout the row is phone-only: <div className="lg:hidden">)
    assert "whitespace-nowrap rounded-pill px-3.5 text-xs" in s
    assert '<div className="lg:hidden">' in s
    assert 'role="tab"' in s and "aria-selected={isActive}" in s
    assert "aria-pressed={isActive}" not in s


def test_a_member_can_see_what_they_can_open():
    s = src("pages/Settings.js")
    assert "function YourAccessCard()" in s
    assert "const mine = userPerms(user);" in s
    assert s.count("<YourAccessCard />") == 2       # members' page + managers' Account tab


def test_owner_access_is_grouped_too():
    s = src("pages/Settings.js")
    i = s.index("function OwnerExclusionsCard()")
    assert "PERMISSION_GROUPS.map((g) => (" in s[i:i + 3500]


# ---- 2026-10-05: the desktop layout (founder: "lot of space, no design") ----
def test_desktop_settings_is_two_panes():
    s = src("pages/Settings.js")
    assert "function SettingsShell(" in s
    assert "lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]" in s
    assert 'className="hidden lg:sticky lg:top-6 lg:block" data-testid="settings-side-panel"' in s
    assert "max-w-2xl" not in s[s.index("export default function Settings()"):]


def test_the_side_panel_lists_only_cards_that_are_there():
    s = src("pages/Settings.js")
    hook = s[s.index("function useSettingsSections("):s.index("function SettingsSectionLinks(")]
    assert ".filter((e) => e.firstElementChild)" in hook          # a card that rendered nothing
    assert "new MutationObserver(schedule)" in hook                # cards that arrive late
    assert "setTimeout" not in hook                                # a background tab delays timers
    assert 'className="scroll-mt-6 empty:hidden"' in s


def test_every_card_is_a_named_section_for_members_and_owners():
    s = src("pages/Settings.js")
    tail = s[s.index("export default function Settings()"):]
    for card in ("<ProfileCard />", "<YourAccessCard />", "<LanguageCard />", "<SecurityCard />", "<DelegationCard />",
                 "<SignOutCard />", "<DeleteAccountCard />", "<TeamsCard />", "<OperatingModelEditor />", "<AuditLogCard />"):
        for chunk in tail.split(card)[:-1]:
            assert chunk.rstrip().endswith(">"), card
            assert "<Section id=" in chunk[chunk.rfind(chr(10)):], card


# ---- 2026-10-05: switches, not black tiles (founder: "I don't like the black dark highlighting") ----
def test_access_is_a_switch_not_a_black_tile():
    sw = src("components/settings/AccessSwitch.js")
    assert 'role="switch"' in sw and "aria-checked={on}" in sw
    assert '"bg-primary" : "bg-slate-300"' in sw
    assert "bg-neutral-900" not in sw
    for rel, testid in (("components/settings/TeamsCard.js", "testid={`role-perm-${role.key}-${p.key}`}"),
                        ("pages/Settings.js", "testid={`owner-perm-${p.key}`}"),
                        ("pages/Team.js", "testid={`perm-${p.key}`}")):
        s = src(rel)
        assert "<AccessSwitch" in s and testid in s, rel
        assert "bg-neutral-900 text-white ring-transparent" not in s, rel
        assert "aria-pressed={on}" not in s, rel


def test_owners_keep_manage_team_on_the_switch_too():
    s = src("pages/Settings.js")
    i = s.index("function OwnerExclusionsCard()")
    assert 'locked={locked}' in s[i:i + 4000]
    assert "· always on" in src("components/settings/AccessSwitch.js")


# ---- 2026-10-05: Settings on a phone (founder: "check the settings page in mobile view") ----
def test_one_pipeline_is_open_at_a_time():
    # Every pipeline showed every stage with every field: 8,400px on a phone.
    s = src("components/OperatingModelEditor.js")
    assert "const [openPi, setOpenPi] = useState(() => (model.pipelines.length === 1 ? 0 : null));" in s
    assert "onClick={() => setOpenPi(open ? null : pi)} aria-expanded={open}" in s
    assert "data-testid={`op-pipeline-toggle-${pi}`}" in s
    assert "{open && (<div className=\"mt-3\">" in s
    assert "setOpenPi(model.pipelines.length)" in s            # a new pipeline opens for its name
    assert 'title="Delete pipeline" aria-label="Delete pipeline" className={iconBtn}' in s


def test_a_task_category_shows_its_whole_name():
    s = src("components/OperatingModelEditor.js")
    assert "bg-transparent text-sm w-28" not in s
    assert "style={{ width: `${Math.min(Math.max((c.label || \"\").length, 6), 30) + 1}ch` }}" in s


def test_the_audit_log_fits_a_phone():
    s = src("pages/Settings.js")
    assert "min-w-[32rem]" not in s
    assert '<table className="w-full text-left text-sm" data-testid="audit-table">' in s


def test_the_open_phone_tab_is_not_clipped_by_the_row_end():
    s = src("pages/Settings.js")
    assert "flex scroll-px-1 items-center gap-1 overflow-x-auto rounded-pill p-1" in s
