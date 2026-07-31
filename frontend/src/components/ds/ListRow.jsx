import * as React from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { AssigneeChip } from "./AssigneeChip";

/**
 * A row in a grouped feed.
 *
 * Urgency is a coloured LEFT EDGE and nothing else — the row never tints, never
 * fills, never borders in red. A list of late work should read as a list, not
 * as an alarm; the edge is what lets a column of them be scanned at a glance.
 *
 * Inside a GroupedFeed both the overdue badge AND the red date are suppressed:
 * under an "Overdue" header those would be the second and third statements of
 * the same fact, and that is the point where urgency tips into alarm. In a
 * group the edge is the only red.
 *
 * Standalone rows keep both, on the same exception: with no header to give the
 * 3px edge meaning, the row has to carry the fact more visibly itself. The rule
 * is parallel for badge and date rather than special-cased for one of them.
 *
 * @typedef {'overdue'|'today'|'week'|'later'} Urgency
 */

const EDGE = {
  overdue: "bg-urgency-overdue",
  today: "bg-urgency-today",
  week: "bg-urgency-week",
  later: "bg-urgency-later",
};

/**
 * @typedef {object} ListRowProps
 * @property {string} title
 * @property {string} [meta] Secondary line, e.g. "Due Friday · Supplier".
 * @property {Urgency} [urgency='later']
 * @property {import('./StatusBadge').StatusTone} [status]
 * @property {string} [statusLabel]
 * @property {'low'|'med'|'medium'|'high'} [priority]
 * @property {string} [assigneeName]
 * @property {string} [assigneeRole]
 * @property {React.ReactNode} [trailing] Progress, actions, anything right-aligned.
 * @property {boolean} [inGroup=false] Set by GroupedFeed; suppresses a redundant overdue badge.
 * @property {boolean} [selected=false]
 * @property {boolean} [disabled=false]
 * @property {() => void} [onClick] Renders the row as a button with hover/focus states.
 *
 * @example
 * <ListRow title="Confirm dispatch schedule" meta="Due Friday"
 *   urgency="today" status="directive" statusLabel="In progress"
 *   assigneeName="Prasanna Narayanan" onClick={open} />
 */
export const ListRow = React.forwardRef(
  (
    {
      className,
      title,
      meta,
      urgency = "later",
      status,
      statusLabel,
      priority,
      assigneeName,
      assigneeRole,
      trailing,
      inGroup = false,
      selected = false,
      disabled = false,
      onClick,
      ...props
    },
    ref
  ) => {
    const Comp = onClick ? "button" : "div";
    const showOverdueBadge = urgency === "overdue" && !inGroup;

    return (
      <Comp
        ref={ref}
        type={onClick ? "button" : undefined}
        onClick={onClick}
        disabled={onClick ? disabled : undefined}
        className={cn(
          "group flex w-full items-stretch border-b-hairline bg-surface text-left transition-colors last:border-0",
          onClick &&
            !disabled &&
            "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:-ring-offset-1",
          selected && "bg-primary-tint",
          disabled && "opacity-60",
          className
        )}
        {...props}
      >
        <span className={cn("w-[3px] shrink-0", EDGE[urgency])} aria-hidden="true" />

        <span className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className={cn("truncate text-body", disabled ? "text-text-disabled" : "text-text")}>{title}</span>
              {priority && <StatusBadge priority={priority} />}
              {showOverdueBadge ? (
                <StatusBadge status="overdue" />
              ) : (
                status && <StatusBadge status={status}>{statusLabel}</StatusBadge>
              )}
            </span>
            {meta && (
              <span
                className={cn(
                  "mt-0.5 block truncate text-small",
                  urgency === "overdue" && !inGroup ? "text-destructive-text" : "text-text-tertiary"
                )}
              >
                {meta}
              </span>
            )}
          </span>

          <span className="flex shrink-0 items-center gap-3">
            {(assigneeName || assigneeRole) && <AssigneeChip name={assigneeName} role={assigneeRole} />}
            {trailing}
          </span>
        </span>
      </Comp>
    );
  }
);
ListRow.displayName = "ListRow";
