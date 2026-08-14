// MPWA-04 · EmptyState — icon + one sentence + one primary action (§7).
//
// §7: "Never a bare 'No data'." An empty screen is still a screen the owner
// opened for a reason, so it says what is true and offers the one next thing.
import * as React from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * @param {Component} [icon]     Phosphor glyph
 * @param {string}    title      one sentence, business language (§5.4)
 * @param {string}    [hint]     at most one more sentence
 * @param {string}    [actionLabel]
 * @param {Function}  [onAction] exactly one primary action, or none
 */
export function EmptyState({
  icon: Icon = CheckCircle,
  title,
  hint,
  actionLabel,
  onAction,
  className,
  "data-testid": testId = "empty-state",
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center",
        className
      )}
    >
      <Icon size={32} weight="bold" aria-hidden="true" className="text-neutral-400" />
      <p className="mt-3 font-heading text-base font-semibold leading-snug tracking-tight">
        {title}
      </p>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{hint}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          data-testid={`${testId}-action`}
          className="mt-4 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ minHeight: "var(--control-h-md)" }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
