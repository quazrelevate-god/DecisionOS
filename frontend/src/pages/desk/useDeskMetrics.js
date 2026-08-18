// KR-8 · useDeskMetrics — the dashboard's data spine. FounderBento's queries
// and derivations survive HERE (the component died with the bento layout;
// the wiring was the part worth keeping), plus the ledger summary the Karma
// tiles need.
//
// Query keys are the SAME ones the destination pages use, so React Query
// dedupes with whatever the founder already visited and a tile can never
// disagree with the page it links to — the bento's founding rule.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";

const ymd = (d) => d.toISOString().slice(0, 10);

export function useDeskMetrics() {
  const opsQ = useQuery({
    queryKey: ["operating-score", null],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });
  const tasksQ = useQuery({
    queryKey: ["tasks", false],
    queryFn: () => api.get("/tasks?mine=false").then((r) => r.data),
  });
  const summaryQ = useQuery({
    queryKey: ["desk-summary"],
    queryFn: () => api.get("/desk/summary").then((r) => r.data),
    refetchInterval: 60000,
  });
  // NOTE: /contacts left the Desk with the Relationships tile — the six Karma
  // tiles are all fed below. One request fewer, recorded in the KR-8 commit.
  const ledgerQ = useQuery({
    queryKey: ["ledger-summary"],
    queryFn: () => api.get("/ledger/summary").then((r) => r.data),
  });

  // Work buckets, client-side off /tasks — created/due dates are reliable
  // fields; completion-over-time deliberately is NOT derived (no completed_at
  // exists; see the plan's data audit).
  const work = useMemo(() => {
    const all = Array.isArray(tasksQ.data) ? tasksQ.data : [];
    if (!all.length && tasksQ.isLoading) return null;
    const today = ymd(new Date());
    const live = all.filter((t) => t.status !== "done" && t.status !== "cancelled");
    const overdue = live.filter((t) => t.due_date && String(t.due_date).slice(0, 10) < today);
    const dueToday = live.filter((t) => t.due_date && String(t.due_date).slice(0, 10) === today);
    const byDept = {};
    overdue.forEach((t) => {
      const k = t.task_type || "other";
      byDept[k] = (byDept[k] || 0) + 1;
    });
    const deptEntries = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
    return {
      open: live.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      worst: deptEntries[0] || null,
      deptCounts: deptEntries.map(([, n]) => n),
    };
  }, [tasksQ.data, tasksQ.isLoading]);

  const ops = useMemo(() => {
    const d = opsQ.data;
    if (!d) return null;
    if (d.view === "self") {
      return { view: "self", self: d.self, stats: d.stats };
    }
    const cats = d.company?.categories || {};
    const catEntries = Object.entries(cats).filter(([, v]) => v != null);
    const weakest = [...catEntries].sort((a, b) => a[1] - b[1])[0] || null;
    return {
      view: "owner",
      score: d.company?.overall ?? null,
      enough: d.company?.enough_data !== false,
      categories: cats,
      catValues: ["execution", "finance", "sales", "responsiveness"].map((k) => cats[k] ?? 0),
      weakest,
      mySnapshot: d.my_snapshot || null,
      stats: d.stats || null,
    };
  }, [opsQ.data]);

  const trends = summaryQ.data?.trends || null;
  const cash = useMemo(() => {
    const c = trends?.cash_flow;
    if (!c) return null;
    return {
      overdue: Number(c.overdue_receivables_amount) || 0,
      unmatched: Number(c.unmatched_payments) || 0,
      clear: !!c.clear,
    };
  }, [trends]);

  const ledger = useMemo(() => {
    const d = ledgerQ.data;
    if (!d) return null;
    return {
      byMonth: Array.isArray(d.by_month) ? d.by_month : [],
      netProfit: Number(d.totals?.net_profit),
      lastMonthSpend: d.by_month?.length ? Number(d.by_month[d.by_month.length - 1].amount) : null,
    };
  }, [ledgerQ.data]);

  return {
    greeting: summaryQ.data?.greeting || "",
    counters: summaryQ.data?.counters || null,   // {delayed, completed_yesterday, pending_decisions}
    weekly: trends?.weekly_completion_rate || null,
    complaints: trends?.complaints_trend || null,
    cash,
    work,
    ops,
    ledger,
    loading: {
      ops: opsQ.isLoading,
      summary: summaryQ.isLoading,
      tasks: tasksQ.isLoading,
      ledger: ledgerQ.isLoading,
    },
  };
}

export default useDeskMetrics;
