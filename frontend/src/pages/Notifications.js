import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { SwipeRow, GestureHint } from "../components/gestures";
import { timeAgo, fullTime } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { cn } from "../lib/utils";
import { BellRinging, Check, UserCircle, CaretRight } from "@phosphor-icons/react";

export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then((r) => r.data),
    refetchInterval: 20000,
  });

  const markRead = async (id) => {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markAll = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const open = async (n) => {
    if (!n.read) {
      try {
        await markRead(n.id);
      } catch (e) {
        console.debug("notif mark-read failed (non-blocking)", e);
      }
    }
    const to = notifLink(n);
    if (to) navigate(to);
  };

  const items = data?.notifications || [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Work updates, approvals & reminders"
        title="Notifications"
        actions={
          (data?.unread || 0) > 0 && (
            <button
              onClick={markAll}
              data-testid="mark-all-read"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-xs transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-accent active:scale-[0.98]"
            >
              <Check size={16} weight="bold" /> Mark all read
            </button>
          )
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={BellRinging}
          title="You're all caught up"
          hint="Work assignments, approvals and updates will appear here."
        />
      ) : (
        <>
          <GestureHint className="mb-3">Swipe right to open · swipe left to mark read</GestureHint>
          <div className="space-y-2.5" data-testid="notifications-list">
            {items.map((n) => {
              const meta = notifMeta(n);
              const clickable = !!notifLink(n);
              return (
                <SwipeRow
                  key={n.id}
                  testid={`notification-${n.id}`}
                  onRight={clickable ? () => open(n) : undefined}
                  onLeft={!n.read ? () => markRead(n.id) : undefined}
                  rightLabel="Open"
                  leftLabel="Mark read"
                  leftIcon={Check}
                  leftTone="success"
                >
                  <div
                    onClick={() => clickable && open(n)}
                    className={cn(
                      "flex items-start justify-between gap-4 p-4 transition-colors duration-200",
                      n.read && "opacity-60",
                      clickable && "cursor-pointer hover:bg-accent"
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          n.read ? "bg-transparent" : "bg-primary"
                        )}
                        data-testid={n.read ? undefined : `notif-unread-dot-${n.id}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip value={meta.label} tone={meta.tone} />
                          <span
                            className="label-mono text-muted-foreground"
                            title={fullTime(n.created_at)}
                          >
                            {timeAgo(n.created_at)}
                          </span>
                        </div>
                        <p className="mt-1.5 truncate text-sm font-medium">
                          {n.work_title || n.message}
                        </p>
                        {n.work_title && n.message && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.message}</p>
                        )}
                        {n.sender_name && (
                          <p className="label-mono mt-1 flex items-center gap-1 text-muted-foreground">
                            <UserCircle size={13} weight="bold" /> {n.sender_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!n.read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                          data-testid={`read-${n.id}`}
                          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
                        >
                          Read
                        </button>
                      )}
                      {clickable && (
                        <CaretRight size={15} weight="bold" className="text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
