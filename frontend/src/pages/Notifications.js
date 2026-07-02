import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { BellRinging, Check } from "@phosphor-icons/react";

export default function Notifications() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data), refetchInterval: 20000 });

  const markRead = async (id) => {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markAll = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const items = data?.notifications || [];

  return (
    <div>
      <PageHeader eyebrow="Reminders & escalations" title="Notifications">
        {(data?.unread || 0) > 0 && (
          <button onClick={markAll} data-testid="mark-all-read" className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
            <Check size={16} weight="bold" /> Mark all read
          </button>
        )}
      </PageHeader>

      {items.length === 0 && <EmptyState title="You're all caught up" hint="Reminders and escalations will appear here." />}

      <div className="card-brutal divide-y divide-black/10" data-testid="notifications-list">
        {items.map((n) => (
          <div key={n.id} data-testid={`notification-${n.id}`} className={`p-4 flex items-start justify-between gap-4 ${n.read ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-3">
              <BellRinging size={18} weight="bold" className={n.level === "owner" ? "text-brand-red mt-0.5" : "text-brand-blue mt-0.5"} />
              <div>
                <p className="text-sm">{n.message}</p>
                <Chip value={n.level} className="mt-2" />
              </div>
            </div>
            {!n.read && (
              <button onClick={() => markRead(n.id)} data-testid={`read-${n.id}`} className="text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">
                Read
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
