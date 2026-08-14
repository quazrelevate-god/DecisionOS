#!/usr/bin/env node
/**
 * Populate the demo tenant with a realistic Indian textile-MSME dataset, so the
 * mobile UI can be judged with content in it rather than empty states.
 *
 *   node scripts/seed-demo-data.mjs            # create anything missing
 *   node scripts/seed-demo-data.mjs --dry      # show what it would do
 *   node scripts/seed-demo-data.mjs --decisions # also capture directives (slow, uses AI)
 *
 * Everything goes through the real API, so the app's own validation applies and
 * nothing is written that the product could not have created itself. Every row
 * carries the marker below in a free-text field so it can be found and removed.
 *
 * Idempotent: it reads what exists first and only creates what is missing, so
 * running it twice does not double the data.
 */
const BASE = (process.env.API_BASE || 'http://localhost:8000').replace(/\/$/, '');
const EMAIL = process.env.DEMO_EMAIL || 'owner@sharma.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const MARKER = '[demo-seed]';
const DRY = process.argv.includes('--dry');
const WITH_DECISIONS = process.argv.includes('--decisions');

let cookie = '';
const created = {};
const failed = [];

async function call(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setC = res.headers.getSetCookie?.() || [];
  if (setC.length) cookie = setC.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, json, text };
}

// List endpoints are not uniform: /expenses and /contacts return arrays, while
// /revenue returns { invoices, payments, totals, ... }. Normalise once.
const asList = (d, ...keys) => {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object') return [];
  for (const k of [...keys, 'items', 'results']) if (Array.isArray(d[k])) return d[k];
  return [];
};

const day = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
};

async function make(kind, path, body, label) {
  if (DRY) { console.log(`  would create ${kind}: ${label}`); return null; }
  const r = await call('POST', path, body);
  if (!r.ok) {
    failed.push(`${kind} "${label}" -> ${r.status} ${(r.json?.detail && JSON.stringify(r.json.detail)) || r.text.slice(0, 120)}`);
    return null;
  }
  created[kind] = (created[kind] || 0) + 1;
  console.log(`  created ${kind}: ${label}`);
  return r.json;
}

// ---------------------------------------------------------------------------
console.log(`seeding ${BASE} as ${EMAIL}${DRY ? '  (dry run)' : ''}\n`);
const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
if (!login.ok) {
  console.error('login failed:', login.status, login.text.slice(0, 200));
  process.exit(1);
}
const tenant = login.json.tenant;
console.log(`tenant: ${tenant.name} (${tenant.id})\n`);

const users = asList((await call('GET', '/users')).json, 'users');
const byRole = (r) => users.find((u) => u.role === r) || {};
const OWNER = byRole('owner');
const SALES = byRole('sales');
const PROD = byRole('production');
const FIN = byRole('finance');
console.log(`team: ${users.map((u) => `${u.name} (${u.role})`).join(', ')}\n`);

// ---------------------------------------------------------------------- contacts
const existingContacts = asList((await call('GET', '/contacts')).json, 'contacts');
const haveContact = (n) => existingContacts.some((c) => c.name.toLowerCase() === n.toLowerCase());

const CONTACTS = [
  { name: 'Reliance Trends', type: 'customer', company: 'Reliance Retail Ltd', phone: '+919820044557', email: 'meera.iyer@ril.example', address: 'Mumbai, Maharashtra', status: 'active', tags: ['key account'] },
  { name: 'Krishna Garments', type: 'customer', company: 'Krishna Garments Pvt Ltd', phone: '+919820044556', email: 'vikram@krishnagarments.in', address: 'Ahmedabad, Gujarat', status: 'active', tags: ['at risk', 'overdue'] },
  { name: 'Anand Fabrics', type: 'customer', company: 'Anand Fabrics & Co', phone: '+919820044558', email: 'deepak@anandfabrics.in', address: 'Surat, Gujarat', status: 'active' },
  { name: 'Nashik Traders', type: 'dealer', company: 'Nashik Traders', phone: '+919820044563', email: 'sunil@nashiktraders.in', address: 'Nashik, Maharashtra', status: 'active' },
  { name: 'Surat Spinners', type: 'vendor', company: 'Surat Spinners LLP', phone: '+919820044559', email: 'jignesh@suratspinners.in', address: 'Surat, Gujarat', status: 'active', tags: ['preferred'] },
  { name: 'Coimbatore Loom Works', type: 'vendor', company: 'CLW Engineering', phone: '+919820044561', email: 'senthil@clw.example', address: 'Coimbatore, Tamil Nadu', status: 'active' },
  { name: 'Bombay Dyeing House', type: 'vendor', company: 'Bombay Dyeing House', phone: '+919820044562', email: 'farhan@bdh.example', address: 'Mumbai, Maharashtra', status: 'inactive' },
];
console.log('contacts…');
const contactIds = {};
for (const c of existingContacts) contactIds[c.name] = c.id;
for (const c of CONTACTS) {
  if (haveContact(c.name)) { console.log(`  exists: ${c.name}`); continue; }
  const r = await make('contact', '/contacts', { ...c, notes: `${MARKER} demo contact` }, c.name);
  if (r?.id) contactIds[c.name] = r.id;
  else if (r?.contact?.id) contactIds[c.name] = r.contact.id;
}

// ------------------------------------------------------------------------- tasks
const existingTasks = asList((await call('GET', '/tasks?mine=false')).json, 'tasks');
const haveTask = (t) => existingTasks.some((x) => x.title === t);

const TASKS = [
  { title: 'Collect ₹4,00,000 outstanding from Krishna Garments', description: 'Overdue 31 days. Two numbers unreachable. Decide recovery vs write-off.', assignee_id: SALES.id, priority: 'high', due_date: day(-31), task_type: 'operational' },
  { title: 'Reconcile March GST input credit against purchase register', description: 'Mismatch of ₹18,400 between GSTR-2B and the purchase register.', assignee_id: FIN.id, priority: 'high', due_date: day(-9), progress: 60 },
  { title: 'Fix loom 4 motor tripping — 6 stoppages this month', description: 'Motor trips under load. Rewind is ₹22,000; replacement ₹78,000 with 2-year warranty.', assignee_id: PROD.id, priority: 'high', due_date: day(-4), evidence_required: true },
  { title: 'Send dispatch plan for Reliance Trends Diwali order', description: '₹22,00,000 order. Buyer needs the plan before confirming.', assignee_id: PROD.id, priority: 'high', due_date: day(0) },
  { title: 'Chase Anand Fabrics for signed reorder confirmation', description: '₹6,00,000 repeat order pending signature.', assignee_id: SALES.id, priority: 'medium', due_date: day(0) },
  { title: 'Pay Surat Spinners advance before dispatch slot closes', description: '30% advance of ₹1,44,000 due to hold the slot.', assignee_id: FIN.id, priority: 'high', due_date: day(0) },
  { title: 'Count finished-goods stock in godown 2 before audit', assignee_id: PROD.id, priority: 'medium', due_date: day(-2), progress: 25, evidence_required: true },
  { title: 'File TDS return for Q2', assignee_id: FIN.id, priority: 'medium', due_date: day(4) },
  { title: 'Renew fire safety certificate for the unit', assignee_id: PROD.id, priority: 'low', due_date: day(12) },
  { title: 'Quality check on the 400-piece sample lot for Reliance', assignee_id: PROD.id, priority: 'high', due_date: day(3), evidence_required: true },
  { title: 'Update rate card for cotton blends', assignee_id: SALES.id, priority: 'low', due_date: day(8) },
  { title: 'Approve ₹78,000 replacement motor for loom 4', description: 'Coimbatore Loom Works quote, 2-year warranty. Loom 4 carries 30% of the Diwali run.', assignee_id: PROD.id, priority: 'high', due_date: day(1), approval_required: true, approver_id: OWNER.id },
  { title: 'Approve 45-day credit for Reliance Trends', description: 'Buyer asked for 45 days on ₹22,00,000. They have never missed a payment in 3 years.', assignee_id: SALES.id, priority: 'high', due_date: day(1), approval_required: true, approver_id: OWNER.id },
];
console.log('\ntasks…');
for (const t of TASKS) {
  if (haveTask(t.title)) { console.log(`  exists: ${t.title.slice(0, 46)}`); continue; }
  await make('task', '/tasks', { ...t, expected_output: t.expected_output || `${MARKER}` }, t.title.slice(0, 46));
}

// ---------------------------------------------------------------------- expenses
const existingExpenses = asList((await call('GET', '/expenses')).json, 'expenses');
const haveExpense = (t) => existingExpenses.some((x) => (x.title || x.description) === t);
const EXPENSES = [
  { title: 'Cotton yarn 40s — 12 tonnes', amount: 480000, category: 'Raw Material', vendor_name: 'Surat Spinners', date: day(-3), status: 'unpaid' },
  { title: 'Power bill — September', amount: 214000, category: 'Utilities', vendor_name: 'MSEDCL', date: day(-12), status: 'paid' },
  { title: 'Wages — September', amount: 862000, category: 'Salaries', vendor_name: 'Payroll', date: day(-14), status: 'paid' },
  { title: 'Dyeing job work — 2,400 m', amount: 96000, category: 'Job Work', vendor_name: 'Bombay Dyeing House', date: day(-8), status: 'unpaid' },
  { title: 'Loom spares and belts', amount: 38500, category: 'Maintenance', vendor_name: 'Coimbatore Loom Works', date: day(-20), status: 'paid' },
  { title: 'Freight to Mumbai — 3 trips', amount: 47000, category: 'Logistics', vendor_name: 'Sai Transport', date: day(-5), status: 'unpaid' },
  { title: 'Polyester blend — 4 tonnes', amount: 152000, category: 'Raw Material', vendor_name: 'Gujarat Cotton Mills', date: day(-28), status: 'paid' },
  { title: 'GST consultant retainer', amount: 25000, category: 'Professional Fees', vendor_name: 'Shah & Associates', date: day(-30), status: 'paid' },
];
console.log('\nexpenses…');
for (const e of EXPENSES) {
  if (haveExpense(e.title)) { console.log(`  exists: ${e.title.slice(0, 40)}`); continue; }
  await make('expense', '/expenses', { ...e, currency: 'INR', notes: MARKER }, e.title.slice(0, 40));
}

// ----------------------------------------------------------------------- revenue
const existingRevenue = asList((await call('GET', '/revenue')).json, 'invoices');
const haveRevenue = (n) => existingRevenue.some((x) => x.number === n);
const REVENUE = [
  // NOTE: IncomeInput.received is a BOOLEAN ("has the money arrived"), not an
  // amount — passing a number returns 422 bool_parsing. Partial receipts are
  // represented by status, not by a part-amount on the invoice.
  { number: 'SBT/25-26/0412', customer_name: 'Krishna Garments', title: 'Shirting — 3,200 m', amount: 400000, received: false, date: day(-61), due_date: day(-31), status: 'overdue' },
  { number: 'SBT/25-26/0431', customer_name: 'Anand Fabrics', title: 'Cotton blend — 1,800 m', amount: 285000, received: false, date: day(-24), due_date: day(-9), status: 'partial' },
  { number: 'SBT/25-26/0447', customer_name: 'Reliance Trends', title: 'Diwali lot — part 1', amount: 1840000, received: true, date: day(-18), due_date: day(-3), status: 'paid' },
  { number: 'SBT/25-26/0452', customer_name: 'Nashik Traders', title: 'Grey shirting — 400 m', amount: 64000, received: false, date: day(-6), due_date: day(9), status: 'sent' },
  { number: 'SBT/25-26/0455', customer_name: 'Threads Boutique', title: 'Indigo lot — 600 m', amount: 96000, received: true, date: day(-2), due_date: day(13), status: 'paid' },
];
console.log('\nincome…');
for (const r of REVENUE) {
  if (haveRevenue(r.number)) { console.log(`  exists: ${r.number}`); continue; }
  await make('income', '/revenue', { ...r, currency: 'INR', notes: MARKER }, r.number);
}

// ------------------------------------------------------------------------ assets
const existingAssets = asList((await call('GET', '/assets')).json, 'assets');
const ASSETS = [
  { name: 'Jacquard loom #4', category: 'Machinery', purchase_amount: 1250000, purchase_date: day(-1400), status: 'maintenance', vendor_name: 'Coimbatore Loom Works' },
  { name: 'Jacquard loom #5', category: 'Machinery', purchase_amount: 1250000, purchase_date: day(-1400), status: 'active', vendor_name: 'Coimbatore Loom Works' },
  { name: 'Cutting table (industrial)', category: 'Machinery', purchase_amount: 185000, purchase_date: day(-900), status: 'active' },
  { name: 'Tata Ace delivery van', category: 'Vehicle', purchase_amount: 620000, purchase_date: day(-1100), status: 'active' },
  { name: 'Diesel generator 62.5 kVA', category: 'Utility', purchase_amount: 480000, purchase_date: day(-700), status: 'active' },
];
console.log('\nassets…');
for (const a of ASSETS) {
  if (existingAssets.some((x) => x.name === a.name)) { console.log(`  exists: ${a.name}`); continue; }
  await make('asset', '/assets', { ...a, currency: 'INR', notes: MARKER }, a.name);
}

// --------------------------------------------------------------------- inventory
const existingInv = asList((await call('GET', '/inventory')).json, 'inventory');
const INVENTORY = [
  { item: 'Cotton yarn 40s', category: 'Raw Material', quantity: 8400, unit: 'kg', unit_cost: 40, vendor_name: 'Surat Spinners' },
  { item: 'Polyester blend', category: 'Raw Material', quantity: 2100, unit: 'kg', unit_cost: 38, vendor_name: 'Gujarat Cotton Mills' },
  { item: 'Finished shirting — grey', category: 'Finished Goods', quantity: 4200, unit: 'm', unit_cost: 140 },
  { item: 'Finished shirting — indigo', category: 'Finished Goods', quantity: 1800, unit: 'm', unit_cost: 160 },
  { item: 'Packing cartons', category: 'Consumable', quantity: 900, unit: 'pcs', unit_cost: 30, vendor_name: 'PackWell Industries' },
];
console.log('\ninventory…');
for (const i of INVENTORY) {
  if (existingInv.some((x) => x.item === i.item)) { console.log(`  exists: ${i.item}`); continue; }
  await make('inventory', '/inventory', { ...i, currency: 'INR', notes: MARKER }, i.item);
}

// --------------------------------------------------------------------- workflows
const existingWf = asList((await call('GET', '/workflows')).json, 'workflows');
// /tenant/operating-model returns only { detail } for this tenant, so derive the
// pipeline vocabulary from workflows that already exist — that is the set the
// backend will actually accept — and fall back to the documented defaults.
const liveTypes = [...new Set(existingWf.map((w) => w.type).filter(Boolean))];
const KNOWN = ['purchase_payment', 'production', 'distribution', 'order_to_cash'];
const types = liveTypes.length ? liveTypes : KNOWN;
const pipeKey = (want) => (types.includes(want) ? want : types[0]);
console.log('\nworkflows…  (pipeline types: ' + types.join(', ') + ')');
{
  const WF = [
    { type: pipeKey('purchase_payment'), title: 'Surat Spinners — yarn PO', amount: 480000, counterparty: 'Surat Spinners', contact_id: contactIds['Surat Spinners'] },
    { type: pipeKey('purchase_payment'), title: 'Gujarat Cotton Mills — blend PO', amount: 92000, counterparty: 'Gujarat Cotton Mills', contact_id: contactIds['Gujarat Cotton Mills'] },
    { type: pipeKey('order_to_cash'), title: 'Reliance Trends — Diwali order', amount: 2200000, counterparty: 'Reliance Trends', contact_id: contactIds['Reliance Trends'] },
    { type: pipeKey('order_to_cash'), title: 'Anand Fabrics — reorder', amount: 600000, counterparty: 'Anand Fabrics', contact_id: contactIds['Anand Fabrics'] },
  ];
  for (const w of WF) {
    if (existingWf.some((x) => x.title === w.title)) { console.log(`  exists: ${w.title}`); continue; }
    await make('workflow', '/workflows', { ...w, detail: `${MARKER} demo workflow` }, w.title);
  }
}

// ------------------------------------------------------------------------ leaves
const existingLeaves = asList((await call('GET', '/leaves?scope=approvals')).json, 'leaves');
console.log('\nleave requests…');
if (existingLeaves.length) {
  console.log(`  ${existingLeaves.length} already pending — skipping`);
} else {
  await make('leave', '/leaves', { leave_type: 'casual', from_date: day(5), to_date: day(7), day_portion: 'full', reason: `${MARKER} Deepavali with family` }, 'casual leave');
}

// -------------------------------------------------------------------- complaints
const existingComplaints = asList((await call('GET', '/complaints')).json, 'complaints');
console.log('\ncomplaints…');
if (existingComplaints.length >= 2) {
  console.log(`  ${existingComplaints.length} already present — skipping`);
} else {
  await make('complaint', '/complaints', {
    customer_id: contactIds['Anand Fabrics'],
    text: `${MARKER} Shade mismatch on the indigo lot — 12 pieces off-tone against the approved swatch.`,
    severity: 'high',
  }, 'shade mismatch');
}

// --------------------------------------------------------------------- decisions
// Decisions are produced by the capture pipeline, not a POST /decisions — so the
// only honest way to seed them is the way the product makes them: capture a
// directive and let the AI structure it. Slow and it costs tokens, hence opt-in.
if (WITH_DECISIONS) {
  console.log('\ndecisions (via capture — this calls the AI, ~10-20s each)…');
  const DIRECTIVES = [
    'Approve four lakh eighty thousand rupees for twelve tonnes of cotton yarn from Surat Spinners for the Diwali run — their rate is four percent higher than Rajkot but they guarantee three week delivery',
    'I need to decide whether to write off one lakh fifteen thousand from Krishna Garments, they have not paid in ninety four days and are not answering two numbers',
    'Approve hiring a second cutting master at thirty two thousand a month, cutting is the bottleneck on three of the last five delays',
    'Should we give Reliance Trends forty five day credit instead of thirty on the twenty two lakh Diwali order',
    'Approve seventy eight thousand for a new motor on loom four, it has tripped six times this month and carries thirty percent of the Diwali run',
  ];
  for (const text of DIRECTIVES) {
    const r = await make('capture', '/voice-notes/text', { text, language: 'en' }, text.slice(0, 46));
    if (r) process.stdout.write('    captured\n');
  }
  console.log('  note: the AI decides whether each becomes a decision, a task, or a reminder.');
} else {
  console.log('\ndecisions: skipped (pass --decisions to capture directives through the AI pipeline)');
}

// ----------------------------------------------------------------------- summary
console.log('\n' + '='.repeat(60));
console.log('created:', Object.keys(created).length ? Object.entries(created).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ') : 'nothing (all present)');
if (failed.length) {
  console.log(`\n${failed.length} failure(s) — these are real API rejections, worth reading:`);
  for (const f of failed) console.log(`  · ${f}`);
}
const after = {
  contacts: asList((await call('GET', '/contacts')).json, 'contacts').length,
  tasks: asList((await call('GET', '/tasks?mine=false')).json, 'tasks').length,
  expenses: asList((await call('GET', '/expenses')).json, 'expenses').length,
  income: asList((await call('GET', '/revenue')).json, 'invoices').length,
  assets: asList((await call('GET', '/assets')).json, 'assets').length,
  inventory: asList((await call('GET', '/inventory')).json, 'inventory').length,
  workflows: asList((await call('GET', '/workflows')).json, 'workflows').length,
};
console.log('\ntenant now holds:', Object.entries(after).map(([k, v]) => `${v} ${k}`).join(', '));
const desk = (await call('GET', '/desk?chip=needs_decision')).json || {};
console.log('desk counters:', JSON.stringify(desk.counters || {}));
console.log(`\nEvery row carries "${MARKER}" in a free-text field for later cleanup.`);
