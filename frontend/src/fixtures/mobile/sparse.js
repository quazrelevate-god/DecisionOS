// Fixture B — sparse (§4).
//
// "today's demo: 1 fire, 2 decisions, 4 contacts, ₹0". This is the state the
// shipped screens were built against, and the one the density floor (L2, §3) is
// measured in: content must fill >= 85% of the first viewport at 390x844 HERE,
// where there is least to show. If a layout passes in sparse it passes anywhere.
import { buildRoutes, buildWrites, TENANT, TEAM, series, ymd, iso } from "./_shared";

const CONTACTS = [
  { id: "c_pack", name: "PackWell Industries", company: "PackWell Industries", type: "vendor", status: "active", phone: "+919820011001", email: "ops@packwell.example", address: "Vapi, Gujarat", outstanding: 0, last_activity_at: iso(-4) },
  { id: "c_gcm", name: "Gujarat Cotton Mills", company: "Gujarat Cotton Mills Ltd", type: "vendor", status: "active", phone: "+919820011002", email: "sales@gcm.example", address: "Ahmedabad, Gujarat", outstanding: 0, last_activity_at: iso(-12) },
  { id: "c_threads", name: "Threads Boutique", company: "Threads Boutique", type: "customer", status: "active", phone: "+919820011003", email: "hello@threads.example", address: "Pune, Maharashtra", outstanding: 0, last_activity_at: iso(-2) },
  { id: "c_kapoor", name: "Kapoor Retail", company: "Kapoor Retail Pvt Ltd", type: "customer", status: "active", phone: "+919820011004", email: "buying@kapoor.example", address: "Delhi", outstanding: 0, last_activity_at: iso(-9) },
];

const FIRE = {
  id: "t_fire", kind: "task_overdue",
  title: "Confirm cotton supplier rates for Q3",
  context_line: "3 days overdue · With Amit Verma",
  amount: null, amount_formatted: null,
  cta: "chase", target_id: "t_fire", target_kind: "task",
  overdue_days: 3, due_date: ymd(-3), from_name: "Amit Verma",
};

const DECISIONS = [
  {
    id: "d_hire", title: "Hire a dispatch coordinator", status: "pending_approval",
    summary: "Dispatch is one person and the Diwali run doubles the volume.",
    rationale: "One coordinator covers both shifts. ₹28,000/month against ₹1,90,000 of late-dispatch penalties booked since April.",
    unblocks: "Second dispatch shift for the festive run",
    amount: 28000, created_at: iso(-6), due_date: ymd(1), created_by: "u_prod",
    proposed_tasks: [{ id: "pt1", title: "Shortlist 3 candidates" }],
  },
  {
    id: "d_rates", title: "Lock supplier rates before the festive season", status: "pending_approval",
    summary: "Two suppliers have quoted; one holds the rate for three weeks.",
    rationale: "Gujarat Cotton Mills is ₹1.50/kg cheaper but will not hold. PackWell holds for three weeks at a ₹12,000 premium on the full order.",
    unblocks: "Festive stock build",
    amount: 12000, created_at: iso(-2), due_date: ymd(3), created_by: "u_sales",
    proposed_tasks: [],
  },
];

const TASKS = [
  { id: "t_fire", title: "Confirm cotton supplier rates for Q3", status: "in_progress", priority: "high", due_date: ymd(-3), assignee_id: "u_prod", assignee_name: "Amit Verma", progress: 40, attachment_count: 0, task_type: "operational" },
  { id: "t_jd", title: "Draft new hire JD for dispatch coordinator", status: "blocked", priority: "medium", due_date: ymd(2), assignee_id: "u_owner", assignee_name: "Rajesh Sharma", attachment_count: 0 },
  { id: "t_stock", title: "Count finished-goods stock before the audit", status: "todo", priority: "medium", due_date: ymd(1), assignee_id: "u_prod", assignee_name: "Amit Verma", progress: 0, attachment_count: 0 },
  { id: "t_gst", title: "File GST return for the quarter", status: "todo", priority: "high", due_date: ymd(4), assignee_id: "u_fin", assignee_name: "Sunita Rao", attachment_count: 0 },
];

const data = {
  tenant: TENANT,
  team: TEAM,
  notifications: [
    { id: "n1", kind: "escalation", title: "Escalated to you", work_title: "Confirm cotton supplier rates for Q3", message: "Escalation", link: "/my-work?task=t_fire", sender_name: "Amit Verma", read: false, created_at: iso(-0.2) },
    { id: "n2", kind: "decision_pending", title: "Decision waiting", work_title: "Hire a dispatch coordinator", message: "Decision", link: "/inbox?focus=decision:d_hire", sender_name: "Amit Verma", read: false, created_at: iso(-1) },
  ],
  pendingCaptures: 0,

  desk: {
    counters: { needs_decision: 2, on_fire: 1, due_today: 1, important: 0 },
    cards: {
      on_fire: [FIRE],
      due_today: [{ id: "t_stock", kind: "task_due_today", title: "Count finished-goods stock before the audit", context_line: "With Amit Verma", cta: "nudge", target_id: "t_stock", target_kind: "task", due_date: ymd(0), from_name: "Amit Verma", amount: null }],
      needs_decision: DECISIONS.map((d) => ({
        id: d.id, kind: "decision", title: d.title,
        context_line: `Waiting ${d.id === "d_hire" ? 6 : 2} days · From ${d.created_by === "u_prod" ? "Amit Verma" : "Priya Nair"}${d.proposed_tasks.length ? ` · Unblocks ${d.proposed_tasks.length} task` : ""}`,
        amount: d.amount, cta: "review", target_id: d.id, target_kind: "decision",
        waiting_days: d.id === "d_hire" ? 6 : 2, from_name: d.created_by === "u_prod" ? "Amit Verma" : "Priya Nair",
        unblocks: d.unblocks, due_date: d.due_date,
      })),
      important: [],
    },
  },

  brief: {
    role: "owner",
    greeting: "Good morning, Rajesh",
    greetingFor: { evening: "Good evening, Rajesh", week: "This week", month: "This month" },
    completed_label: "completed yesterday",
    counters: {
      delayed: 1, completed: 4, awaiting_approval: 2, absent: 0, complaints: 0,
      payment_overdue: 0, fires: 1, on_leave: 0, receivables_overdue: 0,
      bills_due: 0, unmatched_payments: 0,
    },
    finance_amounts: { receivables_overdue: 0, bills_due: 0, unmatched_payments: 0, received: 0 },
    // Decision throughput, 7 points — the L3 progress element for narrative scopes.
    throughput: series(1, 0, 2, 1, 3, 0, 4),
    cleared_period: 4,
  },

  tasks: TASKS,
  decisions: DECISIONS,
  contacts: CONTACTS,
  contactProfile: (c) => ({
    contact: { ...c, tax_id: "24AABCS1429B1ZX" },
    summary: { outstanding: 0, total_billed: 0, total_paid: 0, open_complaints: 0 },
    invoices: [], payments: [], complaints: [], pending_deliveries: [],
    follow_ups: [{ id: "f1", title: `Call ${c.name}`, due_date: ymd(1), owner_name: "Priya Nair" }],
    decisions: [], price_history: [], documents: [],
    tasks: [],
    ai_relationship: { relationship_score: 68, risk_score: 32, reason: "Steady, low volume. No complaints on the last four lots.", signals: ["Pays inside terms", "No complaints"] },
  }),

  workflows: [
    { id: "w1", type: "purchase_payment", title: "PO #221 — Cotton yarn (2 tonnes)", stage: "requested", stages: ["requested", "approved", "ordered", "received", "payment_pending", "paid"], amount: 92000, counterparty: "Gujarat Cotton Mills", owner_name: "Amit Verma" },
    { id: "w2", type: "distribution", title: "Order #4822 — Threads Boutique", stage: "dispatched", stages: ["packed", "dispatched", "delivered", "closed"], amount: 96000, counterparty: "Threads Boutique", owner_name: "Priya Nair" },
  ],
  leaves: [],
  complaints: [],
  attendance: TEAM.map((u) => ({ id: `a_${u.id}`, user_id: u.id, user_name: u.name, date: ymd(0), status: "present" })),

  expenses: [
    { id: "e1", title: "Cotton yarn — 2 tonnes", description: "Cotton yarn — 2 tonnes", amount: 92000, category: "Raw Material", vendor_name: "Gujarat Cotton Mills", date: ymd(-5), status: "unpaid", currency: "INR" },
    { id: "e2", title: "Power bill", description: "Power bill", amount: 61000, category: "Utilities", vendor_name: "MSEDCL", date: ymd(-11), status: "paid", currency: "INR" },
    { id: "e3", title: "Packing cartons", description: "Packing cartons", amount: 15000, category: "Consumable", vendor_name: "PackWell Industries", date: ymd(-8), status: "paid", currency: "INR" },
  ],
  revenue: {
    currency: "INR",
    invoices: [
      { id: "i1", number: "SBT/25-26/0455", contact_name: "Threads Boutique", amount: 96000, paid_amount: 1000, status: "partial", date: ymd(-2), due_date: ymd(13), type: "sales_invoice" },
      { id: "i2", number: "SBT/25-26/0456", contact_name: "Kapoor Retail", amount: 72000, paid_amount: 0, status: "sent", date: ymd(-1), due_date: ymd(20), type: "sales_invoice" },
    ],
    open_invoices: [], payments: [], unmatched_payments: [],
    totals: { billed: 168000, received: 1000, outstanding: 167000 },
  },
  assets: [
    { id: "a1", name: "Jacquard loom #1", category: "Machinery", purchase_amount: 1250000, purchase_date: ymd(-1200), status: "active", currency: "INR" },
    { id: "a2", name: "Delivery van", category: "Vehicle", purchase_amount: 620000, purchase_date: ymd(-900), status: "active", currency: "INR" },
  ],
  inventory: [
    { id: "s1", item: "Cotton yarn 40s", category: "Raw Material", quantity: 1200, unit: "kg", value: 48000, currency: "INR" },
    { id: "s2", item: "Finished shirting", category: "Finished Goods", quantity: 600, unit: "m", value: 84000, currency: "INR" },
  ],
  calendar: [
    { id: "cal1", title: "Stock count before the audit", date: ymd(1), kind: "deadline", amount: 0, link: "/my-work?focus=task:t_stock" },
    { id: "cal2", title: "GST return", date: ymd(4), kind: "compliance", amount: 0, link: "/my-work?focus=task:t_gst" },
  ],

  ledger: {
    currency: "INR",
    totals: {
      total_spend: 168000, paid: 76000, outstanding: 92000, expense_count: 3,
      asset_count: 2, asset_value: 1870000, inventory_count: 2, inventory_value: 132000,
      revenue_billed: 168000, revenue_received: 1000, revenue_outstanding: 167000,
      sales_count: 2, net_profit: 0,
    },
    by_category: [
      { category: "Raw Material", amount: 92000 },
      { category: "Utilities", amount: 61000 },
      { category: "Consumable", amount: 15000 },
    ],
    by_vendor: [
      { vendor: "Gujarat Cotton Mills", amount: 92000 },
      { vendor: "MSEDCL", amount: 61000 },
      { vendor: "PackWell Industries", amount: 15000 },
    ],
    by_month: [{ month: ymd(-30).slice(0, 7), amount: 76000 }, { month: TENANT.currency ? ymd(0).slice(0, 7) : "", amount: 92000 }],
    categories: ["Raw Material", "Utilities", "Consumable", "Salaries", "Other"],
    asset_categories: ["Machinery", "Vehicle"],
    received_series: series(0, 0, 0, 0, 1000, 1000, 1000),
    outstanding_series: series(72000, 72000, 96000, 96000, 167000, 167000, 167000),
  },
  financeAi: {
    scope: "brief", generated_at: iso(-0.2), cached: true,
    verdict: "₹1,68,000 billed, only ₹1,000 received. Both invoices are inside terms — nothing to chase yet.",
    points: ["Threads Boutique part-paid ₹1,000", "Kapoor Retail ₹72,000 due in 20 days"],
  },
  operatingScore: {
    company: { overall: 72, enough_data: true, categories: { execution: 74, finance: 61, sales: 70, responsiveness: 82 } },
    stats: { open: 4, done: 4, overdue: 1, total_decisions: 2, open_complaints: 0 },
    employees: TEAM.slice(1).map((u, i) => ({ id: u.id, name: u.name, role: u.role, score: 70 - i * 4, open: 2 - i, done: 1, overdue: i === 1 ? 1 : 0 })),
  },
  workCoach: {
    target: TEAM[0], stats: { open: 4, done: 4, overdue: 1 },
    summary: {
      generated_at: iso(-0.4),
      headline: "Two decisions have been open six days. Both are under ₹30,000.",
      completed: 4, open: 4, overdive: 1, overdue: 1,
      completion_rate: 0.5, proof_upload_rate: 0.25, plans_used: 1, photos_uploaded: 2, voice_updates: 3,
      strengths: ["You answer escalations the same day."],
      improvements: ["Both open decisions are under ₹30,000 — they could sit with Amit."],
      recommendation: "Delegate approvals under ₹30,000 and close the supplier-rate decision this week.",
    },
  },
  journal: {
    days: [
      { date: ymd(0), decisions: [], notes: [{ id: "j1", text: "Held the supplier rate decision another day.", created_at: iso(-0.3) }] },
      { date: ymd(-6), decisions: [{ id: "d_hire", title: "Hire a dispatch coordinator", status: "pending_approval" }], notes: [] },
    ],
  },
  operatingModel: {
    pipelines: [
      { key: "purchase_payment", label: "Purchase to payment", stages: ["requested", "approved", "ordered", "received", "payment_pending", "paid"] },
      { key: "distribution", label: "Distribution", stages: ["packed", "dispatched", "delivered", "closed"] },
    ],
  },
};

export const SPARSE = { name: "sparse", data, routes: buildRoutes(data), writes: buildWrites() };
