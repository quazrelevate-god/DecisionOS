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
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastAiConsentOr } from "../lib/aiConsent";
import {
  ArrowRight, Buildings, Camera, ChartPieSlice, CurrencyInr, FilePdf,
  Package, Plus, Receipt, Tray, UploadSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { useIsMobile } from "../hooks/useIsMobile";
import { StickyHeader } from "../components/common";
import { GlassSelect } from "../components/neuglass/GlassSelect";
import { GLASS_PILL, INK_PILL } from "../components/neuglass/glass";
import { CaptureReview } from "./Captures";
import ReviewPanel from "./finance/ReviewPanel";
import { AddRecordControl, AddRecordDialogs } from "./finance/FinanceForms";
import { OverviewTab } from "./finance/FinanceOverview";
import { AssetsTab, ExpensesTab, InventoryTab, RevenueTab } from "./finance/FinanceRecords";
import { RecordPaymentDialog, SetRateDialog, UseStockDialog } from "./finance/MoneyActions";
import { FinanceMoreMenu, useFinanceDelete } from "./finance/FinanceDelete";
import { CARD, LoadError } from "./finance/financeKit";
import { LIST_LIMIT, PERIODS, oldestRecord, periodOf, periodWindow } from "./finance/ledgerMath";
import { PeriodPicker } from "./finance/PeriodPicker";

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
// The tabs a period applies to: money moving. Assets and stock are what the
// company holds, and the Inbox is work waiting — a period would only hide them.
const PERIOD_TABS = ["overview", "revenue", "expenses"];

/* 2026-10-29 (founder: the year has to roll over by itself) — the date, as a
   value that changes when the day does, so a page left open over midnight on
   31 March opens the new financial year without a reload. */
function useToday() {
  const [day, setDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const check = () => setDay((d) => (d === new Date().toDateString() ? d : new Date().toDateString()));
    const t = setInterval(check, 60000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);
  return day;
}

function SectionTabs({ tab, setTab, pendingCount, isMobile, tabs = TABS }) {
  const { t } = useTranslation();
  const prefix = isMobile ? "ledger-tab-mobile" : "ledger-tab";
  /* 2026-09-15, founder — on a phone all six tabs fit the screen, as in the
     mobile app: six equal cells, the icon stacked over the label, no sideways
     scroll. The pending count rides on the Inbox icon as a small badge. */
  if (isMobile) {
    return (
      <div role="group" aria-label={t("nav.finance", "Finance")} data-testid="ledger-tabs-mobile"
        className={cn("relative grid w-full gap-0.5 rounded-[1.25rem] p-1", tabs.length === 6 ? "grid-cols-6" : "grid-cols-1", GLASS_PILL)}>
        {tabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <button key={tb.key} type="button" onClick={() => setTab(tb.key)} aria-pressed={active} data-testid={`${prefix}-${tb.key}`}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25",
                active ? cn(INK_PILL, "font-medium") : "text-slate-600 hover:bg-white hover:text-slate-900",
              )}>
              <span className="relative">
                <tb.icon size={17} aria-hidden="true" />
                {tb.key === "inbox" && pendingCount > 0 && (
                  <span aria-hidden="true" className={cn(
                    "absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold tabular-nums",
                    active ? "bg-white text-neutral-900" : "bg-orange-500 text-white",
                  )}>{pendingCount}</span>
                )}
              </span>
              <span className="w-full truncate text-center text-[10.5px] leading-tight">{t(tb.tkey)}</span>
              {tb.key === "inbox" && pendingCount > 0 && <span className="sr-only">, {pendingCount} waiting</span>}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex">
      <div role="group" aria-label={t("nav.finance", "Finance")} data-testid={isMobile ? "ledger-tabs-mobile" : "ledger-tabs"}
        className={`inline-flex gap-1 rounded-pill p-1 ${GLASS_PILL}`}>
        {tabs.map((tb) => {
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
function QuickCapture({ pendingCount, isMobile, canLedger, tab, onIngested, onOpenInbox, onAddExpense }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canIngest = hasPerm(user, "data_input");
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(null);

  const upload = async (endpoint, file) => {
    if (!file) return;
    setUploading(true);
    setActive(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.status === "failed") {
        // 2026-09-26 — a consent refusal here read as "Extraction failed: 451: {…}".
        toastAiConsentOr(data.error, "Extraction failed: " + (data.error || "unreadable file"));
      } else {
        setActive(data);
        /* BUG-16 (XCODITS QA, 2026-10-21) — READ IS NOT SAVED. This said
           "Extracted" in a success toast, and testers took that as filed;
           nothing is saved until File it. It waits in the Inbox's Pending
           until it is filed or discarded. */
        const found = ["contacts", "invoices", "payments", "tasks"].some((k) => (data.records?.[k] || []).length);
        if (found) toast.message("Read it — check the details below, then tap File it to save it.");
        else toast.error(canLedger
          ? "Nothing could be read from this file. Discard it, or add it by hand."
          : "Nothing could be read from this file. Discard it and try a clearer photo.");
      }
      qc.invalidateQueries({ queryKey: ["ingestions"] });
      qc.invalidateQueries({ queryKey: ["captures-pending"] });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Upload failed");
    } finally {
      setUploading(false);
    }
  };
  const sfx = isMobile ? "-m" : "";
  const pick = (key, Icon, label, endpoint, accept, title, capture, extra) => (
    <label key={key} data-testid={`finance-hero-${key}${sfx}`} title={title}
      className={cn(
        `flex h-11 cursor-pointer items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-white focus-within:ring-2 focus-within:ring-neutral-900/25 ${GLASS_PILL}`,
        isMobile && "justify-center px-3",
        uploading && "pointer-events-none opacity-60",
        extra,
      )}>
      <Icon size={17} aria-hidden="true" /> {label}
      <input type="file" className="sr-only" accept={accept} {...(capture ? { capture } : {})}
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; upload(endpoint, file); }} />
    </label>
  );
  /* Audit F-06 (2026-10-09) — ONE PLACE TO ASK. This hero carried an "Ask
     about your finances…" box that went to Dex, and the AI panel below has its
     own that answers from the books; two boxes, one question. The panel's
     stays (it knows which tab you are on). Without Data Input there is nothing
     left to show here. */
  if (!canIngest) return null;
  /* BUG-15 (XCODITS QA, 2026-10-21) — THE PHONE CARD HAS NO WAY-TO-INBOX.
     It carried a round black tray icon with no visible label: the testers
     called it the "index box button" and could not tell what it was for. It
     only switched to the Inbox tab, which sits in the row above it, so on the
     Inbox (where most staff always are) it did nothing at all. A labelled
     "3 in Inbox →" pill replaced it for a day; 2026-10-22 (founder): not on
     the phone either — the Inbox tab already carries the count on its icon.
     Desktop keeps its pill, shown only when something waits elsewhere. */
  const showInbox = pendingCount > 0 && tab !== "inbox";
  return (
    <>
      {isMobile ? (
        <section data-testid="finance-capture-hero-mobile" className={`mb-5 p-4 ${CARD}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-slate-900">Quick capture</p>
              <p className="mt-0.5 text-xs text-slate-500">Upload a bill or receipt and AI reads it for you.</p>
            </div>
          </div>
          {canIngest && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {pick("doc", FilePdf, "Upload bill", "/ingest/document", "image/*,application/pdf", "Upload a bill or receipt (PDF or photo)")}
              {pick("photo", Camera, "Photo", "/ingest/document", "image/*", "Take a photo of a receipt", "environment")}
              {/* BUG-16 — adding an expense by hand needs Finance (the server
                  refuses it otherwise), so it is offered only to who can. */}
              {canLedger && (
                <button type="button" data-testid="finance-hero-add-m" onClick={onAddExpense}
                  className={`flex h-11 items-center justify-center gap-2 rounded-pill px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
                  <Plus size={17} aria-hidden="true" /> Add expense
                </button>
              )}
              {pick("csv", UploadSimple, "CSV / Excel", "/ingest/csv", ".csv,.xlsx,.xls", "Bulk import from CSV or Excel", undefined, !canLedger && "col-span-2")}
            </div>
          )}
          {uploading && <p role="status" className="mt-3 text-xs text-slate-500">Extracting…</p>}
        </section>
      ) : (
        <section data-testid="finance-capture-hero" className={`mb-5 flex flex-wrap items-center gap-2.5 p-2.5 pl-5 ${CARD}`}>
          {canIngest && (
            <>
              <span className="text-sm font-medium text-slate-800">Quick capture</span>
              <span aria-hidden="true" className="mx-1 h-6 w-px bg-slate-900/10" />
              {pick("doc", FilePdf, "Upload bill / receipt", "/ingest/document", "image/*,application/pdf", "Upload a bill or receipt (PDF or photo)")}
              {/* 2026-10-03 (founder) — no "Photo" on desktop: a computer has no
                  camera to point at a receipt, so it opened the same file picker
                  as "Upload bill / receipt", which already takes photos. The
                  phone keeps it (above), where it opens the camera. */}
              {pick("csv", UploadSimple, "CSV / Excel", "/ingest/csv", ".csv,.xlsx,.xls", "Bulk import from CSV or Excel")}
              {showInbox && (
                <button type="button" data-testid="finance-hero-inbox-badge" onClick={onOpenInbox}
                  className={`flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium ${INK_PILL}`}>
                  <Tray size={16} aria-hidden="true" /> {pendingCount} in Inbox <ArrowRight size={13} weight="bold" aria-hidden="true" />
                </button>
              )}
              {uploading && <span role="status" className="text-xs text-slate-500">Extracting…</span>}
            </>
          )}
        </section>
      )}
      {active && (
        <div className="mb-5" data-testid="finance-hero-review">
          <ReviewPanel ingestion={active} onFiled={() => { setActive(null); onIngested?.(); }}
            onCancel={() => { setActive(null); onIngested?.(); }} />
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
  const { tenant, user } = useAuth();
  /* FN-07 (JOURNEY-1 J9-01, J10-02) — FINANCE SHOWS WHAT YOU CAN ACTUALLY
     OPEN. This page is two things at once: the ledger, which is behind the
     `finance` permission on every endpoint (routers/ledger.py require_ledger),
     and the capture inbox, which anyone with `data_input` may use — which is
     why the nav offers it to both. What it did NOT do was tell them apart, so
     a sales person with data_input arrived at Overview and watched six calls
     come back 403. They get the Inbox, which is theirs, and the ledger tabs
     are not offered or fetched at all. */
  const canLedger = hasPerm(user, "finance");
  const tabs = canLedger ? TABS : TABS.filter((tb) => tb.key === "inbox");
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = tabs.some((tb) => tb.key === tabParam) ? tabParam : (canLedger ? "overview" : "inbox");
  // KR-10 — /inbox and Ops link to ?tab=revenue&filter=overdue.
  const filterParam = searchParams.get("filter") || "all";
  const setTab = (key) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (key === "overview") next.delete("tab"); else next.set("tab", key);
    next.delete("filter");
    return next;
  });
  const [period, setPeriodState] = useState(() => {
    // 2026-10-29 — a choice lasts this visit (sessionStorage); every new visit
    // opens on the current financial year, so a stale pick never greets anyone.
    try { return periodOf(sessionStorage.getItem(PERIOD_KEY)).value; } catch { return PERIODS[0].value; }
  });
  const setPeriod = (value) => {
    setPeriodState(value);
    try { sessionStorage.setItem(PERIOD_KEY, value); } catch { /* storage unavailable — the choice lasts until a reload */ }
  };
  const [adding, setAdding] = useState(null);
  // Audit F-02 / F-04: the invoice or bill being paid, the stock being used.
  const [paying, setPaying] = useState(null);
  const [usingStock, setUsingStock] = useState(null);
  const [settingRate, setSettingRate] = useState(null);   // audit: a foreign invoice's exchange rate

  const invalidate = () => ["ledger-summary", "expenses", "assets", "inventory", "revenue", "payables"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const summaryQ = useQuery({ queryKey: ["ledger-summary"], queryFn: () => api.get("/ledger/summary").then((r) => r.data), enabled: canLedger });
  const expensesQ = useQuery({ queryKey: ["expenses"], queryFn: () => api.get("/expenses", { params: { limit: LIST_LIMIT } }).then((r) => r.data), enabled: canLedger });
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => api.get("/assets", { params: { limit: LIST_LIMIT } }).then((r) => r.data), enabled: canLedger });
  const inventoryQ = useQuery({ queryKey: ["inventory"], queryFn: () => api.get("/inventory", { params: { limit: LIST_LIMIT } }).then((r) => r.data), enabled: canLedger });
  const revenueQ = useQuery({ queryKey: ["revenue"], queryFn: () => api.get("/revenue").then((r) => r.data), enabled: canLedger });
  const payablesQ = useQuery({ queryKey: ["payables"], queryFn: () => api.get("/payables").then((r) => r.data), enabled: canLedger });
  const capPendingQ = useQuery({
    queryKey: ["captures-pending"],
    queryFn: () => api.get("/captures/pending-count").then((r) => r.data),
    refetchInterval: 30000,
  });
  const pendingCount = capPendingQ.data?.count || 0;

  const summary = summaryQ.data;
  const today = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [today]);
  // How far back the period picker goes: the oldest dated record on the page.
  const periodWin = useMemo(() => periodWindow(period, tenant?.fy_start_month, now), [period, tenant?.fy_start_month, now]);
  const allDates = () => setPeriod("all");
  const earliest = useMemo(() => oldestRecord(revenueQ.data?.invoices || [], revenueQ.data?.payments || [],
    expensesQ.data || [], assetsQ.data || []), [revenueQ.data, expensesQ.data, assetsQ.data]);
  const cur = summary?.currency || tenant?.currency || "INR";
  const overviewReady = !summaryQ.isLoading && !revenueQ.isLoading && !expensesQ.isLoading && !assetsQ.isLoading && !inventoryQ.isLoading;

  /* 2026-10-22 (client) — a tap on the bin deleted the row on the spot, with
     no question and no way back, and got the books wrong as it went (a deleted
     payment left its invoice "received"). Every delete — one row or a
     selection — now asks first, saying what goes with it, and can be put back
     for 30 days (pages/finance/FinanceDelete, backend services/finance_trash). */
  const deleting = useFinanceDelete();

  return (
    <div data-testid="finance-page">
      {/* 2026-10-31 (founder) — on desktop the section tabs no longer take a
          row of their own above the title: they sit in the title's row, at the
          head of the controls on the right (Finance on the left). On a phone
          the tabs sit under the Finance title, pinned with it (2026-09-15). */}
      {/* 2026-09-15, founder — on a phone the Finance title and the section
          tabs are pinned together: StickyHeader lands in the frame's top slot,
          outside the scroller, so both stay put while the page moves under
          them. The period and Add record controls still scroll with the page. */}
      {isMobile && (
        <StickyHeader className="mb-5 flex flex-col gap-6" data-testid="finance-mobile-header">
          <h1 className="font-display text-3xl">{t("finance.title")}</h1>
          {tabs.length > 1 && <SectionTabs tab={tab} setTab={setTab} pendingCount={pendingCount} isMobile={isMobile} tabs={tabs} />}
        </StickyHeader>
      )}
      <div className="mb-5 lg:mb-6">
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-6 lg:items-center lg:gap-y-3">
          {/* 2026-09-15, founder — the "Track your money flow…" line is gone.
              Desktop only here; the phone title is pinned above with the tabs. */}
          {!isMobile && (
            <div className="min-w-0">
              <h1 className="font-display text-3xl sm:text-4xl">{t("finance.title")}</h1>
            </div>
          )}
          <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto lg:justify-end" data-testid="ledger-controls">
            {/* BUG-15 — without Finance the only tab is Inbox: a one-cell bar that
                is always selected and does nothing when tapped. Shown only when
                there is a choice to make. */}
            {!isMobile && tabs.length > 1 && <SectionTabs tab={tab} setTab={setTab} pendingCount={pendingCount} isMobile={isMobile} tabs={tabs} />}
            {/* 2026-10-29 — one period for every tab that reports money moving. */}
            {PERIOD_TABS.includes(tab) && (
              <PeriodPicker value={period} onChange={setPeriod} fyStartMonth={tenant?.fy_start_month} earliest={earliest} now={now} />
            )}
            {canLedger && <AddRecordControl tab={tab} onPick={setAdding} />}
            {canLedger && <FinanceMoreMenu cur={cur} />}
          </div>
        </div>
      </div>

      <QuickCapture pendingCount={pendingCount} isMobile={isMobile} canLedger={canLedger} tab={tab}
        onIngested={() => {
          invalidate();
          ["captures-pending", "captures", "ingestions"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        }}
        onOpenInbox={() => setTab("inbox")} onAddExpense={() => setAdding("expense")} />

      {tab === "overview" && (
        summaryQ.isError ? (
          <LoadError title="Couldn't load your finances" hint="You may not have the Finance permission, or the connection dropped. Try again in a moment." />
        ) : !overviewReady ? (
          <OverviewSkeleton />
        ) : (
          <OverviewTab summary={summary} revenue={revenueQ.data} expenses={expensesQ.data} assets={assetsQ.data}
            inventory={inventoryQ.data} period={period} fyStartMonth={tenant?.fy_start_month} now={now} cur={cur}
            onViewExpenses={() => setTab("expenses")} />
        )
      )}
      {tab === "revenue" && (
        <RevenueTab key={filterParam} data={revenueQ.data} loading={revenueQ.isLoading} error={revenueQ.isError}
          cur={cur} onDelete={deleting.ask} onChange={invalidate} onPay={setPaying} onSetRate={setSettingRate}
          initialFilter={filterParam} period={periodWin} onAllDates={allDates} />
      )}
      {tab === "expenses" && (
        <ExpensesTab rows={expensesQ.data || []} loading={expensesQ.isLoading} error={expensesQ.isError} payables={payablesQ.data}
          cur={cur} onDelete={deleting.ask} onChange={invalidate} onPay={setPaying}
          onSetRate={setSettingRate} needsRate={summary?.totals?.needs_rate} period={periodWin} onAllDates={allDates} />
      )}
      {tab === "assets" && (
        <AssetsTab rows={assetsQ.data || []} loading={assetsQ.isLoading} error={assetsQ.isError} cur={cur} onDelete={deleting.ask} />
      )}
      {tab === "inventory" && (
        <InventoryTab rows={inventoryQ.data || []} loading={inventoryQ.isLoading} error={inventoryQ.isError} cur={cur}
          onDelete={deleting.ask} onUse={setUsingStock} />
      )}
      {tab === "inbox" && <CaptureReview />}

      <AddRecordDialogs adding={adding} setAdding={setAdding} categories={summary?.categories || []}
        assetCategories={summary?.asset_categories || []} cur={cur} onDone={invalidate} />
      <RecordPaymentDialog invoice={paying} onOpenChange={(o) => !o && setPaying(null)} onDone={invalidate} />
      <UseStockDialog item={usingStock} onOpenChange={(o) => !o && setUsingStock(null)} onDone={invalidate} />
      <SetRateDialog invoice={settingRate} home={cur} onOpenChange={(o) => !o && setSettingRate(null)} onDone={invalidate} />
      {deleting.dialog}
    </div>
  );
}
