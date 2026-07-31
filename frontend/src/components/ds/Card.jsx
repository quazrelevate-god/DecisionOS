import * as React from "react";
import { cva } from "class-variance-authority";
import { ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { AssigneeChip } from "./AssigneeChip";
import { ProgressQuarters } from "./ProgressQuarters";
import { ProgressSteps } from "./ProgressSteps";

/**
 * The card shell every composite is built on.
 *
 * Depth comes from the hairline, not from shadow — elevation is reserved for
 * things that genuinely float. The optional left edge carries urgency and
 * nothing else: 3px, never a tinted row, never a full-card wash.
 *
 * @typedef {'overdue'|'today'|'week'|'later'} Urgency
 */

const EDGE = {
  overdue: "bg-urgency-overdue",
  today: "bg-urgency-today",
  week: "bg-urgency-week",
  later: "bg-urgency-later",
};

const cardVariants = cva("relative flex items-stretch overflow-hidden rounded-lg border bg-surface transition-colors", {
  variants: {
    interactive: {
      true: "text-left w-full hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      false: "",
    },
    selected: { true: "border-primary", false: "border-hairline" },
  },
  defaultVariants: { interactive: false, selected: false },
});

/**
 * @typedef {object} CardProps
 * @property {Urgency} [urgency] Renders the coloured left edge.
 * @property {boolean} [interactive=false] Renders as a button with hover/focus states.
 * @property {boolean} [selected=false]
 * @property {'none'|'sm'|'md'} [padding='md']
 * @property {React.ReactNode} children
 *
 * @example
 * <Card urgency="today" interactive onClick={open}>…</Card>
 */
export const Card = React.forwardRef(
  ({ className, urgency, interactive = false, selected = false, padding = "md", children, ...props }, ref) => {
    const Comp = interactive ? "button" : "div";
    return (
      <Comp
        ref={ref}
        type={interactive ? "button" : undefined}
        className={cn(cardVariants({ interactive, selected }), className)}
        {...props}
      >
        {urgency && <span className={cn("w-[3px] shrink-0", EDGE[urgency])} aria-hidden="true" />}
        <div className={cn("min-w-0 flex-1", padding === "md" && "p-5", padding === "sm" && "p-4")}>{children}</div>
      </Comp>
    );
  }
);
Card.displayName = "Card";

/**
 * KPI / stat card — a compact icon, one big tabular number, a label, and an
 * optional drill-down.
 *
 * The number is tabular so a row of stat cards keeps its digits in column, and
 * the delta is never coloured green/red by sign: "up" is not automatically good
 * (overdue tasks rising is up), so direction is carried by an arrow and words.
 *
 * @typedef {object} StatCardProps
 * @property {string} label
 * @property {string|number} value
 * @property {React.ReactNode} [icon]
 * @property {string} [delta] e.g. "+3 this week"
 * @property {string} [drillLabel]
 * @property {() => void} [onDrill]
 *
 * @example
 * <StatCard label="Awaiting approval" value={7} icon={<Tray />}
 *   drillLabel="Review" onDrill={() => navigate("/inbox")} />
 */
export const StatCard = React.forwardRef(
  ({ className, label, value, icon, delta, drillLabel = "View", onDrill, ...props }, ref) => (
    <Card ref={ref} padding="sm" className={cn("flex-col", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-label text-text-tertiary">{label}</p>
        {icon && <span className="text-text-tertiary [&_svg]:size-4 shrink-0">{icon}</span>}
      </div>
      <p data-numeric className="mt-2 text-h1 text-text tabular-nums">
        {value}
      </p>
      {delta && <p className="text-small text-text-tertiary">{delta}</p>}
      {onDrill && (
        <button
          type="button"
          onClick={onDrill}
          className="mt-3 inline-flex items-center gap-1 self-start text-small font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
        >
          {drillLabel} <ArrowRight size={13} weight="bold" />
        </button>
      )}
    </Card>
  )
);
StatCard.displayName = "StatCard";

/**
 * Task card — title, status, progress, due date, action row.
 *
 * Standalone (not inside a GroupedFeed), so it DOES show the overdue badge:
 * the 3px edge has no group header to give it meaning here and would be
 * missed on its own. Inside a feed, ListRow suppresses the badge instead.
 *
 * Accepts either kind of progress and renders the matching component, so the
 * claimed/computed distinction survives into every card that shows one.
 *
 * @typedef {object} TaskCardProps
 * @property {string} title
 * @property {import('./StatusBadge').StatusTone} [status]
 * @property {'low'|'med'|'medium'|'high'} [priority]
 * @property {string} [statusLabel] Overrides the badge text, e.g. "Blocked".
 * @property {number} [progress] Claimed progress → ProgressQuarters.
 * @property {{done: number, total: number}} [steps] Computed progress → ProgressSteps.
 * @property {string} [dueLabel] Pre-formatted, e.g. "Due Friday" / "Due 2 days ago".
 * @property {boolean} [overdue=false]
 * @property {string} [assigneeName]
 * @property {string} [assigneeRole]
 * @property {React.ReactNode} [actions]
 *
 * @example
 * <TaskCard title="Confirm dispatch schedule" status="directive" statusLabel="In progress"
 *   progress={75} dueLabel="Due Friday" assigneeName="Prasanna Narayanan"
 *   actions={<Button size="sm" variant="secondary">Open</Button>} />
 */
export const TaskCard = React.forwardRef(
  (
    {
      className,
      title,
      status,
      priority,
      statusLabel,
      progress,
      steps,
      dueLabel,
      overdue = false,
      assigneeName,
      assigneeRole,
      actions,
      ...props
    },
    ref
  ) => (
    <Card ref={ref} urgency={overdue ? "overdue" : undefined} className={cn("flex-col", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-body-strong text-text min-w-0">{title}</p>
        <span className="flex items-center gap-1.5 shrink-0">
          {priority && <StatusBadge priority={priority} />}
          {overdue ? (
            <StatusBadge status="overdue" />
          ) : (
            status && <StatusBadge status={status}>{statusLabel}</StatusBadge>
          )}
        </span>
      </div>

      {(dueLabel || assigneeName || assigneeRole) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {dueLabel && (
            <span className={cn("text-small", overdue ? "text-destructive-text" : "text-text-tertiary")}>
              {dueLabel}
            </span>
          )}
          {(assigneeName || assigneeRole) && (
            <>
              {dueLabel && <span className="text-text-tertiary">·</span>}
              <AssigneeChip name={assigneeName} role={assigneeRole} />
            </>
          )}
        </div>
      )}

      {typeof progress === "number" && <div className="mt-3"><ProgressQuarters value={progress} label={title} /></div>}
      {steps && <div className="mt-3"><ProgressSteps done={steps.done} total={steps.total} label={title} /></div>}

      {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
    </Card>
  )
);
TaskCard.displayName = "TaskCard";

export { cardVariants };
