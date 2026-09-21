/* A department's NAME, never its key (2026-09-21).
 *
 * Found clicking through a new company in the browser: an AI-designed company's
 * departments have keys like `sales_&_order_management`, and two screens printed
 * the key — the workflow card ("sales_&_order_management owns this stage") and
 * the decision review ("Pick who does this (production_&_quality team)"). The
 * owner reads "Sales & Order Management". One helper, so every screen that names
 * a department says the same words.
 */
export function deptName(tenant, key) {
  if (!key) return "";
  if (key === "owner") return "Owner";
  const hit = (tenant?.roles || []).find((r) => r.key === key);
  if (hit?.label) return hit.label;
  return String(key).replace(/_&_/g, " & ").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default deptName;
