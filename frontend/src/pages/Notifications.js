import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { timeAgo, fullTime } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { BellRinging, Check, UserCircle, CaretRight } from "@phosphor-icons/react";
import { useIsMobile } from "../hooks/useIsMobile";
import { GLASS_PILL } from "../components/karma/glass";

// Mobile PWA (2026-09-14) — on the glass, and one real fix: the "Show N older"
// button was written INSIDE the row loop, so on a phone every notification
// carried its own "Show 6 older" and the list never read as a list. It sits
// once, under the list, now. The list card also no longer renders empty above
// the "all caught up" state.
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
          <button type="button" onClick={markAll} data-testid="mark-all-read"
            className={`flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
            <Check size={16} weight="bold" aria-hidden="true" /> Mark all read
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

      {items.length > 0 && (
        <div className="card-brutal divide-y divide-slate-900/[0.06] overflow-hidden" data-testid="notifications-list">
          {shown.map((n) => {
            const meta = notifMeta(n);
            const clickable = !!notifLink(n);
            return (
              <div
                key={n.id}
                data-testid={`notification-${n.id}`}
                onClick={() => open(n)}
                onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(n); } }}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                className={`flex items-start justify-between gap-3 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/25 ${n.read ? "opacity-60" : ""} ${clickable ? "cursor-pointer hover:bg-white/60" : ""}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-slate-900" data-testid={`notif-unread-dot-${n.id}`} />}
                  <BellRinging size={18} weight="bold" aria-hidden="true"
                    className={`mt-0.5 shrink-0 ${n.level === "owner" ? "text-orange-500" : "text-slate-500"}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip value={meta.label} className={meta.cls} />
                      <span className="flex items-center gap-1 text-xs text-slate-500" title={fullTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-900">{n.work_title || n.message}</p>
                    {n.work_title && n.message && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>}
                    {n.sender_name && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <UserCircle size={13} weight="bold" aria-hidden="true" /> {n.sender_name}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!n.read && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); markRead(n.id); }} data-testid={`read-${n.id}`}
                      className={`h-9 rounded-pill px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
                      Read
                    </button>
                  )}
                  {clickable && <CaretRight size={16} weight="bold" aria-hidden="true" className="text-slate-400" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          data-testid="notifications-show-all"
          className={`mt-3 flex h-11 w-full items-center justify-center rounded-pill text-sm font-semibold text-slate-800 transition-colors hover:bg-white lg:hidden ${GLASS_PILL}`}
        >
          Show {hidden} older
        </button>
      )}
    </div>
  );
}
