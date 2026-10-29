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

/* 2026-10-29 (founder) — THE COMPANY'S OWN YEAR, AND IT ROLLS OVER BY ITSELF.
   "Last 30 days" was the default, and a period counts a record by the date
   written on it: an invoice entered today but dated in July moved nothing, and
   the client read that as "it doesn't save". Now:
   - The default is the current financial year, worked out from today and the
     company's start month (Settings › Company › Financial year starts in;
     April when unset). Nothing is hard-coded: on 1 April 2027 it is FY 2027–28.
   - A pick names its year: "q4:2026" is Q4 of FY 2026–27 for good, so a choice
     made in December still means that quarter in May. Only "fy" (and 30d /
     all) is relative — "this year", whatever year it is.
   - Any year's halves and quarters can be picked, back to the oldest record, so
     on 1 April the year that just closed is one tap away.
   - Labels are the standard ones: "FY 2026–27", "Q2 FY 2026–27" ("FY 2026" for
     a January year). A window still running compares with the same point of
     the one before; a finished one with the whole of the one before. */
const PERIOD_VALUE = /^(fy|30d|all|(fy|q[1-4]|h[12]):\d{4}|custom:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2})$/;
// Choices saved by earlier versions still open (relative to the current year).
const LEGACY = /^(fy-1|q[1-4]|h[12]|half|quarter|90d|365d)$/;
export const PERIODS = [{ value: "fy", label: "Financial year" }];   // [0] is the default
export const periodOf = (value) => ({ value: PERIOD_VALUE.test(String(value)) || LEGACY.test(String(value)) ? String(value) : "fy" });
export const customPeriod = (from, to) => `custom:${from}:${to}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fyStartOf = (m) => (Number.isInteger(Number(m)) && Number(m) >= 1 && Number(m) <= 12 ? Number(m) : 4);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayYmd = (now = Date.now()) => ymd(new Date(now));

/** The calendar year the financial year containing `t` started in. */
export function fyYearOf(t, fyStartMonth) {
  const fy = fyStartOf(fyStartMonth);
  const d = new Date(t);
  return d.getMonth() + 1 >= fy ? d.getFullYear() : d.getFullYear() - 1;
}

/** "FY 2026–27", or "FY 2026" when the year starts in January. */
export function fyLabel(year, fyStartMonth) {
  return fyStartOf(fyStartMonth) === 1 ? `FY ${year}` : `FY ${year}–${String(year + 1).slice(2)}`;
}

/** "1 Jul – 30 Sep 2026"; years on both ends when they differ. */
export function dateRange(a, b) {
  const s = new Date(a), e = new Date(b);
  return s.getFullYear() === e.getFullYear()
    ? `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`
    : `${s.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
}

/** Old relative values ("q3", "half", "fy-1"…) as the year-stamped value they meant. */
function canonical(value, fy, now) {
  const cur = fyYearOf(now, fy);
  const into = (() => {
    const d = new Date(now), s = new Date(cur, fy - 1, 1);
    return (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
  })();
  if (value === "fy-1") return `fy:${cur - 1}`;
  if (value === "half") return `h${Math.floor(into / 6) + 1}:${cur}`;
  if (value === "quarter") return `q${Math.floor(into / 3) + 1}:${cur}`;
  if (/^[qh][1-4]$/.test(value)) return `${value}:${cur}`;
  if (value === "90d" || value === "365d") return "fy";
  return PERIOD_VALUE.test(value) ? value : "fy";
}

/** The window a period covers for a company whose year starts in `fyStartMonth`
 *  (1-12): {value, kind, year, label, range, months, start, end, prevStart,
 *  prevEnd, prevLabel, windowed, running, future, points}. Times are ms. */
export function periodWindow(period, fyStartMonth, now = Date.now()) {
  const fy = fyStartOf(fyStartMonth);
  const value = canonical(String(typeof period === "string" ? period : period?.value || "fy"), fy, now);

  if (value === "all") return { value, kind: "all", label: "All time", windowed: false, prevLabel: "", points: 12 };
  if (value === "30d") {
    const start = now - 30 * DAY;
    return { value, kind: "30d", label: "Last 30 days", range: dateRange(start, now), windowed: true, running: true,
      start, end: now, prevStart: start - 30 * DAY, prevEnd: start, prevLabel: "the previous 30 days", points: 15 };
  }
  if (value.startsWith("custom:")) {
    const [, a, b] = value.split(":");
    const [from, to] = a <= b ? [a, b] : [b, a];
    const start = new Date(`${from}T00:00:00`).getTime();
    const end = Math.min(new Date(`${to}T23:59:59.999`).getTime(), Math.max(now, start));
    const span = Math.max(end - start, DAY);
    return { value, kind: "custom", label: dateRange(start, end), range: dateRange(start, end), windowed: true,
      running: false, from, to, start, end, prevStart: start - span, prevEnd: start,
      prevLabel: "the same length of time before", points: span > 120 * DAY ? 12 : 13 };
  }
  // A financial year, or one of its halves or quarters.
  const [head, y] = value.split(":");
  const year = y ? Number(y) : fyYearOf(now, fy);      // "fy" alone = the current year
  const fyStart = new Date(year, fy - 1, 1);
  const kind = head === "fy" ? "fy" : head[0] === "q" ? "quarter" : "half";
  const months = kind === "fy" ? 12 : kind === "half" ? 6 : 3;
  const n = kind === "fy" ? 1 : Number(head[1]);
  const start = addMonths(fyStart, (n - 1) * months);
  const fullEnd = addMonths(start, months).getTime();
  const running = start.getTime() <= now && now < fullEnd;
  const future = start.getTime() > now;
  const end = running ? now : fullEnd;
  const prevStart = addMonths(start, -months).getTime();
  const what = kind === "fy" ? "year" : kind;
  return {
    value, kind, year, label: kind === "fy" ? fyLabel(year, fy) : `${head.toUpperCase()} ${fyLabel(year, fy)}`,
    range: dateRange(start.getTime(), fullEnd - 1),
    months: `${MONTHS[start.getMonth()]}–${MONTHS[addMonths(start, months - 1).getMonth()]}`,
    windowed: true, running, future,
    start: start.getTime(), end, prevStart, prevEnd: running ? prevStart + (now - start.getTime()) : start.getTime(),
    prevLabel: running ? `the same point last ${what}` : `the ${what} before`, points: kind === "quarter" ? 13 : 12,
  };
}

/** The value for a financial year: "fy" for the current one (it follows the
 *  calendar), "fy:YYYY" for any other. */
export const fyValue = (year, fyStartMonth, now = Date.now()) => (year === fyYearOf(now, fyStartMonth) ? "fy" : `fy:${year}`);

/** What the picker offers for a company: the years it can step through
 *  (newest first, back to the oldest record, at least last year), and for a
 *  year its halves and quarters (the ones that haven't started marked `future`). */
export function periodChoices(fyStartMonth, earliest, now = Date.now()) {
  const cur = fyYearOf(now, fyStartMonth);
  const first = Math.min(cur - 1, earliest != null && Number.isFinite(earliest) ? fyYearOf(earliest, fyStartMonth) : cur - 1);
  const years = [];
  for (let y = cur; y >= Math.max(first, cur - 20); y -= 1) years.push(y);
  const w = (v) => periodWindow(v, fyStartMonth, now);
  return {
    years,
    current: cur,
    fy: years.map((y) => w(fyValue(y, fyStartMonth, now))),
    half: (y) => [w(`h1:${y}`), w(`h2:${y}`)],
    quarter: (y) => [w(`q1:${y}`), w(`q2:${y}`), w(`q3:${y}`), w(`q4:${y}`)],
  };
}

/** The oldest dated record on the page (for how far back the picker goes). */
export function oldestRecord(...lists) {
  let min = null;
  lists.flat().forEach((r) => {
    const t = timeOf(r?.date, r?.purchase_date, r?.created_at);
    if (t != null && (min == null || t < min)) min = t;
  });
  return min;
}

const DAY = 86400000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

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
/* R10-33 — matched on WORDS, not on an exact name. Every company's categories
   are generated for it at sign-up, and the generator's own name for this one is
   "Raw Materials" — plural — so an exact-string set never fired on a real
   tenant. Narrower than "contains the word material" on purpose: "Packaging
   Materials" is the cost of running the place, and taking it out of profit
   would flatter it. Same rule as the server's _is_stock_category. */
const STOCK_WORDS = new Set(["stock", "inventory", "goods", "trading"]);
const STOCK_ALONE = new Set(["material", "materials", "purchase", "purchases", "raw"]);
const CAPITAL_CATEGORIES = new Set(["asset purchase", "asset purchases", "capital expenditure", "capex"]);
const isStockCategory = (c) => {
  const words = String(c || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return false;
  if (words.includes("raw")) return true;
  if (words.some((w) => STOCK_WORDS.has(w))) return true;
  return words.length === 1 && STOCK_ALONE.has(words[0]);
};
const isStockOrCapital = (c) =>
  isStockCategory(c) || CAPITAL_CATEGORIES.has(String(c || "").trim().toLowerCase());
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

/** An invoice's / payment's amount in the company's currency, or null when it
 *  is in another currency with no exchange rate yet. Rows from an older server
 *  carry no amount_base: they are taken at face value, as before. */
export const baseOf = (d) => (d && "amount_base" in d ? (d.amount_base == null ? null : num(d.amount_base)) : num(d?.amount));

export function financeMetrics({ summary, revenue, expenses, assets, inventory, period, fyStartMonth, now = Date.now() }) {
  const p = periodWindow(period, fyStartMonth, now);
  const rows = {
    /* Audit 2026-10-08 — in the company's currency. An export invoice of
       GBP 160 was counted as Rs 160; the server now sends amount_base (null
       when no exchange rate has been given yet, and then it is left out). */
    billed: (revenue?.invoices || []).filter((i) => baseOf(i) != null)
      .map((i) => ({ t: timeOf(i.date, i.created_at), v: baseOf(i) })),
    received: (revenue?.payments || []).filter((x) => baseOf(x) != null)
      .map((x) => ({ t: timeOf(x.date, x.created_at), v: baseOf(x) })),
    // Audit 2026-10-08 — in the company's currency; a bill in another
    // currency with no exchange rate yet is left out, never added at face value.
    spend: (expenses || []).filter((e) => baseOf(e) != null).map((e) => ({
      t: timeOf(e.date, e.created_at), v: baseOf(e),
      category: categoryName(e.category), vendor: vendorName(e.vendor_name),
      // J2-06: whether this one is the cost of RUNNING the place, or stock
      // and equipment — money out, but not money gone. Same rule as the
      // server's _spend_split, so a period on this page and the all-time
      // figure from /ledger/summary cannot tell different stories.
      operating: !isStockOrCapital(e.category),
    })),
    assets: (assets || []).map((a) => ({ t: timeOf(a.purchase_date, a.created_at), v: num(a.purchase_amount) })),
    stock: (inventory || []).map((i) => ({ t: timeOf(i.created_at), v: num(i.value) })),
    // Audit F-04 (2026-10-08): stock USED — the cost of what was sold.
    stockUsed: (summary?.stock_used || []).map((u) => ({ t: timeOf(u.date), v: num(u.value) })),
  };
  const tt = summary?.totals || {};
  const windowed = p.windowed;
  // "All time" still draws a trend: the last 12 months.
  // A finished quarter / half / year ends where it ended, not today.
  const end = windowed ? p.end : now;
  const start = windowed ? p.start : end - 365 * DAY;
  const prevStart = windowed ? p.prevStart : start - 365 * DAY;
  const prevEnd = windowed ? p.prevEnd : start;   // the same point of the window before
  const points = p.points;
  // A window a day old still draws: at least one day per trend step.
  const step = Math.max((end - start) / points, DAY / points);
  const edges = Array.from({ length: points }, (_, i) => [start + i * step, start + (i + 1) * step]);
  const flowTrend = (list) => edges.map(([a, b]) => sumIn(list, a, b));
  const balanceTrend = (list) => edges.map(([, b]) => balanceAt(list, b));

  const flow = (list, allTime) => {
    if (!windowed) return { value: allTime ?? sumAll(list), change: null, trend: flowTrend(list) };
    const cur = sumIn(list, start, end);
    return { value: cur, change: change(cur, sumIn(list, prevStart, prevEnd)), trend: flowTrend(list) };
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
  /* Audit F-04 (2026-10-08) — AND THE COST OF WHAT WAS SOLD. J2-06 is right
     that stock BOUGHT is not a loss; but a sale of shirts made from yarn cost
     the yarn, and profit read the whole sale because nothing recorded the yarn
     being used. Stock used (Inventory › Use) is that cost, and it comes off. */
  const used = flow(rows.stockUsed, tt.stock_used);
  const netNow = billed.value - operating.value - used.value;
  const net = {
    value: windowed ? netNow : (tt.net_profit ?? netNow),
    change: windowed
      ? change(netNow, sumIn(rows.billed, prevStart, prevEnd) - sumIn(operatingRows, prevStart, prevEnd)
        - sumIn(rows.stockUsed, prevStart, prevEnd))
      : null,
    trend: billed.trend.map((v, i) => v - operating.trend[i] - used.trend[i]),
    stockUsed: used.value,
  };
  const balance = (list, total) => ({
    // A finished quarter / half / year shows what it stood at when it ended.
    value: windowed && !p.running ? balanceAt(list, end) : (total ?? balanceAt(list, Infinity)),
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
