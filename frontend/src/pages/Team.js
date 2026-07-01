import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip } from "../components/common";
import { toast } from "sonner";
import { UserPlus } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const ROLES = ["owner", "sales", "production", "finance"];

export default function Team() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "sales" });
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const add = async () => {
    try {
      await api.post("/users", form);
      toast.success(`${form.name} added as ${form.role}`);
      setForm({ name: "", email: "", password: "", role: "sales" });
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
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <DialogFooter>
                <button data-testid="member-create-submit" onClick={add} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Add</button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

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
            <Chip value={u.role} className={u.role === "owner" ? "bg-brand-red text-white" : "bg-brand-blue text-white"} />
          </div>
        ))}
      </div>
    </div>
  );
}
