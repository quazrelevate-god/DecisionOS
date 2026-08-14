// Fixture C — busy (§4).
//
// "12 fires, 30 decisions, 60 contacts, ₹40L across 8 accounts". What this state
// proves: "caps hold, nothing overflows, titles clamp." Names and amounts vary
// in length on purpose — several titles are deliberately long enough to need the
// 2-line clamp, and amounts span ₹8,000 to ₹40,00,000 so column alignment is
// actually tested.
import { buildRoutes, buildWrites, TENANT, TEAM, series, ymd, iso } from "./_shared";

const COMPANIES = [
  "Reliance Trends", "Krishna Garments", "Anand Fabrics", "Nashik Traders",
  "Surat Spinners", "Coimbatore Loom Works", "Bombay Dyeing House", "Rajkot Fibres",
  "Tirupur Knitwear Exports", "Ludhiana Woollen Mills", "Erode Handloom Collective",
  "Panipat Home Textiles", "Bhilwara Suiting", "Salem Silk House", "Ichalkaranji Weavers",
];
const CITIES = ["Mumbai", "Ahmedabad", "Surat", "Nashik", "Coimbatore", "Rajkot", "Tirupur", "Ludhiana", "Erode", "Panipat"];
const STAGES = ["key_account", "growing", "at_risk", "watch", "dormant", "preferred"];

const contacts = Array.from({ length: 60 }, (_, i) => {
  const base = COMPANIES[i % COMPANIES.length];
  const suffix = i >= COMPANIES.length ? ` ${["Pvt Ltd", "LLP", "& Sons", "Exports", "Industries"][i % 5]}` : "";
  const outstanding = i % 4 === 0 ? 0 : [8000, 42000, 168000, 400000, 1250000, 4000000][i % 6];
  return {
    id: `c_${i}`,
    name: `${base}${suffix}`,
    company: `${base}${suffix || " Pvt Ltd"}`,
    type: i % 3 === 0 ? "vendor" : i % 7 === 0 ? "dealer" : "customer",
    status: i % 11 === 0 ? "inactive" : "active",
    lifecycle_stage: STAGES[i % STAGES.length],
    phone: `+9198200${String(20000 + i).slice(0, 5)}`,
    email: `contact${i}@example.in`,
    address: `${CITIES[i % CITIES.length]}, India`,
    city: CITIES[i % CITIES.length],
    outstanding,
    total_business: outstanding * 6 + 250000,
    health_score: 30 + ((i * 7) % 65),
    last_activity_at: iso(-(i % 40)),
  };
});

const FIRE_TITLES = [
  "Krishna Garments has not paid ₹4,00,000 — 31 days past terms and unreachable on two numbers",
  "Loom 4 motor tripping — Diwali run at risk",
  "GST input credit unreconciled for March",
  "Reliance Trends dispatch slipped a second time",
  "Dyeing job work rejected — 240 m off-shade",
  "Boiler pressure valve overdue for inspection",
  "Two cutting masters absent, second shift uncovered",
  "Rajkot Fibres delivery short by 800 kg",
  "Export documentation missing for the Tirupur consignment",
  "Power factor penalty on the September bill",
  "Sample lot rejected by Panipat Home Textiles",
  "Insurance renewal lapses on Friday",
];

const fires = FIRE_TITLES.map((title, i) => ({
  id: `f_${i}`, kind: i % 3 === 0 ? "task_escalation" : "task_overdue",
  title,
  context_line: `${(i % 30) + 2} days overdue · With ${TEAM[(i % 3) + 1].name}`,
  amount: i % 3 === 0 ? [400000, 78000, 152000, 4000000][i % 4] : null,
  cta: i % 3 === 0 ? "respond" : "chase",
  target_id: `f_${i}`, target_kind: "task",
  overdue_days: (i % 30) + 2, due_date: ymd(-((i % 30) + 2)),
  from_name: TEAM[(i % 3) + 1].name,
}));

const DECISION_TITLES = [
  "Approve ₹4,80,000 yarn purchase from Surat Spinners for the Diwali run",
  "Write off ₹1,15,000 from Krishna Garments",
  "Hire a second cutting master on ₹32,000 a month",
  "Give Reliance Trends 45-day credit instead of 30",
  "Replace the failing Jacquard loom motor — ₹78,000",
  "Discount ₹24,000 to close the Anand Fabrics reorder",
  "Take the Tirupur export order at 8% margin",
  "Lease a second godown in Bhiwandi at ₹85,000 a month",
  "Switch dyeing to Bombay Dyeing House at a ₹6/m premium",
  "Buy the second-hand rapier loom offered at ₹9,50,000",
];

const decisions = Array.from({ length: 30 }, (_, i) => {
  const t = DECISION_TITLES[i % DECISION_TITLES.length];
  const amount = [480000, 115000, 32000, 2200000, 78000, 24000, 640000, 85000, 96000, 950000][i % 10];
  const from = TEAM[(i % 3) + 1];
  return {
    id: `d_${i}`,
    title: i >= DECISION_TITLES.length ? `${t} (revision ${Math.floor(i / DECISION_TITLES.length) + 1})` : t,
    status: "pending_approval",
    summary: "Raised for your approval with the numbers attached.",
    rationale: "The cheaper option cannot hold the rate or the delivery slot, and the festive order cannot slip. The premium buys certainty on both.",
    unblocks: i % 2 ? "Diwali production run" : "Festive stock build",
    amount, created_at: iso(-((i % 9) + 1)), due_date: ymd((i % 5) + 1),
    created_by: from.id,
    proposed_tasks: Array.from({ length: i % 4 }, (_, k) => ({ id: `pt_${i}_${k}`, title: `Follow-up step ${k + 1}` })),
  };
});

const tasks = Array.from({ length: 42 }, (_, i) => {
  const late = i % 3 === 0;
  const assignee = TEAM[(i % 3) + 1];
  return {
    id: `t_${i}`,
    title: [
      "Collect outstanding from Krishna Garments",
      "Reconcile GST input credit against the purchase register",
      "Fix loom 4 motor tripping — six stoppages this month and the Diwali run depends on it",
      "Send the dispatch plan for the Reliance Trends festive order",
      "Chase Anand Fabrics for the signed reorder confirmation",
      "Count finished-goods stock in godown 2 before the audit",
      "File the TDS return",
    ][i % 7] + (i > 6 ? ` (${Math.floor(i / 7) + 1})` : ""),
    status: i % 9 === 0 ? "blocked" : i % 5 === 0 ? "done" : late ? "in_progress" : "todo",
    priority: ["high", "medium", "low"][i % 3],
    due_date: late ? ymd(-((i % 20) + 1)) : ymd(i % 12),
    assignee_id: assignee.id, assignee_name: assignee.name, assignee_role: assignee.role,
    progress: [0, 25, 50, 75][i % 4],
    attachment_count: i % 3,
    task_type: ["operational", "financial", "sales"][i % 3],
  };
});

const PIPELINES = [
  { key: "order_to_cash", label: "Order to cash", stages: ["enquiry", "quotation_sent", "order_confirmed", "in_production", "dispatched", "payment_received"] },
  { key: "purchase_payment", label: "Purchase to payment", stages: ["requested", "approved", "ordered", "received", "payment_pending", "paid"] },
];

const workflows = Array.from({ length: 22 }, (_, i) => {
  const p = PIPELINES[i % 2];
  return {
    id: `w_${i}`, type: p.key, stages: p.stages,
    stage: p.stages[i % p.stages.length],
    title: `${["Order", "PO"][i % 2]} #${4800 + i} — ${COMPANIES[i % COMPANIES.length]}`,
    amount: [96000, 480000, 2200000, 64000, 152000][i % 5],
    counterparty: COMPANIES[i % COMPANIES.length],
    contact_id: `c_${i}`,
    owner_name: TEAM[(i % 3) + 1].name,
  };
});

const invoices = Array.from({ length: 18 }, (_, i) => {
  const amount = [8000, 42000, 168000, 400000, 1250000, 4000000][i % 6];
  const overdue = i % 3 === 0;
  return {
    id: `i_${i}`, type: "sales_invoice",
    number: `SBT/25-26/0${400 + i}`,
    contact_id: `c_${i}`, contact_name: contacts[i].name,
    amount, paid_amount: i % 4 === 0 ? amount : i % 5 === 0 ? Math.round(amount / 3) : 0,
    status: i % 4 === 0 ? "paid" : overdue ? "overdue" : "sent",
    date: ymd(-(20 + i)), due_date: overdue ? ymd(-((i % 40) + 1)) : ymd((i % 25) + 1),
  };
});

const data = {
  tenant: TENANT,
  team: TEAM,
  notifications: Array.from({ length: 14 }, (_, i) => ({
    id: `n_${i}`,
    kind: ["decision_pending", "escalation", "mention", "payment_received", "task_done"][i % 5],
    title: "Needs you", work_title: FIRE_TITLES[i % FIRE_TITLES.length].slice(0, 60),
    message: "Update", link: "/inbox", sender_name: TEAM[(i % 3) + 1].name,
    read: i > 8, created_at: iso(-(i * 0.3)),
  })),
  pendingCaptures: 6,

  desk: {
    counters: { needs_decision: 30, on_fire: 12, due_today: 7, important: 4 },
    cards: {
      needs_decision: decisions.map((d, i) => ({
        id: d.id, kind: "decision", title: d.title,
        context_line: `Waiting ${(i % 9) + 1} days · From ${TEAM[(i % 3) + 1].name}${d.proposed_tasks.length ? ` · Unblocks ${d.proposed_tasks.length} tasks` : ""}`,
        amount: d.amount, cta: "review", target_id: d.id, target_kind: "decision",
        waiting_days: (i % 9) + 1, from_name: TEAM[(i % 3) + 1].name,
        unblocks: d.unblocks, due_date: d.due_date,
      })),
      on_fire: fires,
      due_today: tasks.filter((t) => t.due_date === ymd(0)).slice(0, 7).map((t) => ({
        id: t.id, kind: "task_due_today", title: t.title,
        context_line: `With ${t.assignee_name}`, amount: null,
        cta: "nudge", target_id: t.id, target_kind: "task", due_date: t.due_date, from_name: t.assignee_name,
      })),
      important: decisions.slice(0, 4).map((d) => ({
        id: `imp_${d.id}`, kind: "decision", title: d.title, context_line: "AI flagged",
        amount: d.amount, cta: "review", target_id: d.id, target_kind: "decision", from_name: "Dex",
      })),
    },
  },

  brief: {
    role: "owner",
    greeting: "Good morning, Rajesh",
    greetingFor: { evening: "Good evening, Rajesh", week: "This week", month: "This month" },
    completed_label: "completed yesterday",
    counters: {
      delayed: 14, completed: 11, awaiting_approval: 30, absent: 2, complaints: 3,
      payment_overdue: 6, fires: 12, on_leave: 1, receivables_overdue: 6,
      bills_due: 4, unmatched_payments: 2,
    },
    finance_amounts: {
      receivables_overdue: 1712000, bills_due: 623000, unmatched_payments: 75000, received: 2015000,
    },
    throughput: series(3, 5, 2, 6, 4, 7, 5),
    cleared_period: 11,
  },

  tasks,
  decisions,
  contacts,
  contactProfile: (c) => ({
    contact: { ...c, tax_id: "24AABCS1429B1ZX" },
    summary: { outstanding: c.outstanding, total_billed: c.total_business, total_paid: Math.max(0, c.total_business - c.outstanding), open_complaints: c.outstanding > 400000 ? 2 : 0 },
    invoices: invoices.filter((i) => i.contact_id === c.id),
    payments: [{ id: "p1", amount: 96000, mode: "NEFT", reference: "NEFT8837221", date: ymd(-3) }],
    complaints: c.outstanding > 400000 ? [{ id: "cp1", title: "Shade mismatch on the indigo lot", status: "open" }] : [],
    pending_deliveries: [{ id: "pd1", title: "2,400 m indigo shirting", due_date: ymd(2), amount: 384000 }],
    follow_ups: [{ id: "f1", title: `Chase ${c.name}`, due_date: ymd(1), owner_name: "Priya Nair" }],
    decisions: [], price_history: [
      { id: "ph1", item: "Cotton shirting 40s", rate: 158, date: ymd(-120), unit: "m" },
      { id: "ph2", item: "Cotton shirting 40s", rate: 162, date: ymd(-40), unit: "m" },
    ],
    documents: [{ id: "bd1", title: "Master agreement 2025", filename: "msa.pdf" }],
    tasks: tasks.slice(0, 3),
    ai_relationship: {
      relationship_score: c.health_score, risk_score: 100 - c.health_score,
      reason: c.outstanding > 400000
        ? "Payment behaviour has deteriorated for three months running. Treat further supply as cash-only."
        : "Steady buyer, pays inside terms, no complaints on the last six lots.",
      signals: c.outstanding > 400000 ? ["31 days overdue", "Unreachable on two numbers"] : ["Pays inside terms", "Reorders quarterly"],
    },
  }),

  workflows,
  leaves: [
    { id: "lv1", user_id: "u_sales", user_name: "Priya Nair", user_role: "sales", leave_type: "casual", from_date: ymd(5), to_date: ymd(7), days: 3, day_portion: "full", reason: "Deepavali with family", status: "pending" },
    { id: "lv2", user_id: "u_prod", user_name: "Amit Verma", user_role: "production", leave_type: "sick", from_date: ymd(-1), to_date: ymd(0), days: 2, day_portion: "full", reason: "Fever", status: "approved" },
  ],
  complaints: [
    { id: "cp1", title: "Shade mismatch on the indigo lot", contact_id: "c_2", contact_name: contacts[2].name, status: "open", severity: "high", assignee_name: "Amit Verma" },
    { id: "cp2", title: "Short packing — 12 pieces", contact_id: "c_3", contact_name: contacts[3].name, status: "open", severity: "low", assignee_name: "Priya Nair" },
    { id: "cp3", title: "Late delivery penalty claimed", contact_id: "c_1", contact_name: contacts[1].name, status: "resolved", severity: "medium", assignee_name: "Priya Nair" },
  ],
  attendance: TEAM.map((u, i) => ({ id: `a_${u.id}`, user_id: u.id, user_name: u.name, date: ymd(0), status: i > 2 ? "absent" : "present" })),

  expenses: Array.from({ length: 24 }, (_, i) => ({
    id: `e_${i}`,
    title: ["Cotton yarn 40s — 12 tonnes", "Power bill", "Wages", "Dyeing job work", "Loom spares", "Freight to Mumbai", "Polyester blend", "GST consultant retainer"][i % 8] + (i > 7 ? ` (${Math.floor(i / 8) + 1})` : ""),
    description: ["Cotton yarn 40s — 12 tonnes", "Power bill", "Wages", "Dyeing job work", "Loom spares", "Freight to Mumbai", "Polyester blend", "GST consultant retainer"][i % 8],
    amount: [480000, 214000, 862000, 96000, 38500, 47000, 152000, 25000][i % 8],
    category: ["Raw Material", "Utilities", "Salaries", "Job Work", "Maintenance", "Logistics", "Raw Material", "Professional Fees"][i % 8],
    vendor_name: COMPANIES[i % COMPANIES.length],
    date: ymd(-(i + 2)), status: i % 3 === 0 ? "unpaid" : "paid", currency: "INR",
  })),
  revenue: {
    currency: "INR",
    invoices,
    open_invoices: invoices.filter((i) => i.status !== "paid"),
    payments: Array.from({ length: 9 }, (_, i) => ({
      id: `pay_${i}`, direction: "in", contact_name: contacts[i].name,
      amount: [96000, 400000, 168000, 42000, 1250000][i % 5],
      date: ymd(-(i + 1)), mode: ["NEFT", "UPI", "RTGS"][i % 3], reference: `REF${90000 + i}`,
      matched: i % 4 !== 0,
    })),
    unmatched_payments: [{ id: "pay_0", amount: 75000, mode: "NEFT", reference: "NEFT9910233", date: ymd(-2) }],
    totals: { billed: 8940000, received: 2015000, outstanding: 1712000 },
  },
  assets: Array.from({ length: 11 }, (_, i) => ({
    id: `a_${i}`,
    name: ["Jacquard loom #4", "Jacquard loom #5", "Rapier loom #1", "Cutting table", "Tata Ace van", "Diesel generator", "Compressor", "Boiler", "Winding machine", "Folding machine", "Forklift"][i],
    category: ["Machinery", "Machinery", "Machinery", "Machinery", "Vehicle", "Utility", "Utility", "Utility", "Machinery", "Machinery", "Vehicle"][i],
    purchase_amount: [1250000, 1250000, 950000, 185000, 620000, 480000, 145000, 760000, 320000, 210000, 890000][i],
    purchase_date: ymd(-(600 + i * 90)), status: i === 0 ? "maintenance" : "active", currency: "INR",
  })),
  inventory: Array.from({ length: 13 }, (_, i) => ({
    id: `s_${i}`,
    item: ["Cotton yarn 40s", "Polyester blend", "Finished shirting — grey", "Finished shirting — indigo", "Packing cartons", "Dye — indigo", "Dye — reactive black", "Bobbins", "Cones", "Labels", "Poly bags", "Cartons large", "Thread"][i],
    category: ["Raw Material", "Raw Material", "Finished Goods", "Finished Goods", "Consumable", "Raw Material", "Raw Material", "Consumable", "Consumable", "Consumable", "Consumable", "Consumable", "Raw Material"][i],
    quantity: [8400, 2100, 4200, 1800, 900, 340, 280, 1200, 800, 5000, 3000, 400, 600][i],
    unit: ["kg", "kg", "m", "m", "pcs", "kg", "kg", "pcs", "pcs", "pcs", "pcs", "pcs", "kg"][i],
    value: [336000, 79800, 588000, 288000, 27000, 102000, 78400, 24000, 16000, 15000, 9000, 12000, 42000][i],
    currency: "INR",
  })),
  calendar: Array.from({ length: 12 }, (_, i) => ({
    id: `cal_${i}`,
    title: ["Reliance Trends dispatch deadline", "Surat Spinners payment due", "TDS return", "Priya on leave", "Fire safety certificate expiry", "Audit visit", "Boiler inspection", "GST filing", "Insurance renewal", "Export documentation", "Sample approval", "Loom service"][i],
    date: ymd(i % 30), kind: ["deadline", "payment", "compliance", "leave"][i % 4],
    amount: i % 4 === 1 ? [336000, 480000, 92000][i % 3] : 0,
    link: "/my-work",
  })),

  ledger: {
    currency: "INR",
    totals: {
      total_spend: 4021500, paid: 2680000, outstanding: 1341500, expense_count: 24,
      asset_count: 11, asset_value: 7060000, inventory_count: 13, inventory_value: 1617200,
      revenue_billed: 8940000, revenue_received: 2015000, revenue_outstanding: 1712000,
      sales_count: 18, net_profit: 4918500,
    },
    by_category: [
      { category: "Salaries", amount: 1724000 },
      { category: "Raw Material", amount: 1264000 },
      { category: "Utilities", amount: 428000 },
      { category: "Job Work", amount: 288000 },
      { category: "Logistics", amount: 141000 },
      { category: "Maintenance", amount: 115500 },
      { category: "Professional Fees", amount: 61000 },
    ],
    by_vendor: COMPANIES.slice(0, 8).map((v, i) => ({ vendor: v, amount: [960000, 720000, 480000, 336000, 214000, 152000, 96000, 47000][i] })),
    by_month: Array.from({ length: 6 }, (_, i) => ({ month: ymd(-(150 - i * 30)).slice(0, 7), amount: [520000, 610000, 700000, 660000, 780000, 751500][i] })),
    categories: ["Raw Material", "Salaries", "Utilities", "Job Work", "Logistics", "Maintenance", "Professional Fees", "Other"],
    asset_categories: ["Machinery", "Vehicle", "Utility"],
    received_series: series(240000, 410000, 380000, 620000, 900000, 1500000, 2015000),
    outstanding_series: series(2200000, 2100000, 1980000, 1900000, 1840000, 1760000, 1712000),
  },
  financeAi: {
    scope: "brief", generated_at: iso(-0.2), cached: true,
    verdict: "₹17,12,000 is overdue from customers and ₹4,00,000 of it is 31 days late with one retailer. Everything else is inside terms.",
    points: [
      "Krishna Garments — ₹4,00,000 outstanding 31 days",
      "Surat Spinners — ₹3,36,000 due in 4 days",
      "₹75,000 on NEFT9910233 is unmatched",
    ],
  },
  operatingScore: {
    company: { overall: 68, enough_data: true, categories: { execution: 74, finance: 52, sales: 71, responsiveness: 80 } },
    stats: { open: 28, done: 11, overdue: 14, total_decisions: 30, open_complaints: 2 },
    employees: TEAM.slice(1).map((u, i) => ({ id: u.id, name: u.name, role: u.role, score: [66, 72, 58][i], open: [9, 7, 12][i], done: [4, 5, 2][i], overdue: [3, 2, 9][i] })),
  },
  workCoach: {
    target: TEAM[0], stats: { open: 28, done: 11, overdue: 14 },
    summary: {
      generated_at: iso(-0.4),
      headline: "You are the bottleneck on 30 decisions. Nineteen are under ₹80,000.",
      completed: 11, open: 28, overdue: 14,
      completion_rate: 0.28, proof_upload_rate: 0.42, plans_used: 2, photos_uploaded: 5, voice_updates: 7,
      strengths: ["Escalations get a reply the same day.", "Cash decisions above ₹5,00,000 always get written rationale."],
      improvements: [
        "Thirty decisions have been waiting an average of five days.",
        "You reopened the Krishna Garments file four times in nine days without deciding.",
      ],
      recommendation: "Delegate approvals under ₹30,000 and close the Krishna Garments file this week.",
    },
  },
  journal: {
    days: Array.from({ length: 9 }, (_, i) => ({
      date: ymd(-i),
      decisions: i % 3 === 0 ? decisions.slice(i, i + 2).map((d) => ({ id: d.id, title: d.title, status: d.status })) : [],
      notes: Array.from({ length: (i % 4) + 1 }, (_, k) => ({ id: `jn_${i}_${k}`, text: "Held the supplier rate decision another day.", created_at: iso(-i) })),
    })),
  },
  operatingModel: { pipelines: PIPELINES },
};

export const BUSY = { name: "busy", data, routes: buildRoutes(data), writes: buildWrites() };
