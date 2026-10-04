import { ADMIN_BTN, ADMIN_H2, ADMIN_H3, ADMIN_INP, ADMIN_SEL, CARD_BASE } from "./adminStyle";
// Admin RBAC & security (Epic 10 Sprint 7).
// Manage admin accounts + roles (super_admin only) and your own TOTP 2FA.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, Plus, ShieldCheck, Prohibit } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-4`;
const H2 = ADMIN_H2;
const H3 = ADMIN_H3;
const BTN = ADMIN_BTN;
const SEL = ADMIN_SEL;
const INP = ADMIN_INP;

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

  if (!me) return <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;

  return (
    <div data-testid="admin-rbac">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Admin RBAC & Security</h2>
        <button onClick={load} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}><ArrowClockwise size={13} /> Refresh</button>
      </div>

      {/* My 2FA */}
      <div className={CARD + " mb-4"}>
        <div className={H3}>My account — {me.email} <span className="text-slate-600">({me.role})</span></div>
        {me.two_factor ? (
          <div className="flex items-center justify-between">
            <span className="text-[#116329] font-mono text-xs flex items-center gap-1.5"><ShieldCheck size={14} weight="fill" /> 2FA enabled</span>
            <button onClick={disable2fa} className={BTN + " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10"}>Disable 2FA</button>
          </div>
        ) : enroll ? (
          <div>
            <div className="font-mono text-[11px] text-slate-600 mb-2">Add this secret to your authenticator, then enter a code:</div>
            <div className="font-mono text-xs text-slate-900 bg-white border border-slate-900/10 p-2 mb-2 break-all rounded-xl">{enroll.secret}</div>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" className={INP + " flex-1"} />
              <button onClick={confirmEnroll} className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10"}>Confirm</button>
            </div>
          </div>
        ) : backup ? (
          <div>
            <div className="font-mono text-[11px] text-[#7d4e00] mb-2">2FA enabled — save these backup codes (shown once):</div>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs text-slate-900">{backup.map((c) => <div key={c} className="bg-white border border-slate-900/10 px-2 py-1 rounded-xl">{c}</div>)}</div>
          </div>
        ) : (
          <button onClick={startEnroll} className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10 flex items-center gap-1.5"}><ShieldCheck size={14} /> Enable 2FA</button>
        )}
      </div>

      {me.role !== "super_admin" ? (
        <p className="font-mono text-xs text-slate-600">Admin-account management is available to super-admins only.</p>
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
              <button type="submit" className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10 flex items-center gap-1"}><Plus size={12} /> Add</button>
            </form>
          </div>

          <div className={H3}>Admins ({admins ? admins.length : 0})</div>
          <div className="border border-slate-900/10 divide-y divide-slate-900/5 rounded-xl">
            {(admins || []).map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-slate-900/[0.06]">
                <div>
                  <div className="text-slate-900 text-sm">{a.email} {a.two_factor && <ShieldCheck size={12} className="inline text-[#116329]" weight="fill" />}{!a.active && <span className="text-[#b91c1c] text-xs ml-1">· inactive</span>}</div>
                  <div className="font-mono text-[10px] text-slate-600">{a.name} · last login {a.last_login ? String(a.last_login).slice(0, 16).replace("T", " ") : "never"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select value={a.role} onChange={(e) => setRole(a.id, e.target.value)} disabled={a.id === me.id} className={SEL}>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {a.id !== me.id && (
                    <button onClick={() => setActive(a.id, !a.active)} className={BTN + (a.active ? " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10" : " border-[#116329]/50 text-[#116329]")}>
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
