// Notification type metadata + deep-link resolution.
export const NOTIF_TYPE_META = {
  assigned: { label: "New Work Assigned", cls: "bg-status-directive-bg text-status-directive-fg" },
  approval: { label: "Approval Requested", cls: "bg-status-pending-bg text-status-pending-fg" },
  approved: { label: "Approved", cls: "bg-status-completed-bg text-status-completed-fg" },
  rejected: { label: "Changes Requested", cls: "bg-status-rejected-bg text-status-rejected-fg" },
  clarification: { label: "Clarification", cls: "bg-status-pending-bg text-status-pending-fg" },
  status: { label: "Status Update", cls: "bg-surface-sunken text-text-secondary" },
  comment: { label: "New Comment", cls: "bg-surface-sunken text-text-secondary" },
  reminder: { label: "Reminder", cls: "bg-surface-sunken text-text-secondary" },
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
