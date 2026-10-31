/* Epic 11 Sprint 12 — who a decision, task, meeting or workflow is about
   (docs/CRM_LINKS_PLAN.md). The server's matcher (services/parties.py) answers
   with a status; these say it the same way on every screen.

     linked    "Kumar Exports · Customer"
     new       "New: Kumar Exports · Customer · details needed"
     choose    "Which Kumar?"
     several   "2 customers/suppliers named"
     none      nothing (not a customer or supplier) */

export const PARTY_KINDS = [
  { value: "customer", label: "Customer" },
  { value: "dealer", label: "Dealer" },
  { value: "supplier", label: "Supplier" },
  { value: "prospect", label: "Prospect" },
];

const KIND_OF_TYPE = { customer: "customer", dealer: "dealer", vendor: "supplier" };

export const kindLabel = (k) => (PARTY_KINDS.find((x) => x.value === k) || {}).label || "Customer";

export const kindOf = (c) => c?.kind || KIND_OF_TYPE[c?.type] || "customer";

/* A proposal item's party, or a task's contact_summary, in three pieces: what
   comes before the name, the name, and what comes after it. The chip lets only
   the NAME shorten, so a long firm's kind and "details needed" stay readable
   ("MK Associates & Sons Wholes… · Dealer", never "… · Deal…"). */
export function partyParts(p, { compact = false } = {}) {
  if (!p) return null;
  if (p.status === "linked" || (!p.status && p.id)) {
    const name = p.contact_name || p.name || p.said;
    // Compact (a card's meta line): the kind only; the amber tone and the
    // chip's title still say details are needed.
    if (compact) return { before: "", name, after: ` · ${kindLabel(p.kind || kindOf(p))}` };
    const differs = p.kind_differs && p.contact_type ? ` · in CRM as a ${kindLabel(KIND_OF_TYPE[p.contact_type]).toLowerCase()}` : "";
    return { before: "", name, after: ` · ${kindLabel(p.kind || kindOf(p))}${differs}${p.needs_details ? " · details needed" : ""}` };
  }
  if (p.status === "new") return { before: "New: ", name: p.said, after: ` · ${kindLabel(p.kind)} · details needed` };
  if (p.status === "choose") return { before: "Which ", name: p.said, after: "?" };
  if (p.status === "several") return { before: "", name: "", after: `${(p.several || []).length} customers/suppliers named` };
  return null;
}

/* ...and in one line. */
export function partyText(p) {
  const x = partyParts(p);
  return x ? `${x.before}${x.name}${x.after}` : "";
}

/* What still needs the person: a choice to make before approving links it. */
export const partyIsOpen = (p) => p && (p.status === "choose" || p.status === "several");

export const partyTone = (p) => (!p ? "muted"
  : partyIsOpen(p) ? "ask"
  : p.status === "new" || p.needs_details ? "new"
  : "linked");
