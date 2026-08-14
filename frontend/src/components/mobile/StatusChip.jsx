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

// bg / fg / line, verbatim from §3.3.
const STATUS = {
  pending: {
    label: "Waiting on you",
    icon: Clock,
    cls: "bg-caution-50 text-caution-800 border-caution-200",
  },
  overdue: {
    label: "Overdue",
    icon: WarningCircle,
    cls: "bg-danger-50 text-danger-800 border-danger-200",
  },
  completed: {
    label: "Done",
    icon: CheckCircle,
    cls: "bg-success-50 text-success-800 border-success-200",
  },
  directive: {
    label: "Directive",
    icon: Megaphone,
    cls: "bg-brand-50 text-brand-700 border-brand-200",
  },
  rejected: {
    label: "Rejected",
    icon: Prohibit,
    cls: "bg-neutral-100 text-neutral-600 border-neutral-200",
  },
  neutral: {
    label: "",
    icon: Minus,
    cls: "bg-neutral-100 text-neutral-600 border-neutral-200",
  },
};

// priority-low / med / high, also from §3.3 (no line colour specified).
const PRIORITY = {
  low: { label: "Low", cls: "bg-neutral-50 text-neutral-600 border-transparent" },
  medium: { label: "Medium", cls: "bg-neutral-100 text-neutral-800 border-transparent" },
  high: { label: "High", cls: "bg-caution-50 text-caution-800 border-transparent" },
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
