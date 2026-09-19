import { ShieldCheck, Info, Lightbulb, Prohibit, Play, Check } from "@phosphor-icons/react";
import { INK_PLATE } from "./glass";
import { cn } from "../../lib/utils";

// ASK-28 TK-05 — when a task's approval happens. Before work starts locks it
// until approved; before it's marked done lets the work start straight away
// and makes Complete a request the approver closes.
export const APPROVAL_CHOICES = [
  { key: "none", label: "No", sub: "Not required", icon: Prohibit, hint: "Spending money or committing the company? Approve before work starts. Checking the result? Approve before it's marked done." },
  { key: "start", label: "Before work starts", sub: "Locked until approved", icon: Play, hint: "The task stays locked until it is approved." },
  { key: "close", label: "Before it's marked done", sub: "Approver closes it", icon: Check, hint: "Work starts straight away. Complete sends it to the approver, who closes it." },
];

/**
 * The Needs approval panel — New Task's, and (ASK-50) the Decision review
 * card's, one component so the two cannot drift.
 *
 * 2026-09-15, founder reference — a titled panel with one card per choice
 * instead of a pill row. ASK-50 — grey and ink, not purple: the panel's ground
 * a light grey, the shield-and-tick badge the Desk's ink gradient (INK_PLATE),
 * and the chosen card's edge, the radio and the hint's bulb in the same ink.
 *
 * @param {"none"|"start"|"close"} value
 * @param {function} onChange   (key) => void
 * @param {string} testid       base testid: the panel, `${testid}-${key}` on each
 *                              choice, `${testid}-hint` on the hint — New Task's
 *                              are task-approval, task-approval-none, …
 * @param {string} subtitle     the line under the title
 * @param {boolean} disabled
 */
export function ApprovalPanel({ value, onChange, testid = "task-approval", className,
  subtitle = "Approve before work starts or when it's completed.", disabled = false }) {
  const labelId = `${testid}-label`;
  return (
    <div data-testid={testid} className={cn("rounded-2xl border border-solid border-neutral-900/[0.07] bg-neutral-100 p-3.5", className)}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white ${INK_PLATE}`} aria-hidden="true">
          <ShieldCheck size={20} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground" id={labelId}>Needs approval</span>
          <span className="block text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <span className="shrink-0 text-muted-foreground" title="Choose whether someone must approve this task, and when." aria-hidden="true">
          <Info size={18} />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-labelledby={labelId}>
        {APPROVAL_CHOICES.map((c) => {
          const on = value === c.key;
          const Icon = c.icon;
          return (
            <button key={c.key} type="button" aria-pressed={on} data-testid={`${testid}-${c.key}`}
              disabled={disabled} onClick={() => onChange(c.key)}
              className={`flex min-w-0 flex-col items-stretch gap-1 rounded-xl border border-solid p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${on ? "border-neutral-900 bg-card" : "kr-pop border-transparent hover:border-neutral-900/15"}`}>
              {/* Icon and radio dot share the top row, so the label below gets
                  the card's full width instead of dodging the dot. */}
              <span className="flex items-center justify-between">
                <span aria-hidden="true" className={`grid h-7 w-7 place-items-center rounded-full ${on ? "bg-neutral-900 text-white" : "bg-muted text-foreground"}`}>
                  <Icon size={14} weight="bold" />
                </span>
                <span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-solid ${on ? "border-neutral-900" : "border-neutral-400/80"}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-neutral-900" />}
                </span>
              </span>
              <span className="text-xs font-semibold leading-tight text-foreground">{c.label}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{c.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-card px-3 py-2">
        <Lightbulb size={16} weight="bold" className="mt-px shrink-0 text-neutral-700" aria-hidden="true" />
        <p className="text-xs leading-snug text-muted-foreground" data-testid={`${testid}-hint`}>
          {APPROVAL_CHOICES.find((c) => c.key === value)?.hint}
        </p>
      </div>
    </div>
  );
}

export default ApprovalPanel;
