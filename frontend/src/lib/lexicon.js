// Industry-tailored UI vocabulary. Falls back to generic defaults so the app
// never breaks if a workspace has no lexicon yet.
//
// WE-02 (2026-08-16): `workflows` key removed. The three hardcoded pipeline
// label/sub pairs (production/distribution/purchase_payment) were a dead
// output -- no consumer page read L.workflows.*. Pipeline labels come from
// tenant.operating_model.pipelines[].label instead.
export const DEFAULT_LEXICON = {
  customer_singular: "Customer",
  customer_plural: "Customers",
  vendor_singular: "Supplier",
  vendor_plural: "Suppliers",
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
    task_types: { ...D.task_types, ...(L.task_types || {}) },
  };
}
