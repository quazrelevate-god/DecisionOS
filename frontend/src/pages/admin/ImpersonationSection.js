// Support impersonation management (Epic 10 Sprint 2).
// Lists impersonation sessions (live / expired / revoked) and lets a super-admin
// end a live session immediately. Starting a session happens from Tenant 360.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, Circle, Prohibit, ArrowClockwise } from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-5";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors";
const COLORS = { live: "#3fb950", expired: "#6b6b75", revoked: "#e5484d" };

export function ImpersonationSection() {
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/admin/impersonation");
      setRows(r.data.sessions);
      setActive(r.data.active);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    try {
      await api.post(`/admin/impersonation/${id}/revoke`);
      toast.success("Impersonation session ended");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-white/40 font-mono text-sm py-10 justify-center">
        <Spinner size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

  return (
    <div data-testid="admin-impersonation">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Impersonation</h2>
        <button onClick={load} className={BTN + " border-white/15 text-white/60 hover:text-white flex items-center gap-1.5"}>
          <ArrowClockwise size={13} /> Refresh
        </button>
      </div>
      <p className="font-mono text-[11px] text-white/40 mb-4">
        {active} live session(s). Start a session from <span className="text-white/70">Tenant 360</span>. Read-only
        sessions can view a workspace but every write is blocked; all grants + revokes are in the Audit Log.
      </p>
      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.id} className={CARD + " flex items-center justify-between"}>
            <div>
              <div className="text-white text-sm flex items-center gap-2">
                <Circle size={8} weight="fill" style={{ color: COLORS[s.status] || "#6b6b75" }} />
                {s.target_name} <span className="text-white/30 text-xs">· {s.target_role}</span>
                <span className="text-white/40 text-xs">@ {s.tenant_name}</span>
                {s.read_only && <span className="font-mono text-[9px] uppercase text-[#d29922] border border-[#d29922]/40 px-1.5 py-0.5">read-only</span>}
              </div>
              <div className="font-mono text-[10px] text-white/40 mt-1">
                by {s.admin_email} · {ts(s.granted_at)} → {ts(s.expires_at)} · {s.status}
                {s.reason ? ` · ${s.reason}` : ""}
              </div>
            </div>
            {s.status === "live" && (
              <button
                onClick={() => revoke(s.id)}
                data-testid={`revoke-${s.id}`}
                className={BTN + " border-[#e5484d]/50 text-[#e5484d] hover:bg-[#e5484d]/10 flex items-center gap-1.5"}
              >
                <Prohibit size={13} /> End
              </button>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="font-mono text-xs text-white/30 py-6 text-center">No impersonation sessions yet.</div>}
      </div>
    </div>
  );
}
