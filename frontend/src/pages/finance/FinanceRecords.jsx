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
import { DataList } from "../../components/karma/DataList";
import { GlassSelect } from "../../components/karma/GlassSelect";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { DRAWER_TRACK, GLASS_MENU, INK_PILL } from "../../components/karma/glass";
import { AiPanel } from "./FinanceAi";
import {
  AttachmentLink, CARD, EmptyNote, FIELD, LoadError, SMALL_INK, SMALL_PILL, SourceTag, TONE_CHIP, Tag, fmt,
} from "./financeKit";
import { daysSince, isInvoiceOverdue, overdueDays } from "./ledgerMath";

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
              {p.contact_name || "Unknown"}{p.date ? ` · ${p.date}` : ""}{p.invoice_number ? ` · ref ${p.invoice_number}` : ""}
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

export function RevenueTab({ data, loading, error, cur, onDelete, onChange, initialFilter = "all" }) {
  const f = fmt(cur);
  const tt = data?.totals || {};
  const invoices = useMemo(() => data?.invoices || [], [data]);
  const payments = data?.payments || [];
  // U7-08.1: status filter + sort; KR-10: ?filter= seeds the filter.
  const [statusFilter, setStatusFilter] = useState(FILTER_KEYS.includes(initialFilter) ? initialFilter : "all");
  const [sortKey, setSortKey] = useState("date-desc");

  const awaiting = (s) => s.status !== "paid" && s.status !== "partial";
  const overdueCount = invoices.filter((s) => isInvoiceOverdue(s)).length;
  const counts = {
    all: invoices.length,
    awaiting: invoices.filter(awaiting).length,
    partial: invoices.filter((s) => s.status === "partial").length,
    paid: invoices.filter((s) => s.status === "paid").length,
    overdue: overdueCount,
  };

  const filtered = useMemo(() => {
    let list = invoices;
    if (statusFilter === "overdue") list = list.filter((s) => isInvoiceOverdue(s));
    else if (statusFilter === "awaiting") list = list.filter((s) => s.status !== "paid" && s.status !== "partial");
    else if (statusFilter === "partial") list = list.filter((s) => s.status === "partial");
    else if (statusFilter === "paid") list = list.filter((s) => s.status === "paid");
    const sorted = [...list];
    if (sortKey === "date-desc") sorted.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    else if (sortKey === "date-asc") sorted.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    else if (sortKey === "amount-desc") sorted.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    else if (sortKey === "overdue") sorted.sort((a, b) => (daysSince(b.date) || 0) - (daysSince(a.date) || 0));
    return sorted;
  }, [invoices, statusFilter, sortKey]);
  const filteredTotal = filtered.reduce((sum, s) => sum + (s.amount || 0), 0);

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
      value: (s) => s.date, cell: (s) => s.date || "—" },
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
      cell: (s) => f(s.amount) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (s) => <DeleteButton onClick={() => onDelete("invoice", s.id)} testid={`revenue-invoice-delete-${s.id}`} label="Delete invoice" /> },
  ];
  const paymentColumns = [
    { key: "customer", head: "Customer", role: "title", tdClass: "font-medium text-slate-900",
      cell: (p) => <>{p.contact_name || "—"}<SourceTag source={p.source} /></> },
    { key: "date", head: "Date", role: "meta", tdClass: "tabular-nums text-slate-600", value: (p) => p.date, cell: (p) => p.date || "—" },
    { key: "method", head: "Method", role: "meta", tdClass: "text-slate-600", value: (p) => p.method, cell: (p) => p.method || "—" },
    { key: "ref", head: "Reference", role: "meta", tdClass: "text-slate-600",
      value: (p) => p.reference || p.invoice_number, cell: (p) => p.reference || p.invoice_number || "—" },
    { key: "amount", head: "Amount", role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900", cell: (p) => f(p.amount) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (p) => <DeleteButton onClick={() => onDelete("payment", p.id)} testid={`revenue-payment-delete-${p.id}`} label="Delete payment" /> },
  ];

  return (
    <div className="space-y-5" data-testid="ledger-revenue">
      <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
        <MoneyTile icon={cur === "INR" ? CurrencyInr : CurrencyCircleDollar} tone="emerald" label="Billed" value={f(tt.billed || 0)}
          note={plural(invoices.length, "invoice")} testid="kpi-billed" />
        <MoneyTile icon={DownloadSimple} tone="sky" label="Received" value={f(tt.received || 0)}
          note={plural(payments.length, "payment")} testid="kpi-received-rev" />
        <MoneyTile icon={WarningCircle} tone={overdueCount > 0 ? "rose" : "slate"} label="Outstanding" value={f(tt.outstanding || 0)}
          note={overdueCount > 0 ? `${overdueCount} overdue` : "Nothing overdue"} testid="kpi-outstanding" />
      </div>

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

      <AiPanel scope="revenue" scopeLabel="revenue" />

      <ListCard title="Sales & service invoices" count={invoices.length}
        action={invoices.length > 0 && (
          <GlassSelect testid="revenue-sort" ariaLabel="Sort invoices" value={sortKey} onChange={setSortKey} align="end"
            options={SORTS} triggerClassName="h-10 w-auto min-w-[11rem] text-sm" />
        )}>
        {invoices.length > 0 && (
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
        {invoices.length === 0 ? (
          <EmptyNote icon={Receipt} title="No invoices yet" hint="Record a sale or service with Add income, or send a sales invoice by WhatsApp or upload — it lands here." />
        ) : filtered.length === 0 ? (
          <EmptyNote icon={Receipt} title={`No ${FILTERS.find((x) => x.key === statusFilter)?.label.toLowerCase()} invoices`} hint="Try a different filter, or clear it to see all." />
        ) : (
          <DataList testid="revenue-invoices-table" rows={filtered} rowKey={(s) => s.id}
            rowTestid={(s) => `revenue-invoice-row-${s.id}`}
            rowClass={(s) => (isInvoiceOverdue(s) ? "bg-rose-50/40" : "")}
            footer={filtered.length > 1 ? { label: `Showing ${filtered.length} of ${invoices.length}`, value: f(filteredTotal), testid: "revenue-filtered-total" } : undefined}
            columns={invoiceColumns} />
        )}
      </ListCard>

      {payments.length > 0 && (
        <ListCard title="Payments received" count={payments.length}>
          <DataList testid="revenue-payments-table" rows={payments} rowKey={(p) => p.id}
            rowTestid={(p) => `revenue-payment-row-${p.id}`} columns={paymentColumns} />
        </ListCard>
      )}
    </div>
  );
}

export function ExpensesTab({ rows, loading, error, payables, cur, onDelete, onChange }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  const columns = [
    { key: "title", head: t("finance.c_title"), role: "title", tdClass: "font-medium text-slate-900",
      cell: (e) => <>{e.title}<SourceTag source={e.source} /><AttachmentLink att={e.attachment} /></> },
    { key: "category", head: t("finance.c_category"), role: "chip", cell: (e) => (e.category ? <Tag className="normal-case">{e.category}</Tag> : <span className="text-slate-400">—</span>) },
    { key: "vendor", head: t("finance.c_vendor"), role: "meta", tdClass: "text-slate-600", value: (e) => e.vendor_name, cell: (e) => e.vendor_name || "—" },
    { key: "date", head: t("finance.c_date"), role: "meta", tdClass: "tabular-nums text-slate-600", value: (e) => e.date, cell: (e) => e.date || "—" },
    { key: "status", head: t("finance.c_status"), role: "chip",
      cell: (e) => (
        <Tag tone={e.status === "paid" ? "good" : e.status === "awaiting_bill" ? "quiet" : "warn"}>
          {e.status === "paid" ? t("finance.paid") : e.status === "awaiting_bill" ? "awaiting bill" : t("finance.unpaid")}
        </Tag>
      ) },
    { key: "amount", head: t("finance.c_amount"), role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900", cell: (e) => f(e.amount) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (e) => <DeleteButton onClick={() => onDelete(e.id)} testid={`expense-delete-${e.id}`} label="Delete expense" /> },
  ];
  return (
    <div className="space-y-5">
      <NeedsMatchingPanel title="Supplier payments to match" testid="payables-needs-matching"
        hint="These payments to suppliers couldn’t be auto-linked to a purchase bill. Pick the bill they settle, or mark it as a standalone expense."
        unmatched={payables?.unmatched_payments} open={payables?.open_invoices || []} cur={cur}
        endpoint="/payables/payment" standaloneLabel={{ btn: "Standalone expense", done: "Booked as a standalone expense" }}
        onChange={onChange} />
      <AiPanel scope="expenses" scopeLabel={t("finance.t_expenses").toLowerCase()} />
      <ListCard title={t("finance.t_expenses")} count={loading || error ? null : rows.length}>
        <Records loading={loading} error={error} what="expenses" rows={rows}
          empty={<EmptyNote icon={Receipt} title={t("finance.empty_exp_title")} hint={t("finance.empty_exp_hint")} />}>
          <DataList columns={columns} rows={rows} rowKey={(e) => e.id} rowTestid={(e) => `expense-row-${e.id}`} testid="expenses-table" />
        </Records>
      </ListCard>
    </div>
  );
}

export function AssetsTab({ rows, loading, error, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
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
    { key: "bought", head: t("finance.a_bought"), role: "meta", tdClass: "tabular-nums text-slate-600", value: (a) => a.purchase_date, cell: (a) => a.purchase_date || "—" },
    { key: "status", head: t("finance.c_status"), role: "chip",
      cell: (a) => {
        const st = STATUS[a.status] || { tone: "quiet", label: a.status || "—" };
        return <Tag tone={st.tone} className="normal-case">{st.label}</Tag>;
      } },
    { key: "value", head: t("finance.a_value"), role: "amount", align: "right", tdClass: "font-semibold tabular-nums text-slate-900", cell: (a) => f(a.purchase_amount) },
    { key: "act", head: <span className="sr-only">Actions</span>, role: "action", align: "right",
      cell: (a) => <DeleteButton onClick={() => onDelete(a.id)} testid={`asset-delete-${a.id}`} label="Delete asset" /> },
  ];
  return (
    <div className="space-y-5">
      <AiPanel scope="assets" scopeLabel={t("finance.t_assets").toLowerCase()} />
      <ListCard title={t("finance.t_assets")} count={loading || error ? null : rows.length}>
        <Records loading={loading} error={error} what="assets" rows={rows}
          empty={<EmptyNote icon={Buildings} title={t("finance.empty_asset_title")} hint={t("finance.empty_asset_hint")} />}>
          <DataList columns={columns} rows={rows} rowKey={(a) => a.id} rowTestid={(a) => `asset-row-${a.id}`} testid="assets-table" />
        </Records>
      </ListCard>
    </div>
  );
}

export function InventoryTab({ rows, loading, error, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
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
      cell: (i) => <DeleteButton onClick={() => onDelete(i.id)} testid={`inventory-delete-${i.id}`} label="Delete item" /> },
  ];
  return (
    <div className="space-y-5">
      <AiPanel scope="inventory" scopeLabel={t("finance.t_inventory").toLowerCase()} />
      <ListCard title={t("finance.t_inventory")} count={loading || error ? null : rows.length}>
        <Records loading={loading} error={error} what="inventory" rows={rows}
          empty={<EmptyNote icon={Package} title={t("finance.empty_inv_title")} hint={t("finance.empty_inv_hint")} />}>
          <DataList columns={columns} rows={rows} rowKey={(i) => i.id} rowTestid={(i) => `inv-row-${i.id}`} testid="inventory-table" />
        </Records>
      </ListCard>
    </div>
  );
}
