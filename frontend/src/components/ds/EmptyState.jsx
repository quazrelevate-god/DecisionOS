import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/**
 * Empty state — onboarding, never alarm.
 *
 * No data is not a failure, so nothing here is red, dashed, or warning-shaped.
 * The copy tells the reader what to create first and the primary action starts
 * them doing it: an empty screen with no way forward is a dead end, and a
 * dashed grey box with "No results" teaches nothing.
 *
 * @typedef {object} EmptyStateProps
 * @property {string} title Sentence case, invites the first action, e.g. "Capture the first decision".
 * @property {string} [description]
 * @property {React.ReactNode} [icon]
 * @property {string} [actionLabel]
 * @property {() => void} [onAction]
 * @property {React.ReactNode} [secondaryAction]
 * @property {'md'|'lg'} [size='md']
 *
 * @example
 * <EmptyState
 *   icon={<Microphone />}
 *   title="Capture the first decision"
 *   description="Speak, type or upload a file — the Brain writes it up and proposes the tasks."
 *   actionLabel="Capture a decision"
 *   onAction={focusCapture}
 * />
 */
export const EmptyState = React.forwardRef(
  ({ className, title, description, icon, actionLabel, onAction, secondaryAction, size = "md", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center rounded-lg border border-hairline bg-surface text-center",
        size === "lg" ? "px-6 py-16" : "px-6 py-12",
        className
      )}
      {...props}
    >
      {icon && (
        <span className="mb-4 inline-flex items-center justify-center rounded-pill bg-primary-tint p-3 text-primary-text [&_svg]:size-6">
          {icon}
        </span>
      )}
      <p className="text-h3 text-text">{title}</p>
      {description && <p className="mt-2 max-w-md text-body text-text-secondary">{description}</p>}
      {(actionLabel || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && onAction && <Button onClick={onAction}>{actionLabel}</Button>}
          {secondaryAction}
        </div>
      )}
    </div>
  )
);
EmptyState.displayName = "EmptyState";
