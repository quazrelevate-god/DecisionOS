import { ADMIN_BTN, ADMIN_H2, CARD_BASE } from "./adminStyle";
// Support impersonation management (Epic 10 Sprint 2).
// Lists impersonation sessions (live / expired / revoked) and lets a super-admin
// end a live session immediately. Starting a session happens from Tenant 360.
import { roleLabel } from "../../lib/departments";
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, Circle, Prohibit, ArrowClockwise } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-5`;
const H2 = ADMIN_H2;
const BTN = ADMIN_BTN;
const COLORS = { live: "#116329", expired: "#57606a", revoked: "#cf222e" };

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
      <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center">
        <Spinner size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

  return (
    <div data-testid="admin-impersonation">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Impersonation</h2>
        <button onClick={load} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}>
          <ArrowClockwise size={13} /> Refresh
        </button>
      </div>
      <p className="font-mono text-[11px] text-slate-600 mb-4">
        {active} live session(s). Start a session from <span className="text-slate-600">Tenant 360</span>. Read-only
        sessions can view a workspace but every write is blocked; all grants + revokes are in the Audit Log.
      </p>
      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.id} className={CARD + " flex items-center justify-between"}>
            <div>
              <div className="text-slate-900 text-sm flex items-center gap-2">
                <Circle size={8} weight="fill" style={{ color: COLORS[s.status] || "#57606a" }} />
                {s.target_name} <span className="text-slate-600 text-xs">· {roleLabel(s.target_role)}</span>
                <span className="text-slate-600 text-xs">@ {s.tenant_name}</span>
                {s.read_only && <span className="font-mono text-[9px] uppercase text-[#7d4e00] border border-[#7d4e00]/40 px-1.5 py-0.5 rounded-xl">read-only</span>}
              </div>
              <div className="font-mono text-[10px] text-slate-600 mt-1">
                by {s.admin_email} · {ts(s.granted_at)} → {ts(s.expires_at)} · {s.status}
                {s.reason ? ` · ${s.reason}` : ""}
              </div>
            </div>
            {s.status === "live" && (
              <button
                onClick={() => revoke(s.id)}
                data-testid={`revoke-${s.id}`}
                className={BTN + " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10 flex items-center gap-1.5"}
              >
                <Prohibit size={13} /> End
              </button>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="font-mono text-xs text-slate-600 py-6 text-center">No impersonation sessions yet.</div>}
      </div>
    </div>
  );
}
