import { cn } from "../lib/utils";

export function PageHeader({ eyebrow, title, children }) {
  if (!children) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 w-full">{children}</div>
  );
}

const STATUS_STYLES = {
  pending_approval: "bg-brand-yellow text-black",
  approved: "bg-brand-blue text-white",
  rejected: "bg-black text-white",
  blocked: "bg-black/10 text-black",
  todo: "bg-white text-black",
  in_progress: "bg-brand-blue text-white",
  done: "bg-brand-ink text-white",
  cancelled: "bg-black/10 text-muted-foreground line-through",
  high: "bg-danger-600 text-white",
  medium: "bg-brand-yellow text-black",
  low: "bg-black/10 text-black",
  overdue: "bg-danger-600 text-white",
  decision: "bg-brand-blue text-white",
  purchase: "bg-brand-yellow text-black",
  owner: "bg-brand-600 text-white",
  sales: "bg-white text-black",
  production: "bg-white text-black",
  finance: "bg-white text-black",
  sales_dispatch: "bg-brand-yellow text-black",
  purchase_payment: "bg-brand-yellow text-black",
  directive: "bg-brand-blue text-white",
  approval: "bg-brand-blue text-white",
  policy: "bg-brand-ink text-white",
  observation: "bg-black/10 text-black",
};

const STATUS_LABELS = {
  blocked: "pending approval",
};

export function Chip({ value, className = "", ...rest }) {
  const style = STATUS_STYLES[value] || "bg-white text-black";
  const label = STATUS_LABELS[value] || String(value || "").replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 text-xs uppercase tracking-wider font-semibold border border-black",
        style,
        className
      )}
      {...rest}
    >
      {label}
    </span>
  );
}

export function EmptyState({ title, hint, ctaLabel, onCta, ctaTo, secondary, testid }) {
  // Epic 2 Sprint 3 (E2-13): every list surface now takes a specific CTA
  // so a fresh tenant sees a next-action button instead of a dead
  // "Nothing here" screen. Supports either onCta (callback) or ctaTo
  // (react-router path) so the caller picks whichever it needs.
  return (
    <div
      data-testid={testid || "empty-state"}
      className="border border-dashed border-border rounded-xl p-12 text-center bg-card/40"
    >
      <p className="font-heading font-semibold tracking-tight text-lg">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-2">{hint}</p>}
      {(ctaLabel && (onCta || ctaTo)) && (
        <div className="mt-6 flex items-center justify-center gap-2">
          {onCta ? (
            <button
              onClick={onCta}
              data-testid={testid ? `${testid}-cta` : "empty-state-cta"}
              className="inline-flex items-center gap-2 bg-brand-ink text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all"
            >
              {ctaLabel}
            </button>
          ) : (
            <a
              href={ctaTo}
              data-testid={testid ? `${testid}-cta` : "empty-state-cta"}
              className="inline-flex items-center gap-2 bg-brand-ink text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all"
            >
              {ctaLabel}
            </a>
          )}
          {secondary && (
            <span className="text-xs text-muted-foreground">{secondary}</span>
          )}
        </div>
      )}
    </div>
  );
}


// Epic 2 Sprint 3 (E2-14): brutalist skeleton bars. Keep the visual
// language of the app (border-black, no rounded corners on the primary
// shapes) so layouts don't jump when data lands. Three primitives that
// cover 95% of the surfaces:
//   * <SkeletonLine> for text rows
//   * <SkeletonCard> for the KPI-card / grid-card pattern
//   * <SkeletonRow>  for table rows
// All three respect the same `pulse` animation timing.

export function SkeletonLine({ className = "", width = "100%" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 bg-black/10 rounded-none animate-pulse ${className}`}
      style={{ width }}
    />
  );
}

export function SkeletonCard({ lines = 3, className = "" }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton-card"
      className={`card-brutal p-5 ${className}`}
    >
      <div className="flex flex-col gap-3">
        <SkeletonLine width="40%" className="h-4" />
        <SkeletonLine width="80%" />
        {Array.from({ length: Math.max(0, lines - 2) }).map((_, i) => (
          <SkeletonLine key={i} width={`${60 - i * 8}%`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6, columns = "md:grid-cols-2 xl:grid-cols-3", lines = 3 }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton-grid"
      className={`grid ${columns} gap-4`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

export function SkeletonRow({ cols = 4 }) {
  return (
    <tr aria-hidden="true" className="border-t border-black/10">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <SkeletonLine width={i === 0 ? "60%" : "80%"} />
        </td>
      ))}
    </tr>
  );
}

// Epic 2 Sprint 5 (E2-40): consistent voice marker on every AI-generated
// string. Small Sparkle icon + "DEX →" prefix in mono caps so users
// know which responses came from the persona vs static app copy.
// Wrap: <DexBadge inline /> for a compact chip that sits before the
// response text; <DexBadge /> for the block-header variant used at the
// top of AI panels (Ledger AI, Relationship Intelligence, Coach reports).
export function DexBadge({ inline = false, className = "" }) {
  if (inline) {
    return (
      <span
        data-testid="dex-badge-inline"
        className={`inline-flex items-center gap-1 mr-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-600 ${className}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2z"/>
        </svg>
        DEX →
      </span>
    );
  }
  return (
    <div
      data-testid="dex-badge-block"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-brand-ink text-white border border-black ${className}`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2z"/>
      </svg>
      DEX →
    </div>
  );
}


export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton-table"
      className="overflow-x-auto border border-black bg-white"
    >
      <table className="w-full text-sm">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
