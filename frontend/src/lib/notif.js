// Notification type metadata + deep-link resolution.
export const NOTIF_TYPE_META = {
  assigned: { label: "New Work Assigned", cls: "bg-brand-blue text-white" },
  approval: { label: "Approval Requested", cls: "bg-brand-yellow text-black" },
  approved: { label: "Approved", cls: "bg-green-600 text-white" },
  rejected: { label: "Changes Requested", cls: "bg-danger-600 text-white" },
  clarification: { label: "Clarification", cls: "bg-orange-500 text-black" },
  status: { label: "Status Update", cls: "bg-brand-ink text-white" },
  comment: { label: "New Comment", cls: "bg-purple-600 text-white" },
  reminder: { label: "Reminder", cls: "bg-black/10 text-black" },
  request_rejected: { label: "Request Declined", cls: "bg-danger-600 text-white" },
  request_withdrawn: { label: "Request Withdrawn", cls: "bg-black/10 text-black" },
  // 2026-10-30 (Epic 11 S11) — work nobody has yet (services/task_pickup.py).
  queue: { label: "In Your Team's Queue", cls: "bg-brand-ink text-white" },
  needs_person: { label: "Needs a Person", cls: "bg-orange-500 text-black" },
};

export function notifMeta(n) {
  return NOTIF_TYPE_META[n?.type] || NOTIF_TYPE_META.reminder;
}

// Where does clicking a notification take the user?
export function notifLink(n) {
  // ASK-28 TK-02: an approval request opens the approver's own list, where
  // the task is guaranteed to be — My Tasks only holds tasks you do.
  if (n?.entity_type === "task" && n?.entity_id && n?.type === "approval") return `/approvals?task=${n.entity_id}`;
  // 2026-10-30 — "assign it to someone" opens the Desk's Needs a person list,
  // which holds every task waiting on you whether or not it is in My Work.
  if (n?.type === "needs_person") return "/inbox?needs=person";
  if (n?.entity_type === "task" && n?.entity_id) return `/my-work?task=${n.entity_id}`;
  // ASK-32 1.7 — straight to the Desk, which opens the decision from ?decision=.
  // "/" redirected to /inbox and dropped the parameter, so nothing opened.
  if (n?.entity_type === "decision" && n?.entity_id) return `/inbox?decision=${n.entity_id}`;
  // ASK-6 (2026-09-12): leave notifications now land on the Decision Desk,
  // where the approvals queue lives (ASK-7). The ?leave=<id> query param
  // is preserved so LeaveApprovals can highlight the target card the same
  // way it did on the retired /leave page.
  // 2026-09-19 — only the APPROVER's notification ("X asked for leave") goes
  // there. The requester's ("your leave was approved / rejected / needs more
  // info") opens their own request on /leave, highlighted — the Desk's queue
  // never showed it to them.
  // The approver's side: a new request or an answer to their question
  // ("approval"), or a request its owner withdrew ("leave_withdrawn").
  if (n?.entity_type === "leave" && n?.entity_id && (n?.type === "approval" || n?.type === "leave_withdrawn")) {
    return `/inbox?leave=${n.entity_id}`;
  }
  if (n?.entity_type === "leave" && n?.entity_id) return `/leave?leave=${n.entity_id}`;
  // 2026-10-21 — Requests. The approver's ("X asks…", an answer, a withdrawal)
  // opens their queue; Finance's ("approved — to pay") opens the list to pay;
  // the requester's opens their own requests. Each lands on the card itself.
  if (n?.entity_type === "request" && n?.entity_id) {
    if (n.type === "approval" || n.type === "request_withdrawn") return `/approvals?sub=requests&request=${n.entity_id}`;
    if (n.type === "assigned") return `/requests?tab=fulfil&request=${n.entity_id}`;
    return `/requests?request=${n.entity_id}`;
  }
  return null;
}
