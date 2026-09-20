import { useState, useEffect, useRef } from "react";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm, PERMISSIONS, defaultPermsForRole } from "../lib/perms";
import { toast } from "sonner";
import { Buildings, Package, Plus, Trash, UsersThree, Kanban, ListChecks, ShieldCheck, Copy, WhatsappLogo, Check } from "@phosphor-icons/react";
import { GlassSelect } from "./karma/GlassSelect";

// Mobile PWA (2026-09-14) — the glass field (glass.js DRAWER_FIELD), not a
// square monospace box: Settings' company form was the last form on the old
// input, and on a phone it read as a different app.
const inp = "w-full rounded-2xl bg-white/80 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-900/[0.06] shadow-[inset_0_1px_2px_hsl(216_30%_25%/0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:bg-muted disabled:text-muted-foreground";
const uid = () => Math.random().toString(36).slice(2, 9);
const FIELDS = [
  { key: "name", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "company_size", label: "Team size" },
  { key: "phone", label: "Company mobile" },
  // 2026-09-20 — where support and receipts for THIS company go. Not a sign-in:
  // a founder running two companies may use one address for both.
  { key: "support_email", label: "Company email (support & receipts)" },
  { key: "region", label: "Region" },
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
  // 2026-09-15 — the owner sets what each role can open (Access under a role).
  const isOwner = user?.role === "owner";
  const [openRole, setOpenRole] = useState(null);
  const [members, setMembers] = useState([]);
  const loadMembers = () => api.get("/users").then((r) => setMembers(r.data || [])).catch(() => {});
  useEffect(() => { if (isOwner) loadMembers(); }, [isOwner]); // eslint-disable-line react-hooks/exhaustive-deps
  // WE-02 (2026-08-16): workflows state removed. Pipeline editing lives
  // in the Operating Model editor (single source of truth).
  const [opTasks, setOpTasks] = useState([]);
  const [osBusy, setOsBusy] = useState(false);

  // 2026-09-20 (Settings audit) — this card has three saves (company details,
  // task templates, teams/access), and each one reloads the tenant. The effect
  // below used to rebuild EVERY section on each reload, so saving a team wiped
  // unsaved company details and the other way round. A section is now re-read
  // from the tenant only while it holds no unsaved edits.
  const dirty = useRef({ company: false, os: false });
  useEffect(() => {
    if (!tenant) return;
    if (!dirty.current.company) {
      setForm({
        name: tenant.name || "", industry: tenant.industry || "", company_size: tenant.company_size || "",
        phone: tenant.phone || "", region: tenant.region || "", gst: tenant.gst || "",
        support_email: tenant.support_email || "", branches: tenant.branches || "",
      });
      setProducts((tenant.products || []).map((p) => ({ name: p.name || "", description: p.description || "", _key: uid() })));
    }
    setRoles((tenant.roles || []).map((r) => ({ ...r })));
    // WE-02: setWorkflows removed.
    if (!dirty.current.os) {
      setOpTasks((tenant.operational_task_templates || []).map((t) => ({ title: t.title || "", category: t.category || "Other", _key: uid() })));
    }
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
      toast.success(`Team "${label}" added`);
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
      toast.success("Team renamed");
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
      toast.success("Team deleted");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't delete role");
    } finally { setRoleBusy(false); }
  };

  const touch = (section) => { dirty.current[section] = true; };
  const setField = (k, v) => { touch("company"); setForm((f) => ({ ...f, [k]: v })); };
  const addProduct = () => { touch("company"); setProducts((p) => [...p, { name: "", description: "", _key: uid() }]); };
  const setProduct = (i, k, v) => { touch("company"); setProducts((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it))); };
  const removeProduct = (i) => { touch("company"); setProducts((p) => p.filter((_, idx) => idx !== i)); };

  // WE-02: addWorkflow/setWorkflow/removeWorkflow removed.
  const addOpTask = () => { touch("os"); setOpTasks((t) => [...t, { title: "", category: "Other", _key: uid() }]); };
  const setOpTaskField = (i, k, v) => { touch("os"); setOpTasks((t) => t.map((it, idx) => (idx === i ? { ...it, [k]: v } : it))); };
  const removeOpTask = (i) => { touch("os"); setOpTasks((t) => t.filter((_, idx) => idx !== i)); };

  const saveOs = async () => {
    setOsBusy(true);
    try {
      await api.patch("/tenant/os-blueprint", {
        // WE-02: workflow_templates key removed (backend Pydantic
        // input no longer defines it; extra fields are silently
        // dropped on the server side).
        // RBAC P1 (2026-09-15): free-text approval rules removed — nothing
        // enforced them. Approvals live on each task and on workflow stages.
        operational_task_templates: opTasks.filter((t) => t.title.trim()),
      });
      dirty.current.os = false;
      await refreshTenant();
      toast.success("Operating system updated");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Update failed");
    } finally { setOsBusy(false); }
  };

  const save = async () => {
    if (!form.name?.trim()) return toast.error("Company name is required");
    // A product with a description but no name used to vanish on save,
    // description and all. Say so instead.
    if (products.some((p) => !p.name.trim() && p.description.trim())) {
      return toast.error("Give every product a name, or remove the empty row");
    }
    setSaving(true);
    try {
      await api.patch("/tenant", {
        ...form,
        products: products.filter((p) => p.name.trim()).map(({ _key, ...r }) => r),
      });
      dirty.current.company = false;
      await refreshTenant();
      toast.success("Company details updated");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="nm-tile p-5" data-testid="settings-company-card">
      <div className="flex items-center gap-2 mb-1">
        <Buildings size={20} weight="bold" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Company Details</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Update your company profile, products, and team roles.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === "name" ? "sm:col-span-2" : ""}>
            <label className="label-mono text-muted-foreground">{f.label}</label>
            <input data-testid={`company-field-${f.key}`} className={`${inp} mt-1`} value={form[f.key] || ""}
              disabled={!canManage} onChange={(e) => setField(f.key, e.target.value)} placeholder={canManage ? f.label : "—"} />
          </div>
        ))}
      </div>

      {canManage && tenant?.id && (
        <div className="mt-4 border border-nm-edge/40 bg-brand-paper p-3" data-testid="workspace-id-block">
          {/* U7-11.1 (2026-08-17): rewrote the copy around the workspace
              ID. Was leaking dev-facing language ("WA_TENANT_ID env
              variable") into an owner-facing screen. Owners don't set
              env vars; they hand this code to their WhatsApp integrator
              or support. New copy: what it is, when to share it, who
              needs it. */}
          <label className="label-mono text-muted-foreground flex items-center gap-1.5">
            <WhatsappLogo size={13} weight="bold" className="text-green-600" /> WhatsApp workspace code
          </label>
          <div className="flex gap-2 mt-1.5">
            <input data-testid="workspace-id-value" readOnly value={tenant.id} className={`${inp} bg-white cursor-text`} onFocus={(e) => e.target.select()} />
            <button data-testid="workspace-id-copy"
              onClick={() => { navigator.clipboard?.writeText(tenant.id); toast.success("Workspace code copied"); }}
              className="flex items-center gap-1 border border-nm-edge/40 px-3 text-sm font-semibold uppercase hover:bg-accent transition-colors shrink-0">
              <Copy size={14} weight="bold" /> Copy
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Share this with your WhatsApp integrator or support so messages from unknown numbers land in this workspace. You don&rsquo;t need to touch it day-to-day.
          </p>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Package size={18} weight="bold" className="text-brand-blue" />
            <h3 className="font-medium">Products & Services</h3>
          </div>
          {canManage && (
            <button onClick={addProduct} data-testid="company-add-product"
              className="flex items-center gap-1 text-xs  border border-nm-edge/40 px-2 py-1 hover:bg-accent transition-colors">
              <Plus size={12} weight="bold" /> Add
            </button>
          )}
        </div>

        {products.length === 0 && <p className="text-sm text-muted-foreground">No products or services yet.</p>}
        <div className="space-y-2">
          {products.map((p, i) => (
            <div key={p._key || i} data-testid={`company-product-${i}`} className="border border-nm-edge/40 p-3 flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <input data-testid={`company-product-name-${i}`} className={inp} value={p.name} disabled={!canManage}
                  onChange={(e) => setProduct(i, "name", e.target.value)} placeholder="Name" />
                <input data-testid={`company-product-desc-${i}`} className={inp} value={p.description} disabled={!canManage}
                  onChange={(e) => setProduct(i, "description", e.target.value)} placeholder="Short description" />
              </div>
              {canManage && (
                <button onClick={() => removeProduct(i)} data-testid={`company-product-remove-${i}`}
                  className="border border-nm-edge/40 p-2 hover:bg-kr-accent hover:text-white transition-colors" title="Remove">
                  <Trash size={14} weight="bold" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-1">
          <UsersThree size={18} weight="bold" className="text-muted-foreground" />
          {/* RBAC P2 (2026-09-16): one name — "Team" — everywhere on screen. */}
          <h3 className="font-medium">Teams</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Owner is always present. {isOwner ? "Access sets what people in a team can open. " : ""}A team can't be deleted while people are still in it — move them first. Currency is set in the Money tab.
        </p>
        <div className="space-y-2" data-testid="roles-manage-list">
          {roles.map((r) => (
            <div key={r.key} data-testid={`role-row-${r.key}`} className="border border-nm-edge/40 p-2">
              <div className="flex items-center gap-2">
                <input data-testid={`role-label-${r.key}`} className={inp} value={r.label} disabled={!canManage || roleBusy}
                  onChange={(e) => setRoleLabel(r.key, e.target.value)}
                  onBlur={(e) => canManage && renameRole(r.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }}
                  placeholder="Team name" />
                <span className="label-mono text-muted-foreground shrink-0 hidden sm:inline">{r.key}</span>
                {isOwner && (
                  <button type="button" onClick={() => setOpenRole(openRole === r.key ? null : r.key)} aria-expanded={openRole === r.key}
                    data-testid={`role-access-toggle-${r.key}`}
                    className="flex items-center gap-1 border border-nm-edge/40 px-2.5 py-2 text-xs font-medium hover:bg-accent transition-colors shrink-0">
                    <ShieldCheck size={13} weight="bold" aria-hidden="true" /> Access
                  </button>
                )}
                {canManage && (
                  <button onClick={() => deleteRole(r.key)} disabled={roleBusy} data-testid={`role-delete-${r.key}`}
                    className="border border-nm-edge/40 p-2 hover:bg-kr-accent hover:text-white transition-colors shrink-0" title="Delete role">
                    <Trash size={14} weight="bold" />
                  </button>
                )}
              </div>
              {isOwner && openRole === r.key && (() => {
                const saved = (tenant?.roles || []).find((x) => x.key === r.key) || r;
                return <RoleAccessEditor key={JSON.stringify(saved.permissions || [])} role={saved} members={members} onSaved={loadMembers} />;
              })()}
            </div>
          ))}
          {roles.length === 0 && <p className="text-sm text-muted-foreground">No roles yet — add one below.</p>}
        </div>
        {canManage && (
          <div className="flex gap-2 mt-2">
            <input data-testid="role-add-input" className={inp} value={roleInput} disabled={roleBusy}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }}
              placeholder="Add a team (e.g. Marketing)" />
            <button onClick={addRole} disabled={roleBusy || !roleInput.trim()} data-testid="role-add-button"
              className="flex items-center gap-1 border border-nm-edge/40 px-3 text-sm font-semibold uppercase hover:bg-accent transition-colors disabled:opacity-50">
              <Plus size={14} weight="bold" /> Add
            </button>
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-6 border-t border-nm-edge/40 pt-4" data-testid="os-blueprint-section">
          <div className="flex items-center gap-2 mb-1">
            <Kanban size={18} weight="bold" className="text-muted-foreground" />
            {/* U7-11.1 (2026-08-17): renamed from "Operating System" to
                "Rules & templates". The old name collided with the
                OPERATIONS tab (which owns the real Operating Model
                editor -- pipelines / stages / per-stage approvals),
                so owners had two things called "Operating..." doing
                different things. This section owns free-standing
                task templates + org-wide approval rules; the new
                name says that. */}
            <h3 className="font-medium">Task templates</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Free-standing task templates. Approvals are set on each task (before work starts, or before it&rsquo;s marked done) and on workflow stages in the Operations tab.</p>

          {/* WE-02 (2026-08-16): "Workflows" list removed from this
              card. It was a free-text brainstorm list that never drove
              any behaviour -- the actual pipelines are edited in the
              Operating Model editor and lived on tenant.operating_model
              all along. Kept the section header + Operational tasks +
              Approval rules editors below because those ARE alive. */}

          <label className="label-mono text-muted-foreground flex items-center gap-1.5"><ListChecks size={13} weight="bold" /> Operational tasks</label>
          <div className="space-y-2 mt-1.5" data-testid="os-optasks-list">
            {opTasks.map((t, i) => (
              <div key={t._key || i} className="flex gap-2" data-testid={`os-optask-${i}`}>
                <input data-testid={`os-optask-title-${i}`} className={inp} value={t.title} onChange={(e) => setOpTaskField(i, "title", e.target.value)} placeholder="Task title" />
                {/* Our own dropdown, never the operating system's list. */}
                <div className="w-32 shrink-0">
                  <GlassSelect variant="field" testid={`os-optask-cat-${i}`} ariaLabel="Task category" align="end"
                    value={t.category} onChange={(v) => setOpTaskField(i, "category", v)}
                    options={OP_CATS.map((c) => ({ value: c, label: c }))}
                    triggerClassName="h-full min-h-10 rounded-xl bg-white/80 px-3 text-xs capitalize ring-1 ring-inset ring-slate-900/[0.06]" />
                </div>
                <button type="button" onClick={() => removeOpTask(i)} data-testid={`os-optask-remove-${i}`} aria-label="Remove task"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/80 text-slate-600 ring-1 ring-inset ring-slate-900/[0.06] transition-colors hover:bg-rose-50 hover:text-rose-600"><Trash size={14} weight="bold" aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          <button onClick={addOpTask} data-testid="os-optask-add" className="mt-1.5 flex items-center gap-1 text-sm text-brand-blue font-semibold hover:underline"><Plus size={14} weight="bold" /> Add operational task</button>


          {/* U7-11.1: label the two SAVE buttons on this card by scope
              so owners know which changes each one commits. Was
              "Save operating system" + "Save changes" -- both vague. */}
          <button onClick={saveOs} disabled={osBusy} data-testid="os-save-button" className="mt-4 border border-nm-edge/40 px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50">
            {osBusy ? "Saving…" : "Save task templates"}
          </button>
        </div>
      )}

      {canManage && (
        <div className="mt-6 flex justify-end">
          <button data-testid="company-save-button" onClick={save} disabled={saving}
            className="bg-kr-ink text-white px-5 py-2 text-sm font-medium border border-nm-edge/40 transition-all disabled:opacity-50">
            {saving ? "Saving…" : "Save company details"}
          </button>
        </div>
      )}
    </div>
  );
}

/* 2026-09-15 — what a role can open. People in the role get this unless they
   have their own access list (Team › Edit access, "Use the role's access"
   unticked); the owner can make those people follow the role too. */
function RoleAccessEditor({ role, members, onSaved }) {
  const { refreshTenant } = useAuth();
  const custom = Array.isArray(role.permissions) && role.permissions.length > 0;
  const [draft, setDraft] = useState(custom ? role.permissions : defaultPermsForRole(role.key));
  const [applyAll, setApplyAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const inRole = members.filter((m) => m.role === role.key);
  const ownAccess = inRole.filter((m) => Array.isArray(m.permissions) && m.permissions.length > 0);
  const toggle = (k) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));

  const save = async (perms) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/tenant/roles/${role.key}/permissions`, { permissions: perms, apply_to_members: applyAll });
      await refreshTenant();
      const n = data?.members_updated || 0;
      toast.success(`Access for ${role.label} saved${n ? ` — ${n} ${n === 1 ? "person now follows" : "people now follow"} it` : ""}`);
      setApplyAll(false);
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't save access");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 rounded-2xl bg-white/60 p-3 ring-1 ring-inset ring-slate-900/[0.06]" data-testid={`role-access-${role.key}`}>
      <p className="text-xs text-muted-foreground">
        {inRole.length} {inRole.length === 1 ? "person" : "people"} in this team · {custom ? "custom access" : "built-in default"} · owners always have everything
      </p>
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {PERMISSIONS.map((p) => {
          const on = draft.includes(p.key);
          return (
            <button key={p.key} type="button" aria-pressed={on} onClick={() => toggle(p.key)} disabled={busy}
              data-testid={`role-perm-${role.key}-${p.key}`}
              className={`flex min-h-10 items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-xs font-medium ring-1 ring-inset transition-colors ${on ? "bg-neutral-900 text-white ring-transparent" : "bg-white/80 text-slate-700 ring-slate-900/[0.06] hover:bg-white"}`}>
              <span>{p.label}</span>
              {on && <Check size={12} weight="bold" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {ownAccess.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="mt-0.5 accent-neutral-900"
            data-testid={`role-apply-all-${role.key}`} />
          <span>
            Also make {ownAccess.length === 1 ? `${ownAccess[0].name}, who has their own access,` : `the ${ownAccess.length} people who have their own access`} follow this team
          </span>
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => save(draft)} disabled={busy} data-testid={`role-access-save-${role.key}`}
          className="bg-kr-ink px-4 py-2 text-xs font-medium text-white transition-all disabled:opacity-50">
          {busy ? "Saving…" : "Save access"}
        </button>
        {custom && (
          <button type="button" onClick={() => save([])} disabled={busy} data-testid={`role-access-default-${role.key}`}
            className="border border-nm-edge/40 px-4 py-2 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
            Use the built-in default
          </button>
        )}
      </div>
    </div>
  );
}
