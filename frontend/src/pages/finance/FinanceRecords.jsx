// Finance — the record tabs on the glass (2026-09-14): Revenue (tiles, the
// overdue callout, payments to match, AI analysis, invoices and payments),
// Expenses (supplier payments to match, AI analysis, the list), Assets and
// Inventory. The behaviour is the page's own — filters, sort, matching,
// delete — in the new material, with every data-testid kept.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Buildings, CaretDown, CurrencyCircleDollar, CurrencyInr, DownloadSimple, MagnifyingGlass, Package, Receipt, Trash, WarningCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../lib/perms";
import { DataList } from "../../components/neuglass/DataList";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { DRAWER_TRACK, GLASS_MENU, INK_PILL } from "../../components/neuglass/glass";
import { AiPanel } from "./FinanceAi";
import {
  AttachmentLink, CARD, EmptyNote, FIELD, LoadError, SMALL_INK, SMALL_PILL, SourceTag, TONE_CHIP, Tag, fmt,
} from "./financeKit";
import { latestEntryAt, daysSince, isInvoiceOverdue, overdueDays, inPeriod, baseOf } from "./ledgerMath";
import { BillsToPayPanel, InvoiceRowActions, NeedsRateNote } from "./MoneyActions";
// 2026-10-22 (client) — select-and-delete, and every delete asks first
// (FinanceDelete: the preview says what goes with it; it can be put back).
import { SelectToggle, SelectionBar, useSelection } from "./FinanceDelete";
// J2-07 — the Date columns printed the stored "2026-09-22". shortDate reads it
// back as a day ("22 Sep 2026"); the tables still SORT on the raw value.
import { shortDate } from "../../lib/format";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function MoneyTile({ icon: Icon, tone = "slate", label, value, note, testid }) {
  return (
    <div className={`p-4 sm:p-5 ${CARD}`} data-testid={testid}>
      <span className={`grid h-10 w-10 place-items-center rounded-full ring-1 ring-inset ${TONE_CHIP[tone]}`}>
        <Icon size={19} aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-[1.45rem] font-semibold leading-tight text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function ListCard({ title, count, action, children }) {
  return (
    <section className={`p-5 sm:p-6 ${CARD}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          {title}
          {count != null && <Tag className="tabular-nums">{count}</Tag>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* 2026-10-29 (founder) — ONE PERIOD FOR ALL OF FINANCE. The period picked on
   any tab is the period on every tab that reports money moving: Overview,
   Revenue, Expenses. This line says which one a tab is showing, how much of
   the list it holds, and — when the period leaves out invoices still owed —
   says so, with one tap to see every date. What is owed, what needs matching
   and the bills to pay are never hidden by a period. */
function PeriodLine({ window: w, shown, total, noun, unpaidOutside, unpaidAmount, f, onAllDates, testid }) {
  if (!w?.windowed) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[1.25rem] bg-slate-500/[0.06] px-4 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-900/[0.04]"
      data-testid={testid}>
      <span><span className="font-semibold text-slate-900">{w.label}</span> · {w.range}</span>
      <span className="text-slate-500">{shown} of {plural(total, noun)}</span>
      {unpaidOutside > 0 && (
        <span className="font-medium text-amber-800" data-testid={`${testid}-unpaid-outside`}>
          {plural(unpaidOutside, "unpaid invoice")}{unpaidAmount ? ` (${f(unpaidAmount)})` : ""} dated outside this period
        </span>
      )}
      {shown < total && onAllDates && (
        <button type="button" onClick={onAllDates} data-testid={`${testid}-all`}
          className="ml-auto text-xs font-semibold text-slate-900 underline-offset-2 hover:underline">Show all dates</button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-12 rounded-xl" />)}
    </div>
  );
}

function Records({ loading, error, what, rows, empty, children }) {
  if (loading) return <ListSkeleton />;
  if (error) {
    return <p className="py-6 text-center text-sm text-slate-500">Couldn't load {what}. You may not have access, or the connection dropped.</p>;
  }
  if (!rows.length) return empty;
  return children;
}

function DeleteButton({ onClick, label, testid }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid} aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
      <Trash size={15} aria-hidden="true" />
    </button>
  );
}

function InvoicePicker({ open: invoices, value, onChange, cur, testid }) {
  const f = fmt(cur);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const sel = invoices.find((o) => o.id === value);
  const label = (o) => (o.number ? `#${o.number} · ` : "") + (o.contact_name || o.title || "Invoice") + ` · bal ${f(o.balance)}`;
  const filtered = invoices.filter((o) => label(o).toLowerCase().includes(q.toLowerCase()));
  return (
    <div data-testid={testid} className="w-full sm:w-auto">
      <Popover open={show} onOpenChange={(o) => { setShow(o); if (!o) setQ(""); }}>
        <PopoverTrigger asChild>
          <button type="button" data-testid={`${testid}-toggle`}
            className={cn(FIELD, "flex h-9 items-center justify-between gap-2 rounded-pill px-3.5 text-left text-xs sm:w-[15rem]")}>
            <span className={`truncate ${sel ? "text-slate-800" : "text-slate-400"}`}>{sel ? label(sel) : "Match to invoice…"}</span>
            <CaretDown size={12} weight="bold" aria-hidden="true" className="shrink-0 text-slate-500" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className={cn(GLASS_MENU, "w-[min(18rem,calc(100vw-1.5rem))] p-1.5")}>
          <label className="relative block">
            <span className="sr-only">Search invoices</span>
            <MagnifyingGlass size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testid}-search`}
              placeholder="Search invoice # or name…" className={cn(FIELD, "h-9 rounded-xl pl-8 text-xs")} />
          </label>
          <div className="mt-1 max-h-60 overflow-y-auto" role="listbox" aria-label="Open invoices">
            {filtered.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">No matching invoices</p>}
            {filtered.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={o.id === value} data-testid={`${testid}-opt-${o.id}`}
                onClick={() => { onChange(o.id); setShow(false); setQ(""); }}
                className="block w-full rounded-xl px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-slate-900/[0.06] focus-visible:bg-slate-900/[0.06] focus-visible:outline-none">
                {label(o)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function NeedsMatchingPanel({ title, hint, unmatched, open, cur, endpoint, standaloneLabel, onChange, testid }) {
  const f = fmt(cur);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(null);
  if (!unmatched || unmatched.length === 0) return null;

  const match = async (pid) => {
    const invoice_id = picks[pid];
    if (!invoice_id) return toast.error("Pick an invoice to match");
    setBusy(pid);
    try {
      const { data } = await api.post(`${endpoint}/${pid}/match`, { invoice_id });
      toast.success(data.payment_remaining > 0.01 ? `Matched — ${f(data.payment_remaining)} still to match` : "Payment matched");
      setPicks((s) => ({ ...s, [pid]: "" }));
      onChange();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not match");
    } finally {
      setBusy(null);
    }
  };
  const standalone = async (pid) => {
    setBusy(pid);
    try {
      await api.post(`${endpoint}/${pid}/standalone`);
      toast.success(standaloneLabel.done);
      onChange();
    } catch {
      toast.error("Could not update");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`p-5 ${CARD}`} data-testid={testid}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
          <WarningCircle size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">
            {title} <span className="font-normal text-slate-500">({unmatched.length})</span>
          </h2>
          <p className="text-sm text-slate-500">{hint}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {unmatched.map((p) => (
          <li key={p.id} data-testid={`${testid}-item-${p.id}`}
            className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.05]">
            <span className="text-sm font-semibold text-slate-900">{f(p.remaining ?? p.amount)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {p.contact_name || "Unknown"}{p.date ? ` · ${shortDate(p.date)}` : ""}{p.invoice_number ? ` · ref ${p.invoice_number}` : ""}
              {p.applied > 0 ? ` · ${f(p.applied)} already applied` : ""}
            </span>
            <InvoicePicker open={open} value={picks[p.id] || ""} onChange={(v) => setPicks((s) => ({ ...s, [p.id]: v }))} cur={cur} testid={`match-picker-${p.id}`} />
            <button type="button" onClick={() => match(p.id)} disabled={busy === p.id} data-testid={`match-btn-${p.id}`} className={SMALL_INK}>Match</button>
            <button type="button" onClick={() => standalone(p.id)} disabled={busy === p.id} data-testid={`standalone-btn-${p.id}`} className={SMALL_PILL}>
              {standaloneLabel.btn}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FILTER_KEYS = ["all", "awaiting", "partial", "paid", "overdue"];
const SORTS = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "amount-desc", label: "Amount (highest)" },
  { value: "overdue", label: "Oldest awaiting" },
];

export function RevenueTab({ data, loading, error, cur, onDelete, onChange, onPay, onSetRate, initialFilter = "all", period, onAllDates }) {
  const f = fmt(cur);
  const tt = data?.totals || {};
  const allInvoices = useMemo(() => data?.invoices || [], [data]);
  const allPayments = useMemo(() => data?.payments || [], [data]);
  // The period on the page (2026-10-29): the lists and Billed / Received follow
  // it; Outstanding and Overdue are what is owed, whatever the date.
  const invoices = useMemo(() => allInvoices.filter((s) => inPeriod(s, period)), [allInvoices, period]);
  const payments = useMemo(() => allPayments.filter((p) => inPeriod(p, period)), [allPayments, period]);
  const windowed = !!period?.windowed;
  const sumBase = (rows) => rows.reduce((t, r) => t + (baseOf(r) || 0), 0);
  const unpaidOutside = allInvoices.filter((s) => s.status !== "paid" && !inPeriod(s, period));
  const group = useState(null);
  // U7-08.1: status filter + sort; KR-10: ?filter= seeds the filter.
  const [statusFilter, setStatusFilter] = useState(FILTER_KEYS.includes(initialFilter) ? initialFilter : "all");
  const [sortKey, setSortKey] = useState("date-desc");

  const awaiting = (s) => s.status !== "paid" && s.status !== "partial";
  // Overdue counts every overdue invoice, in the period or not: money owed.
  const overdueCount = allInvoices.filter((s) => isInvoiceOverdue(s)).length;
  const counts = {
    all: invoices.length,
    awaiting: invoices.filter(awaiting).length,
    partial: invoices.filter((s) => s.status === "partial").length,
    paid: invoices.filter((s) => s.status === "paid").length,
    overdue: overdueCount,
  };

  const filtered = useMemo(() => {
    let list = invoices;
    if (statusFilter === "overdue") list = allInvoices.filter((s) => isInvoiceOverdue(s));
    else if (statusFilter === "awaiting") list = list.filter((s) => s.status !== "paid" && s.status !== "partial");
    else if (statusFilter === "partial") list = list.filter((s) => s.status === "partial");
    else if (statusFilter === "paid") list = list.filter((s) => s.status === "paid");
    const sorted = [...list];
    if (sortKey === "date-desc") sorted.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    else if (sortKey === "date-asc") sorted.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    else if (sortKey === "amount-desc") sorted.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    else if (sortKey === "overdue") sorted.sort((a, b) => (daysSince(b.date) || 0) - (daysSince(a.date) || 0));
    return sorted;
  }, [invoices, allInvoices, statusFilter, sortKey]);
  const selInv = useSelection(filtered, () => "invoice", "invoices", group);
  const selPay = useSelection(payments, () => "payment", "payments", group);
  // Audit 2026-10-08: in the company's currency; no-rate foreign invoices left out.
  const filteredTotal = filtered.reduce((sum, s) => sum + (("amount_base" in s ? s.amount_base : s.amount) || 0), 0);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-[148px] rounded-[1.6rem]" />)}
        </div>
        <div className="ds-skeleton h-[320px] rounded-[1.6rem]" />
      </div>
    );
  }
  if (error) return <LoadError title="Couldn't load revenue" />;

  const FILTERS = [
    { key: "all", label: "All", count: counts.all },
    { key: "awaiting", label: "Awaiting", count: counts.awaiting },
    { key: "partial", label: "Partial", count: counts.partial },
    { key: "paid", label: "Received", count: counts.paid },
    { key: "overdue", label: "Overdue", count: counts.overdue, danger: true },
  ];

  const invoiceColumns = [
    { key: "invoice", head: "Invoice", role: "title", tdClass: "font-medium text-slate-900",
      cell: (s) => (
        <>
          {/* Invoice # AND title when both exist — the number is what a
              customer quotes back when asked about payment. */}
          {s.number && <span className="mr-1.5 text-xs font-normal text-slate-500">#{s.number}</span>}
          <span>{s.title || (s.number ? "" : "Sale")}</span>
          <SourceTag source={s.source} />
          <AttachmentLink att={s.attachment} />
        </>
      ) },
    { key: "customer", head: "Customer", role: "meta", tdClass: "text-slate-600",
      value: (s) => s.contact_name, cell: (s) => s.contact_name || "—" },
    { key: "date", head: "Date", role: "meta", tdClass: "tabular-nums text-slate-600",
      value: (s) => s.date, cell: (s) => shortDate(s.date) || "—" },
    { key: "status", head: "Status", role: "chip",
      cell: (s) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Tag tone={s.status === "paid" ? "good" : s.status === "partial" ? "warn" : "quiet"}>
            {s.status === "paid" ? "received" : s.status === "partial" ? "partial" : "awaiting"}
          </Tag>
          {s.status === "partial" && <span className="text-xs text-slate-500">bal {f(s.balance)}</span>}
          {isInvoiceOverdue(s) && (
            <Tag tone="bad" className="normal-case" data-testid={`revenue-overdue-${s.id}`}>
              <WarningCircle size={11} weight="bold" aria-hidden="true" /> {overdueDays(s)}d overdue
            </Tag>
          )}
        </span>
      ) },
    { key: "amount", head: "Amount", role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900",
      // Audit 2026-10-08: an invoice in another currency shows its own amount,
      // and its value in the company's currency (or that it has no rate yet).
      cell: (s) => (s.currency && s.currency !== cur ? (
        <span className="inline-flex flex-col items-end">
          <span>{fmt(s.currency)(s.amount)}</span>
          <span className="text-[11px] font-normal text-slate-500" data-testid={`revenue-base-${s.id}`}>
            {s.amount_base != null ? `≈ ${f(s.amount_base)}` : "no rate yet"}
          </span>
        </span>
      ) : f(s.amount)) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      // Audit F-02/F-03: record a payment on it, or download it as a PDF.
      cell: (s) => (
        <span className="inline-flex items-center justify-end gap-1">
          <InvoiceRowActions inv={{ ...s, currency: s.currency || cur }} onPay={onPay} onSetRate={onSetRate} />
          <DeleteButton onClick={() => onDelete([{ kind: "invoice", id: s.id }])} testid={`revenue-invoice-delete-${s.id}`} label="Delete invoice" />
        </span>
      ) },
  ];
  const paymentColumns = [
    { key: "customer", head: "Customer", role: "title", tdClass: "font-medium text-slate-900",
      cell: (p) => <>{p.contact_name || "—"}<SourceTag source={p.source} /></> },
    { key: "date", head: "Date", role: "meta", tdClass: "tabular-nums text-slate-600", value: (p) => p.date, cell: (p) => shortDate(p.date) || "—" },
    { key: "method", head: "Method", role: "meta", tdClass: "text-slate-600", value: (p) => p.method, cell: (p) => p.method || "—" },
    { key: "ref", head: "Reference", role: "meta", tdClass: "text-slate-600",
      value: (p) => p.reference || p.invoice_number, cell: (p) => p.reference || p.invoice_number || "—" },
    { key: "amount", head: "Amount", role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900",
      cell: (p) => (p.currency && p.currency !== cur ? fmt(p.currency)(p.amount) : f(p.amount)) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (p) => <DeleteButton onClick={() => onDelete([{ kind: "payment", id: p.id }])} testid={`revenue-payment-delete-${p.id}`} label="Delete payment" /> },
  ];

  return (
    <div className="space-y-5" data-testid="ledger-revenue">
      <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
        <MoneyTile icon={cur === "INR" ? CurrencyInr : CurrencyCircleDollar} tone="emerald" label="Billed"
          value={f(windowed ? sumBase(invoices) : (tt.billed || 0))}
          note={plural(invoices.length, "invoice")} testid="kpi-billed" />
        <MoneyTile icon={DownloadSimple} tone="sky" label="Received"
          value={f(windowed ? sumBase(payments) : (tt.received || 0))}
          note={plural(payments.length, "payment")} testid="kpi-received-rev" />
        <MoneyTile icon={WarningCircle} tone={overdueCount > 0 ? "rose" : "slate"} label="Outstanding" value={f(tt.outstanding || 0)}
          note={`${overdueCount > 0 ? `${overdueCount} overdue` : "Nothing overdue"}${windowed ? " · all dates" : ""}`} testid="kpi-outstanding" />
      </div>
      <PeriodLine window={period} shown={invoices.length} total={allInvoices.length} noun="invoice" f={f} testid="revenue-period"
        unpaidOutside={unpaidOutside.length} unpaidAmount={unpaidOutside.reduce((t, s) => t + (s.balance ?? baseOf(s) ?? 0), 0)}
        onAllDates={onAllDates} />

      <NeedsRateNote rows={tt.needs_rate} testid="revenue-needs-rate" />

      {overdueCount > 0 && (
        <button type="button" onClick={() => setStatusFilter("overdue")} data-testid="revenue-overdue-callout"
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[1.25rem] bg-rose-50/90 px-4 py-3 text-left text-sm font-medium text-rose-800 ring-1 ring-inset ring-rose-100 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
          <WarningCircle size={18} weight="bold" aria-hidden="true" />
          {plural(overdueCount, "invoice")} overdue — a week or more past the due date
          <span className="ml-auto text-xs font-semibold">Show only overdue →</span>
        </button>
      )}

      <NeedsMatchingPanel title="Needs matching" testid="revenue-needs-matching"
        hint="These received payments couldn’t be auto-linked to an invoice. Pick the right one, or mark it as standalone income."
        unmatched={data?.unmatched_payments} open={data?.open_invoices || []} cur={cur}
        endpoint="/revenue/payment" standaloneLabel={{ btn: "Standalone income", done: "Marked as standalone income" }}
        onChange={onChange} />

      <AiPanel scope="revenue" scopeLabel="revenue" changedAt={latestEntryAt(data, [])} />

      <ListCard title="Sales & service invoices" count={invoices.length}
        action={allInvoices.length > 0 && (
          <span className="flex flex-wrap items-center gap-2">
            <SelectToggle sel={selInv} rows={filtered} testid="revenue-invoices-select" />
            <GlassSelect testid="revenue-sort" ariaLabel="Sort invoices" value={sortKey} onChange={setSortKey} align="end"
              options={SORTS} triggerClassName="h-10 w-auto min-w-[11rem] text-sm" />
          </span>
        )}>
        {allInvoices.length > 0 && (
          <div role="group" aria-label="Filter invoices" data-testid="revenue-status-filter"
            className={`mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-[1.25rem] p-1 ${DRAWER_TRACK}`}>
            {FILTERS.map((x) => {
              const active = statusFilter === x.key;
              const alarm = x.danger && x.count > 0;
              return (
                <button key={x.key} type="button" onClick={() => setStatusFilter(x.key)} aria-pressed={active} data-testid={`revenue-filter-${x.key}`}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25",
                    active
                      ? (alarm ? "bg-rose-600 text-white shadow-sm" : INK_PILL)
                      : (alarm ? "text-rose-700 hover:bg-white/80" : "text-slate-600 hover:bg-white/80 hover:text-slate-900"),
                    x.count === 0 && !active && "opacity-55",
                  )}>
                  {x.label}
                  <span className={cn("rounded-pill px-1.5 py-px text-[10px] tabular-nums", active ? "bg-white/20" : "bg-slate-900/[0.06]")}>{x.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {allInvoices.length === 0 ? (
          <EmptyNote icon={Receipt} title="No invoices yet" hint="Record a sale or service with Add income, or send a sales invoice by WhatsApp or upload — it lands here." />
        ) : invoices.length === 0 && statusFilter !== "overdue" ? (
          <EmptyNote icon={Receipt} title={`No invoices in ${period?.label || "this period"}`} hint="Pick another period, or Show all dates." />
        ) : filtered.length === 0 ? (
          <EmptyNote icon={Receipt} title={`No ${FILTERS.find((x) => x.key === statusFilter)?.label.toLowerCase()} invoices`} hint="Try a different filter, or clear it to see all." />
        ) : (
          <DataList testid="revenue-invoices-table" rows={filtered} rowKey={(s) => s.id}
            rowTestid={(s) => `revenue-invoice-row-${s.id}`}
            rowClass={(s) => (isInvoiceOverdue(s) ? "bg-rose-50/40" : "")}
            footer={filtered.length > 1 ? { label: `Showing ${filtered.length} of ${statusFilter === "overdue" ? allInvoices.length : invoices.length}`, value: f(filteredTotal), testid: "revenue-filtered-total" } : undefined}
            columns={invoiceColumns} select={selInv} />
        )}
      </ListCard>

      {payments.length > 0 && (
        <ListCard title="Payments received" count={payments.length}
          action={<SelectToggle sel={selPay} rows={payments} testid="revenue-payments-select" />}>
          <DataList testid="revenue-payments-table" rows={payments} rowKey={(p) => p.id}
            rowTestid={(p) => `revenue-payment-row-${p.id}`} columns={paymentColumns} select={selPay} />
        </ListCard>
      )}
      <SelectionBar sel={selInv} onDelete={() => onDelete(selInv.items(), selInv.stop)} />
      <SelectionBar sel={selPay} onDelete={() => onDelete(selPay.items(), selPay.stop)} />
    </div>
  );
}

/* J1-11 (JOURNEY-1) — APPROVED, NOT YET BILLED. A founder approved "a second
   press brake, Rs 18 lakh" on his first day and Money showed nothing anywhere.
   That was not the books being wrong: a purchase the owner has approved is a
   commitment, and the expense is written when the procurement reaches its last
   stage. But between the approval and the bill — weeks, for a machine — the
   money was invisible, and the one screen he would look for it on said nothing.
   Read from the open purchase workflows (GET /payables `committed`), never
   booked: no total moves, and a row leaves the moment the real bill exists. */
function CommittedPanel({ rows, cur, testid = "payables-committed" }) {
  const f = fmt(cur);
  if (!rows || rows.length === 0) return null;
  const total = rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return (
    <section className={`p-5 ${CARD}`} data-testid={testid}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          Approved, not yet billed <span className="font-normal text-slate-500">({rows.length})</span>
        </h2>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{f(total)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Purchases you have approved. Nothing is in your books until the bill arrives — these are here
        so the money is not a surprise.
      </p>
      <ul className="mt-4 space-y-2">
        {rows.map((r) => (
          <li key={r.id} data-testid={`${testid}-item-${r.id}`}
            className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.05]">
            <span className="text-sm font-semibold tabular-nums text-slate-900">{f(r.amount)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {r.title}{r.counterparty ? ` · ${r.counterparty}` : ""}{r.date ? ` · ${shortDate(r.date)}` : ""}
            </span>
            <Tag tone="quiet">{r.stage || "in progress"}</Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExpensesTab({ rows: allRows, loading, error, payables, cur, onDelete, onChange, onPay, onSetRate, needsRate, period, onAllDates }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  const { user } = useAuth();
  const group = useState(null);
  // The period on the page (2026-10-29): the expenses and the payments made
  // follow it; Bills to pay, approved purchases and payments to match don't.
  const rows = useMemo(() => allRows.filter((e) => inPeriod(e, period)), [allRows, period]);
  const sel = useSelection(rows, () => "expense", "expenses", group);
  // 2026-10-22 — payments made had no list of their own, so one could not be
  // deleted at all; they sit under the expenses now, like Payments received.
  const paid = useMemo(() => (payables?.payments || []).filter((p) => inPeriod(p, period)), [payables, period]);
  const selPaid = useSelection(paid, () => "payment", "paid", group);
  const canApprove = hasPerm(user, "approvals");
  const decide = async (e, approve) => {
    try {
      await api.post(`/expenses/${e.id}/approval`, { approve });
      toast.success(approve ? "Approved — it counts now" : "Not approved");
      onChange?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save that"); }
  };
  const columns = [
    { key: "title", head: t("finance.c_title"), role: "title", tdClass: "font-medium text-slate-900",
      cell: (e) => <>{e.title}<SourceTag source={e.source} /><AttachmentLink att={e.attachment} /></> },
    { key: "category", head: t("finance.c_category"), role: "chip", cell: (e) => (e.category ? <Tag className="normal-case">{e.category}</Tag> : <span className="text-slate-400">—</span>) },
    { key: "vendor", head: t("finance.c_vendor"), role: "meta", tdClass: "text-slate-600", value: (e) => e.vendor_name, cell: (e) => e.vendor_name || "—" },
    { key: "date", head: t("finance.c_date"), role: "meta", tdClass: "tabular-nums text-slate-600", value: (e) => e.date, cell: (e) => shortDate(e.date) || "—" },
    /* J7 (JOURNEY-1) — an expense over the company's high-value figure, typed
       by somebody who is not the owner, waits for an owner before it counts.
       The row says so, and anybody who may approve can answer here. */
    { key: "status", head: t("finance.c_status"), role: "chip",
      cell: (e) => (
        e.approval_status === "pending" ? <Tag tone="warn">waiting for approval</Tag>
        : e.approval_status === "rejected" ? <Tag tone="bad">not approved</Tag>
        : (
        <Tag tone={e.status === "paid" ? "good" : e.status === "awaiting_bill" ? "quiet" : "warn"}>
          {e.status === "paid" ? t("finance.paid") : e.status === "awaiting_bill" ? "awaiting bill" : t("finance.unpaid")}
        </Tag>
        )
      ) },
    // Audit 2026-10-08 — a bill in another currency shows its own amount and
    // its value in the company's currency (or "no rate yet" and Set rate).
    { key: "amount", head: t("finance.c_amount"), role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900",
      cell: (e) => (e.currency && e.currency !== cur ? (
        <span className="inline-flex flex-col items-end">
          <span>{fmt(e.currency)(e.amount)}</span>
          <span className="text-[11px] font-normal text-slate-500" data-testid={`expense-base-${e.id}`}>
            {e.amount_base != null ? `≈ ${f(e.amount_base)}` : "no rate yet"}
          </span>
        </span>
      ) : f(e.amount)) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (e) => ("amount_base" in e && e.amount_base == null && onSetRate ? (
        <span className="flex items-center justify-end gap-1.5">
          <button type="button" className={SMALL_PILL} data-testid={`expense-rate-${e.id}`}
            onClick={() => onSetRate({ ...e, kind: "expense" })}>Set rate</button>
          <DeleteButton onClick={() => onDelete([{ kind: "expense", id: e.id }])} testid={`expense-delete-${e.id}`} label="Delete expense" />
        </span>
      ) : (
        e.approval_status === "pending" && canApprove ? (
          <span className="flex items-center justify-end gap-1.5">
            <button type="button" className={SMALL_INK} data-testid={`expense-approve-${e.id}`}
              onClick={() => decide(e, true)}>Approve</button>
            <button type="button" className={SMALL_PILL} data-testid={`expense-reject-${e.id}`}
              onClick={() => decide(e, false)}>Reject</button>
          </span>
        ) : <DeleteButton onClick={() => onDelete([{ kind: "expense", id: e.id }])} testid={`expense-delete-${e.id}`} label="Delete expense" />
      )) },
  ];
  return (
    <div className="space-y-5">
      <NeedsRateNote rows={needsRate} testid="expenses-needs-rate" />
      {/* Audit F-02 — the supplier bills still unpaid, with a way to pay them. */}
      <BillsToPayPanel bills={payables?.open_invoices} total={payables?.totals?.payable_outstanding || 0} cur={cur} onPay={onPay}
        onDelete={(b) => onDelete([{ kind: "bill", id: b.id }])} />
      <CommittedPanel rows={payables?.committed} cur={cur} />
      <NeedsMatchingPanel title="Supplier payments to match" testid="payables-needs-matching"
        hint="These payments to suppliers couldn’t be auto-linked to a purchase bill. Pick the bill they settle, or mark it as a standalone expense."
        unmatched={payables?.unmatched_payments} open={payables?.open_invoices || []} cur={cur}
        endpoint="/payables/payment" standaloneLabel={{ btn: "Standalone expense", done: "Booked as a standalone expense" }}
        onChange={onChange} />
      <AiPanel scope="expenses" scopeLabel={t("finance.t_expenses").toLowerCase()} changedAt={latestEntryAt(null, allRows)} />
      {!loading && !error && (
        <PeriodLine window={period} shown={rows.length} total={allRows.length} noun="expense" f={f} testid="expenses-period" onAllDates={onAllDates} />
      )}
      <ListCard title={t("finance.t_expenses")} count={loading || error ? null : rows.length}
        action={<SelectToggle sel={sel} rows={rows} testid="expenses-select" />}>
        <Records loading={loading} error={error} what="expenses" rows={rows}
          empty={allRows.length
            ? <EmptyNote icon={Receipt} title={`No expenses in ${period?.label || "this period"}`} hint="Pick another period, or Show all dates." />
            : <EmptyNote icon={Receipt} title={t("finance.empty_exp_title")} hint={t("finance.empty_exp_hint")} />}>
          <DataList columns={columns} rows={rows} rowKey={(e) => e.id} rowTestid={(e) => `expense-row-${e.id}`} testid="expenses-table" select={sel} />
        </Records>
      </ListCard>
      {paid.length > 0 && (
        <ListCard title="Payments made" count={paid.length}
          action={<SelectToggle sel={selPaid} rows={paid} testid="payments-made-select" />}>
          <DataList testid="payments-made-table" rows={paid} rowKey={(p) => p.id} rowTestid={(p) => `payment-made-row-${p.id}`}
            select={selPaid} columns={[
              { key: "supplier", head: "Supplier", role: "title", tdClass: "font-medium text-slate-900",
                cell: (p) => <>{p.contact_name || "—"}<SourceTag source={p.source} /></> },
              { key: "date", head: "Date", role: "meta", tdClass: "tabular-nums text-slate-600", value: (p) => p.date, cell: (p) => shortDate(p.date) || "—" },
              { key: "method", head: "Method", role: "meta", tdClass: "text-slate-600", value: (p) => p.method, cell: (p) => p.method || "—" },
              { key: "ref", head: "Reference", role: "meta", tdClass: "text-slate-600",
                value: (p) => p.reference || p.invoice_number, cell: (p) => p.reference || p.invoice_number || "—" },
              { key: "amount", head: "Amount", role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900",
                cell: (p) => (p.currency && p.currency !== cur ? fmt(p.currency)(p.amount) : f(p.amount)) },
              { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
                cell: (p) => <DeleteButton onClick={() => onDelete([{ kind: "payment", id: p.id }])} testid={`payment-made-delete-${p.id}`} label="Delete payment" /> },
            ]} />
        </ListCard>
      )}
      <SelectionBar sel={sel} onDelete={() => onDelete(sel.items(), sel.stop)} />
      <SelectionBar sel={selPaid} onDelete={() => onDelete(selPaid.items(), selPaid.stop)} />
    </div>
  );
}

export function AssetsTab({ rows, loading, error, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  const group = useState(null);
  const sel = useSelection(rows, () => "asset", "assets", group);
  const STATUS = {
    active: { tone: "good", label: t("finance.active") },
    maintenance: { tone: "warn", label: t("finance.maintenance") },
    disposed: { tone: "quiet", label: t("finance.disposed") },
  };
  const columns = [
    { key: "name", head: t("finance.a_asset"), role: "title", tdClass: "font-medium text-slate-900",
      cell: (a) => <>{a.name}<SourceTag source={a.source} /><AttachmentLink att={a.attachment} /></> },
    { key: "category", head: t("finance.c_category"), role: "chip", cell: (a) => (a.category ? <Tag className="normal-case">{a.category}</Tag> : <span className="text-slate-400">—</span>) },
    { key: "vendor", head: t("finance.c_vendor"), role: "meta", tdClass: "text-slate-600", value: (a) => a.vendor_name, cell: (a) => a.vendor_name || "—" },
    { key: "bought", head: t("finance.a_bought"), role: "meta", tdClass: "tabular-nums text-slate-600", value: (a) => a.purchase_date, cell: (a) => shortDate(a.purchase_date) || "—" },
    { key: "status", head: t("finance.c_status"), role: "chip",
      cell: (a) => {
        const st = STATUS[a.status] || { tone: "quiet", label: a.status || "—" };
        return <Tag tone={st.tone} className="normal-case">{st.label}</Tag>;
      } },
    { key: "value", head: t("finance.a_value"), role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900", cell: (a) => f(a.purchase_amount) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (a) => <DeleteButton onClick={() => onDelete([{ kind: "asset", id: a.id }])} testid={`asset-delete-${a.id}`} label="Delete asset" /> },
  ];
  return (
    <div className="space-y-5">
      <AiPanel scope="assets" scopeLabel={t("finance.t_assets").toLowerCase()} />
      <ListCard title={t("finance.t_assets")} count={loading || error ? null : rows.length}
        action={<SelectToggle sel={sel} rows={rows} testid="assets-select" />}>
        <Records loading={loading} error={error} what="assets" rows={rows}
          empty={<EmptyNote icon={Buildings} title={t("finance.empty_asset_title")} hint={t("finance.empty_asset_hint")} />}>
          <DataList columns={columns} rows={rows} rowKey={(a) => a.id} rowTestid={(a) => `asset-row-${a.id}`} testid="assets-table" select={sel} />
        </Records>
      </ListCard>
      <SelectionBar sel={sel} onDelete={() => onDelete(sel.items(), sel.stop)} />
    </div>
  );
}

export function InventoryTab({ rows, loading, error, cur, onDelete, onUse }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  const group = useState(null);
  const sel = useSelection(rows, () => "inventory", "inventory", group);
  const columns = [
    { key: "item", head: t("finance.i_item"), role: "title", tdClass: "font-medium text-slate-900",
      cell: (i) => <>{i.item}<AttachmentLink att={i.attachment} /></> },
    { key: "sku", head: t("finance.i_sku"), role: "meta", tdClass: "text-slate-600", value: (i) => i.sku, cell: (i) => i.sku || "—" },
    { key: "qty", head: t("finance.i_qty"), role: "meta", tdClass: "tabular-nums text-slate-700",
      value: (i) => i.quantity, cell: (i) => `${i.quantity ?? 0} ${i.unit || ""}`.trim() },
    { key: "unitcost", head: t("finance.i_unitcost"), role: "meta", tdClass: "tabular-nums text-slate-700", value: (i) => i.unit_cost, cell: (i) => f(i.unit_cost) },
    { key: "vendor", head: t("finance.c_vendor"), role: "meta", tdClass: "text-slate-600", value: (i) => i.vendor_name, cell: (i) => i.vendor_name || "—" },
    { key: "value", head: t("finance.i_value"), role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900", cell: (i) => f(i.value) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      // Audit F-04 — stock used for an order: its cost reaches profit.
      cell: (i) => (
        <span className="inline-flex items-center justify-end gap-1">
          {onUse && Number(i.quantity) > 0 && (
            <button type="button" className={SMALL_PILL} data-testid={`inventory-use-${i.id}`}
              onClick={() => onUse({ ...i, currency: i.currency || cur })}>Use</button>
          )}
          <DeleteButton onClick={() => onDelete([{ kind: "inventory", id: i.id }])} testid={`inventory-delete-${i.id}`} label="Delete item" />
        </span>
      ) },
  ];
  return (
    <div className="space-y-5">
      <AiPanel scope="inventory" scopeLabel={t("finance.t_inventory").toLowerCase()} />
      <ListCard title={t("finance.t_inventory")} count={loading || error ? null : rows.length}
        action={<SelectToggle sel={sel} rows={rows} testid="inventory-select" />}>
        <Records loading={loading} error={error} what="inventory" rows={rows}
          empty={<EmptyNote icon={Package} title={t("finance.empty_inv_title")} hint={t("finance.empty_inv_hint")} />}>
          <DataList columns={columns} rows={rows} rowKey={(i) => i.id} rowTestid={(i) => `inv-row-${i.id}`} testid="inventory-table" select={sel} />
        </Records>
      </ListCard>
      <SelectionBar sel={sel} onDelete={() => onDelete(sel.items(), sel.stop)} />
    </div>
  );
}
