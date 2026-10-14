// MPWA-04 · StaleStamp — "Showing data from 9:12 am" (§7, §8 MPWA-05).
//
// §8 MPWA-05: "A founder acting on silently stale numbers is worse than one
// seeing a spinner." Any screen served from the service-worker cache says so,
// with the time, and offers a retry.
import * as React from "react";
import { CloudSlash, ArrowClockwise } from "@phosphor-icons/react";
import { TopNotice, NoticePill } from "@/components/TopNotice";

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
/* B10 (2026-09-29) — the same strip also says "we could not load this at
   all". A tile whose fetch failed used to sit on "…" for as long as the app
   was open, or — worse, on the Workflows tile — settle to a confident 0 once
   loading ended, which reads as "nothing needs you" when the truth is
   "nobody asked". `failed` swaps the sentence; the retry is the one this
   strip already had. */
/* 2026-10-12 (founder) — AN OVERLAY, NOT A CARD. This strip sat at the top of
   the Desk's own column, so the moment a fetch failed or the device went
   offline the whole Desk slid down by its height. It is a pill in the
   top-notice stack now (components/TopNotice), floating under the status bar,
   with Refresh and a close. Closed, it stays closed until what it says changes. */
export function StaleStamp({
  at,
  onRetry,
  offline = false,
  failed = false,
  "data-testid": testId = "stale-stamp",
}) {
  const t = timeOf(at);
  const message = failed && !t
    ? "Some numbers couldn't be loaded."
    : `Showing data from ${t}.`;
  const [closed, setClosed] = React.useState(null);
  if (!t && !failed) return null;
  // Offline is said once, by ConnectionNotice's own pill right above this one.
  const key = `${message}|${offline}`;
  if (closed === key) return null;
  return (
    <TopNotice order={1}>
      <NoticePill
        icon={CloudSlash}
        testid={testId}
        onClose={() => setClosed(key)}
        action={onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid={`${testId}-retry`}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-pill bg-white/15 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
            Refresh
          </button>
        )}
      >
        {message}
      </NoticePill>
    </TopNotice>
  );
}

export default StaleStamp;
