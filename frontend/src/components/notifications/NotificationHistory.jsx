/* Epic 12 (2026-10-22, client FEATURE-08) — Notification history.
 *
 * Everything already read, newest first, paged back to the very first one.
 * The client asked for it under Profile Settings; it is also one tap from the
 * Notifications page and the bell, because that is where someone looks for a
 * message they saw yesterday. One component, two places.
 *
 * In Settings (`embedded`) it opens on the latest five, so the sections below
 * it stay in reach, and Show more opens the rest in place.
 *
 * A row opens what it is about, and "Move back to New" returns it to the
 * unread list — reading something by mistake loses nothing. The footer says
 * how long the company keeps notifications (its retention window, when on).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowCounterClockwise, ClockCounterClockwise } from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { notifLink } from "../../lib/notif";
import { LoadFailed } from "../common";
import { useNotificationFeed, feedItems } from "../../hooks/useNotificationFeed";
import { NotificationRow } from "./NotificationRow";
import { DRAWER_CARD, GLASS_PILL } from "../neuglass/glass";

export function NotificationHistory({ embedded = false }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isError, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationFeed("read");
  const all = feedItems(data);
  const [expanded, setExpanded] = useState(!embedded);
  const items = expanded ? all : all.slice(0, 5);
  const keptDays = data?.pages?.[0]?.kept_days;

  const moveBack = async (id) => {
    try {
      await api.post(`/notifications/${id}/unread`);
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Moved back to New");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Couldn't move it back — try again."); }
  };
  const open = (n) => {
    const to = notifLink(n);
    if (to) navigate(to);
  };

  return (
    <div data-testid={embedded ? "notification-history-settings" : "notification-history"}>
      {embedded && (
        <p className="mb-3 text-sm text-muted-foreground">
          Every notification you've read, newest first. Nothing is lost when you read it.
        </p>
      )}
      {isLoading && !data ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-16 rounded-tile" />)}
        </div>
      ) : isError && !data ? (
        <LoadFailed what="your notification history" onRetry={() => refetch()} testid="notification-history-failed" />
      ) : items.length === 0 ? (
        <div className={`p-6 text-sm text-neutral-600 ${DRAWER_CARD}`} data-testid="notification-history-empty">
          Nothing read yet. Notifications you read land here, so you can come back to them.
        </div>
      ) : (
        <div className="card-brutal divide-y divide-slate-900/[0.06] overflow-hidden" data-testid="notification-history-list">
          {items.map((n) => (
            <NotificationRow key={n.id} n={n} onOpen={open} action={(
              <button type="button" onClick={(e) => { e.stopPropagation(); moveBack(n.id); }}
                data-testid={`unread-${n.id}`} aria-label={`Move "${n.work_title || "this notification"}" back to New`}
                className={`flex h-9 items-center gap-1 rounded-pill px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
                <ArrowCounterClockwise size={12} weight="bold" aria-hidden="true" /> Move back to New
              </button>
            )} />
          ))}
        </div>
      )}

      {!expanded && (all.length > items.length || hasNextPage) && (
        <button type="button" onClick={() => setExpanded(true)} data-testid="notification-history-more"
          className={`mt-3 flex h-11 w-full items-center justify-center rounded-pill text-sm font-semibold text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
          Show more
        </button>
      )}

      {expanded && hasNextPage && (
        <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
          data-testid="notification-history-older"
          className={`mt-3 flex h-11 w-full items-center justify-center rounded-pill text-sm font-semibold text-slate-800 transition-colors hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
          {isFetchingNextPage ? "Loading…" : "Show older"}
        </button>
      )}

      {data && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="notification-history-kept">
          <span className="flex items-center gap-1.5">
            <ClockCounterClockwise size={13} weight="bold" aria-hidden="true" />
            {keptDays ? `Your company keeps notifications for ${keptDays} days.` : "Kept with no time limit."}
          </span>
          {embedded && (
            <Link to="/notifications?tab=history" className="font-semibold text-foreground underline-offset-2 hover:underline">
              Open in Notifications
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
