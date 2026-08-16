// MPWA-04 · StaleStamp — "Showing data from 9:12 am" (§7, §8 MPWA-05).
//
// §8 MPWA-05: "A founder acting on silently stale numbers is worse than one
// seeing a spinner." Any screen served from the service-worker cache says so,
// with the time, and offers a retry.
import * as React from "react";
import { CloudSlash, ArrowClockwise } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const timeOf = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
};

/**
 * @param {string|Date} at        when the cached payload was stored
 * @param {Function}   [onRetry]
 * @param {boolean}    [offline]  true when the device itself is offline
 */
export function StaleStamp({
  at,
  onRetry,
  offline = false,
  className,
  "data-testid": testId = "stale-stamp",
}) {
  const t = timeOf(at);
  if (!t) return null;
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        // DS-5: the badge tokens, not ramp steps. `bg-caution-50` had no dark
        // sibling, so this strip stayed cream on a near-black screen.
        "flex items-center gap-2 rounded-lg border border-badge-pending-line bg-badge-pending px-3 py-2",
        "text-sm text-badge-pending-fg",
        className
      )}
    >
      <CloudSlash size={20} weight="bold" aria-hidden="true" className="shrink-0" />
      <p className="min-w-0 flex-1 leading-snug">
        {offline ? "You're offline. " : ""}
        Showing data from {t}.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid={`${testId}-retry`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-caution-300 bg-white/60 px-2.5 text-sm font-semibold text-caution-900 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          <ArrowClockwise size={16} weight="bold" />
          Refresh
        </button>
      )}
    </div>
  );
}

export default StaleStamp;
