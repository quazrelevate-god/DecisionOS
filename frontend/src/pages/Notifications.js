import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { toast } from "sonner";
import { PageHeader, EmptyState, LoadFailed } from "../components/common";
import { notifLink } from "../lib/notif";
import { Check, BellRinging, ClockCounterClockwise } from "@phosphor-icons/react";
import { DRAWER_TRACK, GLASS_PILL } from "../components/neuglass/glass";
import { useNotificationFeed, feedItems } from "../hooks/useNotificationFeed";
import { NotificationRow } from "../components/notifications/NotificationRow";
import { NotificationHistory } from "../components/notifications/NotificationHistory";

/* Epic 12 (2026-10-22, client FEATURE-08) — NEW and HISTORY.
   This page listed the newest 100 notifications, read ones dimmed among the
   unread, and nothing older could be reached at all: eleven of 62 people on the
   dev database were already past 100. Now New holds what has not been read,
   History holds everything that has, and both page back to the first. Marking
   something read moves it to History, with an Undo. The tab lives in the
   address (?tab=history) so Settings and the bell can open History directly.

   Mobile PWA (2026-09-14) — on the glass. The old "Show N older" button sliced
   a list already in memory; "Show older" now asks the server for the next page. */
export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "new";
  const setTab = (t) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (t === "history") next.set("tab", "history"); else next.delete("tab");
    return next;
  }, { replace: true });

  const { data, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationFeed("unread", { refetchInterval: 20000 });
  const unread = data?.pages?.[0]?.unread || 0;

  /* markRead THROWS on purpose: `open` below swallows it deliberately, because
     failing to mark something read must not stop the person getting to the
     thing it is about. The BUTTONS are the other case -- there, marking read
     is the entire intent -- so they use the wrappers underneath, which say so
     when it does not happen.
     2026-10-02: both buttons used to call these bare. A failure changed
     nothing on screen and said nothing, leaving a dot that would not clear and
     an unhandled rejection in the console. A control that cannot report its
     own failure is the same fault as the Ops capture box. */
  const markRead = async (id) => {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markAll = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const moveBack = async (id) => {
    try {
      await api.post(`/notifications/${id}/unread`);
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Couldn't move it back — try again."); }
  };

  // Epic 12 — read moves it to History; the toast offers the way back.
  const markReadSaid = async (id) => {
    try {
      await markRead(id);
      toast.success("Moved to History", { action: { label: "Undo", onClick: () => moveBack(id) } });
    }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Couldn't mark that read — try again."); }
  };
  const markAllSaid = async () => {
    try {
      await markAll();
      toast.success("All moved to History");
    }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Couldn't mark them all read — try again."); }
  };

  const open = async (n) => {
    if (!n.read) { try { await markRead(n.id); } catch (e) { console.debug("notif mark-read failed (non-blocking)", e); } }
    const to = notifLink(n);
    if (to) navigate(to);
  };

  const items = feedItems(data);

  const tabs = [
    { key: "new", label: "New", icon: BellRinging, n: unread },
    { key: "history", label: "History", icon: ClockCounterClockwise, n: null },
  ];

  return (
    <div>
      <PageHeader eyebrow="Work updates, approvals & reminders" title="Notifications">
        {tab === "new" && unread > 0 && (
          <button type="button" onClick={markAllSaid} data-testid="mark-all-read"
            className={`flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
            <Check size={16} weight="bold" aria-hidden="true" /> Mark all read
          </button>
        )}
      </PageHeader>

      <div role="tablist" aria-label="Notifications" data-testid="notifications-tabs"
        className={`mb-5 inline-flex items-center gap-1 rounded-pill p-1 ${DRAWER_TRACK}`}>
        {tabs.map((t) => {
          const on = tab === t.key;
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
              data-testid={`notifications-tab-${t.key}`}
              className={`flex h-9 items-center gap-2 rounded-pill px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${
                on ? `${GLASS_PILL} font-semibold text-neutral-900` : "font-medium text-neutral-600 hover:text-neutral-900"}`}>
              <Icon size={16} weight={on ? "bold" : "regular"} aria-hidden="true" />
              {t.label}
              {t.n > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ng-ink px-1.5 text-[11px] font-semibold tabular-nums leading-none text-white">
                  {t.n > 99 ? "99+" : t.n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "history" ? (
        <NotificationHistory />
      ) : (
        <>
          {/* 2026-10-02 — and before that, whether the list arrived at all.
              "You're all caught up." is a congratulation. Said to somebody whose
              notifications simply failed to load, it is the app telling them there
              is nothing waiting when there may be an approval that is. */}
          {isError && !data && (
            <LoadFailed what="your notifications" onRetry={() => refetch()} testid="notifications-load-failed" />
          )}

          {/* MPWA-12i: completing E2-13's sweep — this list surface never got its CTA.
              Epic 12: "caught up" now also points at History, where read ones went. */}
          {!isError && items.length === 0 && (data ? (
            <EmptyState
              title="You're all caught up."
              hint="New work, approvals and updates appear here. Ones you've read are in History."
              ctaLabel="See history"
              onCta={() => setTab("history")}
            />
          ) : null)}

          {items.length > 0 && (
            <div className="card-brutal divide-y divide-slate-900/[0.06] overflow-hidden" data-testid="notifications-list">
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={open} action={(
                  /* B21 (2026-09-29) — "Read" on a row that is unread reads as a
                     STATUS, not a button. It says what pressing it does. */
                  <button type="button" onClick={(e) => { e.stopPropagation(); markReadSaid(n.id); }} data-testid={`read-${n.id}`}
                    aria-label={`Mark "${n.work_title || "this notification"}" as read`}
                    className={`h-9 rounded-pill px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
                    Mark read
                  </button>
                )} />
              ))}
            </div>
          )}

          {hasNextPage && (
            <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
              data-testid="notifications-show-all"
              className={`mt-3 flex h-11 w-full items-center justify-center rounded-pill text-sm font-semibold text-slate-800 transition-colors hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
              {isFetchingNextPage ? "Loading…" : "Show older"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
