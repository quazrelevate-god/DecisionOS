export const PERMISSIONS = [
  // RBAC P2 (2026-09-16): the key stays "inbox"; on screen it is the Decision Desk.
  { key: "inbox", label: "Decision Desk" },
  { key: "voice_capture", label: "Voice Box (Decision Desk capture)" },
  { key: "data_input", label: "Data Input" },
  { key: "people", label: "People / Contacts" },
  // 2026-09-16 — one Finance permission. "Finance Ledger" was a second toggle
  // for the same page: every ledger endpoint accepted either key and the page
  // had no per-tab gate. A small business has one finance person.
  { key: "finance", label: "Finance (invoices, payments, expenses, assets, inventory)" },
  { key: "workflows", label: "Workflows" },
  { key: "tasks", label: "Tasks" },
  { key: "brain", label: "Company Brain" },
  { key: "ask", label: "Ask AI" },
  { key: "brain_export", label: "Export Company Brain" },
  { key: "approvals", label: "Approve tasks & WhatsApp captures" },
  { key: "decisions_approve", label: "Approve Decisions" },
  { key: "leave_approve", label: "Approve Leave" },
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
  sales: [...BASE],
  finance: [...BASE, "finance"],
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
