// Industry-specific operating model: workflow pipelines (with stages) + task
// categories. Mirrors the backend default so the UI never breaks on a missing model.
const st = (key, label) => ({ key, label });

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

export function opModel(tenant) {
  const om = tenant?.operating_model;
  if (om && Array.isArray(om.pipelines) && om.pipelines.length) {
    return {
      pipelines: om.pipelines,
      task_categories: Array.isArray(om.task_categories) && om.task_categories.length
        ? om.task_categories
        : DEFAULT_OPERATING_MODEL.task_categories,
    };
  }
  return DEFAULT_OPERATING_MODEL;
}
