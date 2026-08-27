// Admin RBAC & security (Epic 10 Sprint 7).
// Manage admin accounts + roles (super_admin only) and your own TOTP 2FA.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, Plus, ShieldCheck, Prohibit } from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-4";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const H3 = "font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors";
const SEL = "bg-[#0a0a0b] border border-white/10 px-2 py-1 font-mono text-[11px] text-white outline-none";
const INP = "bg-[#0a0a0b] border border-white/10 px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-white/30 outline-none";

export function AdminRbacSection() {
  const [me, setMe] = useState(null);
  const [admins, setAdmins] = useState(null);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState({ email: "", name: "", role: "support", password: "" });
  const [enroll, setEnroll] = useState(null);   // {secret, provisioning_uri}
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(null);

  const load = useCallback(async () => {
    try {
      const meR = await api.get("/admin/me");
      setMe(meR.data);
      if (meR.data.role === "super_admin") {
        const r = await api.get("/admin/admins");
        setAdmins(r.data.admins); setRoles(r.data.roles);
      }
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/admin/admins", form);
      toast.success("Admin created"); setForm({ email: "", name: "", role: "support", password: "" }); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const setRole = async (id, role) => { try { await api.patch(`/admin/admins/${id}`, { role }); load(); } catch (e) { toast.error(formatApiError(e)); } };
  const setActive = async (id, active) => { try { await api.patch(`/admin/admins/${id}`, { active }); toast.success(active ? "Reactivated" : "Deactivated"); load(); } catch (e) { toast.error(formatApiError(e)); } };

  const startEnroll = async () => { try { const r = await api.post("/admin/2fa/enroll"); setEnroll(r.data); setBackup(null); } catch (e) { toast.error(formatApiError(e)); } };
  const confirmEnroll = async () => { try { const r = await api.post("/admin/2fa/confirm", { code }); setBackup(r.data.backup_codes); setEnroll(null); setCode(""); toast.success("2FA enabled"); load(); } catch (e) { toast.error(formatApiError(e)); } };
  const disable2fa = async () => { const c = window.prompt("Enter a current 2FA code to disable:"); if (!c) return; try { await api.post("/admin/2fa/disable", { code: c }); toast.success("2FA disabled"); load(); } catch (e) { toast.error(formatApiError(e)); } };

  if (!me) return <div className="flex items-center gap-2 text-white/40 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;

  return (
    <div data-testid="admin-rbac">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Admin RBAC & Security</h2>
        <button onClick={load} className={BTN + " border-white/15 text-white/60 hover:text-white flex items-center gap-1.5"}><ArrowClockwise size={13} /> Refresh</button>
      </div>

      {/* My 2FA */}
      <div className={CARD + " mb-4"}>
        <div className={H3}>My account — {me.email} <span className="text-white/60">({me.role})</span></div>
        {me.two_factor ? (
          <div className="flex items-center justify-between">
            <span className="text-[#3fb950] font-mono text-xs flex items-center gap-1.5"><ShieldCheck size={14} weight="fill" /> 2FA enabled</span>
            <button onClick={disable2fa} className={BTN + " border-[#e5484d]/50 text-[#e5484d] hover:bg-[#e5484d]/10"}>Disable 2FA</button>
          </div>
        ) : enroll ? (
          <div>
            <div className="font-mono text-[11px] text-white/60 mb-2">Add this secret to your authenticator, then enter a code:</div>
            <div className="font-mono text-xs text-white bg-[#0a0a0b] border border-white/10 p-2 mb-2 break-all">{enroll.secret}</div>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" className={INP + " flex-1"} />
              <button onClick={confirmEnroll} className={BTN + " border-[#3fb950]/50 text-[#3fb950] hover:bg-[#3fb950]/10"}>Confirm</button>
            </div>
          </div>
        ) : backup ? (
          <div>
            <div className="font-mono text-[11px] text-[#d29922] mb-2">2FA enabled — save these backup codes (shown once):</div>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs text-white">{backup.map((c) => <div key={c} className="bg-[#0a0a0b] border border-white/10 px-2 py-1">{c}</div>)}</div>
          </div>
        ) : (
          <button onClick={startEnroll} className={BTN + " border-[#3fb950]/50 text-[#3fb950] hover:bg-[#3fb950]/10 flex items-center gap-1.5"}><ShieldCheck size={14} /> Enable 2FA</button>
        )}
      </div>

      {me.role !== "super_admin" ? (
        <p className="font-mono text-xs text-white/40">Admin-account management is available to super-admins only.</p>
      ) : (
        <>
          <div className={CARD + " mb-4"}>
            <div className={H3}>Add admin</div>
            <form onSubmit={create} className="flex flex-wrap gap-2 items-center">
              <input required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email" className={INP} />
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="name" className={INP} />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={SEL}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="password (10+)" className={INP} />
              <button type="submit" className={BTN + " border-[#3fb950]/50 text-[#3fb950] hover:bg-[#3fb950]/10 flex items-center gap-1"}><Plus size={12} /> Add</button>
            </form>
          </div>

          <div className={H3}>Admins ({admins ? admins.length : 0})</div>
          <div className="border border-white/10 divide-y divide-white/5">
            {(admins || []).map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-[#141418]">
                <div>
                  <div className="text-white text-sm">{a.email} {a.two_factor && <ShieldCheck size={12} className="inline text-[#3fb950]" weight="fill" />}{!a.active && <span className="text-[#e5484d] text-xs ml-1">· inactive</span>}</div>
                  <div className="font-mono text-[10px] text-white/40">{a.name} · last login {a.last_login ? String(a.last_login).slice(0, 16).replace("T", " ") : "never"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select value={a.role} onChange={(e) => setRole(a.id, e.target.value)} disabled={a.id === me.id} className={SEL}>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {a.id !== me.id && (
                    <button onClick={() => setActive(a.id, !a.active)} className={BTN + (a.active ? " border-[#e5484d]/50 text-[#e5484d] hover:bg-[#e5484d]/10" : " border-[#3fb950]/50 text-[#3fb950]")}>
                      {a.active ? <Prohibit size={13} /> : "Reactivate"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
