import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder.
 *
 * Written here rather than installed, because the whole component is a tinted
 * box that pulses — the install would have brought a dependency, a second
 * icon library and a set of default colours, to save eight lines.
 *
 * WHY IT EXISTS. The Desk runs four independent queries (voice notes, inbox,
 * decisions, tasks). Each resolves on its own schedule, so the page assembled
 * itself in four visible jumps and the thing you were reaching for moved under
 * the cursor. A skeleton does not make loading faster; it makes the layout
 * stop moving, which is the part that was actually costing anything.
 *
 * Deliberately quiet: surface-sunken, no shimmer sweep, no border. A skeleton
 * that draws the eye is competing with the content it is standing in for, and
 * this one is on screen for a few hundred milliseconds on every visit.
 *
 * Always `rounded-md` from the token scale — never rounded-full, which is
 * Tailwind's own value rather than ours; the pill token is `rounded-pill`.
 *
 * @typedef {object} SkeletonProps
 * @property {string} [className] Sizing lives here — this component has no size of its own.
 *
 * @example
 * <Skeleton className="h-4 w-32" />
 */
export function Skeleton({ className, ...props }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-sunken", className)}
      {...props}
    />
  );
}

/**
 * The Desk's ranked-list placeholder: a heading line, a sentence, three rows.
 *
 * Shaped to the real thing rather than to a generic grey block, so the content
 * lands in the space the skeleton was already holding. A placeholder of the
 * wrong shape still reflows on arrival — it just reflows more politely.
 *
 * @param {{rows?: number, testid?: string}} props
 */
export function SkeletonBrief({ rows = 3, testid = "skeleton-brief" }) {
  return (
    <section className="mb-8" data-testid={testid} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading what matters today</span>
      {/* Heights mirror the real brief exactly, measured rather than guessed:
          h1 32, summary 28, cards 126/82/82 with 12 between, disclosure 32.
          A skeleton of the wrong height does not prevent the reflow, it just
          makes it look deliberate — the first version of this was 96px short
          and the page still jumped when the data landed. */}
      <Skeleton className="h-8 w-28" />
      <Skeleton className="mt-1 h-7 w-[28rem] max-w-full" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="rounded-lg border border-hairline bg-surface p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-6 w-6 rounded-pill" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="mt-2 h-5 w-1/2" />
                {/* The top item is an approval, which carries a Review button. */}
                {i === 0 && <Skeleton className="mt-3 h-8 w-24" />}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-3 h-8 w-36" />
    </section>
  );
}

/**
 * Row placeholder for the feed and the approvals list.
 *
 * @param {{rows?: number, testid?: string}} props
 */
export function SkeletonRows({ rows = 3, testid = "skeleton-rows" }) {
  return (
    <div className="space-y-2" data-testid={testid} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-md border border-hairline bg-surface p-3 flex items-center gap-3">
          <Skeleton className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
