/* Requests (2026-10-21) — the lists.
 *
 * Mine · Waiting for payment · All. Each tab is a different question asked of
 * the server (GET /api/requests?view=…), which narrows the rows itself — the
 * client never filters somebody else's request out, because it never receives
 * it. The tabs a person sees are the ones that can hold anything for them:
 * "Waiting for payment" with Finance access, "All" for the owner.
 *
 * NF-4.21 (2026-10-31, founder: "everything goes to Approvals — why is there a
 * separate approval here?"): approving lives in ONE place, the Approvals hub's
 * Requests tab. This page had its own "To approve" tab on the phone, a second
 * door to the same queue the desktop never had. It is now a line pointing
 * there when something waits on you. "To pay" said nothing about whose job it
 * was; it is "Waiting for payment", Finance's, and says what Mark paid does.
 *
 * Used twice: as the Requests page (phone More → Requests), and inside My Work
 * as "My requests", where `embedded` drops the page-level summary and
 * `mineOnly` keeps the one list (the approver's and Finance's lists have their
 * own places: the Approvals hub and the Requests page).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Tray, CheckCircle, SealCheck, Stack, ArrowRight } from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../lib/perms";
import { LoadFailed } from "../common";
import { OPEN_REQUEST, isOpenRequest, requestType } from "../../lib/requests";
import { RequestCard } from "./RequestCard";
import { DRAWER_CARD, DRAWER_TRACK, GLASS_PILL } from "../neuglass/glass";

const fetchView = (view) => api.get(`/requests?view=${view}`).then((r) => r.data);

export function useRequestsTabs() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const canPay = isOwner || hasPerm(user, "finance");
  // Fetched for everyone: it is the count on the Approvals hub and the Desk,
  // and the server answers an empty list to anyone with nothing routed to them.
  const approvalsQ = useQuery({ queryKey: ["requests", "approvals"], queryFn: () => fetchView("approvals"), refetchInterval: 60000 });
  const waiting = (approvalsQ.data || []).length;
  return { isOwner, canPay, approvalsQ, waiting, showApprovals: isOwner || waiting > 0 };
}

export function RequestsPanel({ tab: tabProp, onTabChange, highlightId, embedded = false, mineOnly = false }) {
  const { isOwner, canPay, waiting } = useRequestsTabs();
  const [tabState, setTabState] = useState(tabProp || "mine");
  const tab = tabProp || tabState;
  const setTab = (t) => { setTabState(t); onTabChange?.(t); };

  const mineQ = useQuery({ queryKey: ["requests", "mine"], queryFn: () => fetchView("mine") });
  const payQ = useQuery({ queryKey: ["requests", "fulfil"], queryFn: () => fetchView("fulfil"), enabled: canPay && !mineOnly });
  const allQ = useQuery({ queryKey: ["requests", "all"], queryFn: () => fetchView("all"), enabled: isOwner && tab === "all" });

  const tabs = [
    { key: "mine", label: "Mine", icon: Tray, q: mineQ,
      n: (mineQ.data || []).filter((r) => r.status === "info_requested").length || null },
    ...(canPay && !mineOnly ? [{ key: "fulfil", label: "Waiting for payment", icon: SealCheck, q: payQ,
      n: (payQ.data || []).filter((r) => r.status === "approved").length }] : []),
    ...(isOwner && !mineOnly ? [{ key: "all", label: "All", icon: Stack, q: allQ, n: null }] : []),
  ];
  const current = tabs.find((t) => t.key === tab) || tabs[0];
  const q = current.q;
  const rows = useMemo(() => q.data || [], [q.data]);

  // Open first, then the rest — and in the approver's queue the longest
  // waiting first, since whoever has waited longest is the one to unblock.
  const [open, closed] = useMemo(() => {
    const isOpen = current.key === "fulfil" ? (r) => r.status === "approved" : isOpenRequest;
    const o = rows.filter(isOpen);
    return [o, rows.filter((r) => !isOpen(r))];
  }, [rows, current.key]);

  // A notification about a request lands here (?request=<id>): bring it into view.
  useEffect(() => {
    if (!highlightId || !rows.length) return undefined;
    const t = setTimeout(() => document.querySelector(`[data-testid="request-card-${highlightId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(t);
  }, [highlightId, rows.length]);

  const heading = {
    mine: ["Open", "Closed"],
    fulfil: ["Approved — not paid yet", "Paid"],
    all: ["Open", "Closed"],
  }[current.key];
  const empty = {
    mine: "Nothing asked for yet. Use + New request when you need material, money or equipment.",
    fulfil: "Nothing waiting for payment. Approved requests for money or material appear here.",
    all: "No requests in the company yet.",
  }[current.key];

  const mine = mineQ.data || [];
  const stat = (label, value, testid) => (
    <div className="ng-pressed flex min-w-0 flex-1 flex-col rounded-2xl px-4 py-3" data-testid={testid}>
      <span className="font-display text-2xl tabular-nums leading-none">{value}</span>
      <span className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    </div>
  );
  const grid = (list) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {list.map((r) => <RequestCard key={r.id} r={r} highlight={r.id === highlightId} />)}
    </div>
  );

  return (
    <div data-testid="requests-panel">
      {!embedded && mineQ.data && (
        <div className="mb-5 flex gap-3" data-testid="requests-summary">
          {stat("Waiting", mine.filter((r) => OPEN_REQUEST.has(r.status)).length, "requests-summary-waiting")}
          {stat("Approved, awaiting payment", mine.filter((r) => r.status === "approved" && requestType(r.type).finance).length, "requests-summary-approved")}
          {/* Done: paid — or a General request, whose yes was the end of it. */}
          {stat("Done", mine.filter((r) => r.status === "fulfilled" || (r.status === "approved" && !requestType(r.type).finance)).length, "requests-summary-done")}
        </div>
      )}

      {/* NF-4.21 — the approver's queue is in Approvals, not a tab here. */}
      {!mineOnly && waiting > 0 && (
        <Link to="/approvals?sub=requests" data-testid="requests-approvals-link"
          className={`mb-5 flex items-center gap-3 px-4 py-3 text-sm text-neutral-800 hover:text-neutral-900 ${DRAWER_CARD}`}>
          <CheckCircle size={18} weight="bold" aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{waiting} request{waiting === 1 ? "" : "s"} waiting for your approval.</span>{" "}
            <span className="text-neutral-600">You approve them in Approvals.</span>
          </span>
          <ArrowRight size={16} weight="bold" aria-hidden="true" className="shrink-0" />
        </Link>
      )}

      {tabs.length > 1 && (
        <div className="mb-5 overflow-x-auto [scrollbar-width:none]">
          <div role="tablist" aria-label="Requests" className={`inline-flex items-center gap-1 rounded-pill p-1 ${DRAWER_TRACK}`} data-testid="requests-tabs">
            {tabs.map((t) => {
              const on = current.key === t.key;
              const Icon = t.icon;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on}
                  onClick={() => setTab(t.key)} data-testid={`requests-tab-${t.key}`}
                  className={`flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${
                    on ? `${GLASS_PILL} font-semibold text-neutral-900` : "font-medium text-neutral-600 hover:text-neutral-900"}`}>
                  <Icon size={16} weight={on ? "bold" : "regular"} aria-hidden="true" />
                  {t.label}
                  {t.n > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ng-ink px-1.5 text-[11px] font-semibold tabular-nums leading-none text-white">{t.n}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {current.key === "fulfil" && (
        <p className="-mt-2 mb-4 text-sm text-neutral-600" data-testid="requests-fulfil-hint">
          Already approved. Pay or buy each one, then press Mark paid: that closes the request and its expense in Finance.
        </p>
      )}

      {q.isLoading && !q.data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-52 rounded-tile" />)}
        </div>
      ) : q.isError && !q.data ? (
        <LoadFailed what="the requests" onRetry={() => q.refetch()} testid="requests-load-failed" />
      ) : rows.length === 0 ? (
        <div className={`p-6 text-sm text-neutral-600 ${DRAWER_CARD}`} data-testid={`requests-empty-${current.key}`}>{empty}</div>
      ) : (
        <div className="space-y-8">
          {open.length > 0 && (
            <section data-testid={`requests-open-${current.key}`}>
              {heading[0] && <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{heading[0]}</h2>}
              {grid(open)}
            </section>
          )}
          {closed.length > 0 && (
            <section data-testid={`requests-closed-${current.key}`}>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{heading[1]}</h2>
              {grid(closed)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
