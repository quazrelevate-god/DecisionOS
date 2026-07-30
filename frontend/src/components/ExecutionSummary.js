import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { CheckSquare, UsersThree, SealCheck, Truck, CalendarCheck, BellRinging, Lightning, ArrowRight } from "@phosphor-icons/react";

function CountUp({ value, delay = 0, duration = 700 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf, start;
    const startTimer = setTimeout(() => {
      const step = (ts) => {
        if (!start) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        setN(Math.round(p * value));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(startTimer); cancelAnimationFrame(raf); };
  }, [value, delay, duration]);
  return <span>{n}</span>;
}

const plural = (n, one, many) => (n === 1 ? one : many);

export default function ExecutionSummary({ data, onReview, onClose }) {
  const open = !!data;
  const s = data || {};
  const chips = [
    { key: "tasks", icon: CheckSquare, value: s.tasks, label: (n) => plural(n, "task created", "tasks created"), color: "bg-primary" },
    { key: "assignees", icon: UsersThree, value: s.assignees, label: (n) => plural(n, "person assigned", "people assigned"), color: "bg-primary" },
    { key: "workflows", icon: Truck, value: s.workflows, label: (n) => plural(n, "workflow generated", "workflows generated"), color: "bg-primary" },
    { key: "approvals", icon: SealCheck, value: s.approvals, label: (n) => plural(n, "approval to review", "approvals to review"), color: "bg-brand-red" },
    { key: "meetings", icon: CalendarCheck, value: s.meetings, label: (n) => plural(n, "meeting scheduled", "meetings scheduled"), color: "bg-primary" },
    { key: "reminders", icon: BellRinging, value: s.reminders, label: (n) => plural(n, "reminder set", "reminders set"), color: "bg-primary" },
  ].filter((c) => (c.value || 0) > 0);

  const hasApprovals = (s.approvals || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border-2 border-hairline rounded-md max-w-lg p-0 overflow-hidden" data-testid="execution-summary-panel">
        <div className="bg-primary text-primary-foreground px-6 py-5">
          <div className="flex items-center gap-2 text-primary-text">
            <Lightning size={18} weight="fill" />
            <span className="text-label uppercase">Structured in seconds</span>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight mt-1">Execution plan is ready</h2>
        </div>
        <DialogTitle className="sr-only">Execution plan is ready</DialogTitle>
        <DialogDescription className="sr-only">Real counts of the tasks, people, workflows, approvals, meetings and reminders produced by this directive.</DialogDescription>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-3" data-testid="execution-summary-chips">
            {chips.map((c, i) => {
              const Icon = c.icon;
              return (
                <div key={c.key} data-testid={`es-chip-${c.key}`}
                  className="border border-hairline p-3 flex items-center gap-3 es-reveal"
                  style={{ animationDelay: `${i * 120}ms` }}>
                  <span className={`w-9 h-9 shrink-0 flex items-center justify-center text-white ${c.color}`}>
                    <Icon size={18} weight="bold" />
                  </span>
                  <div className="leading-tight">
                    <div className="text-2xl font-black" data-testid={`es-count-${c.key}`}>
                      <CountUp value={c.value} delay={i * 120 + 150} />
                    </div>
                    <div className="text-xs text-text-secondary font-semibold">{c.label(c.value)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-sm font-semibold es-reveal" style={{ animationDelay: `${chips.length * 120 + 150}ms` }} data-testid="es-closing-line">
            {hasApprovals
              ? <>Approve the decision below to <span className="text-primary-text">activate execution</span> across your team.</>
              : <>Your company is <span className="text-primary-text">ready to execute</span> today's priorities.</>}
          </p>

          <div className="mt-5 flex gap-2">
            {hasApprovals && (
              <button onClick={onReview} data-testid="es-review-btn"
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-xs transition-all">
                Review &amp; approve <ArrowRight size={15} weight="bold" />
              </button>
            )}
            <button onClick={onClose} data-testid="es-close-btn"
              className={`${hasApprovals ? "" : "flex-1 "}px-5 py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:bg-surface-hover transition-colors`}>
              {hasApprovals ? "Later" : "Done"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
