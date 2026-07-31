import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status and priority badge.
 *
 * Construction is always light tint + dark coloured text, never a saturated
 * slab: a wall of solid colour turns a list into an alarm, which is exactly the
 * failure the system exists to avoid. Uppercase, tracked, sans — never mono.
 *
 * Priority withholds red deliberately. High priority is not the same claim as
 * overdue, so high reads as caution and med/low as neutral weight. Red is
 * reserved for danger and overdue.
 *
 * There is no free-form colour prop: a caller picks a meaning, not a hue.
 *
 * @typedef {'pending'|'directive'|'overdue'|'completed'|'rejected'|'neutral'} StatusTone
 * @typedef {'low'|'med'|'medium'|'high'} PriorityLevel
 */

/**
 * The backend stores priority as "medium"; the token scale is keyed "med".
 * The backend's language wins, so "medium" is canonical on the wire and both
 * spellings are accepted here — callers should never have to remember which
 * layer they are talking to.
 */
const PRIORITY_ALIASES = { medium: 'med', normal: 'med', med: 'med', low: 'low', high: 'high' };

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-badge font-semibold whitespace-nowrap",
  {
    variants: {
      status: {
        pending: "bg-status-pending-bg text-status-pending-fg",
        directive: "bg-status-directive-bg text-status-directive-fg",
        overdue: "bg-status-overdue-bg text-status-overdue-fg",
        completed: "bg-status-completed-bg text-status-completed-fg",
        rejected: "bg-status-rejected-bg text-status-rejected-fg",
        /* For labels that classify rather than signal — a type, a role, a
           category. Colour is reserved for state, so a category gets none. */
        neutral: "bg-surface-sunken text-text-secondary",
        low: "bg-priority-low-bg text-priority-low-fg",
        med: "bg-priority-med-bg text-priority-med-fg",
        high: "bg-priority-high-bg text-priority-high-fg",
      },
      outlined: { true: "border", false: "" },
    },
    compoundVariants: [
      { outlined: true, status: "pending", class: "border-status-pending-line" },
      { outlined: true, status: "directive", class: "border-status-directive-line" },
      { outlined: true, status: "overdue", class: "border-status-overdue-line" },
      { outlined: true, status: "completed", class: "border-status-completed-line" },
      { outlined: true, status: "rejected", class: "border-status-rejected-line" },
      { outlined: true, status: "neutral", class: "border-hairline" },
    ],
    defaultVariants: { status: "pending", outlined: false },
  }
);

const DEFAULT_LABEL = {
  pending: "Pending",
  directive: "Directive",
  overdue: "Overdue",
  completed: "Completed",
  rejected: "Rejected",
  neutral: "",
  low: "Low",
  med: "Medium",
  high: "High",
};

/**
 * @typedef {object} StatusBadgeProps
 * @property {StatusTone} [status] Mutually exclusive with `priority`.
 * @property {PriorityLevel} [priority]
 * @property {boolean} [outlined=false] Adds a hairline in the tint's own hue.
 * @property {React.ReactNode} [icon]
 * @property {React.ReactNode} [children] Overrides the default label.
 *
 * @example
 * <StatusBadge status="overdue" />
 * <StatusBadge status="directive">Directive</StatusBadge>
 * <StatusBadge priority="high" outlined />
 * <StatusBadge priority="medium" />   // the backend's spelling also works
 */
export const StatusBadge = React.forwardRef(
  ({ className, status, priority, outlined = false, icon, children, ...props }, ref) => {
    const tone = priority ? PRIORITY_ALIASES[priority] || "med" : status || "pending";
    return (
      <span ref={ref} className={cn(badgeVariants({ status: tone, outlined }), className)} {...props}>
        {icon}
        {children || DEFAULT_LABEL[tone]}
      </span>
    );
  }
);
StatusBadge.displayName = "StatusBadge";

export { badgeVariants };
