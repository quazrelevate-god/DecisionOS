import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
import { FlowArrow, FloppyDisk, Sparkle, Plus, Trash, ArrowUp, ArrowDown, ShieldCheck, ListChecks, Lightning } from "@phosphor-icons/react";

const inp = "w-full border border-nm-edge/40 rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";
const smInp = "border border-nm-edge/40 rounded-md px-2 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";
let _uid = 0;
const uid = () => `k${Date.now()}_${_uid++}`;

// WE-04 (2026-08-16): withUids now preserves the WE-03 stage extensions
// -- tasks[], approval, side_effects[] -- so the editor can round-trip
// them. Missing/nullish fields default to empty so a legacy tenant that
// pre-dates WE-03 renders as "no templates" instead of crashing on
// stage.tasks.map.
function withUids(om) {
  return {
    pipelines: (om.pipelines || []).map((p) => ({
      _uid: uid(), key: p.key || "", label: p.label || "", sub: p.sub || "",
      approval_stage: p.approval_stage || "",
      stages: (p.stages || []).map((s) => ({
        _uid: uid(), key: s.key || "", label: s.label || "",
        tasks: (s.tasks || []).map((t) => ({
          _uid: uid(),
          title: t.title || "",
          role: t.role || "",
          evidence_required: !!t.evidence_required,
        })),
        approval: s.approval ? {
          role: s.approval.role || "",
          required: s.approval.required !== false,
        } : null,
        side_effects: (s.side_effects || []).map((se) => ({
          _uid: uid(),
          kind: se.kind || "",
          params: se.params || {},
        })),
      })),
    })),
    task_categories: (om.task_categories || []).map((c) => ({ _uid: uid(), key: c.key || "", label: c.label || "" })),
  };
}

export function OperatingModelEditor() {
  const { tenant, refreshTenant } = useAuth();
  const [model, setModel] = useState(() => withUids(opModel(tenant)));
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  // Real role list -- populates every role dropdown in the editor so
  // an owner can't pick a stage-task role that doesn't exist in the
  // tenant's RBAC. Owner is always available regardless of what
  // tenant.roles carries.
  const ROLE_KEYS = (() => {
    const keys = new Set(["owner"]);
    for (const r of (tenant?.roles || [])) {
      if (r?.key) keys.add(r.key);
    }
    return Array.from(keys);
  })();

  const setPipeline = (i, patch) => setModel((m) => {
    const pipelines = [...m.pipelines];
    pipelines[i] = { ...pipelines[i], ...patch };
    return { ...m, pipelines };
  });
  const setStage = (pi, si, patch) => setModel((m) => {
    const pipelines = [...m.pipelines];
    const stages = [...pipelines[pi].stages];
    stages[si] = { ...stages[si], ...patch };
    pipelines[pi] = { ...pipelines[pi], stages };
    return { ...m, pipelines };
  });
  const moveStage = (pi, si, dir) => setModel((m) => {
    const pipelines = [...m.pipelines];
    const stages = [...pipelines[pi].stages];
    const j = si + dir;
    if (j < 0 || j >= stages.length) return m;
    [stages[si], stages[j]] = [stages[j], stages[si]];
    pipelines[pi] = { ...pipelines[pi], stages };
    return { ...m, pipelines };
  });
  const addStage = (pi) => setModel((m) => {
    const pipelines = [...m.pipelines];
    pipelines[pi] = {
      ...pipelines[pi],
      stages: [...pipelines[pi].stages, {
        _uid: uid(), key: "", label: "",
        tasks: [], approval: null, side_effects: [],
      }],
    };
    return { ...m, pipelines };
  });
  const delStage = (pi, si) => setModel((m) => {
    const pipelines = [...m.pipelines];
    pipelines[pi] = { ...pipelines[pi], stages: pipelines[pi].stages.filter((_, x) => x !== si) };
    return { ...m, pipelines };
  });

  // WE-04: per-stage task template helpers.
  const addStageTask = (pi, si) => setStage(pi, si, {
    tasks: [...(model.pipelines[pi].stages[si].tasks || []), {
      _uid: uid(), title: "", role: "", evidence_required: false,
    }],
  });
  const setStageTask = (pi, si, ti, patch) => setModel((m) => {
    const pipelines = [...m.pipelines];
    const stages = [...pipelines[pi].stages];
    const tasks = [...(stages[si].tasks || [])];
    tasks[ti] = { ...tasks[ti], ...patch };
    stages[si] = { ...stages[si], tasks };
    pipelines[pi] = { ...pipelines[pi], stages };
    return { ...m, pipelines };
  });
  const delStageTask = (pi, si, ti) => setModel((m) => {
    const pipelines = [...m.pipelines];
    const stages = [...pipelines[pi].stages];
    stages[si] = {
      ...stages[si],
      tasks: (stages[si].tasks || []).filter((_, x) => x !== ti),
    };
    pipelines[pi] = { ...pipelines[pi], stages };
    return { ...m, pipelines };
  });

  // WE-04: stage-level approval gate (independent of pipeline
  // approval_stage). Setting role to "" clears the whole gate.
  const setStageApproval = (pi, si, patch) => setModel((m) => {
    const pipelines = [...m.pipelines];
    const stages = [...pipelines[pi].stages];
    const cur = stages[si].approval || { role: "", required: true };
    const next = { ...cur, ...patch };
    stages[si] = { ...stages[si], approval: next.role ? next : null };
    pipelines[pi] = { ...pipelines[pi], stages };
    return { ...m, pipelines };
  });

  // WE-04: side-effects are surfaced read-only + deletable in this
  // iteration. Creation UI is deferred -- side-effect handlers are
  // registered by the engine (WE-08) and adding new bindings needs
  // more thought about the param editor for each kind.
  const delSideEffect = (pi, si, ei) => setModel((m) => {
    const pipelines = [...m.pipelines];
    const stages = [...pipelines[pi].stages];
    stages[si] = {
      ...stages[si],
      side_effects: (stages[si].side_effects || []).filter((_, x) => x !== ei),
    };
    pipelines[pi] = { ...pipelines[pi], stages };
    return { ...m, pipelines };
  });

  const addPipeline = () => setModel((m) => ({
    ...m, pipelines: [...m.pipelines, {
      _uid: uid(), key: "", label: "", sub: "", approval_stage: "",
      stages: [{
        _uid: uid(), key: "", label: "",
        tasks: [], approval: null, side_effects: [],
      }],
    }],
  }));
  const delPipeline = (i) => setModel((m) => ({ ...m, pipelines: m.pipelines.filter((_, x) => x !== i) }));

  const setCat = (i, label) => setModel((m) => {
    const task_categories = [...m.task_categories];
    task_categories[i] = { ...task_categories[i], label };
    return { ...m, task_categories };
  });
  const addCat = () => setModel((m) => ({ ...m, task_categories: [...m.task_categories, { _uid: uid(), key: "", label: "" }] }));
  const delCat = (i) => setModel((m) => ({ ...m, task_categories: m.task_categories.filter((_, x) => x !== i) }));

  // WE-04: payload now carries stage tasks/approval/side_effects. The
  // backend normalize_operating_model (WE-03) validates + caps these,
  // so the frontend just strips empty rows before sending.
  const toPayload = () => ({
    pipelines: model.pipelines
      .filter((p) => p.label.trim())
      .map((p) => ({
        key: p.key || undefined, label: p.label.trim(), sub: p.sub.trim(),
        approval_stage: p.approval_stage || null,
        stages: p.stages
          .filter((s) => s.label.trim())
          .map((s) => ({
            key: s.key || undefined,
            label: s.label.trim(),
            tasks: (s.tasks || [])
              .filter((t) => t.title.trim())
              .map((t) => ({
                title: t.title.trim(),
                role: t.role || "",
                evidence_required: !!t.evidence_required,
              })),
            approval: s.approval && s.approval.role
              ? { role: s.approval.role, required: !!s.approval.required }
              : null,
            side_effects: (s.side_effects || [])
              .filter((se) => se.kind)
              .map((se) => ({ kind: se.kind, params: se.params || {} })),
          })),
      })),
    task_categories: model.task_categories.filter((c) => c.label.trim()).map((c) => ({ key: c.key || undefined, label: c.label.trim() })),
  });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch("/tenant/operating-model", { operating_model: toPayload() });
      setModel(withUids(opModel(data)));
      if (refreshTenant) await refreshTenant();
      toast.success("Operating model saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };
  const regenerate = async () => {
    setRegen(true);
    try {
      const { data } = await api.post("/tenant/operating-model/regenerate");
      setModel(withUids(opModel(data)));
      if (refreshTenant) await refreshTenant();
      toast.success("AI regenerated your operating model");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not regenerate");
    } finally {
      setRegen(false);
    }
  };

  return (
    <div className="nm-tile p-5" data-testid="settings-operating-model-card">
      <div className="flex items-center gap-2 mb-1">
        <FlowArrow size={20} weight="bold" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Operating Model</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The workflow pipelines and task categories that shape your Workflows board and My Work — tailored to <span className="font-semibold">{tenant?.industry || "your industry"}</span>. Each stage owns its task templates + approval gate. Add your own or let AI regenerate.
      </p>

      <p className="label-mono text-muted-foreground mb-2">Workflow pipelines</p>
      <div className="space-y-4">
        {model.pipelines.map((p, pi) => (
          <div key={p._uid} className="border border-nm-edge/40 rounded-lg p-3" data-testid={`op-pipeline-${pi}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input data-testid={`op-pipeline-label-${pi}`} className={inp} placeholder="Pipeline name (e.g. Appointments)" value={p.label} onChange={(e) => setPipeline(pi, { label: e.target.value })} />
                <input data-testid={`op-pipeline-sub-${pi}`} className={inp} placeholder="Subtitle (e.g. Booked → Completed)" value={p.sub} onChange={(e) => setPipeline(pi, { sub: e.target.value })} />
              </div>
              <button onClick={() => delPipeline(pi)} data-testid={`op-pipeline-delete-${pi}`} title="Delete pipeline" className="mt-1 text-muted-foreground hover:text-kr-accent transition-colors">
                <Trash size={16} weight="bold" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <span className="label-mono text-muted-foreground">Stages (in order)</span>
              {p.stages.map((s, si) => (
                <div key={s._uid} className="border border-nm-edge/60 rounded-md p-2.5 bg-accent/30" data-testid={`op-stage-${pi}-${si}`}>
                  {/* Stage name row + reorder + delete */}
                  <div className="flex items-center gap-1.5">
                    <input className={`${smInp} flex-1`} placeholder="Stage name" value={s.label} onChange={(e) => setStage(pi, si, { label: e.target.value })} />
                    <button onClick={() => moveStage(pi, si, -1)} disabled={si === 0} title="Move up" className="p-1 disabled:opacity-30 hover:text-brand-blue"><ArrowUp size={14} weight="bold" /></button>
                    <button onClick={() => moveStage(pi, si, 1)} disabled={si === p.stages.length - 1} title="Move down" className="p-1 disabled:opacity-30 hover:text-brand-blue"><ArrowDown size={14} weight="bold" /></button>
                    <button onClick={() => delStage(pi, si)} title="Delete stage" className="p-1 text-muted-foreground hover:text-kr-accent"><Trash size={14} weight="bold" /></button>
                  </div>

                  {/* WE-04: task templates that spawn when this stage starts */}
                  <div className="mt-2.5 pl-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <ListChecks size={12} weight="bold" className="text-muted-foreground" />
                      <span className="text-[11px] font-medium text-muted-foreground">Tasks that fire on entry</span>
                    </div>
                    {(s.tasks || []).length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic pl-4">None. Card just sits at this stage until manually advanced.</p>
                    )}
                    <div className="space-y-1.5">
                      {(s.tasks || []).map((t, ti) => (
                        <div key={t._uid} className="flex items-center gap-1.5" data-testid={`op-stage-task-${pi}-${si}-${ti}`}>
                          <input className={`${smInp} flex-1`} placeholder="Task title (e.g. Confirm with customer)" value={t.title} onChange={(e) => setStageTask(pi, si, ti, { title: e.target.value })} />
                          <select className={smInp} value={t.role} onChange={(e) => setStageTask(pi, si, ti, { role: e.target.value })} title="Assign to role">
                            <option value="">Unassigned</option>
                            {ROLE_KEYS.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap" title="Require attached evidence to close">
                            <input type="checkbox" checked={!!t.evidence_required} onChange={(e) => setStageTask(pi, si, ti, { evidence_required: e.target.checked })} />
                            evidence
                          </label>
                          <button onClick={() => delStageTask(pi, si, ti)} title="Delete task" className="p-1 text-muted-foreground hover:text-kr-accent"><Trash size={12} weight="bold" /></button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => addStageTask(pi, si)} data-testid={`op-add-stage-task-${pi}-${si}`}
                      className="flex items-center gap-1 text-[11px] font-semibold text-brand-blue hover:underline mt-1.5">
                      <Plus size={11} weight="bold" /> Add task template
                    </button>
                  </div>

                  {/* WE-04: per-stage approval gate */}
                  <div className="mt-2.5 pl-1 flex items-center flex-wrap gap-1.5">
                    <ShieldCheck size={12} weight="bold" className="text-muted-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground">Approval to leave this stage</span>
                    <select data-testid={`op-stage-approval-role-${pi}-${si}`} className={smInp}
                      value={s.approval?.role || ""}
                      onChange={(e) => setStageApproval(pi, si, { role: e.target.value })}>
                      <option value="">None</option>
                      {ROLE_KEYS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {s.approval?.role && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap" title="If off, the gate is recorded but skippable">
                        <input type="checkbox" checked={s.approval.required !== false}
                          onChange={(e) => setStageApproval(pi, si, { required: e.target.checked })} />
                        required
                      </label>
                    )}
                  </div>

                  {/* WE-04: side-effects (read-only chips + delete) */}
                  {(s.side_effects || []).length > 0 && (
                    <div className="mt-2.5 pl-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Lightning size={12} weight="bold" className="text-muted-foreground" />
                        <span className="text-[11px] font-medium text-muted-foreground">Fires on entry</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {s.side_effects.map((se, ei) => (
                          <span key={se._uid} data-testid={`op-stage-side-effect-${pi}-${si}-${ei}`}
                            className="inline-flex items-center gap-1 border border-nm-edge/40 rounded-md px-2 py-0.5 text-[11px] font-mono bg-card">
                            {se.kind}
                            <button onClick={() => delSideEffect(pi, si, ei)} title="Remove" className="text-muted-foreground hover:text-kr-accent">
                              <Trash size={10} weight="bold" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => addStage(pi)} data-testid={`op-add-stage-${pi}`} className="flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline mt-1">
                <Plus size={13} weight="bold" /> Add stage
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <ShieldCheck size={14} weight="bold" className="text-muted-foreground" />
              <span className="label-mono text-muted-foreground">Owner sign-off stage</span>
              <select data-testid={`op-approval-${pi}`} className={smInp} value={p.approval_stage} onChange={(e) => setPipeline(pi, { approval_stage: e.target.value })}>
                <option value="">None</option>
                {p.stages.filter((s) => s.key).map((s) => <option key={s._uid} value={s.key}>{s.label}</option>)}
              </select>
              <span className="text-[11px] text-muted-foreground">(only the owner can advance to it)</span>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addPipeline} data-testid="op-add-pipeline" className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:underline mt-3">
        <Plus size={14} weight="bold" /> Add pipeline
      </button>

      <p className="label-mono text-muted-foreground mt-6 mb-2">Task categories</p>
      <div className="flex flex-wrap gap-2">
        {model.task_categories.map((c, i) => (
          <div key={c._uid} className="flex items-center gap-1 border border-nm-edge/40 rounded-md pl-2 pr-1 py-1" data-testid={`op-cat-${i}`}>
            <input className="bg-transparent text-sm w-28 focus:outline-none" value={c.label} onChange={(e) => setCat(i, e.target.value)} />
            <button onClick={() => delCat(i)} title="Delete" className="text-muted-foreground hover:text-kr-accent"><Trash size={13} weight="bold" /></button>
          </div>
        ))}
        <button onClick={addCat} data-testid="op-add-cat" className="flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline px-2 py-1">
          <Plus size={13} weight="bold" /> Add category
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="op-save"
          className="flex items-center gap-2 bg-kr-ink text-white px-5 py-2 text-sm font-medium rounded-lg transition-all disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Model"}
        </button>
        <button onClick={regenerate} disabled={regen} data-testid="op-regenerate"
          className="flex items-center gap-2 border border-nm-edge/40 px-5 py-2 text-sm font-medium rounded-lg hover:bg-accent transition-all disabled:opacity-60">
          <Sparkle size={16} weight="bold" /> {regen ? "Regenerating…" : "Regenerate with AI"}
        </button>
      </div>
    </div>
  );
}
