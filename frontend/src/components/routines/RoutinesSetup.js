/* The routines promised at sign-up — confirmed once, then they repeat.
 *
 * 2026-09-21 (Yokesh, task 3). The reveal screen counted "8 recurring tasks
 * Dex will keep on rails" and nothing created them. The AI names a routine
 * ("Monday shipment review"); how often it comes back and who does it are
 * guesses, so the founder confirms them here and each one kept becomes a real
 * repeating task — the next appears when the last one is closed.
 *
 * FRICTIONLESS: a routine whose name says how often it happens starts ticked
 * with that cadence and a first date, so the usual answer is one tap on
 * "Start". One whose name says nothing about time, or that happens per order,
 * starts unticked with the reason on it. Cadence is three pills and the first
 * date follows the cadence — no date picker, no operating-system list.
 *
 * Used on the reveal screen and, until every routine is answered, behind a
 * slim reminder on My Work (RoutinesNudge) for the owner.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowsClockwise, CalendarBlank, ArrowRight } from "@phosphor-icons/react";
import api from "../../lib/api";
import { DesignCheckbox } from "../karma/DesignCheckbox";
import { GlassSelect } from "../karma/GlassSelect";
import { GLASS_PILL, INK_PILL } from "../karma/glass";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";

const CADENCES = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

export const ROUTINES_KEY = ["routines-setup"];

export function niceDate(ymd) {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function cadenceWords(every, interval) {
  const n = interval || 1;
  if (every === "month" && n === 3) return "Every quarter";
  if (n === 1) return { day: "Every day", week: "Every week", month: "Every month" }[every];
  return `Every ${n} ${every}s`;
}

export function useRoutinesSetup(enabled = true) {
  return useQuery({
    queryKey: ROUTINES_KEY,
    queryFn: () => api.get("/routines/setup").then((r) => r.data),
    enabled,
    staleTime: 30000,
  });
}

/**
 * @param onDone     called with the server's answer after the owner starts them,
 *                   or with null when they choose "Not now"
 * @param showLater  whether to offer "Not now" (the reveal screen's own
 *                   "Enter DecisionOS" already is one)
 */
export function RoutinesSetup({ onDone, showLater = true, notNowLabel = "Not now", testid = "routines" }) {
  const qc = useQueryClient();
  const q = useRoutinesSetup();
  const items = useMemo(() => q.data?.items || [], [q.data]);
  const people = q.data?.people || [];
  const [choice, setChoice] = useState({});   // key -> {on, every, interval, assignee_id}
  const [busy, setBusy] = useState(false);

  // Seed each routine's choice from the suggestion, once it arrives.
  useEffect(() => {
    if (!items.length) return;
    setChoice((prev) => {
      const next = { ...prev };
      items.forEach((it) => {
        if (!next[it.key]) {
          next[it.key] = { on: !!it.confident, every: it.every, interval: it.interval, assignee_id: it.assignee_id };
        }
      });
      return next;
    });
  }, [items]);

  if (q.isLoading) return <p className="text-sm text-muted-foreground" data-testid={`${testid}-loading`}>Loading your routines…</p>;
  if (!items.length) return null;

  const set = (key, patch) => setChoice((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const onCount = items.filter((it) => choice[it.key]?.on).length;
  const offCount = items.length - onCount;

  const submit = async () => {
    setBusy(true);
    try {
      const start = items.filter((it) => choice[it.key]?.on).map((it) => {
        const c = choice[it.key];
        return { key: it.key, every: c.every, interval: c.interval, assignee_id: c.assignee_id };
      });
      const skip = items.filter((it) => !choice[it.key]?.on).map((it) => it.key);
      const { data } = await api.post("/routines/setup", { start, skip });
      qc.setQueryData(ROUTINES_KEY, data);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      const n = (data.created || []).length;
      if (n) toast.success(n === 1 ? "1 routine started" : `${n} routines started`);
      onDone?.(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't start the routines — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid={testid} className="space-y-3">
      <ul className="space-y-2">
        {items.map((it) => {
          const c = choice[it.key] || {};
          const due = it.first_due?.[c.every];
          return (
            <li key={it.key} data-testid={`${testid}-row-${it.key}`} data-on={c.on ? "true" : "false"}
              className={`rounded-2xl px-3.5 py-3 ring-1 ring-inset transition-colors ${c.on ? "bg-white/85 ring-slate-900/10" : "bg-white/45 ring-slate-900/[0.05]"}`}>
              <DesignCheckbox checked={!!c.on} onChange={(e) => set(it.key, { on: e.target.checked })} testid={`${testid}-on-${it.key}`}>
                <span className={`block font-medium ${c.on ? "text-slate-900" : "text-slate-600"}`}>{it.title}</span>
                {!it.confident && (
                  <span className="mt-0.5 block text-[12px] text-slate-500" data-testid={`${testid}-why-${it.key}`}>{it.reason}</span>
                )}
              </DesignCheckbox>
              {c.on && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-8">
                  <div className="flex gap-1" role="radiogroup" aria-label={`How often "${it.title}" repeats`}>
                    {CADENCES.map((k) => {
                      const on = c.every === k.key;
                      return (
                        <button key={k.key} type="button" role="radio" aria-checked={on}
                          data-testid={`${testid}-every-${k.key}-${it.key}`}
                          onClick={() => set(it.key, { every: k.key, interval: k.key === it.every ? it.interval : 1 })}
                          className={`min-h-8 rounded-pill px-3 text-[12px] font-medium ring-1 ring-inset transition-colors ${on
                            ? "bg-slate-900 text-white ring-slate-900" : "bg-white/80 text-slate-600 ring-slate-900/10 hover:bg-white"}`}>
                          {k.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="inline-flex items-center gap-1 text-[12px] text-slate-500" data-testid={`${testid}-first-${it.key}`}>
                    <CalendarBlank size={12} weight="bold" aria-hidden="true" />
                    {cadenceWords(c.every, c.interval)} · first on {niceDate(due)}
                  </span>
                  {people.length > 1 && (
                    <span className="ml-auto inline-block w-40">
                      <GlassSelect value={c.assignee_id} onChange={(v) => set(it.key, { assignee_id: v })}
                        ariaLabel={`Who does "${it.title}"`} testid={`${testid}-who-${it.key}`}
                        options={people.map((p) => ({ value: p.id, label: p.role === "owner" ? `${p.name} (you)` : p.name }))} />
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={submit} disabled={busy} data-testid={`${testid}-start`}
          className={`inline-flex min-h-11 items-center gap-2 rounded-pill px-5 text-sm font-semibold disabled:opacity-50 ${INK_PILL}`}>
          {onCount > 0 && <ArrowsClockwise size={16} weight="bold" aria-hidden="true" />}
          {onCount === 0 ? "None of these" : onCount === 1 ? "Start 1 routine" : `Start ${onCount} routines`}
        </button>
        {showLater && onDone && (
          <button type="button" onClick={() => onDone(null)} disabled={busy} data-testid={`${testid}-later`}
            className={`inline-flex min-h-11 items-center rounded-pill px-4 text-sm font-medium text-slate-700 ${GLASS_PILL}`}>
            {notNowLabel}
          </button>
        )}
      </div>
      <p className="text-[12px] text-slate-500" data-testid={`${testid}-footnote`}>
        {[
          onCount > 0 && (people.length > 1 ? "Each starts with the person shown."
            : "Each starts with you — hand it to a teammate from the task once they join."),
          offCount > 0 && `${offCount === items.length ? (offCount === 1 ? "It" : "They")
            : `The ${offCount === 1 ? "one" : offCount} left unticked`} won't be offered again; any task can still be set to repeat.`,
        ].filter(Boolean).join(" ")}
      </p>
    </div>
  );
}

/** A slim reminder on My Work while sign-up routines are unanswered (owner only). */
export function RoutinesNudge() {
  const q = useRoutinesSetup();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem("routines-nudge-hidden") === "1"; } catch { return false; }
  });
  const pending = q.data?.pending || 0;
  if (!pending || hidden) return null;
  const hide = () => {
    setHidden(true);
    try { sessionStorage.setItem("routines-nudge-hidden", "1"); } catch { /* private mode */ }
  };
  return (
    <>
      <div data-testid="routines-nudge"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-inset ring-slate-900/[0.06]">
        <ArrowsClockwise size={18} weight="bold" aria-hidden="true" className="shrink-0 text-slate-700" />
        <p className="min-w-0 flex-1 text-sm text-slate-700">
          {pending === 1 ? "1 routine" : `${pending} routines`} from your setup {pending === 1 ? "hasn't" : "haven't"} started yet.
        </p>
        <button type="button" onClick={() => setOpen(true)} data-testid="routines-nudge-open"
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold ${INK_PILL}`}>
          Set them up <ArrowRight size={13} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" onClick={hide} data-testid="routines-nudge-hide"
          className="min-h-9 rounded-pill px-3 text-[13px] font-medium text-slate-500 hover:text-slate-800">
          Later
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[calc(90vh/var(--ui-scale,1))] overflow-y-auto" data-testid="routines-dialog">
          <DialogHeader>
            <DialogTitle className="pr-8">Your routines</DialogTitle>
            <DialogDescription className="pr-8">
              Tick the ones your company does, and how often. Each becomes a task that comes back when the last one is done.
            </DialogDescription>
          </DialogHeader>
          <RoutinesSetup testid="routines-dialog-setup" onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RoutinesSetup;
