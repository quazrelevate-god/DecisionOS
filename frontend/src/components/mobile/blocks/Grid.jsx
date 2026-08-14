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
 */
export function Grid({
  title,
  items = [],
  renderTile,
  cols = 2,
  className,
  "data-testid": testId = "block-grid",
}) {
  if (!items.length) return null;
  return (
    <section data-block="grid" data-testid={testId} className={cn("mb-3", className)}>
      {title && (
        <h2 className="mb-1.5 font-heading text-base font-semibold tracking-tight">{title}</h2>
      )}
      <div className={cn("grid gap-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {items.map((item, i) => {
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
    </section>
  );
}

export default Grid;
