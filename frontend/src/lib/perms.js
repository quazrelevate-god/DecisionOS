export const PERMISSIONS = [
  { key: "inbox", label: "Inbox" },
  { key: "voice_capture", label: "Voice Box (Decision Desk capture)" },
  { key: "data_input", label: "Data Input" },
  { key: "people", label: "People / Contacts" },
  { key: "finance", label: "Finance (invoices, payments, 360°)" },
  { key: "ledger", label: "Finance Ledger (expenses, assets, inventory)" },
  { key: "workflows", label: "Workflows" },
  { key: "tasks", label: "Tasks" },
  { key: "brain", label: "Company Brain" },
  { key: "ask", label: "Ask AI" },
  { key: "approvals", label: "Approve Tasks" },
  { key: "decisions_approve", label: "Approve Decisions" },
  { key: "leave_approve", label: "Approve Leave" },
  { key: "team_manage", label: "Manage Team" },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const BASE = ["inbox", "data_input", "people", "workflows", "tasks", "brain", "ask"];
export const ROLE_DEFAULT_PERMS = {
  sales: [...BASE],
  finance: [...BASE, "finance", "ledger"],
};

export function defaultPermsForRole(role) {
  return ROLE_DEFAULT_PERMS[role] || BASE;
}

export function userPerms(user) {
  if (!user) return [];
  if (user.role === "owner") return PERMISSION_KEYS;
  const p = user.permissions;
  if (Array.isArray(p) && p.length) return p.filter((k) => PERMISSION_KEYS.includes(k));
  return defaultPermsForRole(user.role);
}

export function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role === "owner") return true;
  return userPerms(user).includes(perm);
}
