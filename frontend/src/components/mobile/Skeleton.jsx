// MPWA-04 · Skeleton — shape-preserving placeholders (§7, §5.3).
//
// §5.3 is the reason this exists: "Never render a total computed from a
// partially-loaded payload. Render a skeleton instead. One wrong money figure
// costs more trust than ten missing features."
//
// So MoneySkeleton is the important export. Any derived total — profit,
// outstanding, net — renders this until every input it depends on has
// resolved, rather than briefly showing a number that is wrong.
import * as React from "react";
import { cn } from "@/lib/utils";

const base = "animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-700";

// MPWA-12i: every placeholder carries `data-skeleton`, so the audit harness can
// wait for content to actually arrive. Without it, settle() screenshotted
// /my-work at ~2s against the real backend, while the list was still a skeleton,
// and reported a density failure for a screen that composes correctly at 3s.
export function SkeletonLine({ className, w = "w-full" }) {
  return <span data-skeleton="true" className={cn(base, "block h-3.5", w, className)} aria-hidden="true" />;
}

/**
 * Placeholder for a money figure. Reserves the width a real amount would take
 * so the row does not jump when the number lands.
 */
export function MoneySkeleton({ className, "data-testid": testId = "money-skeleton" }) {
  return (
    <span
      data-testid={testId}
      // aria-busy + a label, so a screen reader says "loading" instead of
      // reading an empty cell where an amount belongs.
      role="status"
      aria-busy="true"
      aria-label="Amount still loading"
      data-skeleton="true"
      className={cn(base, "inline-block h-5 w-24 align-middle", className)}
    />
  );
}

/** Matches MobileCard's three-line geometry so lists do not reflow. */
export function CardSkeleton({ className, "data-testid": testId = "card-skeleton" }) {
  return (
    <div
      data-testid={testId}
      aria-busy="true"
      className={cn("nm-raised p-3.5", className)}
    >
      <SkeletonLine w="w-4/5" />
      <SkeletonLine w="w-3/5" className="mt-2.5 h-3" />
      <div className="mt-2.5 flex items-center gap-2">
        <span data-skeleton="true" className={cn(base, "h-7 w-7 rounded-pill")} aria-hidden="true" />
        <SkeletonLine w="w-2/5" className="h-3" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 3, className }) {
  return (
    <div className={cn("space-y-3", className)} data-testid="list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * True when any input a derived total depends on is still missing.
 * Usage: `{anyLoading([summary, payments]) ? <MoneySkeleton/> : inr(profit)}`
 */
export const anyLoading = (inputs = []) =>
  inputs.some((v) => v === undefined || v === null);

export default SkeletonLine;
