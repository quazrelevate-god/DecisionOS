import { useState } from "react";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { toast } from "sonner";
import { Buildings, Package, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "./ui/dialog";

const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm disabled:bg-black/5 disabled:text-muted-foreground";
const FIELDS = [
  { key: "name", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "company_size", label: "Team size" },
  { key: "phone", label: "Company mobile" },
  { key: "region", label: "Region" },
  { key: "currency", label: "Currency" },
  { key: "gst", label: "GST / Tax ID" },
  { key: "branches", label: "Branches" },
];

export function CompanyDialog({ trigger }) {
  const { tenant, user, refreshTenant } = useAuth();
  const canManage = hasPerm(user, "team_manage");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [products, setProducts] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleInput, setRoleInput] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);

  const openChange = (o) => {
    setOpen(o);
    if (o && tenant) {
      setForm({
        name: tenant.name || "", industry: tenant.industry || "", company_size: tenant.company_size || "",
        phone: tenant.phone || "", region: tenant.region || "", currency: tenant.currency || "", gst: tenant.gst || "", branches: tenant.branches || "",
      });
      setProducts((tenant.products || []).map((p) => ({ name: p.name || "", description: p.description || "" })));
      setRoles((tenant.roles || []).map((r) => ({ ...r })));
      setRoleInput("");
    }
  };

  const setRoleLabel = (key, label) => setRoles((rs) => rs.map((r) => (r.key === key ? { ...r, label } : r)));

  const addRole = async () => {
    const label = roleInput.trim();
    if (!label) return;
    setRoleBusy(true);
    try {
      const { data } = await api.post("/tenant/roles", { label });
      setRoles((data.roles || []).map((r) => ({ ...r })));
      setRoleInput("");
      await refreshTenant();
      toast.success(`Role "${label}" added`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't add role");
    } finally { setRoleBusy(false); }
  };

  const renameRole = async (key, label) => {
    const l = (label || "").trim();
    const orig = (tenant?.roles || []).find((r) => r.key === key);
    if (!l || l === orig?.label) { setRoles((tenant?.roles || []).map((r) => ({ ...r }))); return; }
    try {
      const { data } = await api.patch(`/tenant/roles/${key}`, { label: l });
      setRoles((data.roles || []).map((r) => ({ ...r })));
      await refreshTenant();
      toast.success("Role renamed");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't rename role");
      setRoles((tenant?.roles || []).map((r) => ({ ...r })));
    }
  };

  const deleteRole = async (key) => {
    setRoleBusy(true);
    try {
      const { data } = await api.delete(`/tenant/roles/${key}`);
      setRoles((data.roles || []).map((r) => ({ ...r })));
      await refreshTenant();
      toast.success("Role deleted");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't delete role");
    } finally { setRoleBusy(false); }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addProduct = () => setProducts((p) => [...p, { name: "", description: "" }]);
  const setProduct = (i, k, v) => setProducts((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeProduct = (i) => setProducts((p) => p.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.name?.trim()) return toast.error("Company name is required");
    setSaving(true);
    try {
      await api.patch("/tenant", {
        ...form,
        products: products.filter((p) => p.name.trim()),
      });
      await refreshTenant();
      toast.success("Company details updated");
      setOpen(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border border-black rounded-none max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="company-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight flex items-center gap-2">
            <Buildings size={20} weight="bold" className="text-brand-red" /> Company Details
          </DialogTitle>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.key === "name" ? "sm:col-span-2" : ""}>
              <label className="label-mono text-muted-foreground">{f.label}</label>
              <input data-testid={`company-field-${f.key}`} className={`${inp} mt-1`} value={form[f.key] || ""}
                disabled={!canManage} onChange={(e) => setField(f.key, e.target.value)} placeholder={canManage ? f.label : "—"} />
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Package size={18} weight="bold" className="text-brand-blue" />
              <h3 className="font-heading font-extrabold uppercase tracking-tight">Products & Services</h3>
            </div>
            {canManage && (
              <button onClick={addProduct} data-testid="company-add-product"
                className="flex items-center gap-1 text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-blue hover:text-white transition-colors">
                <Plus size={12} weight="bold" /> Add
              </button>
            )}
          </div>

          {products.length === 0 && <p className="text-sm text-muted-foreground">No products or services yet.</p>}
          <div className="space-y-2">
            {products.map((p, i) => (
              <div key={i} data-testid={`company-product-${i}`} className="border border-black/30 p-3 flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <input data-testid={`company-product-name-${i}`} className={inp} value={p.name} disabled={!canManage}
                    onChange={(e) => setProduct(i, "name", e.target.value)} placeholder="Name" />
                  <input data-testid={`company-product-desc-${i}`} className={inp} value={p.description} disabled={!canManage}
                    onChange={(e) => setProduct(i, "description", e.target.value)} placeholder="Short description" />
                </div>
                {canManage && (
                  <button onClick={() => removeProduct(i)} data-testid={`company-product-remove-${i}`}
                    className="border border-black p-2 hover:bg-brand-red hover:text-white transition-colors" title="Remove">
                    <Trash size={14} weight="bold" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1">
            <UsersThree size={18} weight="bold" className="text-brand-red" />
            <h3 className="font-heading font-extrabold uppercase tracking-tight">Team Roles</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Owner is always present. A role can't be deleted while members are still assigned to it — reassign them first.
          </p>
          <div className="space-y-2" data-testid="roles-manage-list">
            {roles.map((r) => (
              <div key={r.key} data-testid={`role-row-${r.key}`} className="border border-black/30 p-2 flex items-center gap-2">
                <input data-testid={`role-label-${r.key}`} className={inp} value={r.label} disabled={!canManage || roleBusy}
                  onChange={(e) => setRoleLabel(r.key, e.target.value)}
                  onBlur={(e) => canManage && renameRole(r.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }}
                  placeholder="Role name" />
                <span className="label-mono text-muted-foreground shrink-0 hidden sm:inline">{r.key}</span>
                {canManage && (
                  <button onClick={() => deleteRole(r.key)} disabled={roleBusy} data-testid={`role-delete-${r.key}`}
                    className="border border-black p-2 hover:bg-brand-red hover:text-white transition-colors shrink-0" title="Delete role">
                    <Trash size={14} weight="bold" />
                  </button>
                )}
              </div>
            ))}
            {roles.length === 0 && <p className="text-sm text-muted-foreground">No roles yet — add one below.</p>}
          </div>
          {canManage && (
            <div className="flex gap-2 mt-2">
              <input data-testid="role-add-input" className={inp} value={roleInput} disabled={roleBusy}
                onChange={(e) => setRoleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }}
                placeholder="Add a role (e.g. Marketing)" />
              <button onClick={addRole} disabled={roleBusy || !roleInput.trim()} data-testid="role-add-button"
                className="flex items-center gap-1 border border-black px-3 text-sm font-semibold uppercase hover:bg-brand-ink hover:text-white transition-colors disabled:opacity-50">
                <Plus size={14} weight="bold" /> Add
              </button>
            </div>
          )}
        </div>

        {canManage && (
          <DialogFooter>
            <button data-testid="company-save-button" onClick={save} disabled={saving}
              className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
