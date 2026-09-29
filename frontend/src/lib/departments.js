/* A department's NAME, never its key (2026-09-21).
 *
 * Found clicking through a new company in the browser: an AI-designed company's
 * departments have keys like `sales_&_order_management`, and two screens printed
 * the key — the workflow card ("sales_&_order_management owns this stage") and
 * the decision review ("Pick who does this (production_&_quality team)"). The
 * owner reads "Sales & Order Management". One helper, so every screen that names
 * a department says the same words.
 */
/* 2026-09-29 — and it is the LAST one. The sweep that followed the access
   walk found FIVE more implementations of this idea: MyWork's teamLabel,
   Team's roleName and roleNameFor, OperatingScore's roleLabelFor, and one I
   added to lib/perms that morning without noticing this file already existed
   and already said, up top, "one helper, so every screen that names a
   department says the same words". Five copies is how a screen ends up
   printing the key: not because anyone chose to, but because the copy in
   reach did not have the fix. They all call this now.

   `roleWords` is the fallback for a key this company does not list, which is
   the normal case in the workspace switcher (a role held in ANOTHER company)
   and in the platform admin console. The keys are slugs of the labels, so it
   lands on the right words on its own: sales_&_order_management reads as
   "Sales & Order Management". Title-cased per word, which Team's `humanize`
   did and this file's own fallback did not. */
export function roleWords(key) {
  return String(key || "")
    .replace(/_&_/g, " & ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A role in the company's own words: the label the owner gave it in
 *  Settings, else the key read as words. `fallback` is for no role at all. */
export function roleLabel(key, roles = null, fallback = "—") {
  if (!key) return fallback;
  if (key === "owner") return "Owner";
  const named = (roles || []).find((r) => r.key === key);
  return (named && named.label) || roleWords(key);
}

export function deptName(tenant, key) {
  if (!key) return "";
  return roleLabel(key, tenant?.roles, "");
}

export default deptName;
