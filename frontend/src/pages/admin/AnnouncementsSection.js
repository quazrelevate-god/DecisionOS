// Announcements & comms (Epic 10 Sprint 8).
// Create in-app broadcasts / maintenance banners (audience all / plan / tenant),
// activate/deactivate, delete, and email to targeted owners.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, Plus, Trash, PaperPlaneRight } from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-4";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const H3 = "font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors";
const SEL = "bg-[#0a0a0b] border border-white/10 px-2 py-1.5 font-mono text-[11px] text-white outline-none";
const INP = "bg-[#0a0a0b] border border-white/10 px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-white/30 outline-none";
const KIND_COLOR = { info: "#3b82f6", warning: "#d29922", maintenance: "#e5484d" };

export function AnnouncementsSection() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ title: "", body: "", kind: "info", audience: "all", dismissible: true });

  const load = useCallback(async () => {
    try { const r = await api.get("/admin/announcements"); setRows(r.data.announcements); }
    catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    try { await api.post("/admin/announcements", form); toast.success("Announcement created"); setForm({ title: "", body: "", kind: "info", audience: "all", dismissible: true }); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const toggle = async (a) => { try { await api.patch(`/admin/announcements/${a.id}`, { active: !a.active }); load(); } catch (e) { toast.error(formatApiError(e)); } };
  const del = async (id) => { if (!window.confirm("Delete this announcement?")) return; try { await api.delete(`/admin/announcements/${id}`); load(); } catch (e) { toast.error(formatApiError(e)); } };
  const email = async (a) => {
    if (!window.confirm(`Email "${a.title}" to targeted owners? This sends real email.`)) return;
    try { const r = await api.post(`/admin/announcements/${a.id}/email`); toast.success(`Emailed ${r.data.sent}/${r.data.targets} owners`); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  if (!rows) return <div className="flex items-center gap-2 text-white/40 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;
  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

  return (
    <div data-testid="admin-announcements">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Announcements</h2>
        <button onClick={load} className={BTN + " border-white/15 text-white/60 hover:text-white flex items-center gap-1.5"}><ArrowClockwise size={13} /> Refresh</button>
      </div>

      <form onSubmit={create} className={CARD + " mb-4 space-y-2"}>
        <div className={H3}>New announcement</div>
        <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className={INP + " w-full"} />
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Body (optional)" rows={2} className={INP + " w-full"} />
        <div className="flex flex-wrap gap-2 items-center">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={SEL}>
            {["info", "warning", "maintenance"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="audience: all | plan:starter | tenant:<id>" className={INP + " flex-1 min-w-[16rem]"} />
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-white/60"><input type="checkbox" checked={form.dismissible} onChange={(e) => setForm({ ...form, dismissible: e.target.checked })} className="accent-[#e5484d]" /> dismissible</label>
          <button type="submit" className={BTN + " border-[#3fb950]/50 text-[#3fb950] hover:bg-[#3fb950]/10 flex items-center gap-1"}><Plus size={12} /> Create</button>
        </div>
      </form>

      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.id} className={CARD + " flex items-center justify-between"} style={{ borderLeft: `3px solid ${KIND_COLOR[a.kind] || "#6b6b75"}` }}>
            <div>
              <div className="text-white text-sm">{a.title} <span className="font-mono text-[9px] uppercase" style={{ color: KIND_COLOR[a.kind] }}>{a.kind}</span></div>
              <div className="font-mono text-[10px] text-white/40 mt-0.5">{a.audience} · {a.live ? <span className="text-[#3fb950]">live</span> : <span className="text-white/40">off</span>} · {ts(a.created_at)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggle(a)} className={BTN + (a.active ? " border-[#d29922]/50 text-[#d29922]" : " border-[#3fb950]/50 text-[#3fb950]")}>{a.active ? "Disable" : "Enable"}</button>
              <button onClick={() => email(a)} title="Email to targeted owners" className={BTN + " border-white/15 text-white/60 hover:text-white"}><PaperPlaneRight size={13} /></button>
              <button onClick={() => del(a.id)} className={BTN + " border-[#e5484d]/50 text-[#e5484d] hover:bg-[#e5484d]/10"}><Trash size={13} /></button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="font-mono text-xs text-white/30 py-6 text-center">No announcements.</div>}
      </div>
    </div>
  );
}
