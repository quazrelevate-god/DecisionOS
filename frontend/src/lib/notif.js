// Notification type metadata + deep-link resolution.
//
// `tone` is the Meridian semantic used by <Chip>. `cls` is kept only so that
// pages not yet migrated keep rendering; new call sites should pass `tone`.
export const NOTIF_TYPE_META = {
  assigned: { label: "New Work Assigned", tone: "primary", cls: "bg-brand-blue text-white" },
  approval: { label: "Approval Requested", tone: "warning", cls: "bg-brand-yellow text-black" },
  approved: { label: "Approved", tone: "success", cls: "bg-green-600 text-white" },
  rejected: { label: "Changes Requested", tone: "danger", cls: "bg-brand-red text-white" },
  clarification: { label: "Clarification", tone: "warning", cls: "bg-orange-500 text-black" },
  status: { label: "Status Update", tone: "neutral", cls: "bg-brand-ink text-white" },
  comment: { label: "New Comment", tone: "primary", cls: "bg-purple-600 text-white" },
  reminder: { label: "Reminder", tone: "quiet", cls: "bg-black/10 text-black" },
};

export function notifMeta(n) {
  return NOTIF_TYPE_META[n?.type] || NOTIF_TYPE_META.reminder;
}

// Where does clicking a notification take the user?
export function notifLink(n) {
  if (n?.entity_type === "task" && n?.entity_id) return `/my-work?task=${n.entity_id}`;
  if (n?.entity_type === "decision" && n?.entity_id) return `/?decision=${n.entity_id}`;
  if (n?.entity_type === "leave" && n?.entity_id) return `/my-work?view=leave&leave=${n.entity_id}`;
  return null;
}
