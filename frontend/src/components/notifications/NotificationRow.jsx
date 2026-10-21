/* Epic 12 (2026-10-22) — one notification, as a row. The New list, the History
 * list and Settings' Notification history all draw it, so a notification looks
 * the same wherever it is found. Lifted out of pages/Notifications.js, where it
 * was written inline; the reasons recorded there still hold (B21: the button
 * says what pressing it does, not a status).
 */
import { BellRinging, UserCircle, CaretRight, Check } from "@phosphor-icons/react";
import { Chip } from "../common";
import { timeAgo, fullTime } from "../../lib/format";
import { notifMeta, notifLink } from "../../lib/notif";

export function NotificationRow({ n, onOpen, action }) {
  const meta = notifMeta(n);
  const clickable = !!notifLink(n);
  return (
    <div
      data-testid={`notification-${n.id}`}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(n); } }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`flex items-start justify-between gap-3 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/25 ${clickable ? "cursor-pointer hover:bg-white/60" : ""}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-slate-900" data-testid={`notif-unread-dot-${n.id}`} />}
        <BellRinging size={18} weight="bold" aria-hidden="true"
          className={`mt-0.5 shrink-0 ${n.read ? "text-slate-400" : n.level === "owner" ? "text-orange-500" : "text-slate-500"}`} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip value={meta.label} className={meta.cls} />
            <span className="flex items-center gap-1 text-xs text-slate-500" title={fullTime(n.created_at)}>{timeAgo(n.created_at)}</span>
          </div>
          <p className={`mt-1.5 line-clamp-2 text-sm font-semibold ${n.read ? "text-slate-700" : "text-slate-900"}`}>{n.work_title || n.message}</p>
          {n.work_title && n.message && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            {n.sender_name && (
              <span className="flex items-center gap-1"><UserCircle size={13} weight="bold" aria-hidden="true" /> {n.sender_name}</span>
            )}
            {n.read && n.read_at && (
              <span className="flex items-center gap-1" title={fullTime(n.read_at)} data-testid={`notif-read-at-${n.id}`}>
                <Check size={12} weight="bold" aria-hidden="true" /> Read {timeAgo(n.read_at)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {clickable && <CaretRight size={16} weight="bold" aria-hidden="true" className="text-slate-400" />}
      </div>
    </div>
  );
}
