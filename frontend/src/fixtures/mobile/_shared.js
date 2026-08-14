// Shared builders for the three fixture states (§4).
//
// Dates are anchored to midnight UTC today so relative strings ("3 days
// overdue", "Due Monday") are stable for a whole day and screenshots do not
// flake — the same anchoring the MPWA-00 harness uses.
const ANCHOR = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
export const shift = (days) => new Date(ANCHOR.getTime() + days * 86400000);
export const ymd = (n) => shift(n).toISOString().slice(0, 10);
export const iso = (n) => shift(n).toISOString();
export const TODAY = ymd(0);

export const OWNER = { id: "u_owner", name: "Rajesh Sharma", role: "owner", email: "owner@sharma.com", language: "en" };

export const TENANT = {
  id: "ten_fixture",
  name: "Sharma Textiles Pvt Ltd",
  industry: "Textile Manufacturing",
  currency: "INR",
  high_value_threshold: 50000,
  onboarded: true,
};

export const TEAM = [
  OWNER,
  { id: "u_sales", name: "Priya Nair", role: "sales", email: "priya@sharma.com" },
  { id: "u_prod", name: "Amit Verma", role: "production", email: "amit@sharma.com" },
  { id: "u_fin", name: "Sunita Rao", role: "finance", email: "sunita@sharma.com" },
];

/** A 7-point series for Pulse sparklines. */
export const series = (...points) => points.map((v, i) => ({ x: i, v }));

/**
 * Assemble the route table every fixture shares, so each state only declares
 * its own data. Anything a state leaves undefined simply does not match, and
 * the request falls through to the network rather than silently returning {}.
 */
export function buildRoutes(d) {
  const R = [];
  const add = (match, data) => { if (data !== undefined) R.push({ match, data }); };

  add("/auth/me", { user: OWNER, tenant: d.tenant || TENANT });
  add("/users", d.team || TEAM);
  add("/notifications", { notifications: d.notifications || [], unread: (d.notifications || []).filter((n) => !n.read).length });
  add("/captures/pending-count", { count: d.pendingCaptures ?? 0 });

  // /desk answers per chip, and always returns the full counters map so the
  // header sentence needs one call (same contract as routers/desk.py).
  if (d.desk) {
    R.push({
      match: "/desk",
      data: ({ query }) => {
        const chip = query.get("chip") || "needs_decision";
        return { chip, counters: d.desk.counters, cards: d.desk.cards?.[chip] || [] };
      },
    });
  }
  if (d.brief) {
    R.push({
      match: "/brief",
      data: ({ query }) => {
        const period = query.get("period") || "morning";
        return { ...d.brief, period, greeting: d.brief.greetingFor?.[period] || d.brief.greeting };
      },
    });
  }
  add("/brief/details", { key: "", actionable: false, items: d.briefDetails || [] });

  add("/tasks", d.tasks);
  add(/^\/tasks\/[^/]+$/, ({ path }) => (d.tasks || []).find((t) => path.endsWith(t.id)) || {});
  add("/decisions", d.decisions);
  add(/^\/decisions\/[^/]+$/, ({ path }) => (d.decisions || []).find((x) => path.endsWith(x.id)) || {});
  add("/contacts", d.contacts);
  add(/^\/contacts\/[^/]+\/profile$/, ({ path }) => {
    const id = path.split("/")[2];
    const c = (d.contacts || []).find((x) => x.id === id) || (d.contacts || [])[0];
    return c ? (d.contactProfile ? d.contactProfile(c) : { contact: c, summary: {}, invoices: [], payments: [], complaints: [], workflows: [], pending_deliveries: [], follow_ups: [], price_history: [], documents: [], tasks: [] }) : {};
  });
  add("/workflows", d.workflows);
  add("/leaves", d.leaves);
  add("/complaints", d.complaints);
  add("/attendance", d.attendance || []);
  add("/ledger/summary", d.ledger);
  add(/^\/ledger\/ai\/[^/]+$/, d.financeAi);
  add("/expenses", d.expenses);
  add("/revenue", d.revenue);
  add("/assets", d.assets);
  add("/inventory", d.inventory);
  add("/invoices", d.invoices || []);
  add("/payments", d.payments || []);
  add("/calendar", d.calendar || []);
  add("/operating-score", d.operatingScore);
  add("/work-coach", d.workCoach);
  add("/journal", d.journal);
  add("/brain/documents", d.documents || []);
  add("/ingest", d.captures || []);
  add("/whatsapp/status", d.whatsapp || { connected: false, number: null });
  add("/tenant", d.tenant || TENANT);
  add("/tenant/settings", d.tenant || TENANT);
  add("/tenant/operating-model", d.operatingModel || { pipelines: [] });
  add("/tenant/roles", d.roles || []);

  return R;
}
