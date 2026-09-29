export const PERMISSIONS = [
  // RBAC P2 (2026-09-16): the key stays "inbox"; on screen it is the Decision Desk.
  { key: "inbox", label: "Decision Desk" },
  { key: "voice_capture", label: "Voice Box (Decision Desk capture)" },
  { key: "data_input", label: "Data Input" },
  { key: "people", label: "People / Contacts (both sides of CRM)" },
  /* J7-04 / J8-01 (JOURNEY-1, founder 24 Sep) — CRM SPLITS BY SIDE.
     "people" was one door to two lists, so giving Sales the buyers they live
     in also handed them every supplier's price and terms; FIX-FUP-51 answered
     that by shutting the door on both, and neither Sales nor Finance could add
     the contact in front of them. One key per side now. "people" stays and
     means both, so nothing set before today changes; holding both new keys is
     the same as holding it. */
  { key: "crm_buyers", label: "Customers & dealers (CRM)" },
  { key: "crm_suppliers", label: "Suppliers (CRM)" },
  // 2026-09-16 — one Finance permission. "Finance Ledger" was a second toggle
  // for the same page: every ledger endpoint accepted either key and the page
  // had no per-tab gate. A small business has one finance person.
  { key: "finance", label: "Finance (invoices, payments, expenses, assets, inventory)" },
  { key: "workflows", label: "Workflows" },
  { key: "tasks", label: "Tasks" },
  { key: "brain", label: "Company Brain" },
  { key: "ask", label: "Ask AI" },
  { key: "brain_export", label: "Export Company Brain" },
  /* J14-13 (JOURNEY-1, founder) — THE APPROVE BOXES SAY WHAT THEY DO.
     "Approve tasks & WhatsApp captures" was two different powers behind one
     tick, and half of it in a word — "capture" — that only this product uses.
     An owner handing out access has to be able to read these without being
     told what they mean. Each one now names the thing it lets somebody wave
     through, and the pair that were joined are separate keys (config.py).
     Nobody loses access: holding the old `approvals` still carries the new
     `captures_approve` with it. */
  { key: "approvals", label: "Approve work and spending" },
  { key: "captures_approve", label: "Approve what the AI drafted from a message" },
  { key: "decisions_approve", label: "Approve decisions" },
  { key: "leave_approve", label: "Approve leave" },
  { key: "team_manage", label: "Manage Team" },
  // ASK-28 TK-08 (plan Phase 6) — off for every role unless ticked here.
  { key: "tasks_assign_any", label: "Assign tasks to anyone" },
  { key: "tasks_view_all", label: "See all tasks" },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// FIX-FUP-51: mirror of backend core._BASE_PERMS — kept in sync so the
// nav/route gates match the API. "people" is opt-in (contact list is
// sensitive); Owner still passes via the role==='owner' branch below.
const BASE = ["inbox", "data_input", "workflows", "tasks", "brain", "ask"];
export const ROLE_DEFAULT_PERMS = {
  // Each role starts holding the side of CRM it works in (see above, and the
  // server's core/permissions.py, which this mirrors).
  sales: [...BASE, "crm_buyers"],
  // J14-13 — the AI-drafted items from WhatsApp land in the Finance inbox, so
  // the people who live in that inbox start able to act on them. Mirrors
  // core/permissions.py ROLE_DEFAULT_PERMS.
  finance: [...BASE, "finance", "crm_suppliers", "captures_approve"],
};

export function defaultPermsForRole(role) {
  return ROLE_DEFAULT_PERMS[role] || BASE;
}

// 2026-09-15 — what a role gives: the owner's setting for it (Settings › Team
// roles › Access), else the built-in default. Same order as the server.
export function roleDefaultPerms(role, tenantRoles) {
  const r = (tenantRoles || []).find((x) => x.key === role);
  if (r && Array.isArray(r.permissions) && r.permissions.length) return r.permissions.filter((k) => PERMISSION_KEYS.includes(k));
  return defaultPermsForRole(role);
}

export function userPerms(user) {
  if (!user) return [];
  if (user.role === "owner") return PERMISSION_KEYS;
  // ASK-28 TK-08 — the signed-in user carries what the server resolved
  // (company role settings included); other members fall back to their list.
  if (Array.isArray(user.effective_permissions)) return user.effective_permissions.filter((k) => PERMISSION_KEYS.includes(k));
  const p = user.permissions;
  // A deliberate own list (permissions_custom) may be empty: No access.
  if (user.permissions_custom || (Array.isArray(p) && p.length)) return (p || []).filter((k) => PERMISSION_KEYS.includes(k));
  return defaultPermsForRole(user.role);
}

export function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role === "owner") return true;
  return userPerms(user).includes(perm);
}

/* J7-04 / J8-01 — which side of CRM a person may open. The mirror of the
   server's core/permissions.crm_types; the nav, the CRM page and the Desk's
   tiles all read these, so none of them can offer a door the API will shut. */
export const canSeeBuyers = (user) => hasPerm(user, "people") || hasPerm(user, "crm_buyers");
export const canSeeSuppliers = (user) => hasPerm(user, "people") || hasPerm(user, "crm_suppliers");
export const canSeeAnyCrm = (user) => canSeeBuyers(user) || canSeeSuppliers(user);
