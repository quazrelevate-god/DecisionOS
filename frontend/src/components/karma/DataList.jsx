// KM-4 (2026-08-27) · DataList — one column config, two renderers.
//
// THE PROBLEM. Finance carries five 6–7 column <table>s (revenue invoices,
// revenue payments, expenses, assets, inventory). Each sits in
// `card-brutal overflow-x-auto` with `p-3` cells, so on a phone they do scroll
// — but seven columns of 24px padding alone is 168px before a single character,
// you see roughly two columns at a time, and there is no affordance saying the
// rest exists. A horizontal scroller with no edge signal inside a page whose
// <main> is `overflow-x: clip` is exactly the failure this pass keeps fixing.
//
// WHY CARDS, NOT A STICKY FIRST COLUMN. A sticky column needs an opaque fill on
// every first cell or the scrolled columns bleed through it. These cards are
// bg-nm-raised with transparent rows separated by a hairline, so painting the
// first cell would draw a hard vertical seam down a card whose whole material
// claim is borderless-by-tone, and it would fight the row's hover tint. The
// columns are also not equally important: all five tables are the same shape —
// a name, some chips, some meta, an amount, one destructive action — which is a
// card, not a grid.
//
// WHY useIsMobile AND NOT `lg:hidden`. hooks/useIsMobile is already the
// codebase's answer here (ContactProfile, Journal, Notifications use it) and
// its own header argues the case: rendering the desktop tree untouched above lg
// makes the desktop guarantee structural rather than something to re-verify,
// and it keeps one copy of the DOM instead of shipping both and hiding one.
import * as React from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { cn } from "@/lib/utils";

/**
 * @param {Array} columns  [{ key, head, cell(row), role, align, thClass, tdClass }]
 *   role drives the MOBILE layout only; the table ignores it and renders the
 *   columns in order, exactly as the hand-written tables did.
 *     title  — the heading line (2-line clamp)
 *     amount — same line as the title, right, tabular-nums
 *     chip   — a wrapped chip row under the title
 *     meta   — one dot-joined muted line; never four labelled rows
 *     action — trailing control, bottom-right of the card
 * @param {Array}    rows
 * @param {Function} rowKey       row -> stable key
 * @param {Function} [rowTestid]  row -> data-testid, so existing selectors survive
 * @param {Function} [rowClass]   row -> extra classes (e.g. the overdue tint)
 */
export function DataList({ columns, rows, rowKey, rowTestid, rowClass, testid, footer }) {
  const isMobile = useIsMobile();
  const by = (r) => columns.filter((c) => c.role === r);

  if (isMobile) {
    const titles = by("title");
    const amounts = by("amount");
    const chips = by("chip");
    const metas = by("meta");
    const actions = by("action");

    return (
      <div className="space-y-2.5" data-testid={testid}>
        {rows.map((row) => {
          // Meta cells render to nodes, so "is this empty" has to be asked of
          // the SOURCE value, not the node — a cell returning "—" is still a
          // node and would put a lone dash in the dot-joined line.
          const metaNodes = metas
            .map((c) => ({ c, v: c.value ? c.value(row) : undefined }))
            .filter(({ c, v }) => (c.value ? v != null && v !== "" && v !== "—" : true))
            .map(({ c }) => c);

          return (
            <div
              key={rowKey(row)}
              data-testid={rowTestid ? rowTestid(row) : undefined}
              className={cn("kr-bento p-3.5", rowClass?.(row))}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2">
                  {titles.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}
                </div>
                {/* tabular-nums, not font-mono: Plex Mono's wide comma splits
                    an Indian-grouped figure (₹4,80,000) into three visually
                    separate blocks at this size. */}
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {amounts.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}
                </span>
              </div>

              {chips.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {chips.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}
                </div>
              )}

              {(metaNodes.length > 0 || actions.length > 0) && (
                <div className="mt-2 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {metaNodes.map((c, i) => (
                      <React.Fragment key={c.key}>
                        {i > 0 && <span aria-hidden="true" className="px-1.5">·</span>}
                        {c.cell(row)}
                      </React.Fragment>
                    ))}
                  </p>
                  {actions.length > 0 && (
                    <span className="flex shrink-0 items-center gap-1">
                      {actions.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* The table's <tfoot> becomes a plain summary line — a footer row in a
            card list has no columns to align to. */}
        {footer && (
          <div className="flex items-center justify-between gap-3 px-1 pt-1 text-xs text-muted-foreground">
            <span>{footer.label}</span>
            <span className="font-semibold tabular-nums text-foreground" data-testid={footer.testid}>
              {footer.value}
            </span>
          </div>
        )}
      </div>
    );
  }

  // >= lg: the original table, verbatim in structure and classes.
  return (
    <div className="card-brutal overflow-x-auto" data-testid={testid}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-nm-edge/40 text-left text-xs font-medium text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} className={cn("p-3", c.align === "right" && "text-right", c.thClass)}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-testid={rowTestid ? rowTestid(row) : undefined}
              className={cn("border-b border-nm-edge/60 hover:bg-accent/50", rowClass?.(row))}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("p-3", c.align === "right" && "text-right", c.tdClass)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-nm-edge/40 bg-nm-sunken/40">
              <td colSpan={Math.max(1, columns.length - 2)} className="p-3 text-xs text-muted-foreground">
                {footer.label}
              </td>
              <td className="p-3 text-right font-mono font-bold" data-testid={footer.testid}>
                {footer.value}
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default DataList;
