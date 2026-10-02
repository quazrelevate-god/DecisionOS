import { ADMIN_BTN, ADMIN_H2, ADMIN_SEL, CARD_BASE } from "./adminStyle";
// Support desk & tickets (Epic 10 Sprint 3).
// Ticket inbox tied to tenants: filter, thread/reply, change status/priority, and
// jump to a read-only impersonation session for the ticket's workspace.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, PaperPlaneRight, UserSwitch, CaretLeft } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-4`;
const H2 = ADMIN_H2;
const BTN = ADMIN_BTN;
const SEL = ADMIN_SEL;
const STATUSES = ["open", "pending", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const PRIO_COLOR = { urgent: "#cf222e", high: "#7d4e00", normal: "#57606a", low: "#8c959f" };

export function SupportDeskSection() {
  const [filter, setFilter] = useState("");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/tickets${filter ? `?status=${filter}` : ""}`);
      setData(r.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    try { const r = await api.get(`/admin/tickets/${id}`); setSel(r.data); setReply(""); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/tickets/${sel.id}/reply`, { body: reply });
      setReply(""); await open(sel.id); load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };

  const patch = async (body) => {
    try { await api.patch(`/admin/tickets/${sel.id}`, body); await open(sel.id); load(); toast.success("Updated"); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const impersonate = async () => {
    const reason = window.prompt("Reason (audited):", `Ticket ${sel.id}`);
    if (reason === null) return;
    try {
      await api.post(`/admin/tenants/${sel.tenant_id}/impersonate`, { reason, read_only: true, minutes: 30 });
      toast.success("Read-only session started — see the Impersonation tab");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");
  if (!data) return <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;

  if (sel) {
    return (
      <div data-testid="admin-ticket-detail">
        <button onClick={() => setSel(null)} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5 mb-4"}>
          <CaretLeft size={13} /> Back to inbox
        </button>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-display text-xl text-slate-900">{sel.subject}</div>
            <div className="font-mono text-[11px] text-slate-600 mt-1">
              {sel.tenant_name} · opened {ts(sel.created_at)} by {sel.created_by_name || sel.created_by}
            </div>
          </div>
          <button onClick={impersonate} className={BTN + " border-[#7d4e00]/50 text-[#7d4e00] hover:bg-[#7d4e00]/10 flex items-center gap-1.5"}>
            <UserSwitch size={14} /> View as tenant
          </button>
        </div>
        <div className="flex gap-2 mb-5">
          <select value={sel.status} onChange={(e) => patch({ status: e.target.value })} className={SEL}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sel.priority} onChange={(e) => patch({ priority: e.target.value })} className={SEL}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="space-y-2 mb-4">
          {(sel.messages || []).map((m, i) => (
            <div key={i} className={CARD + (m.author_type === "admin" ? " border-l-2 border-l-[#cf222e]" : " border-l-2 border-l-white/20")}>
              <div className="font-mono text-[10px] text-slate-600 mb-1">{m.author} · {m.author_type} · {ts(m.created_at)}</div>
              <div className="text-slate-600 text-sm whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
          {(sel.messages || []).length === 0 && <div className="font-mono text-xs text-slate-600">No messages yet.</div>}
        </div>
        <div className="flex gap-2">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Reply…"
            className="flex-1 bg-white border border-slate-900/10 px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#cf222e] rounded-xl" />
          <button onClick={sendReply} disabled={busy} className={BTN + " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10 flex items-center gap-1.5"}>
            {busy ? <Spinner size={13} className="animate-spin" /> : <PaperPlaneRight size={14} />} Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="admin-support">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Support Desk</h2>
        <div className="flex gap-2 items-center">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={SEL}>
            <option value="">all</option>
            {/* One string, not text + expressions: an <option> may hold only
                text, and split children were rendered as invalid markup. */}
            {STATUSES.map((s) => <option key={s} value={s}>{`${s} (${data.counts?.[s] ?? 0})`}</option>)}
          </select>
          <button onClick={load} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}>
            <ArrowClockwise size={13} /> Refresh
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {data.tickets.map((t) => (
          <button key={t.id} onClick={() => open(t.id)} className={CARD + " w-full text-left flex items-center justify-between hover:border-[#cf222e]/50 transition-colors"}>
            <div>
              <div className="text-slate-900 text-sm">{t.subject}</div>
              <div className="font-mono text-[10px] text-slate-600 mt-0.5">{t.tenant_name} · {ts(t.updated_at)} · {t.status}</div>
            </div>
            <span className="font-mono text-[9px] uppercase px-2 py-1 border" style={{ color: PRIO_COLOR[t.priority], borderColor: `${PRIO_COLOR[t.priority]}55` }}>{t.priority}</span>
          </button>
        ))}
        {data.tickets.length === 0 && <div className="font-mono text-xs text-slate-600 py-6 text-center">No tickets.</div>}
      </div>
    </div>
  );
}
