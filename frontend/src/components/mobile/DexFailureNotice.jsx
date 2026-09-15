// ASK-33 Phase 5 · DexFailureNotice — a failed Dex capture, on screen until it
// is dismissed. Why it is not a toast: lib/dexFailureNotices.
import * as React from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { OUTCOME_COPY } from "@/lib/dexOutcome";
import { getFailureNotices, removeFailureNotice, subscribeFailureNotices } from "@/lib/dexFailureNotices";

export function useFailureNotices() {
  return React.useSyncExternalStore(subscribeFailureNotices, getFailureNotices);
}

/**
 * @param {"dock"|"inline"} placement
 *   dock    fixed just above the phone's dock, inside the shell's gutters. Its
 *           height (plus a 12px gap) is published as --dex-notice-space, which
 *           .pb-dock adds to the page's bottom clearance — the way the dock
 *           already pays for what scrolls under it — so nothing beneath it is
 *           out of reach, and it never sits over the header, the dock or the FAB.
 *           Below the app's dialogs and sheets (z-50), so it never covers one.
 *   inline  in the Dex sheet's own flow (DexChat), between the transcript and
 *           the plus, where it covers nothing.
 */
export function DexFailureNotice({ placement = "dock", className }) {
  const notices = useFailureNotices();
  const notice = notices.length ? notices[notices.length - 1] : null;
  const more = notices.length - 1;
  const [waiting, setWaiting] = React.useState(false);
  const boxRef = React.useRef(null);

  React.useEffect(() => { setWaiting(false); }, [notice?.id]);

  React.useLayoutEffect(() => {
    if (placement !== "dock") return undefined;
    const el = boxRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--dex-notice-space", `${Math.ceil(el.offsetHeight) + 12}px`);
    publish();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--dex-notice-space");
    };
  }, [placement, notice?.id]);

  if (!notice) return null;

  const retry = () => {
    // One capture at a time (useDexConversation): while Dex is still reading
    // another, keep the notice and say why, rather than orphan that one.
    if (notice.canRetry && !notice.canRetry()) { setWaiting(true); return; }
    removeFailureNotice(notice.id);
    notice.onRetry?.(notice);
  };

  return (
    <div
      ref={boxRef}
      role="alert"
      data-testid="dex-failure-notice"
      data-placement={placement}
      className={cn(
        /* Literal white and ink rather than theme tokens: the Dex sheet opens
           over /brain, which renders in the dark Dex room. */
        "rounded-3xl bg-[#fff] p-4 text-kr-ink ring-1 ring-slate-900/[0.06] shadow-[0_12px_32px_-12px_hsl(230_30%_18%/.45)]",
        placement === "dock" && "lg:hidden fixed app-dock-left app-fab-right z-40 bottom-[calc(6.25rem+env(safe-area-inset-bottom,0px))]",
        className
      )}
    >
      {/* The reason is the whole point: it wraps, never truncates. A long raw
          one scrolls inside six lines, so the notice itself stays compact. */}
      <p className="flex max-h-[7.5rem] items-start gap-2 overflow-y-auto text-sm font-semibold leading-snug">
        <WarningCircle size={18} weight="fill" aria-hidden="true" className="mt-px shrink-0 text-rose-600" />
        <span data-testid="dex-failure-reason" className="min-w-0 break-words">{notice.message}</span>
      </p>
      {waiting && <p className="mt-1.5 text-[13px] leading-snug text-kr-ink/70">{OUTCOME_COPY.retryWait}</p>}
      {more > 0 && (
        <p className="mt-1 text-[13px] leading-snug text-kr-ink/60">
          {more === 1 ? "1 more failed capture after this one" : `${more} more failed captures after this one`}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {notice.retry && notice.onRetry && (
          /* Retry commits: the 56px tier (MPWA-01 §5.1). */
          <button
            type="button"
            data-testid="dex-failure-retry"
            onClick={retry}
            className="flex h-14 min-h-touch-lg items-center rounded-pill bg-kr-ink px-6 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          data-testid="dex-failure-dismiss"
          onClick={() => removeFailureNotice(notice.id)}
          className="flex h-11 min-h-touch items-center rounded-pill bg-slate-900/[0.06] px-4 text-sm font-medium text-kr-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default DexFailureNotice;
