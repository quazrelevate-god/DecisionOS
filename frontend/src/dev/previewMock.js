/**
 * DEV-ONLY API stub, so real app screens can be reviewed without a backend or Mongo.
 *
 *   REACT_APP_PREVIEW_MOCK=1 yarn start
 *
 * Installed from src/index.js behind that flag and nowhere else — it is a no-op in any
 * normal dev run and is stripped from production builds by the same guard. It exists to
 * make design-system review possible against the *real* pages (real Layout, real Inbox)
 * rather than against a mockup, which is the only way to judge visual dominance honestly.
 *
 * It is not a test fixture and not a substitute for the backend: it answers a fixed set
 * of GETs with plausible shapes and swallows writes.
 */
import api from '../lib/api';

/* Relative dates, not literals.
 *
 * whatMatters() computes lateness against Date.now(), so a hardcoded
 * '2026-07-28' means a fixture whose tiers silently drift: what is "3 days
 * overdue" the week it was written becomes "40 days overdue" a month later,
 * and every screenshot baseline taken against it disagrees with the next one.
 * Offsetting from now keeps the *meaning* fixed — "3 days overdue" reads as
 * 3 days overdue forever — which is also what makes shot-to-shot diffs honest. */
const DAY = 86400000;
/** Exactly n×24h before now, so daysLate() reads back exactly n at any hour. */
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * DAY).toISOString();
/** Noon today — lands in the due-today tier whatever time the preview is opened. */
const todayAtNoon = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

const USER = {
  id: 'u_preview',
  name: 'Prasanna Narayanan',
  email: 'prasanna@example.com',
  role: 'owner',
  language: 'en',
  permissions: [],
};

const TENANT = {
  id: 't_preview',
  company_name: 'Preview Industries',
  roles: [
    { key: 'owner', label: 'Owner' },
    { key: 'sales', label: 'Sales' },
    { key: 'finance', label: 'Finance' },
  ],
};

/** GET responses by path prefix. First match wins. */
const ROUTES = [
  ['/auth/me', { user: USER, tenant: TENANT }],
  [
    '/notifications',
    {
      unread: 3,
      notifications: [
        { id: 'n1', type: 'decision', title: 'Supplier payment timing needs your approval', read: false, created_at: new Date(0).toISOString() },
        { id: 'n2', type: 'task', title: 'Dispatch confirmation is overdue', read: false, created_at: new Date(0).toISOString() },
        { id: 'n3', type: 'task', title: 'Payroll reconciliation completed', read: true, created_at: new Date(0).toISOString() },
      ],
    },
  ],
  ['/captures/pending-count', { count: 2 }],

  /* Shapes below are richer than the endpoints they stand in for because the
     migration's screenshot baseline is worthless if a screen renders a crash
     instead of a layout. Each field here exists because a page dereferenced it
     and threw. */
  [
    '/brief',
    {
      counters: { fires: 2, decisions: 3, tasks: 7, overdue: 1 },
      fires: [{ id: 'f1', title: 'Payroll headroom' }],
      sections: [],
      summary: '',
    },
  ],
  [
    '/operating-score',
    {
      company: {
        overall: 72,
        enough_data: true,
        trend: 'up',
        categories: [
          { key: 'decisions', label: 'Decision throughput', score: 81 },
          { key: 'execution', label: 'Execution follow-through', score: 64 },
          { key: 'response', label: 'Customer response', score: 70 },
        ],
      },
      stats: { total_decisions: 12, done: 24, open: 7, overdue: 2, open_complaints: 1 },
      employees: [
        { id: 'u1', name: 'Prasanna Narayanan', role: 'owner', score: 78, open: 3, done: 12 },
        { id: 'u2', name: 'Ravi Kumar', role: 'sales', score: 61, open: 4, done: 9 },
      ],
    },
  ],
  [
    '/work-coach',
    {
      target: { id: 'u1', name: 'Prasanna Narayanan', role: 'owner' },
      stats: { completed: 12, open: 4, overdue: 2, completion_rate: 0.75, proof_upload_rate: 0.4, photos_uploaded: 3, plans_used: 5 },
      summary: {
        headline: 'Follow-through is the gap, not workload.',
        recommendation: 'Close the two overdue items before taking on new work.',
        completed: 12,
        open: 4,
        overdue: 2,
        completion_rate: 0.75,
        proof_upload_rate: 0.4,
        photos_uploaded: 3,
        plans_used: 5,
        strengths: ['Closes decisions the day they are raised', 'Attaches proof on high-value tasks'],
        improvements: ['Attach proof when marking done', 'Set a due date on every task'],
        generated_at: new Date(0).toISOString(),
      },
      items: [],
    },
  ],
  [
    '/ledger/summary',
    {
      currency: 'INR',
      // Key names match what KpiRow reads — a fixture whose keys miss render
      // ₹0 across the board, which is the exact symptom this product was
      // mistrusted for. Stubbed values, but they must at least be real numbers.
      totals: {
        revenue_billed: 1842300,
        revenue_received: 1621000,
        total_spend: 482000,
        net_profit: 1139000,
        asset_value: 310000,
        inventory_value: 154000,
      },
      by_month: [
        { month: 'Mar', amount: 121000 },
        { month: 'Apr', amount: 98000 },
        { month: 'May', amount: 143000 },
        { month: 'Jun', amount: 120000 },
      ],
      by_category: [
        { category: 'Packaging', amount: 184000 },
        { category: 'Freight', amount: 121000 },
        { category: 'Utilities', amount: 96000 },
        { category: 'Payroll', amount: 81000 },
      ],
      by_vendor: [
        { vendor: 'Acme Packaging', amount: 184000 },
        { vendor: 'Southern Transport', amount: 121000 },
      ],
    },
  ],
  ['/ledger', { items: [] }],
  ['/ledger/ai', { summary: '', insights: [], items: [] }],
  ['/expenses', []],
  ['/assets', []],
  ['/inventory', []],
  ['/revenue', []],
  ['/payables', []],
  ['/voice-notes', []],

  /* Populated so the Decision Desk can be reviewed with real content: an empty
     feed proves nothing about density, scannability or the approval card. */
  [
    '/inbox',
    {
      open_total: 11,
      counts: { customer: 2, supplier: 2, invoice: 1, payment: 1, complaint: 1, task: 3, approval: 1, reminder: 1 },
      /* ref_id joins to a real decision or task id. It has to: the feed's
         "needs you today" is derived from the ranked record behind each row,
         so a row pointing at an id that does not exist is not "not today" —
         it is unrankable, and it would silently fall into the hidden half. */
      items: [
        { id: 'i1', ref_type: 'decision', ref_id: 'd1', classification: 'supplier', source: 'voice', title: 'Approve supplier payment timing', preview: 'Move the ₹4,80,000 payment to Friday to preserve payroll headroom.', amount: 480000, status: 'open' },
        { id: 'i2', ref_type: 'decision', ref_id: 'd2', classification: 'customer', source: 'whatsapp', title: 'Delhi retailer wants revised quote', preview: 'Asked for 8% off on the packaging line.', amount: null, status: 'open' },
        { id: 'i3', ref_type: 'task', ref_id: 'to6', classification: 'invoice', source: 'text', title: 'Reconcile packaging invoice against the GRN', preview: 'Two line items do not match the GRN.', amount: 240000, status: 'open' },
        { id: 'i4', ref_type: 'task', ref_id: 'to3a', classification: 'payment', source: 'text', title: 'Release the quarterly distributor payout', preview: 'Due to fourteen distributors.', amount: 1800000, status: 'open' },
        { id: 'i5', ref_type: 'task', ref_id: 'td1', classification: 'task', source: 'text', title: 'Confirm dispatch schedule with the transporter', preview: '', amount: 420000, status: 'open' },
        { id: 'i6', ref_type: 'task', ref_id: 'te1', classification: 'complaint', source: 'whatsapp', title: 'Chennai stockist wants a callback today', preview: 'Third complaint this month from the same route.', amount: null, status: 'open' },
        // The same invoice parsed twice — what duplicate collapse is for.
        { id: 'i7', ref_type: 'task', ref_id: 'to6', classification: 'invoice', source: 'whatsapp', title: 'Reconcile packaging invoice against the GRN', preview: 'Two line items do not match the GRN.', amount: 240000, status: 'open' },
        { id: 'i8', ref_type: 'task', ref_id: 'to6', classification: 'invoice', source: 'text', title: 'Reconcile packaging invoice against the GRN', preview: 'Two line items do not match the GRN.', amount: 240000, status: 'open' },

        /* Rows that are real work but not today's — the half the feed default
           holds back, and therefore the half the "Show everything" count has
           to be able to account for. */
        { id: 'i9', ref_type: 'task', ref_id: 'tf1', classification: 'task', source: 'text', title: 'Plan the Diwali dispatch schedule', preview: 'Six weeks out.', amount: null, status: 'open' },
        { id: 'i10', ref_type: 'task', ref_id: 'tx1', classification: 'approval', source: 'text', title: 'Leave request — Ravi Kumar', preview: '2 days, next week.', amount: null, status: 'done' },
        { id: 'i11', ref_type: 'task', ref_id: 'th1', classification: 'customer', source: 'whatsapp', title: 'Take over the Trichy dealer conversation', preview: 'Ravi is on leave from Monday.', amount: null, status: 'open' },
        { id: 'i12', ref_type: 'ingestion', ref_id: 'ing1', classification: 'reminder', source: 'text', title: 'Renew the godown insurance', preview: 'Policy lapses next quarter.', amount: null, status: 'open' },
        { id: 'i13', ref_type: 'task', ref_id: 'to1', classification: 'supplier', source: 'text', title: 'Confirm the monsoon leak repair quote', preview: 'Two quotes received.', amount: 610000, status: 'open' },
      ],
    },
  ],
  /* Must precede '/decisions' — first match wins, and the list route's prefix
     swallows every by-id request otherwise. */
  [
    '/decisions/',
    (url) => {
      const id = url.split('/decisions/')[1]?.split(/[?#/]/)[0];
      return previewData('/decisions').find((d) => d.id === id) || null;
    },
  ],
  [
    '/decisions',
    [
      {
        id: 'd1',
        title: 'Approve supplier payment timing',
        dtype: 'directive',
        status: 'pending_approval',
        source: 'voice',
        created_by_name: 'Prasanna Narayanan',
        created_at: new Date(0).toISOString(),
        summary: 'Move the ₹4,80,000 payment to Friday to preserve payroll headroom while maintaining the committed supplier window.',
        tasks: [
          { id: 'dt1', title: 'Confirm dispatch schedule', assignee_name: 'Prasanna Narayanan' },
          { id: 'dt2', title: 'Reconcile packaging invoice', assignee_role: 'finance' },
        ],
      },
      {
        id: 'd2',
        title: 'Delhi retailer wants revised quote',
        dtype: 'directive',
        status: 'pending_approval',
        source: 'whatsapp',
        wa_from: '+91 98••• ••210',
        created_at: new Date(0).toISOString(),
        summary: 'Retailer asked for 8% off the packaging line. Margin holds at 6%.',
        tasks: [{ id: 'dt3', title: 'Send revised quote', assignee_name: 'Ravi Kumar' }],
      },
      {
        id: 'd3',
        title: 'Switch courier for the southern route',
        dtype: 'directive',
        status: 'approved',
        source: 'text',
        created_by_name: 'Prasanna Narayanan',
        created_at: new Date(0).toISOString(),
        summary: '',
        tasks: [],
      },
      /* Approvals 3–6. Six pending is what a real morning looks like; two was
         an empty case dressed as a fixture, and a top-3 chosen from two
         candidates proves nothing about how the Desk behaves under load. */
      {
        id: 'd4',
        title: 'Raise freight rate on the Chennai route',
        dtype: 'directive',
        status: 'pending_approval',
        source: 'whatsapp',
        wa_from: '+91 98••• ••441',
        created_at: new Date(0).toISOString(),
        summary: 'Transporter wants 11% more from next month. Holding the current rate means absorbing ₹38,000 a month.',
        tasks: [{ id: 'dt4', title: 'Get two comparison quotes', assignee_name: 'Ravi Kumar' }],
      },
      {
        id: 'd5',
        title: 'Hire a second dispatch coordinator',
        dtype: 'directive',
        status: 'pending_approval',
        source: 'voice',
        created_by_name: 'Prasanna Narayanan',
        created_at: new Date(0).toISOString(),
        summary: 'Dispatch has slipped four times this month with one coordinator covering both shifts.',
        tasks: [
          { id: 'dt5', title: 'Draft the role and shift pattern', assignee_role: 'owner' },
          { id: 'dt6', title: 'Confirm the salary band against last year', assignee_role: 'finance' },
        ],
      },
      {
        id: 'd6',
        title: 'Write off the damaged carton stock',
        dtype: 'directive',
        status: 'pending_approval',
        source: 'text',
        created_by_name: 'Meena Raghavan',
        created_at: new Date(0).toISOString(),
        summary: '₹1,15,000 of packaging damaged in the monsoon leak. Insurance covers a third of it.',
        tasks: [{ id: 'dt7', title: 'File the insurance claim', assignee_role: 'finance' }],
      },
      {
        id: 'd7',
        title: 'Extend credit terms for the Coimbatore distributor',
        dtype: 'directive',
        status: 'pending_approval',
        source: 'whatsapp',
        wa_from: '+91 90••• ••077',
        created_at: new Date(0).toISOString(),
        summary: 'Asked to move from 30 to 45 days. They have never missed a payment; it costs ₹62,000 of working capital.',
        tasks: [],
      },
    ],
  ],
  /* Twelve tasks, laid out to exercise every branch of whatMatters() rather
     than to look plausible. Read the comments as the spec of what each row is
     here to prove — if one of these stops being true, the ranking changed. */
  [
    '/tasks',
    [
      /* Tier 2 — escalations. Two of them, and the second is also two days
         overdue: it must still rank as an escalation, because a person asking
         outranks a date passing. If it ever appears under "2 days overdue",
         tier precedence has broken. */
      { id: 'te1', title: 'Chennai stockist wants a callback today', status: 'todo', priority: 'high', progress: 0, source: 'escalation', raised_by_name: 'Ravi Kumar', assignee_name: 'Prasanna Narayanan', due_date: daysAhead(2), amount: null },
      { id: 'te2', title: 'Approve the revised packaging artwork', status: 'in_progress', priority: 'medium', progress: 40, source: 'escalation', raised_by_name: 'Meena Raghavan', assignee_name: 'Prasanna Narayanan', due_date: daysAgo(2), amount: 88000 },
      /* A handoff, not an escalation: same tier, different verb. Here so the
         two sources are proven to land together — they used to be one thing
         on the Desk and another in the ranking. */
      { id: 'th1', title: 'Take over the Trichy dealer conversation', status: 'todo', priority: 'medium', progress: 0, source: 'handoff', raised_by_name: 'Ravi Kumar', assignee_name: 'Prasanna Narayanan', due_date: daysAhead(3), amount: null },

      /* Tier 3 — overdue, worst first. Five rows at four distinct day counts.
         The 3-day pair exists for the tie-break: same lateness, different
         amounts, so ₹18,00,000 must sort above ₹95,000. */
      { id: 'to6', title: 'Reconcile packaging invoice against the GRN', status: 'in_progress', priority: 'high', progress: 50, due_date: daysAgo(6), assignee_name: 'Ravi Kumar', amount: 240000 },
      { id: 'to4', title: 'Return the signed transporter agreement', status: 'todo', priority: 'medium', progress: 0, due_date: daysAgo(4), assignee_name: 'Prasanna Narayanan', amount: null },
      { id: 'to3a', title: 'Release the quarterly distributor payout', status: 'todo', priority: 'high', progress: 0, due_date: daysAgo(3), assignee_name: 'Prasanna Narayanan', amount: 1800000 },
      { id: 'to3b', title: 'Chase the Salem retailer receivable', status: 'todo', priority: 'medium', progress: 0, due_date: daysAgo(3), assignee_name: 'Ravi Kumar', amount: 95000 },
      { id: 'to1', title: 'Confirm the monsoon leak repair quote', status: 'todo', priority: 'medium', progress: 0, due_date: daysAgo(1), assignee_name: 'Meena Raghavan', amount: 610000 },

      /* Tier 4 — due today. */
      { id: 'td1', title: 'Confirm dispatch schedule with the transporter', status: 'todo', priority: 'high', progress: 25, due_date: todayAtNoon(), assignee_name: 'Prasanna Narayanan', amount: 420000 },
      { id: 'td2', title: 'Send the revised Delhi quote', status: 'todo', priority: 'medium', progress: 0, due_date: todayAtNoon(), assignee_name: 'Ravi Kumar', amount: null },
      { id: 'td3', title: 'Sign off the weekly payroll run', status: 'todo', priority: 'high', progress: 0, due_date: todayAtNoon(), assignee_name: 'Prasanna Narayanan', amount: 75000 },

      /* Not today — present so "hidden" is a real count of real work, and so a
         future date is proven not to leak into the due-today tier. */
      { id: 'tf1', title: 'Plan the Diwali dispatch schedule', status: 'todo', priority: 'low', progress: 0, due_date: daysAhead(5), assignee_name: 'Meena Raghavan', amount: null },

      /* Terminal, and eight days past due. Must never surface: a completed task
         cannot be overdue, and this row is the guard against that regression. */
      { id: 'tx1', title: 'Leave request — Ravi Kumar', status: 'done', priority: 'low', progress: 100, due_date: daysAgo(8), assignee_name: 'Ravi Kumar', amount: null },
    ],
  ],
  ['/users', [USER]],
];

/**
 * The exact array the preview serves for a path.
 *
 * Exported so a test can assert the fixture still exercises every tier. The
 * comments above each row say what it is there to prove; without this, those
 * comments are a promise nobody checks, and a fixture that quietly stops
 * covering a tier is indistinguishable from one that still does.
 */
export const previewData = (path) => (ROUTES.find(([p]) => p === path) || [])[1];

export function installPreviewMock() {
  api.interceptors.request.use((config) => {
    config.adapter = async (cfg) => {
      const url = cfg.url || '';
      const method = (cfg.method || 'get').toLowerCase();
      const hit = ROUTES.find(([p]) => url.startsWith(p));
      /* A route value may be a function of the url, for the by-id endpoints
         that prefix matching alone answers wrongly — '/decisions/d1' matches
         '/decisions' and would otherwise hand a component the whole array
         where it expects one record. */
      const body = hit ? (typeof hit[1] === 'function' ? hit[1](url) : hit[1]) : [];
      const data = method === 'get' ? body : { ok: true };
      return { data, status: 200, statusText: 'OK', headers: {}, config: cfg, request: {} };
    };
    return config;
  });
  // eslint-disable-next-line no-console
  console.info('[preview-mock] API stubbed — DEV ONLY. Screens render without a backend.');
}
