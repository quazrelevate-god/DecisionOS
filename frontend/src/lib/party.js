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

/* A proposal item's party, or a task's contact_summary, in one line. */
export function partyText(p) {
  if (!p) return "";
  if (p.status === "linked" || (!p.status && p.id)) {
    const name = p.contact_name || p.name || p.said;
    const differs = p.kind_differs && p.contact_type ? ` · in CRM as a ${kindLabel(KIND_OF_TYPE[p.contact_type]).toLowerCase()}` : "";
    return `${name} · ${kindLabel(p.kind || kindOf(p))}${differs}${p.needs_details ? " · details needed" : ""}`;
  }
  if (p.status === "new") return `New: ${p.said} · ${kindLabel(p.kind)} · details needed`;
  if (p.status === "choose") return `Which ${p.said}?`;
  if (p.status === "several") return `${(p.several || []).length} customers/suppliers named`;
  return "";
}

/* What still needs the person: a choice to make before approving links it. */
export const partyIsOpen = (p) => p && (p.status === "choose" || p.status === "several");

export const partyTone = (p) => (!p ? "muted"
  : partyIsOpen(p) ? "ask"
  : p.status === "new" || p.needs_details ? "new"
  : "linked");
