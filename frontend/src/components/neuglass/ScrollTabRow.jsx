/* 2026-10-15 (founder, Redmi) — A ROW OF TABS THAT IS WIDER THAN THE PHONE.
 *
 * Preferences' sections and the Finance inbox's statuses were each one
 * scrolling row with the scrollbar hidden: on a phone the last ones were cut
 * mid-word or off the screen with nothing to say the row moved. This is that
 * row, done once:
 *   - below lg each tab is exactly a third of the row, less a 2.75rem strip at
 *     the end (index.css .tabrow), so the first three are always whole;
 *   - the next tab peeks into that strip under a fade and a round arrow, and a
 *     press on the arrow scrolls on; the arrows come and go with the scroll;
 *   - the label steps down a little on the narrowest phones rather than being
 *     cut (`fit`, the row's longest label, sets how far);
 *   - from lg up the tabs are their own width again and, with room for all of
 *     them, no arrow ever shows.
 * Each caller keeps its own look: it hands in the track's and the tabs' classes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * @param {{key: string, label: string}[]} items
 * @param {string} active        the key of the open one
 * @param {(key: string) => void} onPick
 * @param {string} trackClassName the pill's own material (e.g. "ng-pressed")
 * @param {(active: boolean) => string} tabClassName the look of one tab
 * @param {"tabs"|"toggles"} [kind] "tabs": role=tablist/tab + aria-selected;
 *        "toggles": a labelled group of aria-pressed buttons
 * @param {number} [fit] how wide the row's longest label is, in ems at its
 *        bold weight, measured in the app's own font: "Team & access" 6.7–6.9,
 *        "Needs attention" 7.26. Give a little over. Sets how small the label may
 *        step on a narrow phone so three still fit (see .tabrow__tab).
 * @param {string} testid         the track's testid; the wrapper is `${testid}-row`,
 *        the arrows `${testid}-prev` / `${testid}-next`
 * @param {(key: string) => string} tabTestId
 */
export function ScrollTabRow({ items, active, onPick, trackClassName, tabClassName, kind = "tabs",
                               label, fit = 7.4, testid, tabTestId, className }) {
  const rowRef = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, items.length]);

  /* The open tab is brought into view by hand, not with scrollIntoView: the
     third tab ends exactly where the peek strip begins, and the browser read
     that as a hair out of view and nudged the row — the left arrow came up
     and covered the first tab with nothing scrolled on purpose. This only
     moves the row when a tab is really hidden behind an arrow (4px of slack). */
  useEffect(() => {
    const el = rowRef.current;
    const b = el?.querySelector('[data-open="1"]');
    if (!el || !b) return;
    const PEEK = 44, SLACK = 4;   // the 2.75rem peek strip, in CSS px
    const max = el.scrollWidth - el.clientWidth;
    const viewL = el.scrollLeft + (el.scrollLeft > 2 ? PEEK : 0);
    const viewR = el.scrollLeft + el.clientWidth - (el.scrollLeft < max - 2 ? PEEK : 0);
    let to = null;
    if (b.offsetLeft < viewL - SLACK) to = b.offsetLeft - PEEK;
    else if (b.offsetLeft + b.offsetWidth > viewR + SLACK) to = b.offsetLeft + b.offsetWidth + PEEK - el.clientWidth;
    if (to !== null) el.scrollTo({ left: Math.min(max, Math.max(0, to)) });
    measure();
  }, [active, items.length, measure]);

  const page = (dir) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.66, behavior: "smooth" });
  };
  const fade = !edges.end && !edges.start ? "tabrow--both" : !edges.end ? "tabrow--end" : !edges.start ? "tabrow--start" : "";
  const tabs = kind === "tabs";

  return (
    <div className={cn("tabrow relative rounded-pill p-1", trackClassName, className)}
      /* (3 × the longest label + a little) — the divisor in .tabrow__tab's font-size. */
      style={{ "--tabrow-div": (3 * fit + 0.3).toFixed(2) }}
      data-testid={testid ? `${testid}-row` : undefined}>
      <div ref={rowRef} onScroll={measure}
        /* -m-1 p-1: the row reaches out over the pill's own padding, so the
           open tab's raised shadow has room inside it and is not clipped. */
        className={cn("tabrow__track relative -m-1 flex items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", fade)}
        role={tabs ? "tablist" : "group"} aria-label={label} data-testid={testid}>
        {items.map((it) => {
          const open = it.key === active;
          return (
            <button key={it.key} type="button" onClick={() => onPick(it.key)}
              data-testid={tabTestId?.(it.key)} data-open={open ? "1" : undefined}
              {...(tabs ? { role: "tab", "aria-selected": open } : { "aria-pressed": open })}
              className={cn("tabrow__tab flex shrink-0 items-center justify-center whitespace-nowrap rounded-pill", tabClassName(open))}>
              {it.label}
            </button>
          );
        })}
      </div>
      {!edges.start && (
        <button type="button" onClick={() => page(-1)} aria-label="Show earlier ones"
          data-testid={testid ? `${testid}-prev` : undefined}
          /* A 44px slot that is exactly the peek strip (the phone's touch
             floor); the round arrow inside it is smaller, so it never meets
             the open tab beside it. */
          className="absolute left-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center">
          <span className="ng-pop grid h-7 w-7 place-items-center rounded-full text-foreground/70">
            <CaretLeft size={14} weight="bold" aria-hidden="true" />
          </span>
        </button>
      )}
      {!edges.end && (
        <button type="button" onClick={() => page(1)} aria-label="Show more"
          data-testid={testid ? `${testid}-next` : undefined}
          className="absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center">
          <span className="ng-pop grid h-7 w-7 place-items-center rounded-full text-foreground/70">
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  );
}

export default ScrollTabRow;
