// Tenant-facing announcement banner (Epic 10 Sprint 8).
// Renders active platform announcements targeted at this workspace. Dismissible ones
// are remembered per-viewer in localStorage.
import { useState, useEffect } from "react";
import api from "../lib/api";
import { X, Warning, Info, Wrench } from "@phosphor-icons/react";

const STYLE = {
  info: { bg: "#1e3a5f", border: "#3b82f6", Icon: Info },
  warning: { bg: "#3d3416", border: "#d29922", Icon: Warning },
  maintenance: { bg: "#3d1a1a", border: "#e5484d", Icon: Wrench },
};

function dismissedSet() {
  try { return new Set(JSON.parse(localStorage.getItem("dos_dismissed_announcements") || "[]")); }
  catch { return new Set(); }
}

export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(dismissedSet);

  useEffect(() => {
    let alive = true;
    api.get("/announcements/active")
      .then((r) => { if (alive) setItems(r.data.announcements || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const dismiss = (id) => {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    try { localStorage.setItem("dos_dismissed_announcements", JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const visible = items.filter((a) => !(a.dismissible && dismissed.has(a.id)));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1">
      {visible.map((a) => {
        const s = STYLE[a.kind] || STYLE.info;
        return (
          <div key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-sm"
               style={{ background: s.bg, borderBottom: `2px solid ${s.border}` }}>
            <s.Icon size={18} weight="fill" style={{ color: s.border, marginTop: 1, flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-white">{a.title}</span>
              {a.body && <span className="text-white/80"> — {a.body}</span>}
            </div>
            {a.dismissible && (
              <button onClick={() => dismiss(a.id)} aria-label="Dismiss" className="text-white/50 hover:text-white flex-shrink-0">
                <X size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
