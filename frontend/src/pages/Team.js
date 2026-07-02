import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip } from "../components/common";
import { toast } from "sonner";
import { UserPlus, Buildings, Package } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

export default function Team() {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const roleOptions = tenant?.roles || [];
  const [form, setForm] = useState({ name: "", email: "", password: "", role: roleOptions[0]?.key || "" });
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const { data: attendance } = useQuery({ queryKey: ["attendance"], queryFn: () => api.get("/attendance").then((r) => r.data) });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isOwner = user?.role === "owner";
  const absentIds = new Set((attendance || []).filter((a) => a.status === "absent").map((a) => a.user_id));

  const toggleAbsent = async (u) => {
    const nowAbsent = absentIds.has(u.id);
    await api.post("/attendance", { user_id: u.id, status: nowAbsent ? "present" : "absent" });
    toast.success(`${u.name} marked ${nowAbsent ? "present" : "absent"}`);
    qc.invalidateQueries({ queryKey: ["attendance"] });
  };

  const roleLabel = (key) => (key === "owner" ? "Owner" : roleOptions.find((r) => r.key === key)?.label || key);

  const add = async () => {
    try {
      await api.post("/users", form);
      toast.success(`${form.name} added as ${roleLabel(form.role)}`);
      setForm({ name: "", email: "", password: "", role: roleOptions[0]?.key || "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add");
    }
  };
  const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";

  return (
    <div>
      <PageHeader eyebrow="Role-based access" title="Team">
        {user?.role === "owner" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button data-testid="add-user-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
                <UserPlus size={16} weight="bold" /> Add Member
              </button>
            </DialogTrigger>
            <DialogContent className="border border-black rounded-none">
              <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">Add team member</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <input data-testid="member-name-input" className={inp} placeholder="Name" value={form.name} onChange={set("name")} />
                <input data-testid="member-email-input" className={inp} type="email" placeholder="Email" value={form.email} onChange={set("email")} />
                <input data-testid="member-password-input" className={inp} type="password" placeholder="Temp password (min 6)" value={form.password} onChange={set("password")} />
                <select data-testid="member-role-select" className={inp} value={form.role} onChange={set("role")}>
                  {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
              <DialogFooter>
                <button data-testid="member-create-submit" onClick={add} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Add</button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {/* Company profile */}
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="card-brutal p-6 lg:col-span-1" data-testid="company-profile">
          <div className="flex items-center gap-2 mb-4">
            <Buildings size={20} weight="bold" className="text-brand-red" />
            <h2 className="font-heading font-extrabold uppercase tracking-tight text-lg">Company</h2>
          </div>
          <p className="font-heading font-black text-xl leading-tight">{tenant?.name}</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3 border-b border-black/10 pb-1"><dt className="text-muted-foreground">Industry</dt><dd className="font-semibold text-right" data-testid="profile-industry">{tenant?.industry || "—"}</dd></div>
            <div className="flex justify-between gap-3 border-b border-black/10 pb-1"><dt className="text-muted-foreground">Team size</dt><dd className="font-semibold">{tenant?.company_size || "—"}</dd></div>
            <div className="flex justify-between gap-3 border-b border-black/10 pb-1"><dt className="text-muted-foreground">Region</dt><dd className="font-semibold">{tenant?.region || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Currency</dt><dd className="font-semibold">{tenant?.currency || "—"}</dd></div>
          </dl>
        </div>

        <div className="card-brutal p-6 lg:col-span-2" data-testid="products-card">
          <div className="flex items-center gap-2 mb-4">
            <Package size={20} weight="bold" className="text-brand-blue" />
            <h2 className="font-heading font-extrabold uppercase tracking-tight text-lg">Products & Services</h2>
          </div>
          {(tenant?.products || []).length === 0 && <p className="text-sm text-muted-foreground">No products captured yet.</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            {(tenant?.products || []).map((p, i) => (
              <div key={i} data-testid={`profile-product-${i}`} className="border border-black/20 p-3">
                <p className="font-semibold text-sm">{p.name}</p>
                {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Members</h2>
      <div className="card-brutal divide-y divide-black/10">
        {(data || []).map((u) => (
          <div key={u.id} data-testid={`team-member-${u.id}`} className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-ink text-white flex items-center justify-center font-heading font-black">
                {u.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-sm">{u.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{u.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Chip value={u.role} className={u.role === "owner" ? "bg-brand-red text-white" : "bg-brand-blue text-white"} />
              {absentIds.has(u.id) && <Chip value="absent" className="bg-black text-white" data-testid={`absent-badge-${u.id}`} />}
              {isOwner && u.role !== "owner" && (
                <button onClick={() => toggleAbsent(u)} data-testid={`toggle-absent-${u.id}`}
                  className="text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">
                  {absentIds.has(u.id) ? "Mark present" : "Mark absent"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
