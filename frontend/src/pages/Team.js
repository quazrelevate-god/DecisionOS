import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";import { PERMISSIONS, defaultPermsForRole, hasPerm, userPerms } from "../lib/perms";
import { toast } from "sonner";
import { UserPlus, PencilSimple, ShieldCheck, Check } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";

function MemberDialog({ trigger, initial, roleOptions, onSaved }) {
  const [open, setOpen] = useState(false);
  const blank = { name: "", email: "", password: "", role: roleOptions[0]?.key || "", permissions: defaultPermsForRole(roleOptions[0]?.key) };
  const [form, setForm] = useState(blank);
  const editing = !!initial;

  const openChange = (o) => {
    setOpen(o);
    if (o) {
      if (initial) {
        setForm({
          name: initial.name, email: initial.email, password: "", role: initial.role,
          permissions: Array.isArray(initial.permissions) && initial.permissions.length ? [...initial.permissions] : defaultPermsForRole(initial.role),
        });
      } else setForm(blank);
    }
  };

  const setRole = (role) => setForm((f) => ({ ...f, role, permissions: editing ? f.permissions : defaultPermsForRole(role) }));
  const togglePerm = (key) => setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key] }));

  const save = async () => {
    try {
      if (editing) {
        await api.patch(`/users/${initial.id}`, { role: form.role, permissions: form.permissions });
        toast.success(`${initial.name}'s access updated`);
      } else {
        if (!form.name.trim() || !form.email.trim() || form.password.length < 6) return toast.error("Name, email and a 6+ char password are required");
        await api.post("/users", { name: form.name, email: form.email, password: form.password, role: form.role, permissions: form.permissions });
        toast.success(`${form.name} added`);
      }
      setOpen(false); onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{editing ? `Edit access — ${initial.name}` : "Add team member"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!editing && <>
            <input data-testid="member-name-input" className={inp} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input data-testid="member-email-input" className={inp} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input data-testid="member-password-input" className={inp} type="password" placeholder="Temp password (min 6)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </>}
          <div>
            <label className="label-mono text-muted-foreground">Role</label>
            <select data-testid="member-role-select" className={`${inp} mt-1`} value={form.role} onChange={(e) => setRole(e.target.value)}>
              {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-2 mt-1">
              <ShieldCheck size={16} weight="bold" className="text-brand-red" />
              <label className="label-mono text-muted-foreground">Access — pick what this member can open & use</label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="permission-list">
              {PERMISSIONS.map((p) => {
                const on = form.permissions.includes(p.key);
                return (
                  <button key={p.key} type="button" data-testid={`perm-${p.key}`} onClick={() => togglePerm(p.key)}
                    className={`flex items-center justify-between gap-2 border border-black px-3 py-2 text-xs font-semibold text-left transition-colors ${on ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                    <span>{p.label}</span>
                    <span className={`w-4 h-4 shrink-0 flex items-center justify-center border border-current ${on ? "bg-brand-red text-white border-black" : ""}`}>{on && <Check size={10} weight="bold" />}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <button data-testid="member-save-submit" onClick={save} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">{editing ? "Save access" : "Add"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamPanel() {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const roleOptions = tenant?.roles || [];
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const { data: attendance } = useQuery({ queryKey: ["attendance"], queryFn: () => api.get("/attendance").then((r) => r.data) });
  const canManageTeam = hasPerm(user, "team_manage");
  const absentIds = new Set((attendance || []).filter((a) => a.status === "absent").map((a) => a.user_id));
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const toggleAbsent = async (u) => {
    const nowAbsent = absentIds.has(u.id);
    await api.post("/attendance", { user_id: u.id, status: nowAbsent ? "present" : "absent" });
    toast.success(`${u.name} marked ${nowAbsent ? "present" : "absent"}`);
    qc.invalidateQueries({ queryKey: ["attendance"] });
  };

  return (
    <div>
      {canManageTeam && (
        <div className="flex justify-end mb-6">
          <MemberDialog roleOptions={roleOptions} onSaved={refresh}
            trigger={<button data-testid="add-user-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all"><UserPlus size={16} weight="bold" /> Add Member</button>} />
        </div>
      )}

      {/* Company profile & products now live in the top-bar company icon dialog */}

      <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Members</h2>
      <div className="card-brutal divide-y divide-black/10">
        {(data || []).map((u) => (
          <div key={u.id} data-testid={`team-member-${u.id}`} className="p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-ink text-white flex items-center justify-center font-heading font-black">{u.name?.[0]?.toUpperCase()}</div>
              <div>
                <p className="font-semibold text-sm">{u.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{u.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {u.role !== "owner" && (
                <span className="label-mono text-muted-foreground" data-testid={`member-access-count-${u.id}`}>{userPerms(u).length} access</span>
              )}
              <Chip value={u.role} className={u.role === "owner" ? "bg-brand-red text-white" : "bg-brand-blue text-white"} />
              {absentIds.has(u.id) && <Chip value="absent" className="bg-black text-white" data-testid={`absent-badge-${u.id}`} />}
              {canManageTeam && u.role !== "owner" && (
                <>
                  <MemberDialog roleOptions={roleOptions} initial={u} onSaved={refresh}
                    trigger={<button data-testid={`edit-access-${u.id}`} className="flex items-center gap-1 text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-blue hover:text-white transition-colors"><PencilSimple size={12} weight="bold" /> Access</button>} />
                  <button onClick={() => toggleAbsent(u)} data-testid={`toggle-absent-${u.id}`} className="text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">
                    {absentIds.has(u.id) ? "Mark present" : "Mark absent"}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
