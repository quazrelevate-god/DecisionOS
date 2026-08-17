import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { timeAgo, fullTime } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { BellRinging, Check, UserCircle, CaretRight } from "@phosphor-icons/react";
import { useIsMobile } from "../hooks/useIsMobile";

export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data), refetchInterval: 20000 });

  const markRead = async (id) => {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markAll = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const open = async (n) => {
    if (!n.read) { try { await markRead(n.id); } catch (e) { console.debug("notif mark-read failed (non-blocking)", e); } }
    const to = notifLink(n);
    if (to) navigate(to);
  };

  const items = data?.notifications || [];

  // MPWA-12i (§5.2.7): the feed grows without bound and hit 2,515px at 360px
  // wide on a live tenant. Mobile shows a screenful and asks for the rest;
  // desktop still renders everything, so §9.2's diff is untouched.
  const isMobile = useIsMobile();
  const [showAll, setShowAll] = useState(false);
  // 8, not 12: a notification body can run three lines, and twelve of them ran
  // 2,733px at 360px wide.
  const PER_SCREEN = 8;
  const capped = isMobile && !showAll;
  const shown = capped ? items.slice(0, PER_SCREEN) : items;
  const hidden = items.length - shown.length;

  return (
    <div>
      <PageHeader eyebrow="Work updates, approvals & reminders" title="Notifications">
        {(data?.unread || 0) > 0 && (
          <button onClick={markAll} data-testid="mark-all-read" className="flex items-center gap-2 border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
            <Check size={16} weight="bold" /> Mark all read
          </button>
        )}
      </PageHeader>

      {/* MPWA-12i: completing E2-13's sweep — this list surface never got its CTA. */}
      {items.length === 0 && (
        <EmptyState
          title="You're all caught up."
          hint="Work assignments, approvals and updates appear here."
          ctaLabel="+ Open Decision Desk"
          ctaTo="/inbox"
        />
      )}

      <div className="card-brutal divide-y divide-black/10" data-testid="notifications-list">
        {shown.map((n) => {
          const meta = notifMeta(n);
          const clickable = !!notifLink(n);
          return (
            <div
              key={n.id}
              data-testid={`notification-${n.id}`}
              onClick={() => open(n)}
              className={`p-4 flex items-start justify-between gap-4 transition-colors ${n.read ? "opacity-60" : ""} ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-600 shrink-0" data-testid={`notif-unread-dot-${n.id}`} />}
                <BellRinging size={18} weight="bold" className={`shrink-0 mt-0.5 ${n.level === "owner" ? "text-brand-600" : "text-brand-blue"}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip value={meta.label} className={meta.cls} />
                    <span className="label-mono text-muted-foreground flex items-center gap-1" title={fullTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                  </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          data-testid="notifications-show-all"
          className="mt-3 flex w-full items-center justify-center rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-accent lg:hidden"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          Show {hidden} older
        </button>
      )}
                  <p className="text-sm font-semibold mt-1.5 truncate">{n.work_title || n.message}</p>
                  {n.work_title && n.message && <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.message}</p>}
                  {n.sender_name && (
                    <p className="label-mono text-muted-foreground mt-1 flex items-center gap-1">
                      <UserCircle size={13} weight="bold" /> {n.sender_name}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!n.read && (
                  <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} data-testid={`read-${n.id}`} className="text-xs  border border-border px-2 py-1 hover:bg-accent transition-colors">
                    Read
                  </button>
                )}
                {clickable && <CaretRight size={16} weight="bold" className="text-muted-foreground" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
