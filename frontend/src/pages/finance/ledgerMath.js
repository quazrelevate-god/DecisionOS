// Finance — the period, change and trend arithmetic behind the Overview
// (2026-09-14, founder's Finance reference).
//
// The reference draws a "Last 30 days" picker, a "+12%" on every tile and a
// sparkline under it. /ledger/summary answers none of that: it is all-time
// totals with no window and no history. The page already loads the dated
// records themselves, though (/revenue invoices and payments, /expenses,
// /assets, /inventory), so a window can be plain arithmetic over real rows:
//
//   * "All time" keeps the server's exact totals from /ledger/summary.
//   * A window sums the rows dated inside it; its change compares the window
//     of the same length just before it. Nothing in either says nothing,
//     rather than "0%".
//   * Asset and inventory value are balances, not flows. The tile shows
//     today's total, the change is the movement since the window opened, and
//     the trend is the running total.
//   * The lists are capped (LIST_LIMIT newest by created_at for expenses,
//     assets and inventory; 3,000 each on /revenue). A list at its cap is
//     reported as `truncated` so the page can say a window may be incomplete.
//
// Dates: a row's own date (invoice / payment / expense `date`, asset
// `purchase_date`), falling back to created_at. Inventory only has
// created_at. "YYYY-MM-DD" is read as local midnight, not UTC midnight.

export const LIST_LIMIT = 2000;
export const REVENUE_LIST_CAP = 3000;

// U7-08.1: an awaiting invoice older than this is overdue (Net 30). The
// Revenue tab's filter and the brief's "Oldest overdue" share this rule.
export const REVENUE_OVERDUE_DAYS = 30;

export const PERIODS = [
  { value: "30d", label: "Last 30 days", days: 30, prevLabel: "the previous 30 days" },
  { value: "90d", label: "Last 90 days", days: 90, prevLabel: "the previous 90 days" },
  { value: "365d", label: "Last 12 months", days: 365, prevLabel: "the previous 12 months" },
  { value: "all", label: "All time", days: null, prevLabel: "" },
];
export const periodOf = (value) => PERIODS.find((p) => p.value === value) || PERIODS[0];

const DAY = 86400000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// Trend points per window: every 2 days, weekly-ish, monthly-ish.
const TREND_POINTS = { 30: 15, 90: 13, 365: 12 };

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function timeOf(...candidates) {
  for (const v of candidates) {
    if (!v) continue;
    const s = String(v);
    const t = YMD.test(s) ? new Date(`${s}T00:00:00`).getTime() : new Date(s).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export function daysSince(iso, now = Date.now()) {
  const t = timeOf(iso);
  if (t == null) return null;
  const d = Math.floor((now - t) / DAY);
  return d < 0 ? null : d;
}

/* JOURNEY-1 J3 / J7 — ONE RULE FOR OVERDUE, AND IT IS THE SERVER'S.
   This counted "raised more than 30 days ago" and ignored the due date, while
   the Desk's "To collect (overdue)" — the tile that opens this page — counted
   "a week or more past the due date". Same company, same minute: ₹6.8L on the
   tile, ₹4L here. Each invoice now carries the server's answer (GET /revenue:
   `overdue`, `days_past_due`, services/finance_signals.receivable_overdue);
   the old reading stays only for an answer that predates it. */
export const isInvoiceOverdue = (inv, now = Date.now()) =>
  typeof inv.overdue === "boolean"
    ? inv.overdue
    : inv.status !== "paid" && (daysSince(inv.date, now) || 0) > REVENUE_OVERDUE_DAYS;

/** Days an overdue invoice is past its due date (the old reading: since it was raised). */
export const overdueDays = (inv, now = Date.now()) =>
  inv.days_past_due != null ? inv.days_past_due : daysSince(inv.date, now);

const categoryName = (c) => String(c || "").trim() || "Uncategorized";

/* J2-06 — the categories that are money OUT but not money GONE: stock bought
   to sell, and equipment bought to work with. The same two sets the server
   splits on (routers/ledger._STOCK_CATEGORIES / _CAPITAL_CATEGORIES); they are
   written here as well rather than fetched, because this math runs on every
   keystroke of a period change and one wrong-footed round trip would put the
   page and the tile below it into an argument. */
const STOCK_CATEGORIES = new Set(["raw material", "stock", "inventory", "goods", "purchases", "trading goods"]);
const CAPITAL_CATEGORIES = new Set(["asset purchase"]);
const isStockOrCapital = (c) => {
  const k = String(c || "").trim().toLowerCase();
  return STOCK_CATEGORIES.has(k) || CAPITAL_CATEGORIES.has(k);
};
const vendorName = (v) => String(v || "").trim() || "Unspecified";

const inside = (t, a, b) => t != null && t > a && t <= b;
const sumIn = (rows, a, b) => rows.reduce((s, r) => (inside(r.t, a, b) ? s + r.v : s), 0);
// A balance at time b: every row dated on or before b, plus undated rows
// (they exist; we only don't know since when).
const balanceAt = (rows, b) => rows.reduce((s, r) => (r.t == null || r.t <= b ? s + r.v : s), 0);
const sumAll = (rows) => rows.reduce((s, r) => s + r.v, 0);

function group(rows, key) {
  const m = new Map();
  rows.forEach((r) => m.set(r[key], (m.get(r[key]) || 0) + r.v));
  return [...m.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** {pct, direction} against the previous value, {fresh} when there was none. */
export function change(cur, prev) {
  if (!cur && !prev) return null;
  if (!prev) return { fresh: true, direction: cur > 0 ? "up" : "down" };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export function financeMetrics({ summary, revenue, expenses, assets, inventory, period, now = Date.now() }) {
  const p = periodOf(period);
  const rows = {
    billed: (revenue?.invoices || []).map((i) => ({ t: timeOf(i.date, i.created_at), v: num(i.amount) })),
    received: (revenue?.payments || []).map((x) => ({ t: timeOf(x.date, x.created_at), v: num(x.amount) })),
    spend: (expenses || []).map((e) => ({
      t: timeOf(e.date, e.created_at), v: num(e.amount),
      category: categoryName(e.category), vendor: vendorName(e.vendor_name),
      // J2-06: whether this one is the cost of RUNNING the place, or stock
      // and equipment — money out, but not money gone. Same rule as the
      // server's _spend_split, so a period on this page and the all-time
      // figure from /ledger/summary cannot tell different stories.
      operating: !isStockOrCapital(e.category),
    })),
    assets: (assets || []).map((a) => ({ t: timeOf(a.purchase_date, a.created_at), v: num(a.purchase_amount) })),
    stock: (inventory || []).map((i) => ({ t: timeOf(i.created_at), v: num(i.value) })),
  };
  const tt = summary?.totals || {};
  const windowed = Boolean(p.days);
  // "All time" still draws a trend: the last 12 months.
  const span = (p.days || 365) * DAY;
  const end = now;
  const start = end - span;
  const prevStart = start - span;
  const points = TREND_POINTS[p.days || 365];
  const step = span / points;
  const edges = Array.from({ length: points }, (_, i) => [start + i * step, start + (i + 1) * step]);
  const flowTrend = (list) => edges.map(([a, b]) => sumIn(list, a, b));
  const balanceTrend = (list) => edges.map(([, b]) => balanceAt(list, b));

  const flow = (list, allTime) => {
    if (!windowed) return { value: allTime ?? sumAll(list), change: null, trend: flowTrend(list) };
    const cur = sumIn(list, start, end);
    return { value: cur, change: change(cur, sumIn(list, prevStart, start)), trend: flowTrend(list) };
  };
  const billed = flow(rows.billed, tt.revenue_billed);
  const received = flow(rows.received, tt.revenue_received);
  const spend = flow(rows.spend, tt.total_spend);
  /* J2-06 (JOURNEY-1, founder 24 Sep) — PROFIT IS REVENUE MINUS WHAT IT COSTS
     TO RUN THE PLACE. A wholesaler's first act is buying stock to sell; under
     "revenue minus everything spent" her profit read minus the whole purchase,
     in red, on day one. She had not lost anything — she had turned cash into
     stock in the godown. Stock and equipment are still counted and still
     shown, as Spend and as their own tiles; they are simply not a loss. */
  const operatingRows = rows.spend.filter((r) => r.operating);
  const operating = flow(operatingRows, tt.operating_spend);
  const netNow = billed.value - operating.value;
  const net = {
    value: windowed ? netNow : (tt.net_profit ?? netNow),
    change: windowed
      ? change(netNow, sumIn(rows.billed, prevStart, start) - sumIn(operatingRows, prevStart, start))
      : null,
    trend: billed.trend.map((v, i) => v - operating.trend[i]),
  };
  const balance = (list, total) => ({
    value: total ?? balanceAt(list, Infinity),
    change: windowed ? change(balanceAt(list, end), balanceAt(list, start)) : null,
    trend: balanceTrend(list),
  });

  const allCategories = (summary?.by_category || [])
    .map((c) => ({ label: categoryName(c.category), amount: num(c.amount) }))
    .filter((c) => c.amount > 0);
  const inWindow = windowed ? rows.spend.filter((r) => inside(r.t, start, end)) : [];

  return {
    period: p,
    billed, received, net, spend,
    assets: balance(rows.assets, tt.asset_value),
    stock: balance(rows.stock, tt.inventory_value),
    allCategories,
    byCategory: windowed ? group(inWindow, "category") : allCategories,
    byVendor: (windowed
      ? group(inWindow, "vendor")
      : (summary?.by_vendor || []).map((v) => ({ label: vendorName(v.vendor), amount: num(v.amount) }))
    ).slice(0, 8),
    truncated:
      (expenses || []).length >= LIST_LIMIT
      || (assets || []).length >= LIST_LIMIT
      || (inventory || []).length >= LIST_LIMIT
      || (revenue?.invoices || []).length >= REVENUE_LIST_CAP
      || (revenue?.payments || []).length >= REVENUE_LIST_CAP,
  };
}

/** What the brief's banner states: outstanding receivables and the oldest overdue. */
/** JOURNEY-1 J2 — the newest entry in the books (invoice, payment or expense),
 *  as a time, so a brief written before it can say so. */
export function latestEntryAt(revenue, expenses) {
  let latest = 0;
  const see = (r) => {
    for (const k of ["updated_at", "created_at"]) {
      const t = Date.parse(r?.[k] || "");
      if (Number.isFinite(t) && t > latest) latest = t;
    }
  };
  (revenue?.invoices || []).forEach(see);
  (revenue?.payments || []).forEach(see);
  (expenses || []).forEach(see);
  return latest || null;
}

export function receivableFacts(revenue, summary, now = Date.now()) {
  const invoices = revenue?.invoices || [];
  const overdue = invoices.filter((i) => isInvoiceOverdue(i, now));
  return {
    outstanding: revenue?.totals?.outstanding ?? summary?.totals?.revenue_outstanding ?? 0,
    overdueCount: overdue.length,
    oldestOverdueDays: overdue.length ? Math.max(...overdue.map((i) => overdueDays(i, now) || 0)) : null,
  };
}

// Spend by category colours. The donut sorts slices by amount, so ANY two can
// touch — the palette is validated on every pair, not just neighbours (dataviz
// validator, light, card surface #f8f9f6, --pairs all). No five hues clear the
// all-pairs floors, so four are named and the rest fold into a grey "Other".
// These four pass lightness, chroma, contrast >= 3:1 and normal-vision
// separation (>= 15.8); their worst colour-vision pair (green/bronze, 6.8) sits
// in the floor band that is legal only with secondary encoding, which the 2px
// gaps and the labelled legend with amounts provide.
export const CATEGORY_COLORS = ["#2f7a4f", "#2a78d6", "#a67c2e", "#d9569a"];
export const OTHER_COLOR = "#9a9b95";

/**
 * Colour follows the category, never its rank in the current window: the
 * all-time top four own the four colours, so switching the period never
 * repaints a slice. Everything else folds into a grey "Other".
 */
export function categorySlices(rows, allTime) {
  const slot = new Map();
  const owners = (allTime && allTime.length ? allTime : rows || []).slice(0, CATEGORY_COLORS.length);
  owners.forEach((c, i) => slot.set(c.label, i));
  const named = [];
  let other = 0;
  (rows || []).forEach((r) => {
    if (slot.has(r.label)) named.push({ ...r, color: CATEGORY_COLORS[slot.get(r.label)] });
    else other += r.amount;
  });
  named.sort((a, b) => b.amount - a.amount);
  if (other > 0) named.push({ label: "Other", amount: other, color: OTHER_COLOR, other: true });
  return named;
}
