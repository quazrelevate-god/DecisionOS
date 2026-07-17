// Notification type metadata + deep-link resolution.
export const NOTIF_TYPE_META = {
  assigned: { label: "New Work Assigned", cls: "bg-brand-blue text-white" },
  approval: { label: "Approval Requested", cls: "bg-brand-yellow text-black" },
  approved: { label: "Approved", cls: "bg-green-600 text-white" },
  rejected: { label: "Changes Requested", cls: "bg-brand-red text-white" },
  clarification: { label: "Clarification", cls: "bg-orange-500 text-black" },
  status: { label: "Status Update", cls: "bg-brand-ink text-white" },
  comment: { label: "New Comment", cls: "bg-purple-600 text-white" },
  reminder: { label: "Reminder", cls: "bg-black/10 text-black" },
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
