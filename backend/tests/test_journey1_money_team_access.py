"""A team named for money can open Money (JOURNEY-1 J1-05).

A founder signed up, the AI built him an "Accounts & GST" team, and the
accountant he added to it on day one could not open Finance. Every team
onboarding invents is a CUSTOM role key, and a custom key falls through to
_BASE_PERMS -- which has no `finance` in it.

shared.roles.starting_perms reads the team's own name. It is deliberately
narrow: money words earn Finance, nothing else is granted, and nothing here
opens Contacts -- Sales and Finance losing CRM by default was the founder's
own change of 13 August (FIX-FUP-51).
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
        assert starting_perms(key, label) == ["finance"], f"{key} should start with Finance"


def test_everybody_else_starts_where_they_started():
    for key, label in [
        ("loom_floor_&_production", "Loom Floor & Production"),
        ("dispatch_&_lorry_coordination", "Dispatch & Lorry Coordination"),
        ("sales_&_exporter_relations", "Sales & Exporter Relations"),
        ("quality_control", "Quality Control"),
        ("hr", "HR"),
        ("", ""),
    ]:
        assert starting_perms(key, label) == [], f"{key} should not have been granted anything"


def test_contacts_is_never_granted_here():
    """FIX-FUP-51 was a decision, not an oversight. This must not undo it."""
    for key in ["sales", "sales_&_exporter_relations", "customer_care", "accounts_gst", "finance"]:
        assert "people" not in starting_perms(key, key.replace("_", " "))


def test_the_stored_list_keeps_the_base_a_team_already_had():
    """What register writes is the base set PLUS the extra, never the extra alone."""
    stored = sorted(set(_BASE_PERMS) | set(starting_perms("accounts_gst", "Accounts & GST")))
    assert "finance" in stored
    assert _BASE_PERMS <= set(stored), "a money team must not lose the Desk, tasks or capture"
