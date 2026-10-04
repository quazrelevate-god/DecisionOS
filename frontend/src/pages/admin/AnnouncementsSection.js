import { ADMIN_BTN, ADMIN_H2, ADMIN_H3, ADMIN_INP, ADMIN_SEL, CARD_BASE } from "./adminStyle";
// Announcements & comms (Epic 10 Sprint 8).
// Create in-app broadcasts / maintenance banners (audience all / plan / tenant),
// activate/deactivate, delete, and email to targeted owners.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { ConfirmAction } from "../../components/common";
import { Spinner, ArrowClockwise, Plus, Trash, PaperPlaneRight } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-4`;
const H2 = ADMIN_H2;
const H3 = ADMIN_H3;
const BTN = ADMIN_BTN;
const SEL = ADMIN_SEL;
const INP = ADMIN_INP;
const KIND_COLOR = { info: "#0969da", warning: "#7d4e00", maintenance: "#cf222e" };

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
  /* 2026-10-02 — both of these asked through window.confirm, which some embed
     contexts answer false with nothing drawn: the operator saw no question and
     no result. The second one sends REAL EMAIL to real owners, so a question
     that can fail to appear is not a question. */
  const [pendingDel, setPendingDel] = useState(null);
  const [pendingEmail, setPendingEmail] = useState(null);
  const del = async (id) => {
    setPendingDel(null);
    try { await api.delete(`/admin/announcements/${id}`); load(); } catch (e) { toast.error(formatApiError(e)); }
  };
  const email = async (a) => {
    setPendingEmail(null);
    try { const r = await api.post(`/admin/announcements/${a.id}/email`); toast.success(`Emailed ${r.data.sent}/${r.data.targets} owners`); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  if (!rows) return <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;
  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

  return (
    <div data-testid="admin-announcements">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Announcements</h2>
        <button onClick={load} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}><ArrowClockwise size={13} /> Refresh</button>
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
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-slate-600"><input type="checkbox" checked={form.dismissible} onChange={(e) => setForm({ ...form, dismissible: e.target.checked })} className="accent-[#cf222e]" /> dismissible</label>
          <button type="submit" className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10 flex items-center gap-1"}><Plus size={12} /> Create</button>
        </div>
      </form>

      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.id} className={CARD + " flex items-center justify-between"} style={{ borderLeft: `3px solid ${KIND_COLOR[a.kind] || "#57606a"}` }}>
            <div>
              <div className="text-slate-900 text-sm">{a.title} <span className="font-mono text-[9px] uppercase" style={{ color: KIND_COLOR[a.kind] }}>{a.kind}</span></div>
              <div className="font-mono text-[10px] text-slate-600 mt-0.5">{a.audience} · {a.live ? <span className="text-[#116329]">live</span> : <span className="text-slate-600">off</span>} · {ts(a.created_at)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggle(a)} className={BTN + (a.active ? " border-[#7d4e00]/50 text-[#7d4e00]" : " border-[#116329]/50 text-[#116329]")}>{a.active ? "Disable" : "Enable"}</button>
              <button onClick={() => setPendingEmail(a)} title="Email to targeted owners" className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900"}><PaperPlaneRight size={13} /></button>
              <button onClick={() => setPendingDel(a)} className={BTN + " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10"}><Trash size={13} /></button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="font-mono text-xs text-slate-600 py-6 text-center">No announcements.</div>}
      </div>
      <ConfirmAction
        open={!!pendingDel}
        onOpenChange={() => setPendingDel(null)}
        title="Delete this announcement?"
        description={pendingDel ? `“${pendingDel.title}” comes off every workspace it is showing on. This can't be undone.` : ""}
        confirmLabel="Delete it"
        cancelLabel="Keep it"
        onConfirm={() => del(pendingDel.id)}
        testid="admin-announcement-delete-confirm" />

      <ConfirmAction
        open={!!pendingEmail}
        onOpenChange={() => setPendingEmail(null)}
        title="Send this as real email?"
        description={pendingEmail ? `“${pendingEmail.title}” goes to every targeted owner's inbox. Email cannot be unsent.` : ""}
        confirmLabel="Send the email"
        cancelLabel="Not now"
        danger={false}
        onConfirm={() => email(pendingEmail)}
        testid="admin-announcement-email-confirm" />

    </div>
  );
}
