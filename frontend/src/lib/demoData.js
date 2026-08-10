/* ============================================================================
   Demo mode — front-end only, opt-in, development only.
   ----------------------------------------------------------------------------
   Set REACT_APP_DEMO_MODE=true in frontend/.env to review the UI with no
   backend at all: an axios adapter answers every /api call from the fixtures
   below instead of hitting the network, so auth, the shell and the pages all
   render with plausible data.

   Deliberately NOT a login bypass in the auth code: AuthContext is untouched
   and still restores its session from GET /auth/me — demo mode simply answers
   that call. Nothing here weakens the real login path.

   Two guards keep this out of production:
     · the flag must be explicitly "true"
     · it is ignored entirely unless NODE_ENV === "development"
   A `yarn build` therefore cannot ship demo data even if the flag is set.
   ========================================================================== */

export const DEMO_MODE =
  process.env.NODE_ENV === "development" && process.env.REACT_APP_DEMO_MODE === "true";

const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
const day = (daysFromNow) => new Date(now + daysFromNow * 86400000).toISOString();

const USER = {
  id: "u-owner",
  name: "Rajesh Sharma",
  email: "owner@sharma.com",
  role: "owner",
  phone: "+91 98400 12345",
  language: "en",
  permissions: [],
};

const TENANT = {
  id: "t-demo",
  name: "Sharma Textiles Pvt Ltd",
  industry: "Textile Manufacturing",
  currency: "INR",
  region: "Tamil Nadu, India",
  company_size: "25-50",
};

const MEMBERS = [
  USER,
  { id: "u-priya", name: "Priya Raman", email: "sales@sharma.com", role: "sales" },
  { id: "u-karthik", name: "Karthik M", email: "production@sharma.com", role: "production" },
  { id: "u-anita", name: "Anita Desai", email: "finance@sharma.com", role: "finance" },
];

const TASKS = [
  {
    id: "t-1",
    title: "Send revised quotation to Velan Traders",
    summary: "Rework the pricing sheet with the 8% volume discount and re-send.",
    status: "in_progress",
    priority: "high",
    assignee_id: "u-priya",
    assignee_name: "Priya Raman",
    assignee_role: "sales",
    due_date: day(-1),
    source: "voice",
    created_at: iso(220),
  },
  {
    id: "t-2",
    title: "Chase pending payment — Kumaran Mills",
    summary: "₹4,20,000 outstanding, 38 days overdue. Call the accounts contact.",
    status: "todo",
    priority: "high",
    assignee_id: "u-anita",
    assignee_name: "Anita Desai",
    assignee_role: "finance",
    due_date: day(0),
    source: "text",
    created_at: iso(180),
  },
  {
    id: "t-3",
    title: "Schedule loom maintenance before the festival run",
    status: "blocked",
    approval_status: "pending",
    priority: "medium",
    assignee_id: "u-karthik",
    assignee_name: "Karthik M",
    assignee_role: "production",
    due_date: day(3),
    source: "voice",
    created_at: iso(90),
  },
  {
    id: "t-4",
    title: "File GST return for the quarter",
    status: "done",
    priority: "medium",
    assignee_id: "u-anita",
    assignee_name: "Anita Desai",
    assignee_role: "finance",
    due_date: day(-4),
    source: "text",
    created_at: iso(2400),
  },
  {
    id: "t-5",
    title: "Onboard the new dyeing supplier",
    status: "todo",
    priority: "low",
    assignee_id: "u-karthik",
    assignee_name: "Karthik M",
    assignee_role: "production",
    due_date: day(7),
    source: "upload",
    created_at: iso(45),
  },
];

const DECISIONS = [
  {
    id: "d-1",
    title: "No dispatch without advance for new customers",
    summary:
      "From today, any first-time customer must clear 50% advance before we dispatch. Applies company-wide.",
    status: "pending_approval",
    dtype: "policy",
    source: "voice",
    created_by_name: "Rajesh Sharma",
    created_at: iso(35),
    items: ["Collect 50% advance", "Update the sales checklist"],
    task_ids: ["t-1"],
  },
  {
    id: "d-2",
    title: "Move the Velan Traders order to priority production",
    summary: "They confirmed the repeat order — push it ahead of the Chennai batch.",
    status: "approved",
    dtype: "directive",
    source: "text",
    created_by_name: "Rajesh Sharma",
    created_at: iso(300),
    items: ["Reschedule loom 3"],
    task_ids: [],
  },
];

const NOTIFICATIONS = [
  {
    id: "n-1",
    type: "approval",
    message: "A decision is waiting for your approval",
    work_title: "No dispatch without advance for new customers",
    sender_name: "DecisionOS",
    level: "owner",
    read: false,
    entity_type: "decision",
    entity_id: "d-1",
    created_at: iso(12),
  },
  {
    id: "n-2",
    type: "assigned",
    message: "New work assigned to Priya Raman",
    work_title: "Send revised quotation to Velan Traders",
    sender_name: "Rajesh Sharma",
    read: false,
    entity_type: "task",
    entity_id: "t-1",
    created_at: iso(48),
  },
  {
    id: "n-3",
    type: "rejected",
    message: "Changes requested on a task",
    work_title: "Schedule loom maintenance before the festival run",
    sender_name: "Karthik M",
    read: false,
    entity_type: "task",
    entity_id: "t-3",
    created_at: iso(140),
  },
  {
    id: "n-4",
    type: "approved",
    message: "Task completed and approved",
    work_title: "File GST return for the quarter",
    sender_name: "Anita Desai",
    read: true,
    entity_type: "task",
    entity_id: "t-4",
    created_at: iso(900),
  },
];

const INBOX_ITEMS = [
  { id: "i-1", source: "whatsapp", classification: "invoice", title: "Invoice #4471 — Velan Traders", ref_type: "invoice", ref_id: "inv-1", status: "open", created_at: iso(20) },
  { id: "i-2", source: "voice", classification: "task", title: "Tell Karthik to check loom 3 vibration", ref_type: "task", ref_id: "t-3", status: "open", created_at: iso(65) },
  { id: "i-3", source: "upload", classification: "payment", title: "Payment received — ₹1,80,000", ref_type: "payment", ref_id: "p-1", status: "open", created_at: iso(150) },
  { id: "i-4", source: "whatsapp", classification: "complaint", title: "Colour mismatch on batch B-221", ref_type: "complaint", ref_id: "c-1", status: "open", created_at: iso(400) },
];

const CONTACTS = [
  { id: "c-1", type: "customer", name: "Velan Traders", company: "Velan Traders", phone: "+91 98765 43210", email: "orders@velan.example", status: "active", tags: ["repeat"], outstanding: 240000 },
  { id: "c-2", type: "customer", name: "Kumaran Mills", company: "Kumaran Mills", phone: "+91 90000 11122", status: "active", outstanding: 420000 },
  { id: "c-3", type: "vendor", name: "Anand Dyeing Works", company: "Anand Dyeing", phone: "+91 91234 56789", status: "active", outstanding: 0 },
];

/** Counters differ per period so the CEO Brief swipe visibly changes data. */
const BRIEF = {
  morning: { delayed: 12, completed: 34, awaiting_approval: 5, absent: 0, complaints: 2, payment_overdue: 3, receivables_overdue: 4, bills_due: 2, unmatched_payments: 1, fires: 3 },
  evening: { delayed: 9, completed: 41, awaiting_approval: 3, absent: 1, complaints: 2, payment_overdue: 3, receivables_overdue: 4, bills_due: 2, unmatched_payments: 0, fires: 2 },
  weekly: { delayed: 27, completed: 168, awaiting_approval: 11, absent: 4, complaints: 6, payment_overdue: 7, receivables_overdue: 9, bills_due: 5, unmatched_payments: 3, fires: 5 },
  monthly: { delayed: 64, completed: 712, awaiting_approval: 18, absent: 12, complaints: 14, payment_overdue: 12, receivables_overdue: 15, bills_due: 9, unmatched_payments: 6, fires: 8 },
};

const BRIEF_DETAIL_ITEMS = {
  delayed: [
    { id: "t-1", kind: "task", title: "Send revised quotation to Velan Traders", subtitle: "Priya Raman · 1 day overdue", meta: "high" },
    { id: "t-2", kind: "task", title: "Chase pending payment — Kumaran Mills", subtitle: "Anita Desai · due today", meta: "high" },
  ],
  awaiting_approval: [
    { id: "d-1", kind: "decision", title: "No dispatch without advance for new customers", subtitle: "Raised by you · voice", meta: "2 tasks blocked" },
  ],
  complaints: [
    { id: "c-1", kind: "complaint", title: "Colour mismatch on batch B-221", subtitle: "Velan Traders", meta: "high", customer_id: "c-1" },
  ],
  receivables_overdue: [
    { id: "r-1", kind: "receivable", title: "Kumaran Mills — invoice #4402", subtitle: "38 days overdue", meta: 420000 },
    { id: "r-2", kind: "receivable", title: "Velan Traders — invoice #4471", subtitle: "12 days overdue", meta: 240000 },
  ],
  fires: [
    { id: "t-2", kind: "task", title: "Chase pending payment — Kumaran Mills", subtitle: "₹4,20,000 · 38 days overdue", meta: "high" },
    { id: "d-1", kind: "decision", title: "No dispatch without advance for new customers", subtitle: "Blocking 2 tasks", meta: "awaiting you" },
  ],
};

const FINANCE_AMOUNTS = { receivables_overdue: 660000, bills_due: 315000, unmatched_payments: 180000 };

/* -------------------------------------------------------------------------- */

/**
 * Fallback for endpoints without a fixture.
 *
 * Pages consume responses in two shapes — bare arrays (`/tasks`, `/users`)
 * and wrappers (`{ items }`, `{ notifications }`). An array carrying those
 * keys as properties satisfies both, so an unmapped endpoint degrades into an
 * empty state instead of a crash.
 */
function emptyish() {
  const arr = [];
  Object.assign(arr, {
    items: [],
    notifications: [],
    tasks: [],
    contacts: [],
    results: [],
    documents: [],
    counts: {},
    counters: {},
    unread: 0,
    count: 0,
    open_total: 0,
    total: 0,
  });
  return arr;
}

const ROUTES = [
  [/^\/auth\/me$/, () => ({ user: USER, tenant: TENANT })],
  [/^\/auth\/(login|register)$/, () => ({ user: USER, tenant: TENANT })],
  [/^\/auth\/otp\/verify$/, () => ({ user: USER, tenant: TENANT })],
  [/^\/notifications$/, () => ({ notifications: NOTIFICATIONS, unread: NOTIFICATIONS.filter((n) => !n.read).length })],
  [/^\/captures\/pending-count$/, () => ({ count: 7 })],
  [
    /^\/brief$/,
    (_m, q) => ({
      counters: BRIEF[q.get("period") || "morning"] || BRIEF.morning,
      finance_amounts: FINANCE_AMOUNTS,
      completed_label: "completed today",
    }),
  ],
  [/^\/brief\/details$/, (_m, q) => ({ items: BRIEF_DETAIL_ITEMS[q.get("key")] || [] })],
  [/^\/tasks$/, () => TASKS],
  [/^\/tasks\/([\w-]+)$/, (m) => TASKS.find((t) => t.id === m[1]) || TASKS[0]],
  [/^\/decisions$/, () => DECISIONS],
  [/^\/decisions\/([\w-]+)$/, (m) => ({ ...(DECISIONS.find((d) => d.id === m[1]) || DECISIONS[0]), timeline: [] })],
  [/^\/users$/, () => MEMBERS],
  [/^\/contacts$/, () => CONTACTS],
  [/^\/inbox$/, () => ({ items: INBOX_ITEMS, counts: { invoice: 1, task: 1, payment: 1, complaint: 1 }, open_total: INBOX_ITEMS.length })],
  [/^\/voice-notes$/, () => []],
];

/** Resolves a demo payload for a request path, or null when unmapped. */
function lookup(path, search) {
  const q = new URLSearchParams(search || "");
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) return fn(m, q);
  }
  return null;
}

/**
 * Axios adapter. Reads resolve from the fixtures above; writes acknowledge
 * so buttons stay responsive without pretending anything persisted.
 */
export function demoAdapter(config) {
  const raw = config.url || "";
  const [rawPath, search] = raw.split("?");
  const path = rawPath.replace(/^.*\/api/, "").replace(/\/$/, "") || "/";
  const method = (config.method || "get").toLowerCase();

  const body =
    method === "get"
      ? lookup(path, search) ?? emptyish()
      : lookup(path, search) ?? { ok: true, demo: true };

  return new Promise((resolve) => {
    // A touch of latency so skeletons and pull-to-refresh are actually visible.
    setTimeout(
      () =>
        resolve({
          data: body,
          status: 200,
          statusText: "OK",
          headers: {},
          config,
          request: {},
        }),
      160
    );
  });
}
