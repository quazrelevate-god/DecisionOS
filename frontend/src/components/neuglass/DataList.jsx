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
//
// 2026-09-14 — onto the glass with the Finance rebuild (Finance is the only
// caller). The white glass card now belongs to the page, which wraps each list
// in one, so the table draws no box of its own: a slate head, hairline rows, a
// white wash on hover. On a phone each row is a small white glass tile.
import * as React from "react";
import { Check } from "@phosphor-icons/react";
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
 * @param {object}   [select]     2026-10-22 — Finance's select-and-delete
 *   (pages/finance/FinanceDelete useSelection): while `select.on`, a tick box
 *   leads every row, a tap on a phone card ticks it, and the row's own actions
 *   step aside so a tap cannot delete one record by accident.
 */
export function DataList({ columns, rows, rowKey, rowTestid, rowClass, testid, footer, select }) {
  const isMobile = useIsMobile();
  const selecting = !!select?.on;
  const by = (r) => columns.filter((c) => c.role === r && !(selecting && r === "action"));

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

          const ticked = selecting && select.has(row);
          return (
            <div
              key={rowKey(row)}
              data-testid={rowTestid ? rowTestid(row) : undefined}
              {...(selecting ? {
                role: "checkbox", "aria-checked": ticked, tabIndex: 0,
                onClick: () => select.toggle(row),
                onKeyDown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); select.toggle(row); } },
              } : {})}
              className={cn(
                "rounded-2xl bg-white/80 p-3.5 ring-1 ring-inset ring-white shadow-[0_8px_22px_-14px_hsl(150_15%_20%/0.3)]",
                rowClass?.(row),
                selecting && "flex cursor-pointer items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30",
                ticked && "bg-white ring-2 ring-neutral-900/70",
              )}
            >
              {selecting && <Tick on={ticked} />}
              <div className={selecting ? "min-w-0 flex-1" : undefined}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-900 line-clamp-2">
                  {titles.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}
                </div>
                {/* tabular-nums, not font-mono: Plex Mono's wide comma splits
                    an Indian-grouped figure (₹4,80,000) into three visually
                    separate blocks at this size. */}
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
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
                  <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
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
            </div>
          );
        })}
        {/* The table's <tfoot> becomes a plain summary line — a footer row in a
            card list has no columns to align to. */}
        {footer && (
          <div className="flex items-center justify-between gap-3 px-1 pt-1 text-xs text-slate-500">
            <span>{footer.label}</span>
            <span className="font-semibold tabular-nums text-slate-900" data-testid={footer.testid}>
              {footer.value}
            </span>
          </div>
        )}
      </div>
    );
  }

  // >= lg: the table, in the page's glass card.
  return (
    <div className="-mx-2 overflow-x-auto" data-testid={testid}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-900/[0.07] text-left text-xs font-medium text-slate-500">
            {selecting && (
              <th className="w-10 px-3 py-2.5">
                <TickBox checked={select.all} onChange={select.toggleAll} label="Select all" testid={testid ? `${testid}-select-all` : undefined} />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} className={cn("px-3 py-2.5 font-medium", c.align === "right" && "text-right", c.thClass)}>
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
              className={cn("border-b border-slate-900/[0.05] transition-colors last:border-0 hover:bg-white/60", rowClass?.(row),
                selecting && select.has(row) && "bg-white/80")}
            >
              {selecting && (
                <td className="w-10 px-3 py-3 align-middle">
                  <TickBox checked={select.has(row)} onChange={() => select.toggle(row)} label="Select"
                    testid={rowTestid ? `${rowTestid(row)}-select` : undefined} />
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-3 align-middle text-slate-700", c.align === "right" && "text-right", c.tdClass)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-slate-900/[0.07]">
              <td colSpan={Math.max(1, columns.length - 2 + (selecting ? 1 : 0))} className="px-3 py-3 text-xs text-slate-500">
                {footer.label}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900" data-testid={footer.testid}>
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

/* The tick: the design system's round ink check (DesignCheckbox), drawn
   without a label. On a phone card it is only a picture — the whole card is
   the control — so it is hidden from the accessibility tree there. */
function Tick({ on }) {
  return (
    <span aria-hidden="true" className={cn(
      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors",
      on ? "border-transparent bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))]" : "border-neutral-400/80 bg-white",
    )}>
      {on && <Check size={12} weight="bold" className="text-white" />}
    </span>
  );
}

function TickBox({ checked, onChange, label, testid }) {
  return (
    <span className="relative grid h-5 w-5 place-items-center">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} data-testid={testid}
        className="peer h-5 w-5 cursor-pointer appearance-none rounded-full border-[1.5px] border-neutral-400/80 bg-white transition-colors checked:border-transparent checked:bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30" />
      <Check size={12} weight="bold" aria-hidden="true" className="pointer-events-none absolute hidden text-white peer-checked:block" />
    </span>
  );
}

export default DataList;
