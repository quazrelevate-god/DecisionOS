// MPWA-12b · Board block (§3, §5.4).
//
// Fills the remaining viewport. Horizontal snap columns, 232px wide, for pipeline
// stages — "a founder's work is a FLOW; rendering it as a to-do list is the
// biggest regression from v2" (§5.4).
//
// Advancing a card is long-press → adjacent stages highlight → tap the target.
// §5.4 is explicit: "Do not attempt desktop drag-and-drop on a phone." A drag
// that has to survive a scroll container on a touch screen fights the scroll and
// loses.
import * as React from "react";
import { cn } from "@/lib/utils";

const COL_W = 232;

/** Completion ring — the L3 progress element for this screen (§3). */
export function CompletionRing({ done = 0, total = 0, size = 22 }) {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" className="stroke-neutral-200 dark:stroke-neutral-700" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="stroke-success-600"
      />
    </svg>
  );
}

/**
 * @param {Array<{key,label,count,done,total,items:Array}>} columns
 * @param {Function} renderItem  (item, columnKey) => ReactNode
 * @param {Function} [onMove]    (item, targetColumnKey) => void — enables long-press move
 */
export function Board({
  columns = [],
  renderItem,
  onMove,
  className,
  "data-testid": testId = "block-board",
}) {
  const scroller = React.useRef(null);
  const [active, setActive] = React.useState(0);
  // The card picked up by a long press, if any. Adjacent stages highlight and a
  // tap on a column header moves it there.
  const [lifted, setLifted] = React.useState(null);
  const pressTimer = React.useRef(null);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setActive(Math.round(el.scrollLeft / (COL_W + 12)));
  };

  const startPress = (item, columnKey) => {
    if (!onMove) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      setLifted({ item, from: columnKey });
      // A lift is a state change with no visual of its own on the card, so
      // announce it via haptics where available.
      try { navigator.vibrate?.(12); } catch { /* unsupported */ }
    }, 420);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);

  React.useEffect(() => () => clearTimeout(pressTimer.current), []);

  const moveTo = (key) => {
    if (!lifted) return;
    if (key !== lifted.from) onMove?.(lifted.item, key);
    setLifted(null);
  };

  if (!columns.length) return null;

  return (
    <section data-block="board" data-testid={testId} className={cn("mb-3", className)}>
      {lifted && (
        <p
          role="status"
          data-testid={`${testId}-lifted`}
          className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100"
        >
          Moving “{String(lifted.item?.title || "").slice(0, 40)}” — tap a stage, or{" "}
          <button type="button" onClick={() => setLifted(null)} className="font-semibold underline">
            cancel
          </button>
          .
        </p>
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        data-testid={`${testId}-scroller`}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
        style={{ scrollSnapType: "x mandatory", overscrollBehaviorX: "contain" }}
      >
        {columns.map((col) => {
          const isTarget = lifted && col.key !== lifted.from;
          return (
            <div
              key={col.key}
              data-testid={`${testId}-col-${col.key}`}
              className="shrink-0 snap-start"
              style={{ width: COL_W, scrollSnapAlign: "start" }}
            >
              <button
                type="button"
                onClick={() => isTarget && moveTo(col.key)}
                disabled={!isTarget}
                data-testid={`${testId}-head-${col.key}`}
                aria-label={isTarget ? `Move to ${col.label}` : col.label}
                className={cn(
                  "mb-2 flex w-full items-center gap-2 rounded-xl border px-3 text-left transition-colors",
                  isTarget
                    ? "border-brand-400 bg-brand-50 dark:bg-brand-900/30"
                    : "border-border bg-card",
                  !isTarget && "cursor-default"
                )}
                style={{ minHeight: "var(--control-h-sm)" }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{col.label}</span>
                </span>
                <span className="text-[length:var(--text-label)] font-bold leading-4 tabular-nums text-muted-foreground">
                  {col.count ?? col.items?.length ?? 0}
                </span>
                {/* L3: throughput per stage, not a vanity metric */}
                <span data-progress="stage-completion">
                  <CompletionRing done={col.done || 0} total={col.total || col.items?.length || 0} />
                </span>
              </button>

              <div className="space-y-2">
                {(col.items || []).map((item, i) => (
                  <div
                    key={item.id || i}
                    onPointerDown={() => startPress(item, col.key)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(e) => e.preventDefault()}
                    className={cn(
                      "transition-transform",
                      lifted?.item?.id === item.id && "scale-[0.97] opacity-60"
                    )}
                  >
                    {renderItem?.(item, col.key)}
                  </div>
                ))}
                {!(col.items || []).length && (
                  <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                    Nothing here
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dot indicator plus a thin progress rail under the board (§5.4) */}
      <div className="mt-1 flex items-center gap-2">
        <div className="flex gap-1.5" data-testid={`${testId}-dots`}>
          {columns.map((c, i) => (
            <span
              key={c.key}
              aria-hidden="true"
              className={cn(
                "h-1.5 rounded-pill transition-all",
                i === active ? "w-4 bg-primary" : "w-1.5 bg-neutral-300 dark:bg-neutral-600"
              )}
            />
          ))}
        </div>
        <span className="sr-only" aria-live="polite">
          Stage {active + 1} of {columns.length}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-pill bg-neutral-200 dark:bg-neutral-700">
          <div
            className="h-full rounded-pill bg-primary/60 transition-all"
            style={{ width: `${((active + 1) / columns.length) * 100}%` }}
          />
        </div>
      </div>
    </section>
  );
}

export default Board;
