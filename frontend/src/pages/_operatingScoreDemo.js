// Epic 7 Sprint 1 batch 3 -- DEMO DATA for the OperatingScore redesign.
//
// Everything the redesigned UI consumes that the backend doesn't return YET
// lives here as static data. Wire order at backend time:
//   1. demoTrend       -> GET /api/operating-score-history?days=30
//   2. demoDelta       -> compute from history (this_week - last_week)
//   3. demoDrivers     -> derive from per-category breakdowns
//   4. demoDex         -> POST /api/ai/operating-score-explain
//   5. demoActions     -> derive from stats (top 3 leverage points)
//   6. demoEmpDeltas   -> derive from employee history snapshots
//
// Nothing here is user-specific -- the demo shape is chosen to look
// realistic against Kapoor's actual company stats so an owner viewing
// the page sees consistent numbers.

// KR-8 — THE QUARANTINE FLAG (approved plan). Every surviving piece of this
// file renders ONLY when the signed-in tenant is the demo tenant it was
// written for; real tenants get honest fallbacks (usually: the element is
// absent). One predicate, so post-demo removal is a single grep for
// isDemoTenant.
export const isDemoTenant = (tenant) => /kapoor/i.test(tenant?.name || "");

// ----- 30-day trend (used for hero sparkline) -----
// One entry per day, oldest first. Values 0-100.
export const demoTrend = [
  62, 63, 65, 64, 66, 68, 70, 71, 69, 68,
  70, 71, 73, 74, 72, 71, 73, 75, 76, 74,
  73, 72, 71, 70, 71, 73, 74, 75, 76, 76,
];

// ----- Week-over-week delta chip -----
// Positive = up from last week; null = no comparison yet.
export const demoDelta = { value: 4, sign: "up", period: "vs last week" };

// ----- Per-category drivers (shown inside category cards + drill modals) -----
// Format: [{ label, value, tone: "good" | "warn" | "bad" | "neutral" }]
export const demoDrivers = {
  execution: [
    { label: "Tasks done on time this week", value: "14", tone: "good" },
    { label: "Overdue right now", value: "2", tone: "warn" },
    { label: "Avg time to close", value: "3.2d", tone: "neutral" },
  ],
  finance: [
    { label: "Collection rate this month", value: "78%", tone: "good" },
    { label: "Overdue invoices", value: "5", tone: "warn" },
    { label: "Outstanding", value: "₹4.2L", tone: "bad" },
  ],
  sales: [
    { label: "Decisions raised", value: "12", tone: "neutral" },
    { label: "Approved", value: "6", tone: "good" },
    { label: "Waiting on you", value: "4", tone: "warn" },
  ],
  responsiveness: [
    { label: "Open complaints", value: "3", tone: "bad" },
    { label: "Oldest unresolved", value: "9d", tone: "bad" },
    { label: "Avg response time", value: "4h", tone: "good" },
  ],
};

// ----- Drill-down lists (opened from category cards) -----
// Real backend would return these from /api/tasks, /api/invoices, etc.
export const demoDrilldowns = {
  execution: {
    title: "Execution -- what drove your 72",
    hero: "14 done on time, 2 overdue, 8 in progress",
    items: [
      { title: "Ship Krishna Garments order", meta: "OVERDUE 2d · Priya", tone: "bad" },
      { title: "Reconcile Q1 GST input credit", meta: "OVERDUE 1d · Sunita", tone: "bad" },
      { title: "Approve cotton blend rate card", meta: "in progress · Rajesh", tone: "neutral" },
      { title: "Update reorder inventory list", meta: "in progress · Amit", tone: "neutral" },
      { title: "Send July closing report", meta: "done · yesterday · Sunita", tone: "good" },
    ],
    action: { label: "See all overdue in My Work", to: "/my-work?filter=overdue" },
  },
  finance: {
    title: "Finance -- what drove your 62",
    hero: "78% collected, ₹4.2L outstanding across 5 counterparties",
    items: [
      { title: "Krishna Garments -- SBT/25-26/0412", meta: "₹4,00,000 · 45d overdue", tone: "bad" },
      { title: "Anand Fabrics -- SBT/25-26/0431", meta: "₹2,85,000 · 12d overdue", tone: "bad" },
      { title: "Reliance Trends -- SBT/25-26/0428", meta: "₹1,80,000 · 5d overdue", tone: "warn" },
      { title: "Bombay Silks -- paid", meta: "₹3,20,000 · yesterday", tone: "good" },
      { title: "Sanjay Traders -- paid", meta: "₹1,50,000 · 2d ago", tone: "good" },
    ],
    action: { label: "Open Finance", to: "/finance" },
  },
  sales: {
    title: "Sales -- what drove your 50",
    hero: "12 decisions raised, 6 approved, 4 waiting on you",
    items: [
      { title: "Accept 45-day credit terms for Reliance", meta: "waiting · 5d", tone: "warn" },
      { title: "New line: silk-cotton blends", meta: "waiting · 3d", tone: "warn" },
      { title: "Confirm Bombay Silks reorder", meta: "approved · yesterday", tone: "good" },
      { title: "Delhi Retail bulk quote", meta: "approved · 2d ago", tone: "good" },
      { title: "Discount for Krishna 30-day payment", meta: "dropped · 4d ago", tone: "neutral" },
    ],
    action: { label: "See decisions on Desk", to: "/inbox" },
  },
  responsiveness: {
    title: "Responsiveness -- what drove your 25",
    hero: "3 open complaints, oldest 9 days -- clear these first",
    items: [
      { title: "Krishna Garments -- damaged shipment", meta: "9d open · unassigned", tone: "bad" },
      { title: "Anand Fabrics -- wrong colour lot", meta: "5d open · Amit", tone: "bad" },
      { title: "Bombay Silks -- late delivery", meta: "2d open · Amit", tone: "warn" },
      { title: "Reliance Trends -- billing dispute", meta: "resolved · yesterday", tone: "good" },
    ],
    action: { label: "See all complaints", to: "/crm?filter=complaints" },
  },
};

// ----- Dex-generated narrative + explainer (canned for demo) -----
// One-sentence hero narrative + a longer explainer for the Dex card.
export const demoDex = {
  headline: "Kapoor Retail is running at 76/100 this week -- up 4, driven by faster complaint clearance after Priya cleared two big ones on Wednesday.",
  explainer: "Your weakest signal this week is Responsiveness at 25 -- 3 complaints are open, one for 9 days. Clearing those two lifts your overall score by an estimated 6 points by Friday. Second focus: Sales at 50 -- 4 decisions are waiting for your approval.",
  focus: "Responsiveness",
};

// ----- Suggested action chips (top 3 leverage points for the owner) -----
// Each chip = a one-tap route into the surface that fixes the biggest lever.
// Real backend derives these from stats + AI ranking. Demo picks by hand.
export const demoActions = [
  { label: "Resolve 3 open complaints", to: "/crm?filter=complaints", icon: "flame", lift: "+6" },
  { label: "Chase 5 overdue invoices", to: "/finance?filter=overdue", icon: "money", lift: "+4" },
  { label: "Approve 4 waiting decisions", to: "/inbox?filter=needs_decision", icon: "check", lift: "+3" },
];

// ----- Employee deltas (leaderboard) -----
// Keyed by user id or role -- lookup at render. Real backend derives from
// per-employee history snapshots.
export const demoEmpDeltas = {
  // by role (works for Kapoor's demo tenant)
  finance: 5,
  operations: -3,
  owner: 0,
  sales: 2,
};

// ----- Category weight defaults + presets (Sprint 1 U7-01.17) -----
// Owner can shift weights; frontend stores locally for now, backend later
// persists to tenant.operating_score_weights.
export const DEFAULT_WEIGHTS = { execution: 35, finance: 25, sales: 20, responsiveness: 20 };
export const WEIGHT_PRESETS = {
  balanced: { label: "Balanced (default)", weights: DEFAULT_WEIGHTS },
  manufacturer: { label: "Manufacturer", weights: { execution: 45, finance: 25, sales: 15, responsiveness: 15 } },
  services: { label: "Services", weights: { execution: 25, finance: 20, sales: 20, responsiveness: 35 } },
  distributor: { label: "Distributor", weights: { execution: 30, finance: 40, sales: 20, responsiveness: 10 } },
};
