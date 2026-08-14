#!/usr/bin/env node
/**
 * Dev-only fixture API for the mobile-pwa track.
 *
 * WHY THIS EXISTS
 * ---------------
 * The real backend needs MongoDB + `backend/.env` (neither is in the repo).
 * The mobile track is frontend-only (`backend/` is read-only per the spec),
 * but MPWA-00's audit harness and every "verify by running it" acceptance
 * criterion need authenticated screens to actually render.
 *
 * So: a zero-dependency stand-in that speaks the same shapes as the real
 * routers. Response contracts were read off `backend/routers/*.py` and
 * `backend/server.py` at 54067b0 — they are not guessed, but they are also
 * not the live API. Anything verified against this server is verified
 * against a fixture, and is called out as such.
 *
 * Data is one persona: Rajesh Kumar, owner of a 30-person textile unit
 * (spec §2). Amounts are chosen so Indian digit grouping is visible
 * (₹4,00,000 / ₹1.84Cr) and so zero-value tiles exist to be hidden.
 *
 *   node scripts/fixture-server.mjs [--port 8000]
 */
import http from 'node:http';

const argPort = process.argv.indexOf('--port');
const PORT = argPort > -1 ? Number(process.argv[argPort + 1]) : 8000;
const ORIGIN = process.env.FIXTURE_CORS_ORIGIN || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Date helpers.
//
// T0 is anchored to *midnight UTC today*, not process start. The audit freezes
// the browser clock to the same anchor (+9h12m), so every relative string
// ("Waiting 6 days", "31 days late") is byte-stable for the whole day. Without
// a shared anchor the desktop screenshot diff flakes as wall-clock advances.
// Override with FIXTURE_ANCHOR=2026-08-14 to pin a specific day.
// ---------------------------------------------------------------------------
const ANCHOR = process.env.FIXTURE_ANCHOR
  ? new Date(`${process.env.FIXTURE_ANCHOR}T00:00:00.000Z`)
  : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const T0 = ANCHOR;
const iso = (d) => d.toISOString();
const ymd = (d) => d.toISOString().slice(0, 10);
const shift = (days, hours = 0) =>
  new Date(T0.getTime() + days * 86400000 + hours * 3600000);
const daysAgo = (n) => iso(shift(-n));
const dateAgo = (n) => ymd(shift(-n));
const dateAhead = (n) => ymd(shift(n));
const TODAY = ymd(T0);

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------
const TENANT = {
  id: 'ten_rajesh_textiles',
  name: 'Shree Balaji Textiles',
  industry: 'Textile & Apparel',
  currency: 'INR',
  size: '11-50',
  // §10 Q1 — the high-value threshold MPWA-06's undo-vs-confirm rule keys off.
  high_value_threshold: 50000,
  language: 'en',
  onboarded: true,
};

const USERS = [
  { id: 'u_owner', name: 'Rajesh Kumar', email: 'rajesh@balajitextiles.in', phone: '+919820011223', role: 'owner', language: 'en', department: 'Management', permissions: [] },
  { id: 'u_sales', name: 'Priya Sharma', email: 'priya@balajitextiles.in', phone: '+919820011224', role: 'sales', language: 'en', department: 'Sales', permissions: ['inbox', 'data_input', 'workflows', 'tasks', 'brain', 'ask', 'people'] },
  { id: 'u_prod', name: 'Suresh Patel', email: 'suresh@balajitextiles.in', phone: '+919820011225', role: 'production', language: 'hi', department: 'Production', permissions: ['inbox', 'data_input', 'workflows', 'tasks', 'brain', 'ask'] },
  { id: 'u_fin', name: 'Anita Desai', email: 'anita@balajitextiles.in', phone: '+919820011226', role: 'finance', language: 'en', department: 'Finance', permissions: ['inbox', 'data_input', 'workflows', 'tasks', 'brain', 'ask', 'finance', 'ledger'] },
  { id: 'u_store', name: 'Mohan Yadav', email: 'mohan@balajitextiles.in', phone: '+919820011227', role: 'production', language: 'hi', department: 'Stores', permissions: ['inbox', 'tasks', 'data_input'] },
];
const byId = (id) => USERS.find((u) => u.id === id) || {};

// ---------------------------------------------------------------------------
// Decisions — the Desk's "Needs Your Decision" chip (§8 MPWA-06)
// ---------------------------------------------------------------------------
const DECISIONS = [
  {
    id: 'd_1', title: 'Approve ₹4,80,000 yarn purchase from Surat Spinners',
    summary: 'Cotton yarn 40s count, 12 tonnes. Rate is 4% above last order but locks supply for the Diwali run.',
    rationale: 'Surat Spinners quoted ₹40/kg against Rajkot Fibres at ₹38.50/kg. The extra ₹18,000 buys a 3-week delivery guarantee — Rajkot has slipped twice this quarter and the Diwali order for Reliance Trends cannot slip.',
    unblocks: 'Diwali production run for Reliance Trends (₹22,00,000 order)',
    amount: 480000, status: 'pending', approver_id: 'u_owner', created_by: 'u_prod',
    created_at: daysAgo(6), due_date: dateAhead(1),
    proposed_tasks: [
      { title: 'Raise PO with Surat Spinners', assignee_id: 'u_prod' },
      { title: 'Block ₹4,80,000 against Diwali run', assignee_id: 'u_fin' },
      { title: 'Confirm dispatch slot with transporter', assignee_id: 'u_store' },
    ],
  },
  {
    id: 'd_2', title: 'Write off ₹1,15,000 from Krishna Garments',
    summary: 'Outstanding since 94 days. Buyer has stopped responding on two numbers.',
    rationale: 'Recovery agent estimates 20% at best after a 6-month legal route costing ₹35,000. Writing it off now frees the credit line for Reliance Trends.',
    unblocks: 'Credit line for the Reliance Trends order',
    amount: 115000, status: 'pending', approver_id: 'u_owner', created_by: 'u_fin',
    created_at: daysAgo(4), due_date: dateAhead(3),
    proposed_tasks: [{ title: 'Pass write-off entry in Tally', assignee_id: 'u_fin' }],
  },
  {
    id: 'd_3', title: 'Hire second cutting master on ₹32,000/month',
    summary: 'Cutting is the bottleneck — 3 of the last 5 delays traced here.',
    rationale: 'One master cannot cover two shifts. Cost is ₹3,84,000/year against ₹6,20,000 of delay penalties booked in the last 8 months.',
    unblocks: 'Second shift on the cutting floor',
    amount: 32000, status: 'pending', approver_id: 'u_owner', created_by: 'u_prod',
    created_at: daysAgo(3), due_date: dateAhead(6),
    proposed_tasks: [
      { title: 'Shortlist 3 candidates', assignee_id: 'u_prod' },
      { title: 'Confirm salary band with Finance', assignee_id: 'u_fin' },
    ],
  },
  {
    id: 'd_4', title: 'Give Reliance Trends 45-day credit instead of 30',
    summary: 'Buyer asked for 45 days on the ₹22,00,000 Diwali order.',
    rationale: 'Stretches working capital by roughly ₹7,30,000 for two weeks. They have never missed a payment in 3 years.',
    unblocks: 'Signed Diwali purchase order',
    amount: 2200000, status: 'pending', approver_id: 'u_owner', created_by: 'u_sales',
    created_at: daysAgo(2), due_date: dateAhead(1),
    proposed_tasks: [{ title: 'Reissue quotation with 45-day terms', assignee_id: 'u_sales' }],
  },
  {
    id: 'd_5', title: 'Replace the failing Jacquard loom motor — ₹78,000',
    summary: 'Motor on loom 4 has tripped 6 times this month.',
    rationale: 'Rewinding costs ₹22,000 and buys maybe 4 months. A new motor is ₹78,000 with a 2-year warranty. Loom 4 carries 30% of the Diwali run.',
    unblocks: 'Loom 4 uptime through the Diwali run',
    amount: 78000, status: 'pending', approver_id: 'u_owner', created_by: 'u_store',
    created_at: daysAgo(1), due_date: dateAhead(2),
    proposed_tasks: [{ title: 'Order motor from Coimbatore dealer', assignee_id: 'u_store' }],
  },
  {
    id: 'd_6', title: 'Discount ₹24,000 to close Anand Fabrics reorder',
    summary: 'Buyer wants 4% off on a ₹6,00,000 repeat order.',
    rationale: 'Margin on this line is 14%. A 4% discount leaves 10% — still above our 8% floor, and it is a repeat buyer.',
    unblocks: 'Anand Fabrics reorder',
    amount: 24000, status: 'pending', approver_id: 'u_owner', created_by: 'u_sales',
    created_at: daysAgo(1), due_date: dateAhead(4),
    proposed_tasks: [],
  },
];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
const mkTask = (o) => ({
  status: 'todo', priority: 'medium', source: 'manual', progress: 0,
  updates: [], attachments: [], created_by: 'u_owner', created_at: daysAgo(5),
  ...o,
  assignee_name: byId(o.assignee_id).name,
  assignee_role: byId(o.assignee_id).role,
});

const TASKS = [
  mkTask({ id: 't_1', title: 'Collect ₹4,00,000 outstanding from Krishna Garments — 31 days late', assignee_id: 'u_sales', due_date: dateAgo(31), priority: 'high', amount: 400000, status: 'in_progress', progress: 40, department: 'Sales' }),
  mkTask({ id: 't_2', title: 'Reconcile March GST input credit against purchase register', assignee_id: 'u_fin', due_date: dateAgo(9), priority: 'high', status: 'in_progress', progress: 60, department: 'Finance' }),
  mkTask({ id: 't_3', title: 'Fix loom 4 motor tripping — 6 stoppages this month', assignee_id: 'u_store', due_date: dateAgo(4), priority: 'high', source: 'escalation', department: 'Production',
    updates: [{ id: 'up_1', action: 'escalate', actor_id: 'u_prod', to_id: 'u_owner', note: 'Third stoppage this week. I cannot hold the Diwali schedule without a decision on the motor.', created_at: daysAgo(1) }] }),
  mkTask({ id: 't_4', title: 'Send dispatch plan for Reliance Trends Diwali order', assignee_id: 'u_prod', due_date: TODAY, priority: 'high', amount: 2200000, department: 'Production' }),
  mkTask({ id: 't_5', title: 'Chase Anand Fabrics for signed reorder confirmation', assignee_id: 'u_sales', due_date: TODAY, priority: 'medium', amount: 600000, department: 'Sales' }),
  mkTask({ id: 't_6', title: 'Pay Surat Spinners advance before dispatch slot closes', assignee_id: 'u_fin', due_date: TODAY, priority: 'high', amount: 144000, department: 'Finance' }),
  mkTask({ id: 't_7', title: 'Count finished-goods stock in godown 2 before audit', assignee_id: 'u_store', due_date: dateAgo(2), priority: 'medium', status: 'in_progress', progress: 25, department: 'Stores' }),
  mkTask({ id: 't_8', title: 'File TDS return for Q2', assignee_id: 'u_fin', due_date: dateAhead(4), priority: 'medium', department: 'Finance' }),
  mkTask({ id: 't_9', title: 'Renew fire safety certificate for the unit', assignee_id: 'u_store', due_date: dateAhead(12), priority: 'low', department: 'Stores' }),
  mkTask({ id: 't_10', title: 'Approve Priya leave request for Deepavali week', assignee_id: 'u_owner', due_date: dateAhead(2), priority: 'medium', department: 'Management' }),
  mkTask({ id: 't_11', title: 'Handover: Krishna Garments recovery file', assignee_id: 'u_fin', due_date: dateAhead(1), priority: 'high', amount: 115000, source: 'handoff', department: 'Finance',
    updates: [{ id: 'up_2', action: 'handoff', actor_id: 'u_sales', to_id: 'u_owner', note: 'Buyer is not picking up. Passing to you before we decide on write-off.', created_at: daysAgo(2) }] }),
  mkTask({ id: 't_12', title: 'Quality check on the 400-piece sample lot for Reliance', assignee_id: 'u_prod', due_date: dateAhead(3), priority: 'high', department: 'Production' }),
  mkTask({ id: 't_13', title: 'Update rate card for cotton blends', assignee_id: 'u_sales', due_date: dateAhead(8), priority: 'low', department: 'Sales' }),
  mkTask({ id: 't_14', title: 'Service the boiler before winter run', assignee_id: 'u_store', due_date: dateAhead(20), priority: 'low', department: 'Stores', status: 'done', progress: 100 }),
];

// ---------------------------------------------------------------------------
// Contacts / CRM
// ---------------------------------------------------------------------------
const CONTACTS = [
  { id: 'c_1', name: 'Krishna Garments', company: 'Krishna Garments Pvt Ltd', person: 'Vikram Shah', type: 'customer', status: 'active', lifecycle_stage: 'at_risk', phone: '+919820044556', email: 'vikram@krishnagarments.in', city: 'Ahmedabad', outstanding: 400000, total_business: 3800000, health_score: 31, last_activity_at: daysAgo(31), created_at: daysAgo(700) },
  { id: 'c_2', name: 'Reliance Trends', company: 'Reliance Retail Ltd', person: 'Meera Iyer', type: 'customer', status: 'active', lifecycle_stage: 'key_account', phone: '+919820044557', email: 'meera.iyer@ril.example', city: 'Mumbai', outstanding: 0, total_business: 18400000, health_score: 92, last_activity_at: daysAgo(1), created_at: daysAgo(1100) },
  { id: 'c_3', name: 'Anand Fabrics', company: 'Anand Fabrics & Co', person: 'Deepak Anand', type: 'customer', status: 'active', lifecycle_stage: 'growing', phone: '+919820044558', email: 'deepak@anandfabrics.in', city: 'Surat', outstanding: 185000, total_business: 4200000, health_score: 74, last_activity_at: daysAgo(3), created_at: daysAgo(520) },
  { id: 'c_4', name: 'Surat Spinners', company: 'Surat Spinners LLP', person: 'Jignesh Patel', type: 'vendor', status: 'active', lifecycle_stage: 'preferred', phone: '+919820044559', email: 'jignesh@suratspinners.in', city: 'Surat', outstanding: 336000, total_business: 9600000, health_score: 81, last_activity_at: daysAgo(2), created_at: daysAgo(900) },
  { id: 'c_5', name: 'Rajkot Fibres', company: 'Rajkot Fibres Pvt Ltd', person: 'Bhavesh Mehta', type: 'vendor', status: 'active', lifecycle_stage: 'watch', phone: '+919820044560', email: 'bhavesh@rajkotfibres.in', city: 'Rajkot', outstanding: 92000, total_business: 2700000, health_score: 48, last_activity_at: daysAgo(18), created_at: daysAgo(640) },
  { id: 'c_6', name: 'Coimbatore Loom Works', company: 'CLW Engineering', person: 'Senthil Kumar', type: 'vendor', status: 'active', lifecycle_stage: 'preferred', phone: '+919820044561', email: 'senthil@clw.example', city: 'Coimbatore', outstanding: 0, total_business: 780000, health_score: 88, last_activity_at: daysAgo(6), created_at: daysAgo(300) },
  { id: 'c_7', name: 'Bombay Dyeing House', company: 'Bombay Dyeing House', person: 'Farhan Qureshi', type: 'vendor', status: 'inactive', lifecycle_stage: 'dormant', phone: '+919820044562', email: 'farhan@bdh.example', city: 'Mumbai', outstanding: 0, total_business: 410000, health_score: 55, last_activity_at: daysAgo(140), created_at: daysAgo(800) },
  { id: 'c_8', name: 'Nashik Traders', company: 'Nashik Traders', person: 'Sunil Pawar', type: 'dealer', status: 'active', lifecycle_stage: 'growing', phone: '+919820044563', email: 'sunil@nashiktraders.in', city: 'Nashik', outstanding: 64000, total_business: 1350000, health_score: 69, last_activity_at: daysAgo(8), created_at: daysAgo(410) },
];

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
const EXPENSES = [
  { id: 'e_1', description: 'Cotton yarn 40s — 12 tonnes', category: 'Raw Material', vendor_name: 'Surat Spinners', amount: 480000, status: 'unpaid', date: dateAgo(3), created_at: daysAgo(3), currency: 'INR' },
  { id: 'e_2', description: 'Power bill — September', category: 'Utilities', vendor_name: 'MSEDCL', amount: 214000, status: 'paid', date: dateAgo(12), created_at: daysAgo(12), currency: 'INR' },
  { id: 'e_3', description: 'Wages — September', category: 'Salaries', vendor_name: 'Payroll', amount: 862000, status: 'paid', date: dateAgo(14), created_at: daysAgo(14), currency: 'INR' },
  { id: 'e_4', description: 'Dyeing job work — 2,400 m', category: 'Job Work', vendor_name: 'Bombay Dyeing House', amount: 96000, status: 'unpaid', date: dateAgo(8), created_at: daysAgo(8), currency: 'INR' },
  { id: 'e_5', description: 'Loom spares and belts', category: 'Maintenance', vendor_name: 'Coimbatore Loom Works', amount: 38500, status: 'paid', date: dateAgo(20), created_at: daysAgo(20), currency: 'INR' },
  { id: 'e_6', description: 'Freight to Mumbai — 3 trips', category: 'Logistics', vendor_name: 'Sai Transport', amount: 47000, status: 'unpaid', date: dateAgo(5), created_at: daysAgo(5), currency: 'INR' },
  { id: 'e_7', description: 'Polyester blend — 4 tonnes', category: 'Raw Material', vendor_name: 'Rajkot Fibres', amount: 152000, status: 'paid', date: dateAgo(28), created_at: daysAgo(28), currency: 'INR' },
  { id: 'e_8', description: 'GST consultant retainer', category: 'Professional Fees', vendor_name: 'Shah & Associates', amount: 25000, status: 'paid', date: dateAgo(30), created_at: daysAgo(30), currency: 'INR' },
];

const INVOICES = [
  { id: 'i_1', type: 'sales_invoice', number: 'SBT/25-26/0412', contact_id: 'c_1', contact_name: 'Krishna Garments', amount: 400000, paid_amount: 0, status: 'overdue', date: dateAgo(61), due_date: dateAgo(31), currency: 'INR' },
  { id: 'i_2', type: 'sales_invoice', number: 'SBT/25-26/0431', contact_id: 'c_3', contact_name: 'Anand Fabrics', amount: 285000, paid_amount: 100000, status: 'partial', date: dateAgo(24), due_date: dateAgo(9), currency: 'INR' },
  { id: 'i_3', type: 'sales_invoice', number: 'SBT/25-26/0447', contact_id: 'c_2', contact_name: 'Reliance Trends', amount: 1840000, paid_amount: 1840000, status: 'paid', date: dateAgo(18), due_date: dateAgo(3), currency: 'INR' },
  { id: 'i_4', type: 'sales_invoice', number: 'SBT/25-26/0452', contact_id: 'c_8', contact_name: 'Nashik Traders', amount: 64000, paid_amount: 0, status: 'sent', date: dateAgo(6), due_date: dateAhead(9), currency: 'INR' },
  { id: 'i_5', type: 'purchase_invoice', number: 'SS/9921', contact_id: 'c_4', contact_name: 'Surat Spinners', amount: 336000, paid_amount: 0, status: 'due', date: dateAgo(10), due_date: dateAhead(4), currency: 'INR' },
  { id: 'i_6', type: 'purchase_invoice', number: 'RF/2210', contact_id: 'c_5', contact_name: 'Rajkot Fibres', amount: 92000, paid_amount: 0, status: 'overdue', date: dateAgo(40), due_date: dateAgo(10), currency: 'INR' },
];

const PAYMENTS = [
  { id: 'p_1', direction: 'in', contact_id: 'c_2', contact_name: 'Reliance Trends', amount: 1840000, date: dateAgo(3), mode: 'NEFT', reference: 'NEFT8837221', matched: true, invoice_id: 'i_3', currency: 'INR' },
  { id: 'p_2', direction: 'in', contact_id: 'c_3', contact_name: 'Anand Fabrics', amount: 100000, date: dateAgo(9), mode: 'UPI', reference: 'UPI772110', matched: true, invoice_id: 'i_2', currency: 'INR' },
  { id: 'p_3', direction: 'in', contact_id: null, contact_name: null, amount: 75000, date: dateAgo(2), mode: 'NEFT', reference: 'NEFT9910233', matched: false, invoice_id: null, currency: 'INR' },
  { id: 'p_4', direction: 'out', contact_id: 'c_4', contact_name: 'Surat Spinners', amount: 144000, date: dateAgo(11), mode: 'RTGS', reference: 'RTGS4410', matched: true, invoice_id: 'i_5', currency: 'INR' },
];

const ASSETS = [
  { id: 'a_1', name: 'Jacquard loom #4', category: 'Machinery', purchase_amount: 1250000, purchase_date: dateAgo(1400), status: 'maintenance', location: 'Shed A', currency: 'INR' },
  { id: 'a_2', name: 'Jacquard loom #5', category: 'Machinery', purchase_amount: 1250000, purchase_date: dateAgo(1400), status: 'active', location: 'Shed A', currency: 'INR' },
  { id: 'a_3', name: 'Cutting table (industrial)', category: 'Machinery', purchase_amount: 185000, purchase_date: dateAgo(900), status: 'active', location: 'Shed B', currency: 'INR' },
  { id: 'a_4', name: 'Tata Ace delivery van', category: 'Vehicle', purchase_amount: 620000, purchase_date: dateAgo(1100), status: 'active', location: 'Yard', currency: 'INR' },
  { id: 'a_5', name: 'Diesel generator 62.5 kVA', category: 'Utility', purchase_amount: 480000, purchase_date: dateAgo(700), status: 'active', location: 'Yard', currency: 'INR' },
];

const INVENTORY = [
  { id: 'inv_1', item: 'Cotton yarn 40s', category: 'Raw Material', quantity: 8400, unit: 'kg', value: 336000, vendor_name: 'Surat Spinners', currency: 'INR' },
  { id: 'inv_2', item: 'Polyester blend', category: 'Raw Material', quantity: 2100, unit: 'kg', value: 79800, vendor_name: 'Rajkot Fibres', currency: 'INR' },
  { id: 'inv_3', item: 'Finished shirting — grey', category: 'Finished Goods', quantity: 4200, unit: 'm', value: 588000, vendor_name: null, currency: 'INR' },
  { id: 'inv_4', item: 'Finished shirting — indigo', category: 'Finished Goods', quantity: 1800, unit: 'm', value: 288000, vendor_name: null, currency: 'INR' },
  { id: 'inv_5', item: 'Packing cartons', category: 'Consumable', quantity: 900, unit: 'pcs', value: 27000, vendor_name: 'Nashik Traders', currency: 'INR' },
];

const REVENUE = INVOICES.filter((i) => i.type === 'sales_invoice').map((i) => ({
  id: `r_${i.id}`, invoice_id: i.id, contact_id: i.contact_id, contact_name: i.contact_name,
  description: `Invoice ${i.number}`, amount: i.amount, received: i.paid_amount,
  outstanding: i.amount - i.paid_amount, status: i.status, date: i.date, due_date: i.due_date,
  category: 'Sales', currency: 'INR',
}));

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const remaining = (r) => Math.max(0, num(r.amount) - num(r.paid_amount));

function ledgerSummary() {
  const sales = INVOICES.filter((i) => i.type === 'sales_invoice');
  const paysIn = PAYMENTS.filter((p) => p.direction === 'in');
  const total = EXPENSES.reduce((s, e) => s + num(e.amount), 0);
  const paid = EXPENSES.filter((e) => e.status === 'paid').reduce((s, e) => s + num(e.amount), 0);
  const revenueBilled = sales.reduce((s, r) => s + num(r.amount), 0);
  const revenueReceived = paysIn.reduce((s, p) => s + num(p.amount), 0);
  const revenueOutstanding = sales.filter((s) => s.status !== 'paid').reduce((s, r) => s + remaining(r), 0);

  const byCat = {}, byVendor = {}, byMonth = {};
  for (const e of EXPENSES) {
    const amt = num(e.amount);
    byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + amt;
    const v = e.vendor_name || 'Unspecified';
    byVendor[v] = (byVendor[v] || 0) + amt;
    const m = (e.date || e.created_at || '').slice(0, 7);
    if (m) byMonth[m] = (byMonth[m] || 0) + amt;
  }
  return {
    currency: 'INR',
    totals: {
      total_spend: total, paid, outstanding: total - paid, expense_count: EXPENSES.length,
      asset_count: ASSETS.length, asset_value: ASSETS.reduce((s, a) => s + num(a.purchase_amount), 0),
      inventory_count: INVENTORY.length, inventory_value: INVENTORY.reduce((s, i) => s + num(i.value), 0),
      revenue_billed: revenueBilled, revenue_received: revenueReceived,
      revenue_outstanding: revenueOutstanding, sales_count: sales.length,
      net_profit: revenueBilled - total,
    },
    by_category: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount })),
    by_vendor: Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([vendor, amount]) => ({ vendor, amount })),
    by_month: Object.keys(byMonth).sort().slice(-6).map((month) => ({ month, amount: byMonth[month] })),
    categories: ['Raw Material', 'Salaries', 'Utilities', 'Job Work', 'Logistics', 'Maintenance', 'Professional Fees', 'Other'],
    asset_categories: ['Machinery', 'Vehicle', 'Utility', 'Building', 'IT'],
  };
}

// ---------------------------------------------------------------------------
// Desk chip builders — mirrors backend/routers/desk.py
// ---------------------------------------------------------------------------
const dayDiff = (a, b = TODAY) =>
  Math.max(0, Math.round((new Date(b) - new Date(String(a).slice(0, 10))) / 86400000));

// NOTE: backend `_format_amount` emits en-US grouping (₹480,000) — its
// Indian-grouping branch is dead code. The fixture reproduces that bug on
// purpose so the audit's "non-Indian INR grouping" rule has something to
// catch, and so MPWA-06 is forced to render via inr() instead of this field.
const fmtAmountLikeBackend = (n) =>
  n == null || Number(n) === 0 ? null : `₹${Number(n).toLocaleString('en-US')}`;

function cardsNeedsDecision() {
  return DECISIONS.filter((d) => d.status === 'pending').map((d) => {
    const waiting = dayDiff(d.created_at);
    const proposed = (d.proposed_tasks || []).length;
    const parts = [`Waiting ${waiting} day${waiting !== 1 ? 's' : ''}`, `From ${byId(d.created_by).name || 'Unknown'}`];
    if (proposed) parts.push(`Unblocks ${proposed} task${proposed !== 1 ? 's' : ''}`);
    return {
      id: d.id, kind: 'decision', title: d.title, context_line: parts.join(' · '),
      amount: d.amount, amount_formatted: fmtAmountLikeBackend(d.amount),
      cta: 'review', target_id: d.id, target_kind: 'decision',
      waiting_days: waiting, from_name: byId(d.created_by).name,
      unblocks: d.unblocks, due_date: d.due_date,
    };
  });
}

function cardsOnFire() {
  const out = [];
  for (const t of TASKS) {
    if (['done', 'cancelled'].includes(t.status)) continue;
    const latest = (t.updates || []).slice(-1)[0];
    if (latest && ['escalate', 'handoff'].includes(latest.action) && latest.to_id === 'u_owner') {
      const actor = byId(latest.actor_id).name || 'someone';
      const parts = [latest.action === 'escalate' ? `Escalated by ${actor}` : `Handed to you by ${actor}`];
      if (t.assignee_name && t.assignee_name !== actor) parts.push(`With ${t.assignee_name}`);
      out.push({
        id: t.id, kind: latest.action === 'escalate' ? 'task_escalation' : 'task_handoff',
        title: t.title, context_line: parts.join(' · '), amount: t.amount ?? null,
        amount_formatted: fmtAmountLikeBackend(t.amount), cta: 'respond',
        target_id: t.id, target_kind: 'task', target_owner_id: t.assignee_id,
        from_name: actor, note: latest.note, due_date: t.due_date,
      });
    }
  }
  for (const t of TASKS) {
    if (['done', 'cancelled'].includes(t.status)) continue;
    if (out.some((c) => c.id === t.id)) continue;
    if (!t.due_date || t.due_date >= TODAY) continue;
    if (t.assignee_id === 'u_owner') continue;
    const late = dayDiff(t.due_date);
    const parts = [`${late} day${late !== 1 ? 's' : ''} overdue`];
    if (t.assignee_name) parts.push(`With ${t.assignee_name}`);
    out.push({
      id: t.id, kind: 'task_overdue', title: t.title, context_line: parts.join(' · '),
      amount: t.amount ?? null, amount_formatted: fmtAmountLikeBackend(t.amount),
      cta: 'chase', target_id: t.id, target_kind: 'task', target_owner_id: t.assignee_id,
      overdue_days: late, due_date: t.due_date,
    });
  }
  return out;
}

function cardsDueToday() {
  return TASKS.filter((t) => t.due_date === TODAY && !['done', 'cancelled'].includes(t.status) && t.assignee_id !== 'u_owner')
    .map((t) => ({
      id: t.id, kind: 'task_due_today', title: t.title,
      context_line: t.assignee_name ? `With ${t.assignee_name}` : 'Due today',
      amount: t.amount ?? null, amount_formatted: fmtAmountLikeBackend(t.amount),
      cta: 'nudge', target_id: t.id, target_kind: 'task', target_owner_id: t.assignee_id,
      due_date: t.due_date,
    }))
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));
}

// 'important' is intentionally empty — backend returns [] at this commit
// (E2-21 not wired). Keeps the "hide zero-count chips" rule exercised.
const cardsImportant = () => [];

const DESK_BUILDERS = {
  needs_decision: cardsNeedsDecision, on_fire: cardsOnFire,
  due_today: cardsDueToday, important: cardsImportant,
};

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------
function brief(period = 'morning') {
  const sales = INVOICES.filter((i) => i.type === 'sales_invoice');
  const overdueRecv = sales.filter((i) => i.due_date < TODAY && i.status !== 'paid');
  const billsDue = INVOICES.filter((i) => i.type === 'purchase_invoice' && i.status !== 'paid');
  const unmatched = PAYMENTS.filter((p) => !p.matched);
  const greet = period === 'evening' ? 'Good evening' : 'Good morning';
  return {
    period, role: 'owner', greeting: `${greet}, Rajesh`,
    completed_label: period === 'morning' ? 'completed yesterday' : `completed (${period})`,
    counters: {
      delayed: TASKS.filter((t) => t.due_date && t.due_date < TODAY && ['todo', 'in_progress'].includes(t.status)).length,
      completed: 4,
      awaiting_approval: DECISIONS.filter((d) => d.status === 'pending').length,
      absent: 2, complaints: 1,
      payment_overdue: overdueRecv.length,
      fires: TASKS.filter((t) => t.source === 'escalation' && t.status !== 'done').length,
      on_leave: 1,
      receivables_overdue: overdueRecv.length,
      bills_due: billsDue.length,
      unmatched_payments: unmatched.length,
      // deliberate zeros — §8 MPWA-07 requires these tiles not to render
      absconding: 0, rejected: 0, stalled_workflows: 0,
    },
    finance_amounts: {
      receivables_overdue: overdueRecv.reduce((s, r) => s + remaining(r), 0),
      bills_due: billsDue.reduce((s, r) => s + remaining(r), 0),
      unmatched_payments: unmatched.reduce((s, p) => s + num(p.amount), 0),
      // MPWA-07's money line is "received vs outstanding" in one line, so the
      // brief needs the received side too.
      received: PAYMENTS.filter((p) => p.direction === 'in').reduce((s, p) => s + num(p.amount), 0),
    },
    // The written verdict MPWA-07 hoists into the hero.
    verdict: '₹4,00,000 is stuck past 30 days with one retailer.',
    verdict_action: { label: 'Chase Krishna Garments', link: '/contacts/c_1' },
    fires_detail: [
      { id: 'f_1', title: 'Krishna Garments has not paid ₹4,00,000', amount: 400000, days_late: 31, person: 'Priya Sharma', person_id: 'u_sales', action: 'Chase payment', link: '/contacts/c_1' },
      { id: 'f_2', title: 'Loom 4 motor tripping — Diwali run at risk', amount: 78000, days_late: 4, person: 'Mohan Yadav', person_id: 'u_store', action: 'Decide on replacement', link: '/inbox?decision=d_5' },
      { id: 'f_3', title: 'GST input credit unreconciled for March', amount: 0, days_late: 9, person: 'Anita Desai', person_id: 'u_fin', action: 'Ask for status', link: '/my-work?task=t_2' },
    ],
  };
}

function briefDetails(key) {
  const item = (id, title, subtitle, meta, kind, extra = {}) => ({ id, title, subtitle, meta, kind, ...extra });
  switch (key) {
    case 'delayed':
      return TASKS.filter((t) => t.due_date && t.due_date < TODAY && ['todo', 'in_progress'].includes(t.status))
        .map((t) => item(t.id, t.title, t.assignee_name || 'unassigned', t.priority, 'task', { due_date: t.due_date }));
    case 'awaiting_approval':
      return DECISIONS.filter((d) => d.status === 'pending')
        .map((d) => item(d.id, d.title, `From ${byId(d.created_by).name}`, d.amount, 'decision', { amount: d.amount }));
    case 'receivables_overdue':
      return INVOICES.filter((i) => i.type === 'sales_invoice' && i.due_date < TODAY && i.status !== 'paid')
        .map((i) => item(i.id, i.contact_name, `${i.number} · ${dayDiff(i.due_date)} days late`, remaining(i), 'invoice', { amount: remaining(i) }));
    case 'bills_due':
      return INVOICES.filter((i) => i.type === 'purchase_invoice' && i.status !== 'paid')
        .map((i) => item(i.id, i.contact_name, `${i.number} · due ${i.due_date}`, remaining(i), 'invoice', { amount: remaining(i) }));
    case 'unmatched_payments':
      return PAYMENTS.filter((p) => !p.matched)
        .map((p) => item(p.id, `${p.mode} ${p.reference}`, 'No invoice matched yet', num(p.amount), 'payment', { amount: num(p.amount) }));
    case 'absent':
      return [item('at_1', 'Mohan Yadav', 'Absent today', 'Stores', 'attendance'),
              item('at_2', 'Kamal Singh', 'Absent today', 'Production', 'attendance')];
    case 'complaints':
      return [item('cp_1', 'Shade mismatch on indigo lot', 'Anand Fabrics · open 3 days', 'quality', 'complaint')];
    case 'on_leave':
      return [item('lv_1', 'Priya Sharma', `Casual leave until ${dateAhead(2)}`, 'sales', 'leave')];
    case 'fires':
      return TASKS.filter((t) => t.source === 'escalation' && t.status !== 'done')
        .map((t) => item(t.id, t.title, t.assignee_name || 'unassigned', t.priority, 'task'));
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Misc collections
// ---------------------------------------------------------------------------
const NOTIFICATIONS = [
  { id: 'n_1', kind: 'decision_pending', title: 'Decision waiting on you', body: 'Approve ₹4,80,000 yarn purchase from Surat Spinners', work_title: 'Approve ₹4,80,000 yarn purchase', message: 'Decision waiting', link: '/inbox?decision=d_1', sender_name: 'Suresh Patel', read: false, created_at: daysAgo(0.2) },
  { id: 'n_2', kind: 'escalation', title: 'Escalated to you', body: 'Loom 4 motor tripping — third stoppage this week', work_title: 'Loom 4 motor tripping', message: 'Escalation', link: '/my-work?task=t_3', sender_name: 'Suresh Patel', read: false, created_at: daysAgo(1) },
  { id: 'n_3', kind: 'mention', title: 'Priya mentioned you', body: 'Krishna Garments recovery file handed over', work_title: 'Krishna Garments recovery', message: 'Mention', link: '/my-work?task=t_11', sender_name: 'Priya Sharma', read: false, created_at: daysAgo(2) },
  { id: 'n_4', kind: 'payment_received', title: 'Payment received', body: '₹18,40,000 from Reliance Trends', work_title: 'Payment ₹18,40,000 received', message: 'Payment', link: '/finance?tab=revenue', sender_name: null, read: true, created_at: daysAgo(3) },
  { id: 'n_5', kind: 'task_done', title: 'Task completed', body: 'Boiler serviced before winter run', work_title: 'Boiler serviced', message: 'Completed', link: '/my-work?task=t_14', sender_name: 'Mohan Yadav', read: true, created_at: daysAgo(4) },
];

const LEAVES = [
  { id: 'lv_1', user_id: 'u_sales', user_name: 'Priya Sharma', user_role: 'sales', leave_type: 'casual', from_date: dateAhead(5), to_date: dateAhead(7), days: 3, day_portion: 'full', reason: 'Deepavali with family', status: 'pending', created_at: daysAgo(2) },
  { id: 'lv_2', user_id: 'u_store', user_name: 'Mohan Yadav', user_role: 'production', leave_type: 'sick', from_date: dateAgo(1), to_date: TODAY, days: 2, day_portion: 'full', reason: 'Fever', status: 'approved', created_at: daysAgo(2) },
  { id: 'lv_3', user_id: 'u_prod', user_name: 'Suresh Patel', user_role: 'production', leave_type: 'casual', from_date: dateAhead(12), to_date: dateAhead(12), days: 1, day_portion: 'half', reason: 'Bank work', status: 'pending', created_at: daysAgo(1) },
];

const WORKFLOWS = [
  { id: 'w_1', type: 'purchase_payment', title: 'Surat Spinners — yarn PO', stage: 'quote_received', stages: ['quote_received', 'po_raised', 'goods_received', 'payment_due', 'paid'], amount: 480000, contact_name: 'Surat Spinners', owner_id: 'u_prod', owner_name: 'Suresh Patel', created_at: daysAgo(3), updated_at: daysAgo(1) },
  { id: 'w_2', type: 'purchase_payment', title: 'Rajkot Fibres — blend PO', stage: 'payment_due', stages: ['quote_received', 'po_raised', 'goods_received', 'payment_due', 'paid'], amount: 92000, contact_name: 'Rajkot Fibres', owner_id: 'u_fin', owner_name: 'Anita Desai', created_at: daysAgo(40), updated_at: daysAgo(10) },
  { id: 'w_3', type: 'order_to_cash', title: 'Reliance Trends — Diwali order', stage: 'quotation_sent', stages: ['enquiry', 'quotation_sent', 'order_confirmed', 'dispatched', 'payment_received'], amount: 2200000, contact_name: 'Reliance Trends', owner_id: 'u_sales', owner_name: 'Priya Sharma', created_at: daysAgo(5), updated_at: daysAgo(1) },
];

const CAPTURES = [
  { id: 'cap_1', kind: 'voice', status: 'pending', transcript: 'Tell Suresh the indigo lot has to ship before Friday otherwise Reliance will cancel', duration_sec: 9, confidence: 0.91, created_at: daysAgo(0.1), created_by: 'u_owner' },
  { id: 'cap_2', kind: 'voice', status: 'needs_clarification', transcript: '…', duration_sec: 12, confidence: 0.24, created_at: daysAgo(0.3), created_by: 'u_owner' },
  { id: 'cap_3', kind: 'photo', status: 'pending', filename: 'yarn-bill-surat.jpg', confidence: 0.86, created_at: daysAgo(1), created_by: 'u_store' },
];

const BRAIN_DOCS = [
  { id: 'bd_1', title: 'Reliance Trends master agreement 2025', filename: 'reliance-msa-2025.pdf', kind: 'contract', size: 482113, pages: 14, created_at: daysAgo(120), uploaded_by: 'u_owner' },
  { id: 'bd_2', title: 'GST filing checklist', filename: 'gst-checklist.pdf', kind: 'process', size: 91223, pages: 3, created_at: daysAgo(60), uploaded_by: 'u_fin' },
  { id: 'bd_3', title: 'Surat Spinners rate card Sep', filename: 'ss-rates-sep.pdf', kind: 'pricing', size: 55120, pages: 2, created_at: daysAgo(20), uploaded_by: 'u_prod' },
];

const CALENDAR = [
  { id: 'cal_1', title: 'Reliance Trends dispatch deadline', date: dateAhead(2), kind: 'deadline', amount: 2200000, link: '/my-work?task=t_4' },
  { id: 'cal_2', title: 'Surat Spinners payment due', date: dateAhead(4), kind: 'payment', amount: 336000, link: '/finance?tab=expenses' },
  { id: 'cal_3', title: 'TDS return Q2', date: dateAhead(4), kind: 'compliance', amount: 0, link: '/my-work?task=t_8' },
  { id: 'cal_4', title: 'Priya on leave', date: dateAhead(5), kind: 'leave', amount: 0, link: '/my-work?view=leave' },
  { id: 'cal_5', title: 'Fire safety certificate expiry', date: dateAhead(12), kind: 'compliance', amount: 0, link: '/my-work?task=t_9' },
];

// Shape per OperatingScore.js: { company: {overall, enough_data, categories},
// stats, employees[] }. CATS keys are execution/finance/sales/responsiveness.
const OPERATING_SCORE = {
  company: {
    overall: 68,
    enough_data: true,
    categories: { execution: 74, finance: 52, sales: 71, responsiveness: 80 },
  },
  stats: {
    open: 9, done: 4, overdue: 4, total_decisions: 6, open_complaints: 1,
  },
  employees: [
    { id: 'u_sales', name: 'Priya Sharma', role: 'sales', score: 66, open: 3, done: 1, overdue: 1 },
    { id: 'u_prod', name: 'Suresh Patel', role: 'production', score: 72, open: 2, done: 2, overdue: 0 },
    { id: 'u_fin', name: 'Anita Desai', role: 'finance', score: 58, open: 3, done: 1, overdue: 1 },
    { id: 'u_store', name: 'Mohan Yadav', role: 'production', score: 49, open: 3, done: 0, overdue: 2 },
  ],
};

// Shape per WorkCoach.js: { target: {name, role}, stats, summary: {...} }.
const WORK_COACH = {
  target: { id: 'u_owner', name: 'Rajesh Kumar', role: 'owner' },
  stats: { open: 9, done: 4, overdue: 4 },
  summary: {
    generated_at: daysAgo(0.4),
    headline: 'You are the bottleneck on 6 decisions. Four are under ₹80,000.',
    completed: 4, open: 9, overdue: 4,
    completion_rate: 0.31, proof_upload_rate: 0.42,
    plans_used: 2, photos_uploaded: 5, voice_updates: 7,
    strengths: [
      'You answer escalations the same day — Suresh got a reply within 4 hours.',
      'Cash decisions above ₹5,00,000 always get written rationale.',
    ],
    improvements: [
      'Six decisions have been waiting an average of 3 days. Two are worth under ₹30,000 — those could sit with Suresh.',
      'You reopened the Krishna Garments file 4 times in 9 days without deciding either way.',
      'Cutting is behind 3 of the last 5 delays; the second master role you approved in July is still unfilled.',
    ],
    recommendation: 'Delegate approvals under ₹30,000 to Suresh and close the Krishna Garments file this week — either write it off or start recovery.',
  },
};

const JOURNAL = [
  { id: 'j_1', date: dateAgo(0), entry: 'Held the Surat Spinners decision another day. Need to stop doing this.', mood: 'unsettled', tags: ['decisions'], created_at: daysAgo(0.3) },
  { id: 'j_2', date: dateAgo(2), entry: 'Reliance paid the full ₹18,40,000 without a reminder. Meera is straight.', mood: 'good', tags: ['cash', 'customers'], created_at: daysAgo(2) },
  { id: 'j_3', date: dateAgo(5), entry: 'Loom 4 stopped twice. Mohan is patching it. This will bite during Diwali.', mood: 'worried', tags: ['production'], created_at: daysAgo(5) },
];

const COMPLAINTS = [
  { id: 'cp_1', title: 'Shade mismatch on indigo lot', contact_id: 'c_3', contact_name: 'Anand Fabrics', status: 'open', severity: 'high', created_at: daysAgo(3), assignee_id: 'u_prod', assignee_name: 'Suresh Patel' },
  { id: 'cp_2', title: 'Short packing — 12 pieces', contact_id: 'c_8', contact_name: 'Nashik Traders', status: 'resolved', severity: 'low', created_at: daysAgo(25), assignee_id: 'u_store', assignee_name: 'Mohan Yadav' },
];

const ATTENDANCE = [
  { id: 'att_1', user_id: 'u_store', user_name: 'Mohan Yadav', date: TODAY, status: 'absent', reason: 'Sick leave' },
  { id: 'att_2', user_id: 'u_prod', user_name: 'Suresh Patel', date: TODAY, status: 'present' },
  { id: 'att_3', user_id: 'u_sales', user_name: 'Priya Sharma', date: TODAY, status: 'present' },
  { id: 'att_4', user_id: 'u_fin', user_name: 'Anita Desai', date: TODAY, status: 'present' },
];

const financeAi = (scope) => ({
  scope, generated_at: daysAgo(0.2), cached: true,
  verdict: {
    brief: 'You earned ₹25,89,000 and spent ₹19,14,500 this period. ₹6,49,000 is still to come in, and ₹4,00,000 of that is 31 days late with one retailer.',
    overview: 'Raw material is 33% of spend and one supplier carries most of it. Power is up 12% month on month.',
    expenses: '₹6,23,000 of bills are unpaid. Surat Spinners alone is ₹3,36,000 of that, due in 4 days.',
    assets: 'Loom 4 is in maintenance and carries 30% of the Diwali run. It is 4 years old with no replacement plan.',
    inventory: '₹8,76,000 of finished goods is sitting in the godown — grey shirting is over half of it.',
    revenue: '₹25,89,000 billed, ₹19,40,000 received. Krishna Garments is the whole problem at ₹4,00,000 past 31 days.',
  }[scope] || 'Nothing notable in this period.',
  points: [
    'Krishna Garments — ₹4,00,000 outstanding 31 days',
    'Surat Spinners — ₹3,36,000 due in 4 days',
    '₹75,000 received on NEFT9910233 is not matched to any invoice',
  ],
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
const OK = { ok: true };

function resolve(method, path, q) {
  const seg = path.split('/').filter(Boolean); // ['api', ...]
  const p = '/' + seg.slice(1).join('/');
  const role = q.get('_role') || 'owner';
  const me = USERS.find((u) => u.role === role) || USERS[0];

  // --- auth ---
  if (p === '/auth/me' || p === '/auth/login' || p === '/auth/register' || p === '/auth/otp/verify') {
    return { user: me, tenant: TENANT };
  }
  if (p === '/auth/logout') return OK;
  if (p === '/auth/otp/request') return { sent: true, dev_code: '123456' };
  if (p === '/auth/profile' || p === '/auth/change-password') return { ...OK, user: me };

  // --- desk ---
  if (p === '/desk') {
    const chip = q.get('chip') || 'needs_decision';
    const counters = Object.fromEntries(Object.entries(DESK_BUILDERS).map(([k, f]) => [k, f().length]));
    return { chip, counters, cards: (DESK_BUILDERS[chip] || cardsImportant)() };
  }
  if (p.startsWith('/desk/nudge/')) return { sent: true, channel: 'notification', target_id: 'u_sales', target_name: 'Priya Sharma' };

  // --- brief / notifications ---
  if (p === '/brief') return brief(q.get('period') || 'morning');
  if (p === '/brief/details') return { key: q.get('key'), actionable: true, items: briefDetails(q.get('key')) };
  if (p === '/brief/send-digest') return { sent: true, to: me.email };
  if (p === '/notifications') return { notifications: NOTIFICATIONS, unread: NOTIFICATIONS.filter((n) => !n.read).length };
  if (p.startsWith('/notifications/')) return OK;

  // --- decisions ---
  if (p === '/decisions') return DECISIONS;
  if (seg[1] === 'decisions' && seg[2]) {
    const d = DECISIONS.find((x) => x.id === seg[2]);
    if (seg[3] === 'timeline') return [
      { id: 'tl_1', kind: 'created', actor_name: byId(d?.created_by).name, note: 'Raised for your approval', created_at: d?.created_at },
      { id: 'tl_2', kind: 'comment', actor_name: 'Anita Desai', note: 'Cash position supports this if we stagger the Rajkot payment.', created_at: daysAgo(1) },
    ];
    if (seg[3] === 'tasks') return d?.proposed_tasks || [];
    if (method !== 'GET') return { ...OK, decision: { ...d, status: seg[3] === 'reject' ? 'rejected' : 'approved' } };
    return d || {};
  }

  // --- tasks ---
  if (p === '/tasks') {
    if (method !== 'GET') return { ...OK, task: TASKS[0] };
    return q.get('mine') === 'true' ? TASKS.filter((t) => t.assignee_id === me.id || t.created_by === me.id) : TASKS;
  }
  if (p === '/tasks/prioritize') return { ranked: TASKS.slice(0, 5).map((t) => t.id) };
  if (seg[1] === 'tasks' && seg[2]) {
    const t = TASKS.find((x) => x.id === seg[2]) || TASKS[0];
    if (seg[3] === 'execution-plan') return { steps: [
      { id: 's_1', title: 'Confirm the motor model with Coimbatore Loom Works', done: false },
      { id: 's_2', title: 'Get a written 2-year warranty', done: false },
      { id: 's_3', title: 'Schedule the swap for Sunday shutdown', done: false },
    ] };
    if (seg[3] === 'updates') return t.updates || [];
    if (method !== 'GET') return { ...OK, task: t };
    return t;
  }

  // --- people / crm / team ---
  if (p === '/contacts') {
    if (method !== 'GET') return { ...OK, contact: CONTACTS[0] };
    const type = q.get('type');
    return type ? CONTACTS.filter((c) => c.type === type) : CONTACTS;
  }
  if (seg[1] === 'contacts' && seg[2]) {
    const c = CONTACTS.find((x) => x.id === seg[2]) || CONTACTS[0];
    if (seg[3] === 'profile') {
      // Shape per ContactProfile.js's destructure: contact, summary, invoices,
      // payments, complaints, pending_deliveries, follow_ups, decisions,
      // price_history, ai_relationship.
      const inv = INVOICES.filter((i) => i.contact_id === c.id);
      const atRisk = c.id === 'c_1';
      return {
        contact: {
          ...c,
          address: `${c.city}, India`,
          tax_id: '24AABCS1429B1ZX',
        },
        summary: {
          outstanding: c.outstanding,
          total_billed: c.total_business,
          total_paid: Math.max(0, c.total_business - c.outstanding),
          open_complaints: COMPLAINTS.filter((x) => x.contact_id === c.id && x.status === 'open').length,
        },
        invoices: inv,
        payments: PAYMENTS.filter((x) => x.contact_id === c.id),
        complaints: COMPLAINTS.filter((x) => x.contact_id === c.id),
        pending_deliveries: atRisk ? [] : [
          { id: 'pd_1', title: '2,400 m indigo shirting', due_date: dateAhead(2), amount: 384000 },
        ],
        follow_ups: [
          { id: 'fu_1', title: 'Call about the overdue invoice', due_date: dateAhead(1), owner_name: 'Priya Sharma' },
        ],
        decisions: DECISIONS.filter((d) => d.title.includes(c.name.split(' ')[0])),
        price_history: [
          { id: 'ph_1', item: 'Cotton shirting 40s', rate: 158, date: dateAgo(120), unit: 'm' },
          { id: 'ph_2', item: 'Cotton shirting 40s', rate: 162, date: dateAgo(40), unit: 'm' },
        ],
        ai_relationship: {
          relationship_score: c.health_score,
          risk_score: 100 - c.health_score,
          reason: atRisk
            ? 'Payment behaviour has deteriorated for three months running and two numbers are unreachable. Treat further supply as cash-only.'
            : 'Steady buyer, pays inside terms, no complaints on the last six lots.',
          signals: atRisk
            ? ['31 days overdue on ₹4,00,000', 'Unreachable on two numbers', 'Stopped replying on WhatsApp']
            : ['Pays inside terms', 'No quality complaints', 'Reorders every quarter'],
        },
      };
    }
    if (method !== 'GET') return { ...OK, contact: c };
    return c;
  }
  if (p === '/users') {
    if (method !== 'GET') return { ...OK, user: USERS[1] };
    return USERS;
  }
  if (seg[1] === 'users' && seg[2]) return { ...OK, user: byId(seg[2]) };
  if (p === '/attendance') return ATTENDANCE;
  if (p === '/complaints' || p.startsWith('/complaints/')) return method === 'GET' ? COMPLAINTS : OK;

  // --- leaves / workflows ---
  if (p === '/leaves') {
    if (method !== 'GET') return { ...OK, leave: LEAVES[0] };
    return q.get('scope') === 'approvals' ? LEAVES.filter((l) => l.status === 'pending') : LEAVES;
  }
  if (p === '/leaves/absence') return ATTENDANCE.filter((a) => a.status === 'absent');
  if (seg[1] === 'leaves' && seg[2]) {
    if (seg[3] === 'impact') return { affected_tasks: 2, affected_workflows: 1, note: 'Two Diwali-run tasks fall in this window.' };
    return { ...OK, leave: LEAVES[0] };
  }
  if (p === '/workflows') {
    if (method !== 'GET') return { ...OK, workflow: WORKFLOWS[0] };
    const type = q.get('type');
    return type ? WORKFLOWS.filter((w) => w.type === type) : WORKFLOWS;
  }
  if (seg[1] === 'workflows' && seg[2]) return method === 'GET' ? (WORKFLOWS.find((w) => w.id === seg[2]) || {}) : { ...OK, workflow: WORKFLOWS[0] };

  // --- finance ---
  if (p === '/ledger/summary') return ledgerSummary();
  if (p.startsWith('/ledger/ai/')) return financeAi(seg[3] || 'brief');
  if (p === '/ledger/ask') return { answer: 'Krishna Garments is your single biggest problem: ₹4,00,000, 31 days late.', sources: ['i_1'] };
  if (p === '/ledger/reclassify-purchases') return { updated: 3, message: 'Rechecked 3 earlier bills' };
  if (p === '/expenses' || p === '/expenses/with-file') return method === 'GET' ? EXPENSES : { ...OK, expense: EXPENSES[0] };
  if (p === '/expenses/suggest-category') return { category: 'Raw Material', confidence: 0.88 };
  if (p === '/assets' || p === '/assets/with-file') return method === 'GET' ? ASSETS : { ...OK, asset: ASSETS[0] };
  if (p === '/inventory' || p === '/inventory/with-file') return method === 'GET' ? INVENTORY : { ...OK, item: INVENTORY[0] };
  if (p === '/revenue' || p === '/revenue/with-file') return method === 'GET' ? REVENUE : { ...OK, revenue: REVENUE[0] };
  if (seg[1] === 'revenue' && seg[2]) return { ...OK, revenue: REVENUE[0] };
  if (p === '/invoices') return method === 'GET' ? INVOICES : { ...OK, invoice: INVOICES[0] };
  if (p === '/payments') return method === 'GET' ? PAYMENTS : { ...OK, payment: PAYMENTS[0] };
  if (p === '/payables') return INVOICES.filter((i) => i.type === 'purchase_invoice');
  if (p === '/files') return [];

  // --- capture / ingest ---
  if (p === '/captures/pending-count') return { count: CAPTURES.filter((c) => c.status === 'pending').length };
  if (p === '/captures') return CAPTURES.filter((c) => !q.get('status') || c.status === q.get('status'));
  if (seg[1] === 'captures' && seg[2]) return OK;
  if (p === '/ingest') return method === 'GET' ? CAPTURES : { ...OK, capture: CAPTURES[0] };
  if (seg[1] === 'ingest' && seg[3] === 'commit') return OK;
  if (p === '/capture/clarify') return { ...OK, question: 'Who should this go to?' };
  if (p === '/transcribe') return { text: 'Tell Suresh the indigo lot ships before Friday', confidence: 0.92 };
  if (p === '/voice-notes' || p === '/voice-notes/text') return { ...OK, id: 'cap_new', status: 'pending' };
  if (p === '/whatsapp/status') return { connected: false, number: null, last_message_at: null };
  // The raw log is what MPWA-09 deletes — it leaks WA_TENANT_ID at the founder.
  if (p === '/whatsapp/logs') return [
    { id: 'wl_1', level: 'error', message: 'Sender not registered in any workspace and no fallback (WA_TENANT_ID) is set', created_at: daysAgo(1) },
    { id: 'wl_2', level: 'info', message: 'inbound webhook tenant_id=ten_rajesh_textiles status=403', created_at: daysAgo(2) },
  ];

  // --- brain / dex ---
  if (p === '/brain/documents') return method === 'GET' ? BRAIN_DOCS : { ...OK, document: BRAIN_DOCS[0] };
  if (p === '/brain/search') return { results: [
    { id: 'bd_1', title: 'Reliance Trends master agreement 2025', snippet: 'Payment terms: 30 days from invoice date…', score: 0.91 },
  ] };
  if (p === '/brain/export') return { url: null, message: 'Export not available in fixtures' };
  if (seg[1] === 'brain' && seg[2] === 'documents' && seg[3]) return OK;
  if (p === '/ask') return { answer: 'Krishna Garments owes ₹4,00,000 and is 31 days late. Priya has chased twice with no answer.', sources: [{ id: 'i_1', title: 'Invoice SBT/25-26/0412' }] };

  // --- misc screens ---
  if (p === '/calendar') return CALENDAR;
  if (p === '/operating-score') return OPERATING_SCORE;
  if (p === '/work-coach' || p === '/work-coach/refresh') return WORK_COACH;
  if (p === '/journal') return JOURNAL;
  if (p === '/meetings' || p === '/meetings/text') return method === 'GET' ? [] : OK;
  if (p === '/inbox') return { items: [] };

  // --- tenant / settings ---
  if (p === '/tenant' || p === '/tenant/settings') return method === 'GET' ? TENANT : { ...OK, tenant: TENANT };
  if (p === '/tenant/roles') return [
    { key: 'owner', label: 'Owner', permissions: ['*'] },
    { key: 'sales', label: 'Sales', permissions: ['inbox', 'tasks', 'people'] },
    { key: 'production', label: 'Production', permissions: ['inbox', 'tasks'] },
    { key: 'finance', label: 'Finance', permissions: ['inbox', 'tasks', 'finance', 'ledger'] },
  ];
  if (p === '/tenant/lexicon') return { terms: [
    { term: 'lot', meaning: 'A production batch against one buyer order' },
    { term: 'grey', meaning: 'Undyed woven fabric' },
  ] };
  if (p === '/tenant/operating-model') return {
    pipelines: [
      { key: 'order_to_cash', label: 'Order to cash', stages: ['enquiry', 'quotation_sent', 'order_confirmed', 'dispatched', 'payment_received'] },
      { key: 'purchase_payment', label: 'Purchase to payment', stages: ['quote_received', 'po_raised', 'goods_received', 'payment_due', 'paid'] },
    ],
    approval_rules: [{ key: 'high_value', label: 'Owner approves above', amount: TENANT.high_value_threshold }],
  };
  if (p === '/tenant/finance-categories') return { expense: ledgerSummary().categories, asset: ledgerSummary().asset_categories };
  if (p === '/tenant/leave-approvers') return [{ id: 'u_owner', name: 'Rajesh Kumar' }];
  if (p === '/tenant/os-blueprint' || p === '/onboarding/os-blueprint') return { ready: true, pipelines: 2, roles: 4 };
  if (p.startsWith('/tenant/')) return method === 'GET' ? {} : OK;

  return null; // -> catch-all
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body) => {
    const payload = JSON.stringify(body ?? null);
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': req.headers.origin || ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  if (req.method === 'OPTIONS') return send(204, null);

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (!url.pathname.startsWith('/api')) return send(404, { detail: 'Not found' });
    let out;
    try {
      out = resolve(req.method, url.pathname, url.searchParams);
    } catch (err) {
      console.error(`[fixture] ${req.method} ${url.pathname} ->`, err.message);
      return send(500, { detail: 'Fixture server error' });
    }
    if (out === null) {
      // Unmapped endpoint: answer shape-neutrally rather than 404, so a
      // missing fixture never looks like a UI bug during an audit run.
      console.warn(`[fixture] unmapped ${req.method} ${url.pathname} -> {}`);
      out = req.method === 'GET' ? {} : OK;
    }
    send(200, out);
  });
});

server.listen(PORT, () => {
  console.log(`[fixture] DecisionOS fixture API on http://localhost:${PORT}/api`);
  console.log(`[fixture] clock anchor: ${ANCHOR.toISOString()}`);
  console.log(`[fixture] CORS origin: ${ORIGIN} · persona: Rajesh Kumar (owner)`);
  console.log('[fixture] NOT the real backend — contracts read off backend/routers at 54067b0.');
});
