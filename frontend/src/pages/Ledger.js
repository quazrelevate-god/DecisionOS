// /finance — Finance, rebuilt end to end on the founder's reference
// (2026-09-14).
//
// The shell: the section tabs (Overview, Revenue, Expenses, Assets,
// Inventory, Inbox) as a glass track, a breadcrumb, the title and its line,
// the period (Overview) and the Add record split button; Quick capture under
// it; then the tab. The pieces live in pages/finance/*:
//   ledgerMath        the period, change and trend arithmetic (honest windows)
//   financeKit        the shared glass pieces
//   FinanceOverview   KPI tiles, the AI brief, spend by category, top vendors
//   FinanceAi         the AI brief / analysis, action items, ask
//   FinanceRecords    Revenue, Expenses, Assets, Inventory
//   FinanceForms      the Add dialogs and the Add record control
//   ReviewPanel       review an uploaded document before filing it
//
// Two behaviour fixes ride along:
//   * The tab lives in the URL (?tab=). Before, it was read once on mount, so
//     every same-page link (a tile, "View all", /finance?tab=revenue&filter=
//     overdue from the Desk) changed the address and not the page.
//   * Adding works on a phone (the Add control was desktop-only) and the phone
//     capture card's "Add expense" opens the dialog (it clicked a selector
//     nothing carried — FN-08).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight, Buildings, CalendarBlank, Camera, CaretRight, ChartPieSlice, ChatCircleDots, CurrencyInr, FilePdf,
  Package, Plus, Receipt, Sparkle, Tray, UploadSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { useIsMobile } from "../hooks/useIsMobile";
import { StickyHeader } from "../components/common";
import { GlassSelect } from "../components/karma/GlassSelect";
import { GLASS_PILL, INK_PILL } from "../components/karma/glass";
import { CaptureReview } from "./Captures";
import ReviewPanel from "./finance/ReviewPanel";
import { AddRecordControl, AddRecordDialogs } from "./finance/FinanceForms";
import { OverviewTab } from "./finance/FinanceOverview";
import { AssetsTab, ExpensesTab, InventoryTab, RevenueTab } from "./finance/FinanceRecords";
import { CARD, FIELD, LoadError } from "./finance/financeKit";
import { LIST_LIMIT, PERIODS, periodOf } from "./finance/ledgerMath";

const TABS = [
  { key: "overview", tkey: "finance.t_overview", icon: ChartPieSlice },
  { key: "revenue", tkey: "finance.t_revenue", icon: CurrencyInr },
  { key: "expenses", tkey: "finance.t_expenses", icon: Receipt },
  { key: "assets", tkey: "finance.t_assets", icon: Buildings },
  { key: "inventory", tkey: "finance.t_inventory", icon: Package },
  // Epic 2 Sprint 4 (E2-24): the Capture Review Queue, formerly /ingest.
  { key: "inbox", tkey: "finance.t_inbox", icon: Tray },
];
const PERIOD_KEY = "finance.period";

function SectionTabs({ tab, setTab, pendingCount, isMobile }) {
  const { t } = useTranslation();
  const prefix = isMobile ? "ledger-tab-mobile" : "ledger-tab";
  return (
    /* On a phone the track scrolls and bleeds to the page gutter, so the last
       pill is cut by the screen — the thing that reads as "there is more".
       `relative` makes the scroller the containing block of the sr-only badge
       text: an absolutely positioned child of a non-positioned scroller escapes
       its clip and widened the whole page by ~190px. */
    <div className={isMobile ? "relative -mx-4 min-w-0 self-stretch overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex justify-center"}>
      <div role="group" aria-label={t("nav.finance", "Finance")} data-testid={isMobile ? "ledger-tabs-mobile" : "ledger-tabs"}
        className={`inline-flex gap-1 rounded-pill p-1 ${GLASS_PILL}`}>
        {TABS.map((tb) => {
          const active = tab === tb.key;
          return (
            <button key={tb.key} type="button" onClick={() => setTab(tb.key)} aria-pressed={active} data-testid={`${prefix}-${tb.key}`}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25",
                active ? cn(INK_PILL, "font-medium") : "text-slate-600 hover:bg-white hover:text-slate-900",
              )}>
              <tb.icon size={15} aria-hidden="true" />
              {t(tb.tkey)}
              {tb.key === "inbox" && pendingCount > 0 && (
                <>
                  <span aria-hidden="true" className={cn(
                    "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-orange-500 text-white",
                  )}>{pendingCount}</span>
                  <span className="sr-only">, {pendingCount} waiting</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Epic 2 Sprint 4 (E2-25): capture stays one click from every Finance tab.
function QuickCapture({ pendingCount, isMobile, onIngested, onOpenInbox, onAddExpense }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canIngest = user?.role === "owner" || hasPerm(user, "data_input");
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(null);
  const [question, setQuestion] = useState("");

  const upload = async (endpoint, file) => {
    if (!file) return;
    setUploading(true);
    setActive(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.status === "failed") {
        toast.error("Extraction failed: " + (data.error || "unreadable file"));
      } else {
        setActive(data);
        toast.success("Extracted — review below");
      }
      qc.invalidateQueries({ queryKey: ["ingestions"] });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Upload failed");
    } finally {
      setUploading(false);
    }
  };
  const ask = (e) => {
    e.preventDefault();
    const q = question.trim();
    if (q) navigate(`/brain?q=${encodeURIComponent(q)}`);
  };

  const sfx = isMobile ? "-m" : "";
  const pick = (key, Icon, label, endpoint, accept, title, capture) => (
    <label key={key} data-testid={`finance-hero-${key}${sfx}`} title={title}
      className={cn(
        `flex h-11 cursor-pointer items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-white focus-within:ring-2 focus-within:ring-neutral-900/25 ${GLASS_PILL}`,
        isMobile && "justify-center px-3",
        uploading && "pointer-events-none opacity-60",
      )}>
      <Icon size={17} aria-hidden="true" /> {label}
      <input type="file" className="sr-only" accept={accept} {...(capture ? { capture } : {})}
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; upload(endpoint, file); }} />
    </label>
  );
  const askForm = (
    <form onSubmit={ask} className={cn("flex min-w-0 items-center gap-2.5", isMobile ? "mt-4" : "ml-auto")}>
      {!isMobile && (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-600">
          <Sparkle size={15} weight="fill" aria-hidden="true" className="text-orange-500" /> Need help?
        </span>
      )}
      <label className="relative min-w-0 flex-1 lg:w-80 lg:flex-none">
        <span className="sr-only">Ask Dex anything about your finances</span>
        <ChatCircleDots size={16} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="finance-ask"
          placeholder="Ask about your finances…" className={cn(FIELD, "rounded-pill pl-10 pr-12")} />
        <button type="submit" aria-label="Ask Dex" data-testid="finance-ask-send" disabled={!question.trim()}
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-slate-900/[0.06] text-slate-600 transition-colors hover:bg-slate-900 hover:text-white disabled:opacity-40 disabled:hover:bg-slate-900/[0.06] disabled:hover:text-slate-600">
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </button>
      </label>
    </form>
  );

  return (
    <>
      {isMobile ? (
        <section data-testid="finance-capture-hero-mobile" className={`mb-5 p-4 ${CARD}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-slate-900">Quick capture</p>
              <p className="mt-0.5 text-xs text-slate-500">Upload a bill or receipt and AI reads it for you.</p>
            </div>
            {canIngest && (
              <button type="button" onClick={onOpenInbox} data-testid="finance-hero-inbox-m"
                aria-label={pendingCount > 0 ? `Open Inbox, ${pendingCount} waiting` : "Open Inbox"}
                className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full ${INK_PILL}`}>
                <Tray size={16} aria-hidden="true" />
                {pendingCount > 0 && (
                  <span aria-hidden="true" className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}
          </div>
          {canIngest && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {pick("doc", FilePdf, "Upload bill", "/ingest/document", "image/*,application/pdf", "Upload a bill or receipt (PDF or photo)")}
              {pick("photo", Camera, "Photo", "/ingest/document", "image/*", "Take a photo of a receipt", "environment")}
              <button type="button" data-testid="finance-hero-add-m" onClick={onAddExpense}
                className={`flex h-11 items-center justify-center gap-2 rounded-pill px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
                <Plus size={17} aria-hidden="true" /> Add expense
              </button>
              {pick("csv", UploadSimple, "CSV / Excel", "/ingest/csv", ".csv,.xlsx,.xls", "Bulk import from CSV or Excel")}
            </div>
          )}
          {askForm}
          {uploading && <p role="status" className="mt-3 text-xs text-slate-500">Extracting…</p>}
        </section>
      ) : (
        <section data-testid="finance-capture-hero" className={`mb-5 flex flex-wrap items-center gap-2.5 p-2.5 pl-5 ${CARD}`}>
          {canIngest && (
            <>
              <span className="text-sm font-medium text-slate-800">Quick capture</span>
              <span aria-hidden="true" className="mx-1 h-6 w-px bg-slate-900/10" />
              {pick("doc", FilePdf, "Upload bill / receipt", "/ingest/document", "image/*,application/pdf", "Upload a bill or receipt (PDF or photo)")}
              {pick("photo", Camera, "Photo", "/ingest/document", "image/*", "Take a photo of a receipt", "environment")}
              {pick("csv", UploadSimple, "CSV / Excel", "/ingest/csv", ".csv,.xlsx,.xls", "Bulk import from CSV or Excel")}
              {pendingCount > 0 && (
                <button type="button" data-testid="finance-hero-inbox-badge" onClick={onOpenInbox}
                  className={`flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium ${INK_PILL}`}>
                  <Tray size={16} aria-hidden="true" /> {pendingCount} in Inbox <ArrowRight size={13} weight="bold" aria-hidden="true" />
                </button>
              )}
              {uploading && <span role="status" className="text-xs text-slate-500">Extracting…</span>}
            </>
          )}
          {askForm}
        </section>
      )}
      {active && (
        <div className="mb-5" data-testid="finance-hero-review">
          <ReviewPanel ingestion={active} onFiled={() => { setActive(null); onIngested?.(); }} onCancel={() => setActive(null)} />
        </div>
      )}
    </>
  );
}

function OverviewSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="space-y-5" data-testid="ledger-loading">
      <p className="sr-only">{t("finance.loading")}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ds-skeleton h-[176px] rounded-[1.6rem]" />)}
      </div>
      <div className="ds-skeleton h-[420px] rounded-[1.6rem]" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="ds-skeleton h-[320px] rounded-[1.6rem]" />
        <div className="ds-skeleton h-[320px] rounded-[1.6rem]" />
      </div>
    </div>
  );
}

export default function Ledger() {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = TABS.some((tb) => tb.key === tabParam) ? tabParam : "overview";
  const current = TABS.find((tb) => tb.key === tab);
  // KR-10 — /inbox and Ops link to ?tab=revenue&filter=overdue.
  const filterParam = searchParams.get("filter") || "all";
  const setTab = (key) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (key === "overview") next.delete("tab"); else next.set("tab", key);
    next.delete("filter");
    return next;
  });
  const [period, setPeriodState] = useState(() => {
    try { return periodOf(localStorage.getItem(PERIOD_KEY)).value; } catch { return PERIODS[0].value; }
  });
  const setPeriod = (value) => {
    setPeriodState(value);
    try { localStorage.setItem(PERIOD_KEY, value); } catch { /* storage unavailable — the choice lasts this visit */ }
  };
  const [adding, setAdding] = useState(null);

  const invalidate = () => ["ledger-summary", "expenses", "assets", "inventory", "revenue", "payables"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const summaryQ = useQuery({ queryKey: ["ledger-summary"], queryFn: () => api.get("/ledger/summary").then((r) => r.data) });
  const expensesQ = useQuery({ queryKey: ["expenses"], queryFn: () => api.get("/expenses", { params: { limit: LIST_LIMIT } }).then((r) => r.data) });
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => api.get("/assets", { params: { limit: LIST_LIMIT } }).then((r) => r.data) });
  const inventoryQ = useQuery({ queryKey: ["inventory"], queryFn: () => api.get("/inventory", { params: { limit: LIST_LIMIT } }).then((r) => r.data) });
  const revenueQ = useQuery({ queryKey: ["revenue"], queryFn: () => api.get("/revenue").then((r) => r.data) });
  const payablesQ = useQuery({ queryKey: ["payables"], queryFn: () => api.get("/payables").then((r) => r.data) });
  const capPendingQ = useQuery({
    queryKey: ["captures-pending"],
    queryFn: () => api.get("/captures/pending-count").then((r) => r.data),
    refetchInterval: 30000,
  });
  const pendingCount = capPendingQ.data?.count || 0;

  const summary = summaryQ.data;
  const cur = summary?.currency || tenant?.currency || "INR";
  const overviewReady = !summaryQ.isLoading && !revenueQ.isLoading && !expensesQ.isLoading && !assetsQ.isLoading && !inventoryQ.isLoading;

  const del = async (kind, id) => {
    try { await api.delete(`/${kind}/${id}`); invalidate(); toast.success(t("finance.deleted")); }
    catch { toast.error(t("finance.del_failed")); }
  };
  const delRevenue = async (kind, id) => {
    try { await api.delete(`/revenue/${kind}/${id}`); invalidate(); toast.success(t("finance.deleted")); }
    catch { toast.error(t("finance.del_failed")); }
  };

  return (
    <div data-testid="finance-page">
      <StickyHeader className="mb-5 lg:mb-6">
        <SectionTabs tab={tab} setTab={setTab} pendingCount={pendingCount} isMobile={isMobile} />
        <nav aria-label="Breadcrumb" className="mt-4 lg:mt-5">
          <ol className="flex items-center gap-1.5 text-sm text-slate-500">
            <li>
              {tab === "overview"
                ? t("finance.title")
                : <button type="button" onClick={() => setTab("overview")} className="rounded hover:text-slate-800 hover:underline">{t("finance.title")}</button>}
            </li>
            <li aria-hidden="true"><CaretRight size={11} weight="bold" /></li>
            <li aria-current="page" className="font-medium text-slate-700">{t(current.tkey)}</li>
          </ol>
        </nav>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl">{t("finance.title")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
              {t("finance.subtitle", "Track your money flow, control costs, and make smarter decisions.")}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto" data-testid="ledger-controls">
            {tab === "overview" && (
              <GlassSelect testid="finance-period" ariaLabel="Period" value={period} onChange={setPeriod} align="end" icon={CalendarBlank}
                options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} triggerClassName="h-11 w-auto min-w-[11rem] text-sm" />
            )}
            <AddRecordControl tab={tab} onPick={setAdding} />
          </div>
        </div>
      </StickyHeader>

      <QuickCapture pendingCount={pendingCount} isMobile={isMobile}
        onIngested={() => { invalidate(); qc.invalidateQueries({ queryKey: ["captures-pending"] }); }}
        onOpenInbox={() => setTab("inbox")} onAddExpense={() => setAdding("expense")} />

      {tab === "overview" && (
        summaryQ.isError ? (
          <LoadError title="Couldn't load your finances" hint="You may not have the Finance permission, or the connection dropped. Try again in a moment." />
        ) : !overviewReady ? (
          <OverviewSkeleton />
        ) : (
          <OverviewTab summary={summary} revenue={revenueQ.data} expenses={expensesQ.data} assets={assetsQ.data}
            inventory={inventoryQ.data} period={period} cur={cur} onViewExpenses={() => setTab("expenses")} />
        )
      )}
      {tab === "revenue" && (
        <RevenueTab key={filterParam} data={revenueQ.data} loading={revenueQ.isLoading} error={revenueQ.isError}
          cur={cur} onDelete={delRevenue} onChange={invalidate} initialFilter={filterParam} />
      )}
      {tab === "expenses" && (
        <ExpensesTab rows={expensesQ.data || []} loading={expensesQ.isLoading} error={expensesQ.isError} payables={payablesQ.data}
          cur={cur} onDelete={(id) => del("expenses", id)} onChange={invalidate} />
      )}
      {tab === "assets" && (
        <AssetsTab rows={assetsQ.data || []} loading={assetsQ.isLoading} error={assetsQ.isError} cur={cur} onDelete={(id) => del("assets", id)} />
      )}
      {tab === "inventory" && (
        <InventoryTab rows={inventoryQ.data || []} loading={inventoryQ.isLoading} error={inventoryQ.isError} cur={cur} onDelete={(id) => del("inventory", id)} />
      )}
      {tab === "inbox" && <CaptureReview />}

      <AddRecordDialogs adding={adding} setAdding={setAdding} categories={summary?.categories || []}
        assetCategories={summary?.asset_categories || []} cur={cur} onDone={invalidate} />
    </div>
  );
}
