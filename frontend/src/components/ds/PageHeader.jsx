import * as React from "react";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Page header — title, optional context, and the screen's one primary action.
 *
 * The action slot is deliberately singular. Screens accumulate buttons one
 * reasonable addition at a time, and a header with four equal buttons is how a
 * product loses its answer to "what am I here to do?". Secondary actions go in
 * `secondaryActions`, which renders them quieter and after the primary.
 *
 * Breadcrumbs are optional and truncate from the middle: the first crumb says
 * where you are in the product and the last says where you are now — the
 * middle is the part nobody reads.
 *
 * @typedef {object} Crumb
 * @property {string} label
 * @property {() => void} [onClick]
 *
 * @typedef {object} PageHeaderProps
 * @property {string} title
 * @property {string} [description]
 * @property {Crumb[]} [breadcrumbs]
 * @property {React.ReactNode} [primaryAction] The one action this screen exists for.
 * @property {React.ReactNode} [secondaryActions]
 * @property {React.ReactNode} [meta] Status badges, counts, timestamps.
 * @property {boolean} [sticky=false]
 *
 * @example
 * <PageHeader
 *   title="Decision Desk"
 *   description="Everything waiting on your decision."
 *   meta={<StatusBadge status="pending">3 pending</StatusBadge>}
 *   primaryAction={<Button>Capture a decision</Button>}
 *   secondaryActions={<Button variant="tertiary">Export</Button>}
 * />
 */
export const PageHeader = React.forwardRef(
  (
    { className, title, description, breadcrumbs = [], primaryAction, secondaryActions, meta, sticky = false, ...props },
    ref
  ) => (
    <header
      ref={ref}
      className={cn(
        "border-b-hairline bg-background pb-4",
        sticky && "sticky top-0 z-10 backdrop-blur-xl",
        className
      )}
      {...props}
    >
      {breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-small text-text-tertiary">
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={c.label} className="flex items-center gap-1 min-w-0">
                  {c.onClick && !last ? (
                    <button
                      type="button"
                      onClick={c.onClick}
                      className="truncate rounded-sm hover:text-text focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring"
                    >
                      {c.label}
                    </button>
                  ) : (
                    <span className={cn("truncate", last && "text-text-secondary")}>{c.label}</span>
                  )}
                  {!last && <CaretRight size={11} weight="bold" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h1 text-text min-w-0">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1 max-w-2xl text-body text-text-secondary">{description}</p>}
        </div>

        {(primaryAction || secondaryActions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* The primary comes FIRST in the DOM so it is announced first, and
                is pushed rightmost visually with order-last. Putting secondary
                actions first in the markup would read the screen's least
                important actions before its reason for existing. */}
            {primaryAction && <span className="order-last">{primaryAction}</span>}
            {secondaryActions}
          </div>
        )}
      </div>
    </header>
  )
);
PageHeader.displayName = "PageHeader";
