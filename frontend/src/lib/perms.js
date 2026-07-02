export const PERMISSIONS = [
  { key: "inbox", label: "Inbox" },
  { key: "data_input", label: "Data Input" },
  { key: "people", label: "People / Contacts" },
  { key: "finance", label: "Finance (invoices, payments, 360°)" },
  { key: "workflows", label: "Workflows" },
  { key: "tasks", label: "Tasks" },
  { key: "brain", label: "Company Brain" },
  { key: "ask", label: "Ask AI" },
  { key: "team_manage", label: "Manage Team" },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const BASE = ["inbox", "people", "workflows", "tasks", "brain", "ask"];
export const ROLE_DEFAULT_PERMS = {
  sales: [...BASE, "data_input"],
  finance: [...BASE, "data_input", "finance"],
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
