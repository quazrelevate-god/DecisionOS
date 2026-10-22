/* Words for the admin console (2026-10-22, admin redesign).
 *
 * The console printed stored keys -- super_admin, grandfathered, brain.answer,
 * NOT_SET, request_approved -- because nothing turned them into words. Every
 * section reads its labels from here now, so a plan, a role or an audit entry
 * reads the same on every screen. Unknown keys fall back to humanize(), never
 * to the raw key. */

export function humanize(key) {
  if (key == null || key === "") return "—";
  const s = String(key).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const PLAN_KEYS = ["trial", "starter", "business", "enterprise", "grandfathered"];
const PLAN_LABEL = {
  trial: "Trial", starter: "Starter", business: "Business", enterprise: "Enterprise",
  grandfathered: "Legacy",
};
export const planLabel = (p) => (p ? PLAN_LABEL[p] || humanize(p) : "No plan");
export const PLAN_OPTIONS = PLAN_KEYS.map((p) => ({ value: p, label: planLabel(p) }));

const ADMIN_ROLE_LABEL = {
  super_admin: "Super admin", support: "Support", billing: "Billing", read_only: "Read only",
};
export const adminRoleLabel = (r) => ADMIN_ROLE_LABEL[r] || humanize(r);
export const ADMIN_ROLE_HINT = {
  super_admin: "Everything, including admins, keys and deleting workspaces",
  support: "Workspaces, people, tickets and reports",
  billing: "Plans and payments",
  read_only: "Can look at everything, change nothing",
};

const PROVIDER_LABEL = {
  sarvam: "Sarvam voice", anthropic: "Claude", emergent: "Claude via Emergent",
  openai: "OpenAI", gemini: "Gemini", whatsapp: "WhatsApp", unknown: "Unattributed",
};
export const providerLabel = (p) => PROVIDER_LABEL[p] || humanize(p);

const KEY_SOURCE_LABEL = { custom: "Set here", env: "Server default", not_set: "Not set" };
export const keySourceLabel = (s) => KEY_SOURCE_LABEL[s] || humanize(s);

const KEY_STATUS = {
  active: { label: "Working", tone: "good" },
  fallback: { label: "On fallback", tone: "warn" },
  out_of_credits: { label: "Out of credits", tone: "bad" },
  invalid: { label: "Key rejected", tone: "bad" },
  error: { label: "Error", tone: "bad" },
  not_set: { label: "Not set", tone: "neutral" },
};
export const keyStatus = (s) => KEY_STATUS[s] || { label: humanize(s), tone: "neutral" };

const HEALTH_OK = new Set(["ok", "running", "configured", "custom", "env"]);
export const healthOk = (v) => HEALTH_OK.has(String(v || "").toLowerCase());
const HEALTH_LABEL = {
  ok: "Healthy", running: "Running", configured: "Configured", custom: "Set here", env: "Server default",
  not_set: "Not set", missing: "Missing", error: "Error", down: "Down", stopped: "Stopped",
  problem: "Needs attention",
};
export const healthLabel = (v) => HEALTH_LABEL[String(v || "").toLowerCase()] || humanize(v);

const TICKET_STATUS = { open: "Open", pending: "Waiting on them", resolved: "Resolved", closed: "Closed" };
export const ticketStatusLabel = (s) => TICKET_STATUS[s] || humanize(s);
const PRIORITY = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const priorityLabel = (p) => PRIORITY[p] || humanize(p);
export const priorityTone = (p) => ({ urgent: "bad", high: "warn" }[p] || "neutral");

const REPORT_STATUS = { open: "New", reviewing: "Reviewing", actioned: "Acted on", dismissed: "Dismissed" };
export const reportStatusLabel = (s) => REPORT_STATUS[s] || humanize(s);
export const reportStatusTone = (s) => ({ open: "bad", reviewing: "warn", actioned: "good" }[s] || "neutral");

const ANNOUNCE_KIND = { info: "Information", warning: "Warning", maintenance: "Maintenance" };
export const announceKindLabel = (k) => ANNOUNCE_KIND[k] || humanize(k);
export const announceKindTone = (k) => ({ info: "info", warning: "warn", maintenance: "bad" }[k] || "neutral");

/* What an audit entry was, in a few words. The entry's own message carries
   the detail ("Suspended workspace Acme — chargeback"). */
const AUDIT_LABEL = {
  login: "Signed in", logout: "Signed out",
  update_ai_keys: "Changed AI keys",
  suspend_user: "Suspended a person", reactivate_user: "Reactivated a person", reset_access: "Reset access",
  user_dsar: "Exported a person's data",
  suspend_tenant: "Suspended a workspace", reactivate_tenant: "Reactivated a workspace",
  delete_tenant: "Deleted a workspace", delete_with_export: "Exported and deleted a workspace",
  mark_test_tenant: "Marked a workspace as test", mark_customer_tenant: "Marked a workspace as a customer",
  tenant_export: "Exported a workspace", consent_export: "Exported consent records",
  tenant_flags: "Changed a workspace's features",
  retention_set: "Set a retention policy", retention_run: "Ran the retention sweep",
  billing_plan_override: "Changed a plan",
  impersonate_start: "Started a view-as session", impersonate_end: "Ended a view-as session",
  ticket_create: "Opened a ticket", ticket_reply: "Replied to a ticket", ticket_update: "Updated a ticket",
  report_status: "Triaged a report",
  announcement_create: "Created an announcement", announcement_update: "Changed an announcement",
  announcement_delete: "Deleted an announcement", announcement_email: "Emailed an announcement",
  config_models: "Changed AI model routes", config_sarvam: "Changed the voice settings",
  config_flags: "Changed feature flags", config_runtime: "Changed runtime settings",
  config_plan_caps: "Changed plan capabilities",
  admin_create: "Added an admin", admin_invite: "Invited an admin", admin_invite_accepted: "Accepted an admin invite",
  admin_update: "Changed an admin", admin_2fa_enable: "Turned on two-step sign-in",
  admin_2fa_disable: "Turned off two-step sign-in",
};
export const auditLabel = (a) => AUDIT_LABEL[a] || humanize(a);

/* Groups for filtering the audit log. */
export const AUDIT_GROUPS = [
  { value: "", label: "Everything" },
  { value: "workspaces", label: "Workspaces", match: (a) => /tenant|retention|billing|consent/.test(a) },
  { value: "people", label: "People", match: (a) => /user|reset_access|impersonate/.test(a) },
  { value: "support", label: "Support", match: (a) => /ticket|report|announcement/.test(a) },
  { value: "platform", label: "Platform", match: (a) => /config|ai_keys/.test(a) },
  { value: "security", label: "Admins & sign-in", match: (a) => /admin|login|logout/.test(a) },
];
