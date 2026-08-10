import { CaretRight } from "@phosphor-icons/react";

import { cn } from "../lib/utils";

/* ============================================================================
   Meridian primitives
   ----------------------------------------------------------------------------
   Every page composes from these instead of hand-rolling headers, chips, tabs
   and empty states. Existing exports (PageHeader / Chip / EmptyState) keep the
   same call signature so un-migrated pages pick the new look up for free.
   ========================================================================== */

/**
 * Canonical page header.
 *
 * Previously this dropped `eyebrow`/`title` on the floor and rendered only its
 * children — so no screen in the app had a visible title or an <h1>. It now
 * renders a real heading (fixing both hierarchy and screen-reader landmarks)
 * while still slotting page controls into the same row.
 */
export function PageHeader({ eyebrow, title, description, actions, children, className }) {
  if (!eyebrow && !title && !description && !actions && !children) return null;
  return (
    <header
      className={cn("mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", className)}
      data-testid="page-header"
    >
      {(eyebrow || title || description) && (
        <div className="min-w-0">
          {eyebrow && (
            <p className="label-mono text-muted-foreground" data-testid="page-header-eyebrow">
              {eyebrow}
            </p>
          )}
          {title && (
            <h1
              className="mt-1.5 text-title text-foreground truncate"
              data-testid="page-header-title"
            >
              {title}
            </h1>
          )}
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {(children || actions) && (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:shrink-0">
          {children}
          {actions}
        </div>
      )}
    </header>
  );
}

/* --------------------------------------------------------------------------
   Status chips — mapped onto semantic tokens rather than raw brand colours.
   Red now means "urgent", not "brand".
   -------------------------------------------------------------------------- */

const TONE = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  primary: "bg-primary-subtle text-primary border-primary/25",
  success: "bg-success-subtle text-success border-success/25",
  warning: "bg-warning-subtle text-warning border-warning/25",
  danger: "bg-destructive-subtle text-destructive border-destructive/25",
  solid: "bg-foreground text-background border-transparent",
  quiet: "bg-muted text-muted-foreground border-border",
};

const STATUS_TONES = {
  // approvals & decisions
  pending_approval: "warning",
  approved: "success",
  rejected: "quiet",
  blocked: "warning",
  decision: "primary",
  directive: "primary",
  approval: "primary",
  policy: "solid",
  observation: "quiet",
  // task lifecycle
  todo: "neutral",
  in_progress: "primary",
  done: "success",
  cancelled: "quiet",
  // priority & risk
  high: "danger",
  medium: "warning",
  low: "quiet",
  overdue: "danger",
  // domain
  purchase: "warning",
  owner: "primary",
  sales: "neutral",
  production: "neutral",
  finance: "neutral",
  sales_dispatch: "warning",
  purchase_payment: "warning",
};

const STATUS_LABELS = {
  blocked: "pending approval",
};

export function Chip({ value, tone, className = "", ...rest }) {
  const resolved = TONE[tone || STATUS_TONES[value] || "neutral"];
  const label = STATUS_LABELS[value] || String(value || "").replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5",
        "font-mono text-[10px] uppercase tracking-[0.08em] font-medium leading-5",
        "whitespace-nowrap",
        resolved,
        className
      )}
      {...rest}
    >
      {label}
    </span>
  );
}

/* --------------------------------------------------------------------------
   States: empty, loading, error. Previously each page invented its own.
   -------------------------------------------------------------------------- */

export function EmptyState({ icon: Icon, title, hint, action, className, ...rest }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border",
        "bg-card/40 px-6 py-14 text-center",
        className
      )}
      {...rest}
    >
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <Icon size={20} weight="bold" />
        </div>
      )}
      <p className="text-heading text-foreground">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-md bg-muted", className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
    </div>
  );
}

export function LoadingState({ rows = 3, className, label = "Loading…" }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="surface-card p-5">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="mt-3 h-3 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", hint, onRetry, className }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-destructive/25 bg-destructive-subtle px-6 py-8 text-center",
        className
      )}
    >
      <p className="text-heading text-destructive">{title}</p>
      {hint && <p className="mt-1.5 text-sm text-destructive/80">{hint}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          data-testid="error-retry"
          className="mt-5 rounded-lg border border-destructive/30 bg-card px-4 py-2 text-sm font-medium text-destructive transition-[background-color,transform] duration-200 hover:bg-destructive/10 active:scale-[0.98]"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Layout helpers
   -------------------------------------------------------------------------- */

/** A titled content block — the standard way to group related controls. */
export function Section({ title, description, actions, children, className, ...rest }) {
  return (
    <section className={cn("surface-card overflow-hidden", className)} {...rest}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-heading text-foreground">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </section>
  );
}

/** A single metric in a bento grid. Numerals are tabular so columns line up. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  onClick,
  className,
  valueTestId,
  ...rest
}) {
  const accents = {
    neutral: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "surface-card group flex flex-col gap-3 p-5 text-left",
        onClick &&
          "shadow-hover cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...rest}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-mono text-muted-foreground">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          {Icon && (
            <Icon size={16} weight="bold" className={cn("opacity-70", accents[tone])} aria-hidden="true" />
          )}
          {/* Whole-tile clicks need a visible affordance, otherwise the tile
              reads as a static readout. */}
          {onClick && (
            <CaretRight
              size={13}
              weight="bold"
              aria-hidden="true"
              className="text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          )}
        </span>
      </div>
      <p
        data-numeric
        data-testid={valueTestId}
        className={cn("text-[2rem] font-semibold leading-none tracking-tight", accents[tone])}
      >
        {value}
      </p>
      {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
    </Comp>
  );
}

/** Replaces the ad-hoc bordered tab strips each page was building by hand. */
export function SegmentedControl({ options, value, onChange, className, testid, size = "md" }) {
  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <div
      role="tablist"
      data-testid={testid}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-1",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={o.testid}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium",
              "transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98]",
              pad,
              active
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.icon && <o.icon size={15} weight="bold" aria-hidden="true" />}
            {o.label}
            {o.count > 0 && (
              <span
                data-numeric
                className={cn(
                  "ml-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] leading-none",
                  active ? "bg-primary-subtle text-primary" : "bg-secondary text-muted-foreground"
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
