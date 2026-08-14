// MPWA-12b · Grid block (§3).
//
// 116px tiles, 2-up compact, for "comparable entities you scan and pick".
//
// NEVER for ordered work (§3, §9). That is the rule that separates this from
// v1's original sin — nine KPI tiles as a screen's main content, five reading
// zero. A grid says "these are peers, pick one"; a queue says "start at the
// top". Using a grid for ordered work throws away the order.
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * @param {Array<{id,onOpen,...}>} items
 * @param {Function} renderTile  (item) => ReactNode — the tile's inner content
 * @param {string}  [title]
 * @param {2|3}     [cols]
 * @param {number}  [max]       tiles rendered before the "Show more" row. A book
 *                              of 60 relationships is 4,700px of tiles, past
 *                              §5.2.7's ceiling — the cap is what keeps a Grid
 *                              scannable, the same way max-5 does for a Queue.
 * @param {Function} [onSeeAll] omit to render everything
 */
export function Grid({
  title,
  items = [],
  renderTile,
  cols = 2,
  max,
  onSeeAll,
  className,
  "data-testid": testId = "block-grid",
}) {
  const shown = max ? items.slice(0, max) : items;
  const hidden = items.length - shown.length;

  if (!items.length) return null;
  return (
    <section data-block="grid" data-testid={testId} className={cn("mb-3", className)}>
      {title && (
        <h2 className="mb-1.5 font-heading text-base font-semibold tracking-tight">{title}</h2>
      )}
      <div className={cn("grid gap-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {shown.map((item, i) => {
          const Tag = item.onOpen ? "button" : "div";
          return (
            <Tag
              key={item.id || i}
              {...(item.onOpen ? { type: "button", onClick: item.onOpen } : {})}
              data-testid={`${testId}-tile-${item.id ?? i}`}
              className={cn(
                "flex min-h-[7.25rem] flex-col justify-between rounded-xl border border-border bg-card p-3 text-left",
                item.onOpen && "transition-colors hover:bg-accent"
              )}
            >
              {renderTile?.(item)}
            </Tag>
          );
        })}
      </div>

      {hidden > 0 && onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          data-testid={`${testId}-see-all`}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-accent"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          Show {Math.min(hidden, max)} more of {items.length}
        </button>
      )}
    </section>
  );
}

export default Grid;
