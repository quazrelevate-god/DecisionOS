// Fixture A — empty (§4).
//
// A brand-new tenant with nothing recorded. What this state proves: "empty
// states invite rather than dead-end." Every screen rendered against this must
// end in a sentence and a button, never a full stop.
import { buildRoutes, buildWrites, TENANT, TEAM, series } from "./_shared";

const data = {
  tenant: { ...TENANT, name: "New Textiles Co" },
  team: [TEAM[0]],
  notifications: [],
  pendingCaptures: 0,

  desk: {
    counters: { needs_decision: 0, on_fire: 0, due_today: 0, important: 0 },
    cards: {},
  },
  brief: {
    role: "owner",
    greeting: "Good morning, Rajesh",
    greetingFor: { evening: "Good evening, Rajesh" },
    completed_label: "completed yesterday",
    counters: {
      delayed: 0, completed: 0, awaiting_approval: 0, absent: 0, complaints: 0,
      payment_overdue: 0, fires: 0, on_leave: 0, receivables_overdue: 0,
      bills_due: 0, unmatched_payments: 0,
    },
    finance_amounts: { receivables_overdue: 0, bills_due: 0, unmatched_payments: 0 },
    throughput: series(0, 0, 0, 0, 0, 0, 0),
  },

  tasks: [],
  decisions: [],
  contacts: [],
  workflows: [],
  leaves: [],
  complaints: [],
  expenses: [],
  assets: [],
  inventory: [],
  revenue: { currency: "INR", invoices: [], open_invoices: [], payments: [], unmatched_payments: [], totals: {} },
  calendar: [],
  journal: { days: [] },

  ledger: {
    currency: "INR",
    totals: {
      total_spend: 0, paid: 0, outstanding: 0, expense_count: 0,
      asset_count: 0, asset_value: 0, inventory_count: 0, inventory_value: 0,
      revenue_billed: 0, revenue_received: 0, revenue_outstanding: 0,
      sales_count: 0, net_profit: 0,
    },
    by_category: [], by_vendor: [], by_month: [],
    categories: ["Raw Material", "Salaries", "Utilities", "Other"],
    asset_categories: ["Machinery", "Vehicle"],
    received_series: series(0, 0, 0, 0, 0, 0, 0),
    outstanding_series: series(0, 0, 0, 0, 0, 0, 0),
  },
  financeAi: null,
  operatingScore: { company: { overall: null, enough_data: false, categories: {} }, stats: {}, employees: [] },
  workCoach: { target: TEAM[0], stats: {}, summary: null },
  operatingModel: { pipelines: [] },
};

export const EMPTY = { name: "empty", data, routes: buildRoutes(data), writes: buildWrites() };
