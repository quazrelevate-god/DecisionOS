// Industry-specific operating model: workflow pipelines (with stages) + task
// categories. Mirrors the backend default so the UI never breaks on a missing model.
// WE-04 (2026-08-16): default stages carry the WE-03 empty extensions
// (tasks[], approval=null, side_effects[]) so a tenant that has no
// stored operating_model yet still renders in OperatingModelEditor
// without a stage.tasks.map crash on first paint.
const st = (key, label) => ({ key, label, tasks: [], approval: null, side_effects: [] });

export const DEFAULT_OPERATING_MODEL = {
  pipelines: [
    { key: "production", label: "Production", sub: "Order → Ready", approval_stage: null,
      stages: [st("order_received", "Order Received"), st("confirmed", "Confirmed"), st("in_production", "In Production"), st("ready", "Ready")] },
    { key: "distribution", label: "Distribution", sub: "Dispatch → Deliver", approval_stage: null,
      stages: [st("ready_to_dispatch", "Ready To Dispatch"), st("dispatched", "Dispatched"), st("in_transit", "In Transit"), st("delivered", "Delivered")] },
    { key: "purchase_payment", label: "Procurement", sub: "Purchase → Payment", approval_stage: "approved",
      stages: [st("requested", "Requested"), st("approved", "Approved"), st("ordered", "Ordered"), st("received", "Received"), st("payment_pending", "Payment Pending"), st("paid", "Paid")] },
  ],
  task_categories: [
    st("operational", "Operational"), st("sales", "Sales"), st("purchase", "Purchase"),
    st("production", "Production"), st("finance", "Finance"), st("hr", "HR"),
  ],
};

/* Audit B-02 (2026-10-08) — A TASK'S DEPARTMENT IS ONE OF THE TEAMS.
   The New Task "Department" list and My Work's tabs used to read a third list
   (operating_model.task_categories: "Buyer Coordination", "Quality Control"…)
   that sign-up generated separately from the teams, with different names.
   They read the teams now (Settings › Team & access), the same list work is
   routed by, so there is one list an owner edits. The owner is a person, not
   a department. A company with no teams yet keeps the generic six. */
export function teamCategories(tenant) {
  const roles = Array.isArray(tenant?.roles) ? tenant.roles : [];
  const seen = new Set();
  return roles
    .filter((r) => r?.key && r.key !== "owner" && !seen.has(r.key) && seen.add(r.key))
    .map((r) => ({ key: r.key, label: r.label || r.key }));
}

export function opModel(tenant) {
  const om = tenant?.operating_model;
  const teams = teamCategories(tenant);
  const task_categories = teams.length ? teams : DEFAULT_OPERATING_MODEL.task_categories;
  if (om && Array.isArray(om.pipelines) && om.pipelines.length) {
    return { pipelines: om.pipelines, task_categories };
  }
  return { ...DEFAULT_OPERATING_MODEL, task_categories };
}
