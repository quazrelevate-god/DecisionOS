import { useState, useEffect } from "react";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { toast } from "sonner";
import { Buildings, Package, Plus, Trash, UsersThree, Kanban, ListChecks, ShieldCheck, Copy, WhatsappLogo } from "@phosphor-icons/react";

const inp = "w-full border border-hairline px-3 py-2 text-sm text-label focus:outline-none focus:shadow-xs disabled:bg-surface-hover disabled:text-text-secondary";
const uid = () => Math.random().toString(36).slice(2, 9);
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
const OP_CATS = ["Presentation","Meeting","Documentation","Proposal","Planning","Review","Administration","Compliance","Marketing","HR Activity","Travel","Event","IT Support","Other"];

export function CompanyDetails() {
  const { tenant, user, refreshTenant } = useAuth();
  const canManage = hasPerm(user, "team_manage");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [products, setProducts] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleInput, setRoleInput] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [opTasks, setOpTasks] = useState([]);
  const [approvalRules, setApprovalRules] = useState([]);
  const [osBusy, setOsBusy] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name: tenant.name || "", industry: tenant.industry || "", company_size: tenant.company_size || "",
      phone: tenant.phone || "", region: tenant.region || "", currency: tenant.currency || "", gst: tenant.gst || "", branches: tenant.branches || "",
    });
    setProducts((tenant.products || []).map((p) => ({ name: p.name || "", description: p.description || "", _key: uid() })));
    setRoles((tenant.roles || []).map((r) => ({ ...r })));
    setWorkflows((tenant.workflow_templates || []).map((w) => ({ name: w.name || "", _key: uid() })));
    setOpTasks((tenant.operational_task_templates || []).map((t) => ({ title: t.title || "", category: t.category || "Other", _key: uid() })));
    setApprovalRules((tenant.approval_rules || []).map((r) => ({ name: r.name || "", description: r.description || "", _key: uid() })));
  }, [tenant]);

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
  const addProduct = () => setProducts((p) => [...p, { name: "", description: "", _key: uid() }]);
  const setProduct = (i, k, v) => setProducts((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeProduct = (i) => setProducts((p) => p.filter((_, idx) => idx !== i));

  const addWorkflow = () => setWorkflows((w) => [...w, { name: "", _key: uid() }]);
  const setWorkflow = (i, v) => setWorkflows((w) => w.map((it, idx) => (idx === i ? { ...it, name: v } : it)));
  const removeWorkflow = (i) => setWorkflows((w) => w.filter((_, idx) => idx !== i));
  const addOpTask = () => setOpTasks((t) => [...t, { title: "", category: "Other", _key: uid() }]);
  const setOpTaskField = (i, k, v) => setOpTasks((t) => t.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeOpTask = (i) => setOpTasks((t) => t.filter((_, idx) => idx !== i));
  const addRule = () => setApprovalRules((r) => [...r, { name: "", description: "", _key: uid() }]);
  const setRuleField = (i, k, v) => setApprovalRules((r) => r.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeRule = (i) => setApprovalRules((r) => r.filter((_, idx) => idx !== i));

  const saveOs = async () => {
    setOsBusy(true);
    try {
      await api.patch("/tenant/os-blueprint", {
        workflow_templates: workflows.filter((w) => w.name.trim()),
        operational_task_templates: opTasks.filter((t) => t.title.trim()),
        approval_rules: approvalRules.filter((r) => r.name.trim()),
      });
      await refreshTenant();
      toast.success("Operating system updated");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Update failed");
    } finally { setOsBusy(false); }
  };

  const save = async () => {
    if (!form.name?.trim()) return toast.error("Company name is required");
    setSaving(true);
    try {
      await api.patch("/tenant", {
        ...form,
        products: products.filter((p) => p.name.trim()).map(({ _key, ...r }) => r),
      });
      await refreshTenant();
      toast.success("Company details updated");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface p-5" data-testid="settings-company-card">
      <div className="flex items-center gap-2 mb-1">
        <Buildings size={20} weight="bold" className="text-primary-text" />
        <h2 className="text-lg font-extrabold tracking-tight">Company Details</h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">Update your company profile, products, and team roles.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === "name" ? "sm:col-span-2" : ""}>
            <label className="text-label text-text-secondary">{f.label}</label>
            <input data-testid={`company-field-${f.key}`} className={`${inp} mt-1`} value={form[f.key] || ""}
              disabled={!canManage} onChange={(e) => setField(f.key, e.target.value)} placeholder={canManage ? f.label : "—"} />
          </div>
        ))}
      </div>

      {canManage && tenant?.id && (
        <div className="mt-4 border border-hairline bg-background p-3 rounded-md" data-testid="workspace-id-block">
          <label className="text-label text-text-secondary flex items-center gap-1.5"><WhatsappLogo size={13} weight="bold" className="text-status-completed-fg" /> Workspace ID <span className="normal-case">(used to route WhatsApp messages)</span></label>
          <div className="flex gap-2 mt-1.5">
            <input data-testid="workspace-id-value" readOnly value={tenant.id} className={`${inp} bg-surface cursor-text`} onFocus={(e) => e.target.select()} />
            <button data-testid="workspace-id-copy"
              onClick={() => { navigator.clipboard?.writeText(tenant.id); toast.success("Workspace ID copied"); }}
              className="flex items-center gap-1 border border-hairline px-3 text-sm font-semibold hover:bg-surface-hover transition-colors shrink-0 rounded-md">
              <Copy size={14} weight="bold" /> Copy
            </button>
          </div>
          <p className="text-xs text-text-secondary mt-1.5">WhatsApp messages from numbers we don't recognise land in this workspace. Your administrator connects this once during setup — you don't need to do anything with the ID.</p>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Package size={18} weight="bold" className="text-primary-text" />
            <h3 className="font-extrabold tracking-tight">Products & Services</h3>
          </div>
          {canManage && (
            <button onClick={addProduct} data-testid="company-add-product"
              className="flex items-center gap-1 text-xs border border-hairline px-2 py-1 hover:bg-primary hover:text-white transition-colors rounded-md">
              <Plus size={12} weight="bold" /> Add
            </button>
          )}
        </div>

        {products.length === 0 && <p className="text-sm text-text-secondary">No products or services yet.</p>}
        <div className="space-y-2">
          {products.map((p, i) => (
            <div key={p._key || i} data-testid={`company-product-${i}`} className="border border-hairline p-3 flex items-start gap-2 rounded-md">
              <div className="flex-1 space-y-2">
                <input data-testid={`company-product-name-${i}`} className={inp} value={p.name} disabled={!canManage}
                  onChange={(e) => setProduct(i, "name", e.target.value)} placeholder="Name" />
                <input data-testid={`company-product-desc-${i}`} className={inp} value={p.description} disabled={!canManage}
                  onChange={(e) => setProduct(i, "description", e.target.value)} placeholder="Short description" />
              </div>
              {canManage && (
                <button onClick={() => removeProduct(i)} data-testid={`company-product-remove-${i}`}
                  className="border border-hairline p-2 hover:bg-destructive-tint transition-colors rounded-md" title="Remove">
                  <Trash size={14} weight="bold" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-1">
          <UsersThree size={18} weight="bold" className="text-primary-text" />
          <h3 className="font-extrabold tracking-tight">Team Roles</h3>
        </div>
        <p className="text-xs text-text-secondary mb-2">
          Owner is always present. A role can't be deleted while members are still assigned to it — reassign them first.
        </p>
        <div className="space-y-2" data-testid="roles-manage-list">
          {roles.map((r) => (
            <div key={r.key} data-testid={`role-row-${r.key}`} className="border border-hairline p-2 flex items-center gap-2 rounded-md">
              <input data-testid={`role-label-${r.key}`} className={inp} value={r.label} disabled={!canManage || roleBusy}
                onChange={(e) => setRoleLabel(r.key, e.target.value)}
                onBlur={(e) => canManage && renameRole(r.key, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }}
                placeholder="Role name" />
              <span className="text-label text-text-secondary shrink-0 hidden sm:inline">{r.key}</span>
              {canManage && (
                <button onClick={() => deleteRole(r.key)} disabled={roleBusy} data-testid={`role-delete-${r.key}`}
                  className="border border-hairline p-2 hover:bg-destructive-tint transition-colors shrink-0 rounded-md" title="Delete role">
                  <Trash size={14} weight="bold" />
                </button>
              )}
            </div>
          ))}
          {roles.length === 0 && <p className="text-sm text-text-secondary">No roles yet — add one below.</p>}
        </div>
        {canManage && (
          <div className="flex gap-2 mt-2">
            <input data-testid="role-add-input" className={inp} value={roleInput} disabled={roleBusy}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }}
              placeholder="Add a role (e.g. Marketing)" />
            <button onClick={addRole} disabled={roleBusy || !roleInput.trim()} data-testid="role-add-button"
              className="flex items-center gap-1 border border-hairline px-3 text-sm font-semibold hover:bg-surface-hover transition-colors disabled:opacity-50 rounded-md">
              <Plus size={14} weight="bold" /> Add
            </button>
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-6 border-t-hairline pt-4" data-testid="os-blueprint-section">
          <div className="flex items-center gap-2 mb-1">
            <Kanban size={18} weight="bold" className="text-primary-text" />
            <h3 className="font-extrabold tracking-tight">Operating System</h3>
          </div>
          <p className="text-xs text-text-secondary mb-3">Your generated workflows, operational tasks and approval rules. Add, edit or delete anytime.</p>

          <label className="text-label text-text-secondary flex items-center gap-1.5"><Kanban size={13} weight="bold" /> Workflows</label>
          <div className="space-y-2 mt-1.5" data-testid="os-workflows-list">
            {workflows.map((w, i) => (
              <div key={w._key || i} className="flex gap-2" data-testid={`os-workflow-${i}`}>
                <input data-testid={`os-workflow-name-${i}`} className={inp} value={w.name} onChange={(e) => setWorkflow(i, e.target.value)} placeholder="Workflow name" />
                <button onClick={() => removeWorkflow(i)} data-testid={`os-workflow-remove-${i}`} className="border border-hairline p-2 hover:bg-destructive-tint transition-colors shrink-0 rounded-md"><Trash size={14} weight="bold" /></button>
              </div>
            ))}
          </div>
          <button onClick={addWorkflow} data-testid="os-workflow-add" className="mt-1.5 flex items-center gap-1 text-sm text-primary-text font-semibold hover:underline"><Plus size={14} weight="bold" /> Add workflow</button>

          <label className="text-label text-text-secondary flex items-center gap-1.5 mt-4"><ListChecks size={13} weight="bold" /> Operational tasks</label>
          <div className="space-y-2 mt-1.5" data-testid="os-optasks-list">
            {opTasks.map((t, i) => (
              <div key={t._key || i} className="flex gap-2" data-testid={`os-optask-${i}`}>
                <input data-testid={`os-optask-title-${i}`} className={inp} value={t.title} onChange={(e) => setOpTaskField(i, "title", e.target.value)} placeholder="Task title" />
                <select data-testid={`os-optask-cat-${i}`} className="border border-hairline px-1 py-2 text-xs text-label focus:outline-none w-28 shrink-0 rounded-md" value={t.category} onChange={(e) => setOpTaskField(i, "category", e.target.value)}>
                  {OP_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => removeOpTask(i)} data-testid={`os-optask-remove-${i}`} className="border border-hairline p-2 hover:bg-destructive-tint transition-colors shrink-0 rounded-md"><Trash size={14} weight="bold" /></button>
              </div>
            ))}
          </div>
          <button onClick={addOpTask} data-testid="os-optask-add" className="mt-1.5 flex items-center gap-1 text-sm text-primary-text font-semibold hover:underline"><Plus size={14} weight="bold" /> Add operational task</button>

          <label className="text-label text-text-secondary flex items-center gap-1.5 mt-4"><ShieldCheck size={13} weight="bold" /> Approval rules</label>
          <div className="space-y-2 mt-1.5" data-testid="os-rules-list">
            {approvalRules.map((r, i) => (
              <div key={r._key || i} className="border border-hairline p-2 rounded-md" data-testid={`os-rule-${i}`}>
                <div className="flex gap-2">
                  <input data-testid={`os-rule-name-${i}`} className={inp} value={r.name} onChange={(e) => setRuleField(i, "name", e.target.value)} placeholder="Rule name" />
                  <button onClick={() => removeRule(i)} data-testid={`os-rule-remove-${i}`} className="border border-hairline p-2 hover:bg-destructive-tint transition-colors shrink-0 rounded-md"><Trash size={14} weight="bold" /></button>
                </div>
                <input data-testid={`os-rule-desc-${i}`} className={`${inp} mt-2`} value={r.description} onChange={(e) => setRuleField(i, "description", e.target.value)} placeholder="When does it apply?" />
              </div>
            ))}
          </div>
          <button onClick={addRule} data-testid="os-rule-add" className="mt-1.5 flex items-center gap-1 text-sm text-primary-text font-semibold hover:underline"><Plus size={14} weight="bold" /> Add approval rule</button>

          <button onClick={saveOs} disabled={osBusy} data-testid="os-save-button" className="mt-4 border border-hairline px-4 py-2 text-sm font-semibold hover:bg-surface-hover transition-colors disabled:opacity-50 rounded-md">
            {osBusy ? "Saving…" : "Save operating system"}
          </button>
        </div>
      )}

      {canManage && (
        <div className="mt-6 flex justify-end">
          <button data-testid="company-save-button" onClick={save} disabled={saving}
            className="bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all disabled:opacity-50 rounded-md">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}
