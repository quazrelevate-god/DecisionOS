import { cn } from "../lib/utils";

export function PageHeader({ eyebrow, title, children }) {
  if (!children) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 w-full">{children}</div>
  );
}

// RD-1 (2026-08-17) — the status pill, rebuilt.
//
// Was: saturated fills (solid yellow / solid blue / solid black), a hard
// `border-black` frame, uppercase and wide letter-spacing. A list of ten rows
// carried ten shouting blocks of colour and the eye had nowhere to rest.
//
// Now: a tint-background + darker-text pair drawn from the semantic ramp, no
// border, normal case. The reference sets status this way — the pill reads as
// a quiet annotation and colour only appears where it means something. Note
// there is deliberately NO indigo default: indigo is the action colour, and a
// status pill is not an action. Neutral states are grey.
const STATUS_STYLES = {
  // neutral / in-flight
  todo: "bg-muted text-muted-foreground",
  blocked: "bg-muted text-muted-foreground",
  observation: "bg-muted text-muted-foreground",
  low: "bg-muted text-muted-foreground",
  sales: "bg-muted text-muted-foreground",
  production: "bg-muted text-muted-foreground",
  finance: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground line-through",

  // waiting on someone
  pending_approval: "bg-caution-50 text-caution-800",
  medium: "bg-caution-50 text-caution-800",
  purchase: "bg-caution-50 text-caution-800",
  sales_dispatch: "bg-caution-50 text-caution-800",
  purchase_payment: "bg-caution-50 text-caution-800",

  // settled / positive
  approved: "bg-success-50 text-success-800",
  done: "bg-success-50 text-success-800",

  // at risk
  high: "bg-danger-50 text-danger-700",
  overdue: "bg-danger-50 text-danger-700",
  rejected: "bg-danger-50 text-danger-700",

  // informational — brand tint is reserved for things that ARE the workflow
  in_progress: "bg-brand-50 text-brand-700",
  decision: "bg-brand-50 text-brand-700",
  directive: "bg-brand-50 text-brand-700",
  approval: "bg-brand-50 text-brand-700",
  policy: "bg-brand-50 text-brand-700",
  owner: "bg-brand-50 text-brand-700",
};

const STATUS_LABELS = {
  blocked: "pending approval",
};

export function Chip({ value, className = "", ...rest }) {
  const style = STATUS_STYLES[value] || "bg-muted text-muted-foreground";
  const label = STATUS_LABELS[value] || String(value || "").replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize whitespace-nowrap",
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
    // RD-1 (2026-08-17): the reference states an empty list as centred, quiet
    // prose on the plain page — no dashed box, no tinted plate. The dashed
    // rectangle read as a drop-zone, which is the wrong affordance for "you
    // have nothing here yet". The CTA is the only coloured thing in the block.
    <div
      data-testid={testid || "empty-state"}
      className="py-16 px-6 text-center"
    >
      <p className="text-base font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">{hint}</p>}
      {(ctaLabel && (onCta || ctaTo)) && (
        <div className="mt-6 flex flex-col items-center gap-2">
          {onCta ? (
            <button
              onClick={onCta}
              data-testid={testid ? `${testid}-cta` : "empty-state-cta"}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              {ctaLabel}
            </button>
          ) : (
            <a
              href={ctaTo}
              data-testid={testid ? `${testid}-cta` : "empty-state-cta"}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
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


// Epic 2 Sprint 3 (E2-14): skeleton bars that hold the layout so nothing
// jumps when data lands.
// RD-5 (2026-08-17): this comment used to say "keep the visual language of
// the app (border-black, no rounded corners)" — that language was the
// brutalist system, which the redesign retired. The skeletons now take the
// muted surface and the same soft radius the real rows use.
// Three primitives cover ~95% of the surfaces:
//   * <SkeletonLine> for text rows
//   * <SkeletonCard> for the KPI-card / grid-card pattern
//   * <SkeletonRow>  for table rows
// All three respect the same `pulse` animation timing.

export function SkeletonLine({ className = "", width = "100%" }) {
  // RD-1: `bg-black/10` + `rounded-none` were the brutalist bar. A skeleton
  // should read as the shape of the content that is coming, so it takes the
  // muted surface and the same soft radius the real rows use.
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 bg-muted rounded animate-pulse ${className}`}
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
    <tr aria-hidden="true" className="border-t border-border">
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
        className={`inline-flex items-center gap-1 mr-1.5 text-[10px] font-medium text-brand-600 ${className}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2z"/>
        </svg>
        DEX →
      </span>
    );
  }
  // RD-1: the block badge was a solid dark plate with a hard border. It now
  // reads as a brand-tinted pill — still unmistakably "this came from Dex",
  // but it no longer outweighs the sentence it labels.
  return (
    <div
      data-testid="dex-badge-block"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium bg-brand-50 text-brand-700 ${className}`}
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
      className="overflow-x-auto nm-raised"
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
