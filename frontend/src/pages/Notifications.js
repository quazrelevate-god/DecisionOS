import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { timeAgo, fullTime } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { BellRinging, Check, UserCircle, CaretRight } from "@phosphor-icons/react";

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

  return (
    <div>
      <PageHeader eyebrow="Work updates, approvals & reminders" title="Notifications">
        {(data?.unread || 0) > 0 && (
          <button onClick={markAll} data-testid="mark-all-read" className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
            <Check size={16} weight="bold" /> Mark all read
          </button>
        )}
      </PageHeader>

      {items.length === 0 && <EmptyState title="You're all caught up" hint="Work assignments, approvals and updates will appear here." />}

      <div className="card-brutal divide-y divide-black/10" data-testid="notifications-list">
        {items.map((n) => {
          const meta = notifMeta(n);
          const clickable = !!notifLink(n);
          return (
            <div
              key={n.id}
              data-testid={`notification-${n.id}`}
              onClick={() => open(n)}
              className={`p-4 flex items-start justify-between gap-4 transition-colors ${n.read ? "opacity-60" : ""} ${clickable ? "cursor-pointer hover:bg-black/[0.03]" : ""}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-red shrink-0" data-testid={`notif-unread-dot-${n.id}`} />}
                <BellRinging size={18} weight="bold" className={`shrink-0 mt-0.5 ${n.level === "owner" ? "text-brand-red" : "text-brand-blue"}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip value={meta.label} className={meta.cls} />
                    <span className="label-mono text-muted-foreground flex items-center gap-1" title={fullTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                  </div>
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
                  <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} data-testid={`read-${n.id}`} className="text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">
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
