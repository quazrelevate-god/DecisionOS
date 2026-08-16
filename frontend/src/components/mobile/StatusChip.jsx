// MPWA-04 · StatusChip — the §3.3 status table, and nothing else.
//
// §3.3 is explicit: "Use these; do not compose new combinations." So the
// bg/fg/line triples live here once and no call-site picks colours.
//
// §3.3 is also explicit that colour never carries meaning alone — sunlight,
// colour-blindness and grayscale battery-saver all strip it. Every chip
// therefore pairs its colour with a glyph AND a label.
import * as React from "react";
import {
  Clock,
  WarningCircle,
  CheckCircle,
  Megaphone,
  Prohibit,
  Minus,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// bg / fg / line — §3.3's table, through the --badge-* tokens.
//
// DS-5: these used to name ramp STEPS (bg-caution-50 text-caution-800). A step
// is one fixed value, so in dark mode a "Waiting 1 day" chip kept its cream
// background and amber text sitting on a near-black card. The badge tokens have
// a dark override; the ramp does not. Same triples in light, readable in dark.
const STATUS = {
  pending: {
    label: "Waiting on you",
    icon: Clock,
    cls: "bg-badge-pending text-badge-pending-fg border-badge-pending-line",
  },
  overdue: {
    label: "Overdue",
    icon: WarningCircle,
    cls: "bg-badge-overdue text-badge-overdue-fg border-badge-overdue-line",
  },
  completed: {
    label: "Done",
    icon: CheckCircle,
    cls: "bg-badge-completed text-badge-completed-fg border-badge-completed-line",
  },
  directive: {
    label: "Directive",
    icon: Megaphone,
    cls: "bg-badge-directive text-badge-directive-fg border-badge-directive-line",
  },
  rejected: {
    label: "Rejected",
    icon: Prohibit,
    cls: "bg-badge-neutral text-badge-neutral-fg border-badge-neutral-line",
  },
  neutral: {
    label: "",
    icon: Minus,
    cls: "bg-badge-neutral text-badge-neutral-fg border-badge-neutral-line",
  },
};

// priority-low / med / high, also from §3.3.
//
// low and medium share the neutral badge and separate on BORDER weight rather
// than on a second fill. Their old cue was neutral-50 vs neutral-100 — a
// difference of 3% lightness, which is invisible in sunlight and inverted in
// dark mode. The label already says which is which; §1 requires colour never be
// the only cue anyway.
const PRIORITY = {
  low: { label: "Low", cls: "bg-badge-neutral text-badge-neutral-fg border-transparent" },
  medium: { label: "Medium", cls: "bg-badge-neutral text-badge-neutral-fg border-hairline-strong" },
  high: { label: "High", cls: "bg-badge-pending text-badge-pending-fg border-transparent" },
};

/**
 * Map the API's task/decision status vocabulary onto the §3.3 set. Business
 * language only — §5.4 forbids schema words reaching the screen.
 */
export function statusFromTask({ status, due_date: due } = {}, now = new Date()) {
  if (status === "done" || status === "completed") return "completed";
  if (status === "cancelled" || status === "rejected") return "rejected";
  if (due) {
    const d = new Date(String(due).length <= 10 ? `${due}T12:00:00` : due);
    if (!Number.isNaN(d.getTime()) && d < now) return "overdue";
  }
  return "pending";
}

export function StatusChip({ status = "neutral", label, className, "data-testid": testId }) {
  const s = STATUS[status] || STATUS.neutral;
  const Icon = s.icon;
  const text = label ?? s.label;
  if (!text) return null;
  return (
    <span
      data-testid={testId || `status-chip-${status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
        "text-[length:var(--text-label)] font-semibold leading-4",
        s.cls,
        className
      )}
    >
      <Icon size={14} weight="bold" aria-hidden="true" className="shrink-0" />
      {text}
    </span>
  );
}

export function PriorityChip({ priority = "medium", className }) {
  const p = PRIORITY[String(priority).toLowerCase()] || PRIORITY.medium;
  return (
    <span
      data-testid={`priority-chip-${priority}`}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5",
        "text-[length:var(--text-label)] font-semibold leading-4",
        p.cls,
        className
      )}
    >
      {p.label} priority
    </span>
  );
}

export default StatusChip;
