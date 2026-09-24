"""A team named for money can open Money (JOURNEY-1 J1-05).

A founder signed up, the AI built him an "Accounts & GST" team, and the
accountant he added to it on day one could not open Finance. Every team
onboarding invents is a CUSTOM role key, and a custom key falls through to
_BASE_PERMS -- which has no `finance` in it.

shared.roles.starting_perms reads the team's own name: money words earn Finance.

2026-09-24 (founder): and the side of CRM the team works in. A money team also
starts with the SUPPLIERS, a selling team with the BUYERS, and a team that is
both -- "Sales & Accounts", which small companies really have -- with both,
which is the whole of CRM. Nothing grants `people` itself, so FIX-FUP-51's
answer (nobody is handed the entire contact book by default) still stands.
"""
from core.permissions import _BASE_PERMS
from shared.roles import starting_perms


def test_the_teams_the_ai_actually_built():
    """Real department keys from the audit's own tenants."""
    for key, label in [
        ("accounts_gst", "Accounts & GST"),
        ("accounts_&_gst", "Accounts and GST"),
        ("finance", "Finance"),
        ("billing_collections", "Billing & Collections"),
        ("yarn_&_material_procurement", "Yarn & Material Procurement"),
        ("purchase", "Purchase"),
    ]:
        got = starting_perms(key, label)
        assert "finance" in got, f"{key} should start with Finance"
        assert "crm_suppliers" in got, f"{key} buys things; it starts with the suppliers"
        assert "crm_buyers" not in got, f"{key} is not a selling team"


def test_a_selling_team_starts_with_the_buyers_and_nothing_else():
    for key, label in [
        ("sales_&_exporter_relations", "Sales & Exporter Relations"),
        ("customer_care", "Customer Care"),
        ("orders", "Orders"),
    ]:
        assert starting_perms(key, label) == ["crm_buyers"], f"{key} should start with the buyers alone"


def test_a_team_that_is_both_gets_the_whole_of_crm():
    got = starting_perms("sales_and_accounts", "Sales & Accounts")
    assert got == ["crm_buyers", "crm_suppliers", "finance"], got


def test_everybody_else_starts_where_they_started():
    for key, label in [
        ("loom_floor_&_production", "Loom Floor & Production"),
        ("dispatch_&_lorry_coordination", "Dispatch & Lorry Coordination"),
        ("quality_control", "Quality Control"),
        ("hr", "HR"),
        ("", ""),
    ]:
        assert starting_perms(key, label) == [], f"{key} should not have been granted anything"


def test_the_whole_contact_book_is_never_granted_here():
    """FIX-FUP-51 was a decision, not an oversight: nobody is handed both
    sides at once by a NAME. A team whose name says it does both earns both,
    one side at a time, which is a different thing from `people`."""
    for key in ["sales", "sales_&_exporter_relations", "customer_care", "accounts_gst", "finance"]:
        assert "people" not in starting_perms(key, key.replace("_", " "))


def test_the_stored_list_keeps_the_base_a_team_already_had():
    """What register writes is the base set PLUS the extra, never the extra alone."""
    stored = sorted(set(_BASE_PERMS) | set(starting_perms("accounts_gst", "Accounts & GST")))
    assert "finance" in stored
    assert _BASE_PERMS <= set(stored), "a money team must not lose the Desk, tasks or capture"
