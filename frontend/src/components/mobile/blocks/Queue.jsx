// MPWA-12b · Queue block (§3).
//
// 76–96px per row, flat rows on `surface`, hairline dividers, NO CARD CHROME.
// Max 5 rows then `See all ›`.
//
// The "no card chrome" is the substance of this block. §1's complaint is that
// every element is "a white rounded rectangle ~80px tall with a chevron", so a
// list of cards on a page of cards is the disease. Rows share one surface and
// are separated by hairlines — the list reads as one object, not eight.
import * as React from "react";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CompletionRing } from "./Board";
import { inr } from "@/lib/format";
import { StatusChip } from "../StatusChip";
import { dueLabel } from "../MobileCard";

const MAX_ROWS = 5;

/**
 * @param {string} title
 * @param {Array}  rows      {id,title,status,statusLabel,due,person,context,amount,onOpen,progress}
 *        `progress` — 0..100. Rendered as a ring, because §5.4 asks for "a
 *        progress ring per card instead of a percentage in text".
 * @param {number} [max]
 * @param {Function} [onSeeAll]
 * @param {number} [total]   real count, when rows is already truncated upstream
 * @param {ReactNode} [empty] rendered instead of the list when there is nothing
 * @param {Function} [wrapRow] (node, row) => ReactNode — wraps each row without
 *        changing it. MPWA-12f uses it to keep My Work's swipe-to-snooze around
 *        a Queue row; without it, moving that screen onto the block would have
 *        silently dropped a shipped gesture.
 */
export function Queue({
  title,
  rows = [],
  max = MAX_ROWS,
  onSeeAll,
  total,
  empty,
  wrapRow,
  className,
  "data-testid": testId = "block-queue",
}) {
  const wrap = wrapRow ? (r, node) => wrapRow(node, r) : (_r, node) => node;
  const shown = rows.slice(0, max);
  const count = total ?? rows.length;
  const hidden = Math.max(0, count - shown.length);

  if (!rows.length && !empty) return null;

  return (
    <section data-block="queue" data-testid={testId} className={cn("mb-3", className)}>
      {title && (
        <h2 className="mb-1.5 flex items-baseline gap-2 font-heading text-base font-semibold tracking-tight">
          {title}
          {count > 0 && (
            <span className="text-[length:var(--text-label)] font-bold leading-4 tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
      )}

      {!rows.length ? (
        empty
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {shown.map((r) => {
              const d = dueLabel(r.due);
              return (
                <li key={r.id}>
                  {wrap(r, (
                  <button
                    type="button"
                    onClick={r.onOpen}
                    data-testid={`${testId}-row-${r.id}`}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent"
                    style={{ minHeight: "4.75rem" }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-heading text-[0.9375rem] font-semibold leading-snug tracking-tight line-clamp-2">
                        {r.title}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {r.status && <StatusChip status={r.status} label={r.statusLabel} />}
                        {d && (
                          <span
                            className={cn(
                              "text-sm",
                              d.tone === "overdue" ? "font-semibold text-danger-700" : "text-muted-foreground"
                            )}
                          >
                            {d.text}
                          </span>
                        )}
                        {r.context && (
                          <span className="min-w-0 truncate text-sm text-muted-foreground">{r.context}</span>
                        )}
                      </span>
                    </span>
                    {r.progress != null && (
                      <span
                        className="shrink-0"
                        role="img"
                        aria-label={`${Math.round(r.progress)}% done`}
                        data-testid={`${testId}-ring-${r.id}`}
                      >
                        <CompletionRing done={Number(r.progress) || 0} total={100} size={24} />
                      </span>
                    )}
                    {r.amount != null && Number(r.amount) !== 0 && (
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                        {inr(r.amount)}
                      </span>
                    )}
                    <CaretRight
                      size={20}
                      weight="bold"
                      aria-hidden="true"
                      className="shrink-0 text-neutral-400"
                    />
                  </button>
                  ))}
                </li>
              );
            })}
          </ul>

          {hidden > 0 && onSeeAll && (
            <button
              type="button"
              onClick={onSeeAll}
              data-testid={`${testId}-see-all`}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border text-sm font-semibold transition-colors hover:bg-accent"
              style={{ minHeight: "var(--control-h-sm)" }}
            >
              See all {count}
              <CaretRight size={16} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default Queue;
