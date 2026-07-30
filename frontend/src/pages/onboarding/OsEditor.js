import { Sparkle, CircleNotch, X, Plus, ArrowLeft, ArrowRight, Kanban, ListChecks, ShieldCheck } from "@phosphor-icons/react";

const inputCls = "w-full border border-hairline bg-surface px-4 py-3 text-sm text-label uppercase focus:outline-none focus:shadow-xs transition-shadow";
const labelCls = "text-label uppercase text-text-secondary";
const OP_CATEGORIES = ["Presentation", "Meeting", "Documentation", "Proposal", "Planning", "Review", "Administration", "Compliance", "Marketing", "HR Activity", "Travel", "Event", "IT Support", "Other"];

export function OsEditor(props) {
  const {
    industryLabel, suggesting,
    roles, removeRole, roleInput, setRoleInput, addRole,
    workflows, removeWorkflow, wfInput, setWfInput, addWorkflow,
    opTasks, updateOpTask, removeOpTask, addOpTask,
    approvalRules, updateRule, removeRule, addRule,
    products, updateProduct, removeProduct, addProduct,
    error, busy, onBack, onProvision,
  } = props;

  return (
    <div className="space-y-5" data-testid="onboarding-step-4">
      <p className="text-sm text-text-secondary flex items-center gap-1.5">
        <Sparkle size={16} weight="fill" className="text-primary-text" /> Your AI-generated operating system for <strong>{industryLabel || "your business"}</strong>. Edit freely.
      </p>
      {suggesting ? (
        <div className="flex items-center gap-2 border border-hairline p-6 justify-center" data-testid="suggest-loading">
          <CircleNotch size={18} className="animate-spin" /> <span className="text-sm font-semibold uppercase tracking-wider">Building your operating system…</span>
        </div>
      ) : (
        <>
          <div>
            <label className={labelCls}>Departments &amp; roles (besides Owner)</label>
            <div className="flex flex-wrap gap-2 mt-2" data-testid="roles-list">
              {roles.map((r) => (
                <span key={r.key} data-testid={`role-chip-${r.key}`} className="inline-flex items-center gap-1.5 border border-hairline bg-surface px-2.5 py-1 text-xs uppercase tracking-wider font-semibold">
                  {r.label}<button onClick={() => removeRole(r.key)} data-testid={`remove-role-${r.key}`} className="hover:text-destructive-text"><X size={12} weight="bold" /></button>
                </span>
              ))}
              {roles.length === 0 && <span className="text-xs text-text-secondary">No departments yet — add some below.</span>}
            </div>
            <div className="flex gap-2 mt-2">
              <input data-testid="role-input" className={inputCls} placeholder="Add a department (e.g. Quality)" value={roleInput} onChange={(e) => setRoleInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }} />
              <button onClick={addRole} data-testid="add-role-button" className="px-4 border border-hairline bg-primary text-primary-foreground hover:shadow-xs transition-all"><Plus size={16} weight="bold" /></button>
            </div>
          </div>

          <div>
            <label className={`${labelCls} flex items-center gap-1.5`}><Kanban size={13} weight="bold" /> Workflows</label>
            <div className="flex flex-wrap gap-2 mt-2" data-testid="workflows-list">
              {workflows.map((w, i) => (
                <span key={w._key || i} data-testid={`workflow-chip-${i}`} className="inline-flex items-center gap-1.5 border border-hairline bg-surface px-2.5 py-1 text-xs font-semibold">
                  {w.name}<button onClick={() => removeWorkflow(i)} data-testid={`remove-workflow-${i}`} className="hover:text-destructive-text"><X size={12} weight="bold" /></button>
                </span>
              ))}
              {workflows.length === 0 && <span className="text-xs text-text-secondary">No workflows yet.</span>}
            </div>
            <div className="flex gap-2 mt-2">
              <input data-testid="workflow-input" className={inputCls} placeholder="Add a workflow (e.g. Dispatch)" value={wfInput} onChange={(e) => setWfInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addWorkflow(); } }} />
              <button onClick={addWorkflow} data-testid="add-workflow-button" className="px-4 border border-hairline bg-primary text-primary-foreground hover:shadow-xs transition-all"><Plus size={16} weight="bold" /></button>
            </div>
          </div>

          <div>
            <label className={`${labelCls} flex items-center gap-1.5`}><ListChecks size={13} weight="bold" /> Operational tasks (starter library)</label>
            <div className="space-y-2 mt-2 max-h-52 overflow-y-auto pr-1" data-testid="optasks-list">
              {opTasks.map((t, i) => (
                <div key={t._key || i} data-testid={`optask-row-${i}`} className="flex gap-2">
                  <input data-testid={`optask-title-${i}`} className="flex-1 border border-hairline px-2 py-1.5 text-sm text-label uppercase focus:outline-none" placeholder="Task title" value={t.title} onChange={(e) => updateOpTask(i, "title", e.target.value)} />
                  <select data-testid={`optask-cat-${i}`} className="border border-hairline px-1 py-1.5 text-xs text-label uppercase focus:outline-none w-28" value={t.category} onChange={(e) => updateOpTask(i, "category", e.target.value)}>
                    {OP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={() => removeOpTask(i)} data-testid={`remove-optask-${i}`} className="px-2 border border-hairline hover:bg-destructive-tint transition-colors"><X size={14} weight="bold" /></button>
                </div>
              ))}
            </div>
            <button onClick={addOpTask} data-testid="add-optask-button" className="mt-2 flex items-center gap-1.5 text-sm text-primary-text font-semibold hover:underline"><Plus size={14} weight="bold" /> Add operational task</button>
          </div>

          <div>
            <label className={`${labelCls} flex items-center gap-1.5`}><ShieldCheck size={13} weight="bold" /> Approval rules</label>
            <div className="space-y-2 mt-2" data-testid="rules-list">
              {approvalRules.map((r, i) => (
                <div key={r._key || i} data-testid={`rule-row-${i}`} className="border border-hairline p-2">
                  <div className="flex gap-2">
                    <input data-testid={`rule-name-${i}`} className="flex-1 border border-hairline px-2 py-1.5 text-sm text-label uppercase focus:outline-none" placeholder="Rule name" value={r.name} onChange={(e) => updateRule(i, "name", e.target.value)} />
                    <button onClick={() => removeRule(i)} data-testid={`remove-rule-${i}`} className="px-2 border border-hairline hover:bg-destructive-tint transition-colors"><X size={14} weight="bold" /></button>
                  </div>
                  <input data-testid={`rule-desc-${i}`} className="w-full border border-hairline px-2 py-1.5 text-xs text-label uppercase mt-2 focus:outline-none" placeholder="When does it apply?" value={r.description} onChange={(e) => updateRule(i, "description", e.target.value)} />
                </div>
              ))}
            </div>
            <button onClick={addRule} data-testid="add-rule-button" className="mt-2 flex items-center gap-1.5 text-sm text-primary-text font-semibold hover:underline"><Plus size={14} weight="bold" /> Add approval rule</button>
          </div>

          <div>
            <label className={labelCls}>Products / Services</label>
            <div className="space-y-2 mt-2" data-testid="products-list">
              {products.map((p, i) => (
                <div key={p._key || i} data-testid={`product-row-${i}`} className="border border-hairline p-2">
                  <div className="flex gap-2">
                    <input data-testid={`product-name-${i}`} className="flex-1 border border-hairline px-2 py-1.5 text-sm text-label uppercase focus:outline-none" placeholder="Name" value={p.name} onChange={(e) => updateProduct(i, "name", e.target.value)} />
                    <button onClick={() => removeProduct(i)} data-testid={`remove-product-${i}`} className="px-2 border border-hairline hover:bg-destructive-tint transition-colors"><X size={14} weight="bold" /></button>
                  </div>
                  <input data-testid={`product-desc-${i}`} className="w-full border border-hairline px-2 py-1.5 text-xs text-label uppercase mt-2 focus:outline-none" placeholder="Short description" value={p.description} onChange={(e) => updateProduct(i, "description", e.target.value)} />
                </div>
              ))}
            </div>
            <button onClick={addProduct} data-testid="add-product-button" className="mt-2 flex items-center gap-1.5 text-sm text-primary-text font-semibold hover:underline"><Plus size={14} weight="bold" /> Add product / service</button>
          </div>
        </>
      )}
      {error && <p data-testid="auth-error" className="text-sm text-primary-text font-semibold">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-3 border border-hairline text-sm font-semibold uppercase tracking-wider hover:bg-surface-hover"><ArrowLeft size={16} weight="bold" /></button>
        <button disabled={busy || suggesting} data-testid="onboarding-create-button" onClick={onProvision} className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold uppercase tracking-wider py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-50">
          {busy ? <><CircleNotch size={16} className="animate-spin" /> Provisioning…</> : <>Provision Operating System <ArrowRight size={16} weight="bold" /></>}
        </button>
      </div>
    </div>
  );
}
