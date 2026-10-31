"""Who is this? — the one matcher for customers, dealers and suppliers
(Epic 11 Sprint 12, docs/CRM_LINKS_PLAN.md, founder 2026-10-31).

Decisions, tasks, meetings and workflow cards name the companies a business
deals with, and until now none of them carried the CRM record: Tracole had 647
tasks naming a customer or supplier and not one linked. Dex, New Task, the
old-data review and Finance's bill import all ask this module the same
question, so a party is found the same way everywhere and never made twice.

THE RULE: Dex proposes, the person decides. `Book.find` never creates
anything; it answers with one of

  linked   one CRM record is this party (exactly, or plainly: "Toyota" is
           Toyota Kirloskar Pvt Ltd) — shown with what it matched from
  choose   more than one could be ("Kumar": Kumar Exports, Kumar Textiles) —
           the person picks; Dex never guesses between them
  new      nobody in CRM — approval makes ONE record marked Needs details
  none     not a party at all: one of the team, our own company, or words
           that name no firm ("the exporters")

and `settle` (on approval) is the only writer.
"""
from __future__ import annotations

import difflib
import re
from typing import Optional

from core import new_id, now_iso

# What a person calls the kind, and what CRM stores.
KINDS = ("customer", "dealer", "supplier", "prospect")
TYPE_OF_KIND = {"customer": "customer", "dealer": "dealer", "supplier": "vendor", "prospect": "customer"}
KIND_OF_TYPE = {"customer": "customer", "dealer": "dealer", "vendor": "supplier"}

# Words that do not tell one firm from another ("Kapoor Retail Pvt Ltd" = "Kapoor Retail").
NOISE = {"pvt", "ltd", "limited", "private", "co", "and", "the", "llp", "inc", "company", "corp", "m", "s",
         "ms", "messrs", "mr", "mrs", "sri", "shri", "of"}
# Words a firm's name is made of but that name no firm on their own: "the
# exporters", "Traders" must never be matched to Kumar Exports or Ravi Traders.
GENERIC = {"exports", "export", "exporters", "traders", "trading", "textiles", "textile", "mills", "mill",
           "industries", "industry", "enterprises", "enterprise", "agencies", "agency", "associates",
           "solutions", "technologies", "technology", "services", "service", "group", "international",
           "india", "global", "corporation", "systems", "sons", "brothers", "bros", "stores", "store",
           "suppliers", "supplier", "customer", "customers", "dealer", "dealers", "vendor", "vendors",
           "buyer", "buyers", "client", "clients", "party", "parties", "garments", "fabrics", "foods",
           "motors", "electricals", "logistics", "transport", "chemicals", "plastics", "steels", "steel"}
ALIKE = 0.86          # a close spelling ("Kumar Exprts") counts as the same name
MAX_CANDIDATES = 5


def words(name: Optional[str]) -> list:
    return [w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if w not in NOISE]


def norm(name: Optional[str]) -> str:
    return " ".join(words(name))


def ident(name: Optional[str]) -> set:
    """The words that identify a firm: not noise, not generic, not tiny."""
    return {w for w in words(name) if w not in GENERIC and len(w) > 2}


def _names(c: dict) -> list:
    out = [c.get("name"), c.get("company")] + list(c.get("aliases") or [])
    return [n for n in out if n and norm(n)]


def public(c: dict) -> dict:
    """What a review or a chip shows of a record."""
    return {"id": c["id"], "name": c.get("name") or c.get("company") or "", "type": c.get("type"),
            "kind": KIND_OF_TYPE.get(c.get("type"), "customer"), "phone": c.get("phone") or "",
            "needs_details": bool(c.get("needs_details"))}


class Book:
    """A company's CRM, its team and its own name, read once per request."""

    def __init__(self, contacts: list, members: list = (), own_name: str = ""):
        self.contacts = [c for c in contacts or [] if c.get("id")]
        self.by_id = {c["id"]: c for c in self.contacts}
        self.own = norm(own_name)
        self.member_full = {norm(m.get("name")) for m in members or [] if norm(m.get("name"))}
        self.member_first = {norm(m.get("name")).split()[0] for m in members or [] if norm(m.get("name"))}

    # -- guards --------------------------------------------------------------
    def is_own(self, said: str) -> bool:
        n = norm(said)
        return bool(self.own and n and (n == self.own or (len(n) > 5 and (n in self.own or self.own in n))))

    def is_team(self, said: str) -> bool:
        """"Ravi", "Ravi Kumar" — one of the team, saying nothing more."""
        n = norm(said)
        return bool(n) and (n in self.member_full or n in self.member_first)

    def _team_named(self, c: dict) -> bool:
        """A record whose whole name is a team member's name is never matched
        from free text (a contact "Ravi" would catch every "tell Ravi")."""
        return all(norm(n) in self.member_full or norm(n) in self.member_first for n in _names(c))

    # -- the question --------------------------------------------------------
    def find(self, said: Optional[str], kind: Optional[str] = None) -> dict:
        said = " ".join((said or "").split())
        kind = kind if kind in KINDS else None
        base = {"said": said, "kind": kind}
        if not said or not ident(said) and not norm(said):
            return {**base, "status": "none", "reason": "empty"}
        if self.is_own(said):
            return {**base, "status": "none", "reason": "own_company"}
        if self.is_team(said):
            return {**base, "status": "none", "reason": "team"}
        n, ids = norm(said), ident(said)
        exact = [c for c in self.contacts if any(norm(x) == n for x in _names(c))]
        if not exact and not ids:
            # Only generic words ("the exporters"): names no firm.
            return {**base, "status": "none", "reason": "generic"}
        if exact:
            return self._answer(base, exact, kind, "exact")
        scored = {}
        for c in self.contacts:
            if self._team_named(c):
                continue
            for x in _names(c):
                xi = ident(x)
                r = difflib.SequenceMatcher(None, n, norm(x)).ratio()
                if (xi and (ids <= xi or xi <= ids)) or r >= ALIKE:
                    scored[c["id"]] = max(r, scored.get(c["id"], 0))
        if scored:
            ranked = sorted(scored.items(), key=lambda kv: -kv[1])
            # One name plainly closest ("Kumar Exprts" -> Kumar Exports, not
            # Kumar Textiles): that one. Otherwise the person picks.
            if len(ranked) > 1 and ranked[0][1] >= ALIKE and ranked[0][1] - ranked[1][1] >= 0.08:
                ranked = ranked[:1]
            return self._answer(base, [self.by_id[i] for i, _ in ranked], kind, "likely")
        return {**base, "status": "new", "kind": kind or "customer"}

    def _answer(self, base: dict, found: list, kind: Optional[str], confidence: str) -> dict:
        seen, uniq = set(), []
        for c in found:
            if c["id"] not in seen:
                seen.add(c["id"])
                uniq.append(c)
        if len(uniq) > 1 and kind:
            same = [c for c in uniq if KIND_OF_TYPE.get(c.get("type")) == kind
                    or (kind == "prospect" and c.get("type") == "customer")]
            if len(same) == 1:
                uniq = same
        if len(uniq) == 1:
            c = uniq[0]
            its_kind = KIND_OF_TYPE.get(c.get("type"), "customer")
            return {**base, "status": "linked", "confidence": confidence, "contact_id": c["id"],
                    "contact_name": c.get("name") or c.get("company") or "", "contact_type": c.get("type"),
                    "kind": base.get("kind") or its_kind,
                    # One firm on both sides: link the record there is, say so.
                    "kind_differs": bool(base.get("kind")) and base["kind"] != its_kind
                                    and not (base["kind"] == "prospect" and its_kind == "customer")}
        kind_first = sorted(uniq, key=lambda c: KIND_OF_TYPE.get(c.get("type")) != kind)   # stable: closest first
        return {**base, "status": "choose", "candidates": [public(c) for c in kind_first[:MAX_CANDIDATES]]}

    def scan(self, text: Optional[str]) -> list:
        """The CRM records whose WHOLE name appears in a sentence, longest first —
        for a task Dex gave no party, and for the old-data review. A record named
        only with generic words, or only with a team member's name, never counts."""
        hay = f" {norm(text)} "
        if not hay.strip():
            return []
        out, taken = [], []
        cands = []
        for c in self.contacts:
            if self._team_named(c):
                continue
            for x in _names(c):
                nx = norm(x)
                # "MK Associates" counts (MK names the firm); "Traders" alone does not.
                if nx and any(w not in GENERIC for w in nx.split()) and (len(nx) >= 5 or " " in nx):
                    cands.append((len(nx), nx, c))
        for _, nx, c in sorted(cands, key=lambda t: -t[0]):
            if f" {nx} " in hay and c["id"] not in {o["id"] for o in out} \
                    and not any(nx in t for t in taken):   # "MK Associates Erode" before "MK Associates"
                out.append(c)
                taken.append(nx)
        return out


async def book(db, tenant_id: str, members: Optional[list] = None) -> Book:
    contacts = await db.contacts.find(
        {"tenant_id": tenant_id},
        {"_id": 0, "id": 1, "name": 1, "company": 1, "aliases": 1, "type": 1, "phone": 1, "needs_details": 1},
    ).to_list(10000)
    if members is None:
        members = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "name": 1}).to_list(2000)
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "name": 1, "company_name": 1})
    return Book(contacts, members, (t or {}).get("company_name") or (t or {}).get("name") or "")


# ---------------------------------------------------------------------------
# A proposal's parties
# ---------------------------------------------------------------------------
def party_for(bk: Book, said: Optional[str], kind: Optional[str], text: str = "",
              person: Optional[str] = None) -> Optional[dict]:
    """The party of one proposed item: what Dex said, else a CRM name in its
    own words. None when it names nobody."""
    if said:
        ans = bk.find(said, kind)
        if ans["status"] == "none":
            # Dex named the team or our own company; the words may still name a firm.
            said = None
        else:
            if person and not bk.is_team(person) and norm(person) != norm(said):
                ans["person"] = " ".join(person.split())
            return ans
    found = bk.scan(text)
    if not found:
        return None
    if len(found) == 1:
        c = found[0]
        return {"said": c.get("name") or "", "kind": KIND_OF_TYPE.get(c.get("type"), "customer"),
                "status": "linked", "confidence": "named", "contact_id": c["id"],
                "contact_name": c.get("name") or c.get("company") or "", "contact_type": c.get("type")}
    return {"said": ", ".join(c.get("name") or "" for c in found), "kind": None, "status": "several",
            "several": [public(c) for c in found[:12]]}


def party_key(p: Optional[dict]) -> str:
    """Items naming the same party share it: resolving one resolves them all."""
    return norm((p or {}).get("said")) if p else ""


OPEN = ("choose", "several")


def open_questions(proposal: dict) -> list:
    """What the review still has to answer before approving links it: [{item_kind, key, title, party}]."""
    out = []
    for kind in ("tasks", "meetings", "workflows"):
        for it in proposal.get(kind) or []:
            p = it.get("party")
            if p and p.get("status") in OPEN:
                out.append({"item_kind": kind, "key": it.get("key"), "title": it.get("title") or "", "party": p})
    return out


# ---------------------------------------------------------------------------
# Writing: a new record, and approval
# ---------------------------------------------------------------------------
async def create_needs_details(db, tenant_id: str, name: str, kind: Optional[str], actor_id: str, *,
                               person: Optional[str] = None, made_from: Optional[dict] = None,
                               bk: Optional[Book] = None) -> dict:
    """ONE record for a party nobody had in CRM, marked Needs details, with what
    was said. Looked up again first, so a second approval (or a bill that
    arrived meanwhile) links instead of making a twin."""
    bk = bk or await book(db, tenant_id)
    ans = bk.find(name, kind)
    if ans["status"] == "linked":
        return bk.by_id[ans["contact_id"]]
    kind = kind if kind in KINDS else "customer"
    clean = " ".join((name or "").split())[:120]
    doc = {
        "id": new_id(), "tenant_id": tenant_id, "type": TYPE_OF_KIND[kind], "name": clean, "company": "",
        "phone": "", "email": "", "address": "", "tax_id": "", "tags": [],
        "status": "lead" if kind == "prospect" else "active", "assigned_id": None, "notes": "",
        "birthday": "", "lifecycle_stage": "lead" if kind == "prospect" else "",
        "contact_people": [{"name": person, "role": "", "phone": "", "email": ""}] if person else [],
        "needs_details": True, "source": "dex", "made_from": made_from or {},
        "created_by": actor_id, "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.contacts.insert_one(dict(doc))
    bk.contacts.append(doc)
    bk.by_id[doc["id"]] = doc
    return doc


async def add_person(db, tenant_id: str, contact_id: str, person: Optional[str]) -> None:
    """"Call Sajith from MK Associates": Sajith joins MK Associates' people, once."""
    person = " ".join((person or "").split())
    if not person:
        return
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": tenant_id}, {"_id": 0, "contact_people": 1})
    if c is None or any(norm(p.get("name")) == norm(person) for p in c.get("contact_people") or []):
        return
    await db.contacts.update_one({"id": contact_id, "tenant_id": tenant_id},
                                 {"$push": {"contact_people": {"name": person, "role": "", "phone": "", "email": ""}}})


async def settle(db, tenant_id: str, decision: dict, actor_id: str) -> dict:
    """On approval: every item's party becomes a contact id. Linked ones are
    used; new ones are made once per name; open questions (Which one? /
    several) are left unlinked for the old-data review. Returns
    {item_key: contact} plus what was added, for the timeline."""
    p = decision.get("proposal") or {}
    bk = await book(db, tenant_id)
    made, by_key, out = [], {}, {}
    for kind in ("tasks", "meetings", "workflows"):
        for it in p.get(kind) or []:
            party = it.get("party")
            if not party or party.get("status") not in ("linked", "new"):
                continue
            c = None
            if party["status"] == "linked" and party.get("contact_id"):
                c = bk.by_id.get(party["contact_id"]) or await db.contacts.find_one(
                    {"id": party["contact_id"], "tenant_id": tenant_id}, {"_id": 0})
            fresh = False
            if c is None:
                k = party_key(party)
                c = by_key.get(k)
                if c is None:
                    c = await create_needs_details(
                        db, tenant_id, party.get("said") or "", party.get("kind"), actor_id,
                        person=party.get("person"), made_from={"kind": "decision", "id": decision["id"]}, bk=bk)
                    fresh = c.get("source") == "dex" and (c.get("made_from") or {}).get("id") == decision["id"]
                    if fresh:
                        made.append(c)
                    by_key[k] = c
            if party.get("person") and not fresh:
                await add_person(db, tenant_id, c["id"], party["person"])
            out[(kind, it.get("key"))] = c
    return {"by_item": out, "made": made}
