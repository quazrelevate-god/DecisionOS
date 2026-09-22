"""Which of THIS company's departments a role name means (2026-09-21).

Found by running a textile mill through the product with four people. Its
departments, as onboarding designed them, were `loom_floor_&_production`,
`sales_&_exporter_relations`, `yarn_&_material_procurement` and
`dispatch_&_lorry_coordination`. Its operating model — designed by a different
prompt — said every stage belonged to `sales`, `production` or `dispatch`.
None of those is a department it has.

Every consumer compared the two with `==`, so nothing matched:
workflow_engine.on_stage_enter blanked the role (unassigned rather than
blocked), and decision tasks never found the stage their department owns. The
result was a card whose stage work belonged to nobody, and which therefore
never moved. It was invisible in tests because every seed used the literal
keys `sales`, `finance` and `production`.

`resolve_role` maps a role name onto the company's real department keys: exact,
then the same letters ignoring punctuation, then a shared word, then a word from
the same family ("accounts" is finance, "lorry" is dispatch). It answers None
rather than guess between two departments, because a wrong department sends
work to the wrong people — and "nobody yet" is at least visibly unassigned.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

_STOP = {"and", "the", "of", "team", "dept", "department", ""}

# Words that mean the same kind of work in the businesses this is for. A role
# resolves through a family only when EXACTLY one department is in it.
FAMILIES = [
    {"finance", "accounts", "accounting", "account", "billing", "payments", "payment",
     "collections", "treasury", "cashier", "audit"},
    {"sales", "selling", "business", "development", "exporter", "exporters", "export",
     "customer", "customers", "client", "clients", "orders", "crm", "marketing", "front", "desk",
     "reception", "counter", "bookings"},
    {"production", "manufacturing", "factory", "plant", "loom", "looms", "weaving", "floor",
     "shop", "kitchen", "fabrication", "assembly", "workshop"},
    {"dispatch", "logistics", "delivery", "deliveries", "shipping", "transport", "lorry",
     "fleet", "courier", "warehouse", "packing"},
    {"procurement", "purchase", "purchasing", "sourcing", "material", "materials", "yarn",
     "stores", "store", "inventory", "stock", "supply", "suppliers", "vendor", "vendors"},
    {"hr", "people", "human", "resources", "staff", "admin", "administration", "payroll"},
    {"quality", "qc", "qa", "inspection", "testing"},
    {"operations", "ops"},
    {"service", "services", "stylist", "stylists", "therapist", "therapists", "salon", "treatment"},
]


def _words(key: str) -> set:
    return {w for w in re.split(r"[^a-z0-9]+", (key or "").lower()) if w not in _STOP}


def _flat(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (key or "").lower())


def _unique(cands: list) -> Optional[str]:
    return cands[0] if len(cands) == 1 else None


def resolve_role(role: Optional[str], role_keys: Iterable[str]) -> Optional[str]:
    """The department key in `role_keys` that `role` means, or None."""
    keys = [k for k in dict.fromkeys(role_keys or []) if k]
    role = (role or "").strip()
    if not role or not keys:
        return None
    if role in keys:
        return role
    hit = _unique([k for k in keys if _flat(k) == _flat(role)])
    if hit:
        return hit
    rw = _words(role)
    if not rw:
        return None
    # Only the owner role is ever called "owner"; never let it absorb a word.
    depts = [k for k in keys if k != "owner"]
    # A word they share: "sales" → sales_&_exporter_relations.
    scored = [(len(rw & _words(k)), k) for k in depts]
    best = max((n for n, _ in scored), default=0)
    if best:
        hit = _unique([k for n, k in scored if n == best])
        if hit:
            return hit
    # A word from the same family: "finance" → accounts_&_billing.
    fam = set().union(*(f for f in FAMILIES if rw & f)) if any(rw & f for f in FAMILIES) else set()
    if fam:
        return _unique([k for k in depts if _words(k) & fam])
    return None


def dept_name(roles: Optional[Iterable[dict]], key: Optional[str]) -> str:
    """A department's NAME, never its key (JOURNEY-1, 2026-09-22).

    The backend twin of frontend/src/lib/departments.js deptName: the
    company's own label for the key, else the key made readable. A new
    founder's approved decision logged "Task assigned to
    order_intake_&_customer_coordination" on the decision he had just approved.
    """
    if not key:
        return ""
    if key == "owner":
        return "Owner"
    for r in roles or []:
        if isinstance(r, dict) and r.get("key") == key and r.get("label"):
            return str(r["label"])
    text = str(key).replace("_&_", " & ").replace("_", " ").strip()
    return text[:1].upper() + text[1:]

