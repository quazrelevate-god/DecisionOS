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
  ['/brief', { fires: [{ id: 'f1', title: 'Payroll headroom' }], summary: '', sections: [] }],
  ['/voice-notes', []],
  ['/inbox', []],
  ['/decisions', []],
  ['/tasks', []],
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
