// MPWA-09 · /finance — mobile.
//
// Three things this page got wrong on a phone:
//   1. the six-tab strip clipped silently at the right edge (§5.2.1/§5.2.2)
//   2. the AI finance verdict — the single most useful string in the product —
//      sat BELOW a grid of KPI tiles, several of which read zero
//   3. Net Profit was computed as `revenue_billed - total_spend` with no guard,
//      so while spend was still resolving it displayed profit == revenue. §5.3:
//      "One wrong money figure costs more trust than ten missing features."
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Sparkle, CurrencyDollar, Receipt, Buildings, Package, Tray, TrendUp,
  TrendDown, Coins, ArrowClockwise, Camera, UploadSimple, WhatsappLogo,
  CheckCircle, CaretRight, Spinner,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr, inrCompact } from "../../lib/format";
import {
  BottomSheet, MobileCard, EmptyState, ListSkeleton, MoneySkeleton, StatusChip,
} from "../../components/mobile";
import { Verdict, Pulse, Grid, Strip } from "../../components/mobile/blocks";
import { useFocus, FocusView } from "../../components/mobile/FocusView";

const TABS = [
  { key: "overview", label: "Overview", icon: Sparkle },
  { key: "revenue", label: "Income", icon: CurrencyDollar },
  { key: "expenses", label: "Spending", icon: Receipt },
  { key: "assets", label: "Assets", icon: Buildings },
  { key: "inventory", label: "Stock", icon: Package },
  { key: "inbox", label: "Inbox", icon: Tray },
];

/**
 * A derived total is only safe to show once every input it depends on has
 * arrived. `num(x)` returns null for a missing input so the caller can render a
 * skeleton instead of a confident wrong number (§5.3).
 */
const val = (x) => (x === undefined || x === null || Number.isNaN(Number(x)) ? null : Number(x));
const derive = (fn, ...inputs) => (inputs.some((i) => val(i) === null) ? null : fn(...inputs.map(Number)));

function Figure({ amount, className = "", compact = false, testid }) {
  if (amount === null) return <MoneySkeleton data-testid={testid ? `${testid}-skeleton` : undefined} />;
  return (
    <span className={`tabular-nums ${className}`} data-testid={testid}>
      {compact ? inrCompact(amount) : inr(amount)}
    </span>
  );
}

export default function FinanceMobile() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview";
  const setTab = (key) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set("tab", key);
    return next;
  }, { replace: true });

  const [reclassifying, setReclassifying] = useState(false);
  const [detail, setDetail] = useState(null);
  const focus = useFocus();

  const summaryQ = useQuery({
    queryKey: ["ledger-summary"],
    queryFn: () => api.get("/ledger/summary").then((r) => r.data),
  });
  const aiQ = useQuery({
    queryKey: ["ledger-ai", tab === "overview" ? "brief" : tab],
    queryFn: () => api.get(`/ledger/ai/${tab === "overview" ? "brief" : tab}`).then((r) => r.data),
  });
  // §3's table for Money asks for a "received-this-week trend, up-arrow when
  // positive". /ledger/summary has no history, so the trend is built from the
  // invoices themselves — same queryKey the Income tab uses, so it is one cached
  // request rather than a second one for a sparkline.
  const invoicesQ = useQuery({
    queryKey: ["ledger", "revenue"],
    queryFn: () => api.get("/revenue").then((r) => r.data),
  });

  const totals = summaryQ.data?.totals || {};
  const received = val(totals.revenue_received);
  const outstanding = val(totals.revenue_outstanding);
  // The guarded version of the desktop calculation. Either input missing ->
  // null -> skeleton, so profit can never briefly equal revenue.
  const netProfit = val(totals.net_profit) ?? derive((r, s) => r - s, totals.revenue_billed, totals.total_spend);

  // Two 7-day series from the invoice ledger: money that came in, and money that
  // fell due and has not. Derived, not invented — every point is a row he could
  // open. Empty when there are no invoices, and the Pulse then shows the delta
  // chip alone rather than a flat line pretending to be data.
  const trends = useMemo(() => {
    const rows = invoicesQ.data?.invoices || (Array.isArray(invoicesQ.data) ? invoicesQ.data : []);
    if (!rows.length) return { received: [], outstanding: [], receivedDelta: null };
    const day = 86400000;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const bucket = (n) => {
      // n = days back from today; 0 is today.
      const from = midnight.getTime() - n * day;
      return { from, to: from + day };
    };
    const paidOn = (r) => {
      const raw = r.paid_at || r.updated_at || r.date;
      const t = raw ? new Date(raw).getTime() : NaN;
      return Number.isNaN(t) ? null : t;
    };
    const received = [];
    const outstanding = [];
    for (let i = 6; i >= 0; i--) {
      const { from, to } = bucket(i);
      received.push(
        rows.reduce((sum, r) => {
          const t = paidOn(r);
          const paid = Number(r.paid_amount) || 0;
          return t != null && paid > 0 && t >= from && t < to ? sum + paid : sum;
        }, 0)
      );
      outstanding.push(
        rows.reduce((sum, r) => {
          const due = r.due_date ? new Date(r.due_date).getTime() : NaN;
          const owed = (Number(r.amount) || 0) - (Number(r.paid_amount) || 0);
          return !Number.isNaN(due) && owed > 0 && due < to ? sum + owed : sum;
        }, 0)
      );
    }
    // Week on week, so the arrow means something.
    const thisWeek = received.reduce((a, b) => a + b, 0);
    const prior = rows.reduce((sum, r) => {
      const t = paidOn(r);
      const paid = Number(r.paid_amount) || 0;
      const from = midnight.getTime() - 14 * day;
      const to = midnight.getTime() - 7 * day;
      return t != null && paid > 0 && t >= from && t < to ? sum + paid : sum;
    }, 0);
    const receivedDelta = prior > 0 ? Math.round(((thisWeek - prior) / prior) * 100) : null;
    return { received, outstanding, receivedDelta };
  }, [invoicesQ.data]);

  const reclassify = async () => {
    setReclassifying(true);
    try {
      const { data } = await api.post("/ledger/reclassify-purchases");
      toast.success(data?.message || "Earlier bills rechecked");
      qc.invalidateQueries({ queryKey: ["ledger-summary"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not recheck those");
    } finally {
      setReclassifying(false);
    }
  };

  // §8: hide zeros. A KPI reading ₹0 spends a sixth of the viewport saying
  // nothing. `null` means still loading and DOES render (as a skeleton).
  const kpis = [
    { key: "revenue", label: "Billed", amount: val(totals.revenue_billed), icon: CurrencyDollar },
    { key: "spend", label: "Spent", amount: val(totals.total_spend), icon: TrendDown },
    { key: "profit", label: "Profit", amount: netProfit, icon: Coins },
    { key: "assets", label: "Asset value", amount: val(totals.asset_value), icon: Buildings },
    { key: "stock", label: "Stock value", amount: val(totals.inventory_value), icon: Package },
    { key: "unpaid", label: "Unpaid bills", amount: val(totals.outstanding), icon: Receipt },
  ].filter((k) => k.amount === null || k.amount !== 0);
  const kpiPeak = Math.max(...kpis.map((k) => Math.abs(k.amount || 0)), 0);
  const kpis2 = kpis.map((k) => ({
    ...k,
    id: k.key,
    share: kpiPeak > 0 && k.amount != null ? Math.min(1, Math.abs(k.amount) / kpiPeak) : null,
  }));

  return (
    <div data-testid="finance-mobile">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Money</h1>

      {/* MPWA-12g (§5.3): ONE row with a fade mask and a peeking sixth chip.
          MPWA-09 made it wrap, which fixed the silent clipping but "six chips
          wrapping to two rows eats 100px before any content". A Strip scrolls
          *visibly* — the mask and the half-shown next chip are what the old
          version was missing, not the wrapping. */}
      <Strip
        label="View"
        sticky
        data-testid="finance-tabs"
        items={TABS.map((tb) => ({
          key: tb.key,
          label: tb.label,
          icon: tb.icon,
          active: tab === tb.key,
          onSelect: () => setTab(tb.key),
        }))}
      />

      {/* §5.3's stratum 1 — the AI finance sentence as the Verdict. §8: it is
          "the most useful string in the product and is currently buried below
          the KPI tiles". It leads, and it is the screen's one full-bleed hero. */}
      <Verdict
        tone={outstanding > 0 ? "danger" : "success"}
        eyebrow="Money"
        headline={aiQ.data?.verdict || moneyFallback(received, outstanding)}
        action={
          outstanding > 0
            ? { label: "Chase what's owed", onClick: () => focus.open("money:outstanding") }
            : undefined
        }
        data-testid="finance-verdict"
      />

      {/* Stratum 2 — Received vs Outstanding, with L3 on Received (§5.3). Both
          open a Focus View: chasing a receivable is an ACT, so it happens here
          rather than throwing him onto the ledger (§2.2). */}
      <Pulse
        data-testid="finance-pulse"
        stats={[
          {
            label: "Received",
            value: received == null ? null : inrCompact(received),
            loading: received == null,
            series: trends.received,
            tone: "success",
            delta: trends.receivedDelta,
            progress: "money-received",
            onOpen: () => focus.open("money:received"),
          },
          {
            label: "Outstanding",
            value: outstanding == null ? null : inrCompact(outstanding),
            loading: outstanding == null,
            series: trends.outstanding,
            tone: "danger",
            delta: null,
            invertDelta: true,
            onOpen: () => focus.open("money:outstanding"),
          },
        ]}
      />

      {/* Stratum 3 — where the money is, as a Grid. Zeros still never render: a
          tile reading ₹0 spends a sixth of the viewport saying nothing (§8). */}
      <Grid
        title="Where the money is"
        items={kpis2}
        data-testid="finance-kpis"
        renderTile={(k) => (
          <>
            <span className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
              <k.icon size={16} weight="bold" aria-hidden="true" />
              {k.label}
            </span>
            {/* Right-aligned and tabular so a column of amounts lines up (§5.3). */}
            <span className="mt-1 block text-right font-heading text-lg font-bold">
              <Figure amount={k.amount} compact testid={`finance-kpi-value-${k.key}`} />
            </span>
            {/* §5.3 calls these "composition tiles", so they show composition:
                this figure against the largest one on screen. Derived from the
                same numbers above it — not decoration, and not a second way of
                saying the amount. A label + a number in a 116px tile leaves a
                hole in the middle, which is what took the first viewport to 78%
                against §3's 85% floor. */}
            {k.share != null && (
              <span
                className="mt-1.5 block h-1.5 overflow-hidden rounded-pill bg-accent"
                role="img"
                aria-label={`${Math.round(k.share * 100)}% of the largest figure here`}
              >
                <span
                  className={`block h-full rounded-pill ${k.key === "spend" || k.key === "unpaid" ? "bg-danger-500" : "bg-brand-500"}`}
                  style={{ width: `${Math.max(4, Math.round(k.share * 100))}%` }}
                />
              </span>
            )}
          </>
        )}
      />

      {tab === "inbox" ? (
        <CaptureInbox />
      ) : tab === "overview" ? (
        <OverviewLists summary={summaryQ.data} loading={summaryQ.isLoading} />
      ) : (
        <LedgerList tab={tab} onOpen={setDetail} />
      )}

      {/* §8: "Rename Fix Old Purchases -> Recheck earlier bills." */}
      {tab === "expenses" && (
        <button
          type="button"
          onClick={reclassify}
          disabled={reclassifying}
          data-testid="finance-recheck-bills"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          {reclassifying ? <Spinner size={18} className="animate-spin" /> : <ArrowClockwise size={18} weight="bold" />}
          {reclassifying ? "Rechecking…" : "Recheck earlier bills"}
        </button>
      )}

      <BottomSheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || ""}
        description={detail?.subtitle}
        data-testid="finance-detail-sheet"
      >
        {detail?.amount != null && (
          <p className="font-heading text-2xl font-bold tabular-nums">{inr(detail.amount)}</p>
        )}
        {detail?.rows?.map(([k, v]) => (
          <p key={k} className="mt-2 flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right font-semibold tabular-nums">{v}</span>
          </p>
        ))}
      </BottomSheet>

      {/* §5.3: "Tapping Outstanding ₹1,68,000 -> Focus View listing the six
          overdue receivables with a Chase action per row and Open Money -> at
          the foot. He chases the payment without ever leaving the screen he was
          reading." */}
      <FocusView onChanged={() => qc.invalidateQueries({ queryKey: ["ledger-summary"] })} />
    </div>
  );
}

/**
 * The Verdict's sentence when the AI has not produced one. Says what the two
 * numbers mean rather than restating them — a hero that reads "Received ₹19.4L,
 * Outstanding ₹6.9L" is the Pulse below it, twice.
 */
function moneyFallback(received, outstanding) {
  if (outstanding == null && received == null) return "Pulling your numbers together.";
  if ((outstanding || 0) > 0 && (received || 0) > 0) {
    return `${inrCompact(outstanding)} is still owed to you.`;
  }
  if ((outstanding || 0) > 0) return `${inrCompact(outstanding)} is owed and nothing has come in yet.`;
  if ((received || 0) > 0) return "Everything invoiced has been paid.";
  return "Nothing has moved yet.";
}

// ---------------------------------------------------------------------------
function OverviewLists({ summary, loading }) {
  if (loading) return <div className="mt-4"><ListSkeleton rows={3} /></div>;
  const byCat = (summary?.by_category || []).filter((c) => c.amount > 0).slice(0, 6);
  const byVendor = (summary?.by_vendor || []).filter((v) => v.amount > 0).slice(0, 6);
  if (!byCat.length && !byVendor.length) {
    return <div className="mt-4"><EmptyState icon={Receipt} title="Nothing recorded yet." /></div>;
  }
  return (
    <>
      {byCat.length > 0 && (
        <Section title="Where it went" testid="finance-by-category" rows={byCat.map((c) => [c.category, c.amount])} />
      )}
      {byVendor.length > 0 && (
        <Section title="Who you paid" testid="finance-by-vendor" rows={byVendor.map((v) => [v.vendor, v.amount])} />
      )}
    </>
  );
}

function Section({ title, rows, testid }) {
  return (
    <section className="mt-5" data-testid={testid}>
      <h2 className="font-heading text-base font-semibold tracking-tight">{title}</h2>
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="min-w-0 truncate text-sm">{k}</span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{inrCompact(v)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
const ENDPOINT = {
  revenue: "/revenue",
  expenses: "/expenses",
  assets: "/assets",
  inventory: "/inventory",
};

// List endpoints are not uniform. /expenses, /assets and /inventory return bare
// arrays; /revenue returns { currency, invoices, open_invoices, payments,
// totals, unmatched_payments }. Looking only for `items` made the Income tab
// render "Nothing under income yet" while invoices existed — caught against the
// real API, hidden by the fixture, which did return an array.
const LIST_KEY = { revenue: "invoices" };

function LedgerList({ tab, onOpen }) {
  // MPWA-12g: a busy ledger tab rendered every row — 24 expenses ran 3,927px,
  // past §5.2.7's ceiling. Show a screenful, then let him ask for more.
  const [limit, setLimit] = useState(8);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", tab],
    queryFn: () => api.get(ENDPOINT[tab]).then((r) => r.data),
    enabled: !!ENDPOINT[tab],
  });
  const all = Array.isArray(data)
    ? data
    : data?.[LIST_KEY[tab]] || data?.items || [];
  useEffect(() => setLimit(8), [tab]);
  const rows = all.slice(0, limit);
  const hidden = all.length - rows.length;

  if (isLoading) return <div className="mt-4"><ListSkeleton rows={4} /></div>;
  if (!all.length) {
    return (
      <div className="mt-4">
        <EmptyState
          icon={Receipt}
          title={`Nothing under ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} yet.`}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3" data-testid={`finance-list-${tab}`}>
      {rows.map((r) => {
        const title = r.description || r.item || r.name || r.contact_name || "Entry";
        const amount = r.amount ?? r.value ?? r.purchase_amount ?? null;
        const paid = r.status === "paid" || r.status === "active";
        return (
          <MobileCard
            key={r.id}
            data-testid={`finance-row-${r.id}`}
            title={title}
            status={paid ? "completed" : "pending"}
            statusLabel={r.status ? sentence(r.status) : undefined}
            due={r.due_date || r.date}
            context={[r.vendor_name || r.contact_name, r.category].filter(Boolean).join(" · ") || null}
            amount={amount}
            onOpen={() =>
              onOpen({
                title,
                subtitle: [r.vendor_name || r.contact_name, r.category].filter(Boolean).join(" · "),
                amount,
                rows: [
                  r.quantity ? ["Quantity", `${r.quantity} ${r.unit || ""}`.trim()] : null,
                  r.date ? ["Date", r.date] : null,
                  r.due_date ? ["Due", r.due_date] : null,
                  r.status ? ["Status", sentence(r.status)] : null,
                  r.received != null ? ["Received", inr(r.received)] : null,
                  r.outstanding ? ["Outstanding", inr(r.outstanding)] : null,
                ].filter(Boolean),
              })
            }
          />
        );
      })}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 8)}
          data-testid={`finance-list-${tab}-more`}
          className="flex w-full items-center justify-center rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-accent"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          Show {Math.min(hidden, 8)} more of {all.length}
        </button>
      )}
    </div>
  );
}

const sentence = (s) => String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// The inbox tab. §8: "upload · camera · WhatsApp status as cards. DELETE the
// raw WhatsApp log — it currently prints WA_TENANT_ID at the founder."
//
// There is no log rendering here at all, and the WhatsApp card reports state in
// business language. /whatsapp/logs is deliberately not called.
// ---------------------------------------------------------------------------
function CaptureInbox() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: pending } = useQuery({
    queryKey: ["captures-pending"],
    queryFn: () => api.get("/captures/pending-count").then((r) => r.data),
  });
  const { data: wa } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => api.get("/whatsapp/status").then((r) => r.data),
  });
  const { data: queue, isLoading } = useQuery({
    queryKey: ["ingest"],
    queryFn: () => api.get("/ingest").then((r) => r.data),
  });
  const rows = Array.isArray(queue) ? queue : queue?.items || [];

  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setBusy(true);
    try {
      await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Sent to Dex to read");
      qc.invalidateQueries({ queryKey: ["ingest"] });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not upload that");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="mt-4" data-testid="finance-inbox">
      <div className="grid grid-cols-2 gap-3">
        <label
          data-testid="capture-camera"
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent"
          style={{ minHeight: "5.5rem" }}
        >
          <Camera size={26} weight="regular" aria-hidden="true" />
          <span className="text-sm font-semibold">Photograph a bill</span>
          <input type="file" accept="image/*" capture="environment" hidden onChange={upload} disabled={busy} />
        </label>
        <label
          data-testid="capture-upload"
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent"
          style={{ minHeight: "5.5rem" }}
        >
          <UploadSimple size={26} weight="regular" aria-hidden="true" />
          <span className="text-sm font-semibold">Upload a file</span>
          <input type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" hidden onChange={upload} disabled={busy} />
        </label>
      </div>

      {/* WhatsApp state as a card, in business language. No log, no env var. */}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-3.5" data-testid="capture-whatsapp">
        <WhatsappLogo size={26} weight="regular" aria-hidden="true" className="shrink-0 text-success-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">WhatsApp bills</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {wa?.connected
              ? `Connected${wa.number ? ` on ${wa.number}` : ""}. Forward a bill and it lands here.`
              : "Not linked to your company yet."}
          </p>
        </div>
        <StatusChip
          status={wa?.connected ? "completed" : "rejected"}
          label={wa?.connected ? "On" : "Off"}
        />
      </div>

      <h2 className="mt-5 font-heading text-base font-semibold tracking-tight">
        Waiting to be read{pending?.count ? ` · ${pending.count}` : ""}
      </h2>
      <div className="mt-2 space-y-3">
        {isLoading && <ListSkeleton rows={2} />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={CheckCircle} title="Nothing waiting to be read." />
        )}
        {rows.map((c) => (
          <MobileCard
            key={c.id}
            data-testid={`capture-row-${c.id}`}
            title={c.transcript || c.filename || "Captured item"}
            status={c.status === "needs_clarification" ? "overdue" : "pending"}
            statusLabel={c.status === "needs_clarification" ? "Couldn't read it" : "Being read"}
            due={c.created_at}
            context={c.kind ? sentence(c.kind) : null}
            onOpen={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
