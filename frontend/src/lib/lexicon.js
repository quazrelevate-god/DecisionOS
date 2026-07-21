// Industry-tailored UI vocabulary. Falls back to generic defaults so the app
// never breaks if a workspace has no lexicon yet.
export const DEFAULT_LEXICON = {
  customer_singular: "Customer",
  customer_plural: "Customers",
  vendor_singular: "Supplier",
  vendor_plural: "Suppliers",
  workflows: {
    production: { label: "Production", sub: "Order → Ready" },
    distribution: { label: "Distribution", sub: "Dispatch → Deliver" },
    purchase_payment: { label: "Procurement", sub: "Purchase → Payment" },
  },
  task_types: {
    operational: "Operational",
    sales: "Sales",
    purchase: "Purchase",
    production: "Production",
    finance: "Finance",
    hr: "HR",
  },
};

// Merge a tenant's stored lexicon over the defaults.
export function lex(tenant) {
  const L = tenant?.lexicon || {};
  const D = DEFAULT_LEXICON;
  return {
    customer_singular: L.customer_singular || D.customer_singular,
    customer_plural: L.customer_plural || D.customer_plural,
    vendor_singular: L.vendor_singular || D.vendor_singular,
    vendor_plural: L.vendor_plural || D.vendor_plural,
    workflows: {
      production: { ...D.workflows.production, ...(L.workflows?.production || {}) },
      distribution: { ...D.workflows.distribution, ...(L.workflows?.distribution || {}) },
      purchase_payment: { ...D.workflows.purchase_payment, ...(L.workflows?.purchase_payment || {}) },
    },
    task_types: { ...D.task_types, ...(L.task_types || {}) },
  };
}
