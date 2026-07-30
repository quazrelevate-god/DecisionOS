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
      company: { overall: 72, enough_data: true, trend: 'up' },
      stats: { decisions: 12, approved: 9, tasks: 31, done: 24 },
      employees: [],
    },
  ],
  ['/work-coach', { summary: { name: 'Prasanna Narayanan', score: 68, strengths: [], gaps: [] }, items: [] }],
  [
    '/ledger/summary',
    {
      currency: 'INR',
      totals: { expenses: 482000, revenue: 1842300, payables: 121000, assets: 0 },
      by_month: [],
      by_category: [],
    },
  ],
  ['/ledger', { items: [] }],
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
      open_total: 6,
      counts: { customer: 2, supplier: 1, invoice: 1, payment: 0, complaint: 1, task: 1, approval: 1, reminder: 0 },
      items: [
        { id: 'i1', ref_type: 'decision', ref_id: 'd1', classification: 'supplier', source: 'voice', title: 'Approve supplier payment timing', preview: 'Move the ₹4,80,000 payment to Friday to preserve payroll headroom.', amount: 480000, status: 'open' },
        { id: 'i2', ref_type: 'decision', ref_id: 'd2', classification: 'customer', source: 'whatsapp', title: 'Delhi retailer wants revised quote', preview: 'Asked for 8% off on the packaging line.', amount: null, status: 'open' },
        { id: 'i3', ref_type: 'task', ref_id: 't3', classification: 'invoice', source: 'text', title: 'Reconcile packaging invoice', preview: 'Two line items do not match the GRN.', amount: 121000, status: 'open' },
        { id: 'i4', ref_type: 'task', ref_id: 't4', classification: 'complaint', source: 'whatsapp', title: 'Damaged carton reported by Chennai stockist', preview: 'Third complaint this month from the same route.', amount: null, status: 'open' },
        { id: 'i5', ref_type: 'task', ref_id: 't5', classification: 'task', source: 'text', title: 'Confirm dispatch schedule with transporter', preview: '', amount: null, status: 'open' },
        { id: 'i6', ref_type: 'task', ref_id: 't6', classification: 'approval', source: 'text', title: 'Leave request — Ravi Kumar', preview: '2 days, next week.', amount: null, status: 'done' },
      ],
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
    ],
  ],
  [
    '/tasks',
    [
      { id: 't3', title: 'Reconcile packaging invoice', status: 'in_progress', priority: 'medium', progress: 50, due_date: '2026-07-28', assignee_name: 'Ravi Kumar' },
      { id: 't5', title: 'Confirm dispatch schedule with transporter', status: 'todo', priority: 'high', progress: 25, due_date: '2026-08-01', assignee_name: 'Prasanna Narayanan' },
      { id: 't6', title: 'Leave request — Ravi Kumar', status: 'blocked', priority: 'low', progress: 0, due_date: '2026-08-05' },
    ],
  ],
  ['/users', [USER]],
];

export function installPreviewMock() {
  api.interceptors.request.use((config) => {
    config.adapter = async (cfg) => {
      const url = cfg.url || '';
      const method = (cfg.method || 'get').toLowerCase();
      const hit = ROUTES.find(([p]) => url.startsWith(p));
      const data = method === 'get' ? (hit ? hit[1] : []) : { ok: true };
      return { data, status: 200, statusText: 'OK', headers: {}, config: cfg, request: {} };
    };
    return config;
  });
  // eslint-disable-next-line no-console
  console.info('[preview-mock] API stubbed — DEV ONLY. Screens render without a backend.');
}
