import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
import { FlowArrow, FloppyDisk, Sparkle, Plus, Trash, ArrowUp, ArrowDown, ShieldCheck } from "@phosphor-icons/react";

const inp = "w-full border border-hairline rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40";
const smInp = "border border-hairline rounded-md px-2 py-1.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40";
let _uid = 0;
const uid = () => `k${Date.now()}_${_uid++}`;

function withUids(om) {
  return {
    pipelines: (om.pipelines || []).map((p) => ({
      _uid: uid(), key: p.key || "", label: p.label || "", sub: p.sub || "",
      approval_stage: p.approval_stage || "",
      stages: (p.stages || []).map((s) => ({ _uid: uid(), key: s.key || "", label: s.label || "" })),
    })),
    task_categories: (om.task_categories || []).map((c) => ({ _uid: uid(), key: c.key || "", label: c.label || "" })),
  };
}

export function OperatingModelEditor() {
  const { tenant, refreshTenant } = useAuth();
  const [model, setModel] = useState(() => withUids(opModel(tenant)));
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

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
    pipelines[pi] = { ...pipelines[pi], stages: [...pipelines[pi].stages, { _uid: uid(), key: "", label: "" }] };
    return { ...m, pipelines };
  });
  const delStage = (pi, si) => setModel((m) => {
    const pipelines = [...m.pipelines];
    pipelines[pi] = { ...pipelines[pi], stages: pipelines[pi].stages.filter((_, x) => x !== si) };
    return { ...m, pipelines };
  });
  const addPipeline = () => setModel((m) => ({
    ...m, pipelines: [...m.pipelines, { _uid: uid(), key: "", label: "", sub: "", approval_stage: "", stages: [{ _uid: uid(), key: "", label: "" }] }],
  }));
  const delPipeline = (i) => setModel((m) => ({ ...m, pipelines: m.pipelines.filter((_, x) => x !== i) }));

  const setCat = (i, label) => setModel((m) => {
    const task_categories = [...m.task_categories];
    task_categories[i] = { ...task_categories[i], label };
    return { ...m, task_categories };
  });
  const addCat = () => setModel((m) => ({ ...m, task_categories: [...m.task_categories, { _uid: uid(), key: "", label: "" }] }));
  const delCat = (i) => setModel((m) => ({ ...m, task_categories: m.task_categories.filter((_, x) => x !== i) }));

  const toPayload = () => ({
    pipelines: model.pipelines
      .filter((p) => p.label.trim())
      .map((p) => ({
        key: p.key || undefined, label: p.label.trim(), sub: p.sub.trim(),
        approval_stage: p.approval_stage || null,
        stages: p.stages.filter((s) => s.label.trim()).map((s) => ({ key: s.key || undefined, label: s.label.trim() })),
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
    <div className="rounded-lg border border-hairline bg-surface p-5" data-testid="settings-operating-model-card">
      <div className="flex items-center gap-2 mb-1">
        <FlowArrow size={20} weight="bold" className="text-primary-text" />
        <h2 className="text-lg font-extrabold uppercase tracking-tight">Operating Model</h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        The workflow pipelines and task categories that shape your Workflows board and My Work — tailored to <span className="font-semibold">{tenant?.industry || "your industry"}</span>. Add your own or let AI regenerate them.
      </p>

      <p className="text-label uppercase text-primary-text mb-2">Workflow pipelines</p>
      <div className="space-y-4">
        {model.pipelines.map((p, pi) => (
          <div key={p._uid} className="border border-hairline rounded-lg p-3" data-testid={`op-pipeline-${pi}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input data-testid={`op-pipeline-label-${pi}`} className={inp} placeholder="Pipeline name (e.g. Appointments)" value={p.label} onChange={(e) => setPipeline(pi, { label: e.target.value })} />
                <input data-testid={`op-pipeline-sub-${pi}`} className={inp} placeholder="Subtitle (e.g. Booked → Completed)" value={p.sub} onChange={(e) => setPipeline(pi, { sub: e.target.value })} />
              </div>
              <button onClick={() => delPipeline(pi)} data-testid={`op-pipeline-delete-${pi}`} title="Delete pipeline" className="mt-1 text-text-secondary hover:text-destructive-text transition-colors">
                <Trash size={16} weight="bold" />
              </button>
            </div>

            <div className="mt-3 space-y-1.5">
              <span className="text-label uppercase text-text-secondary">Stages (in order)</span>
              {p.stages.map((s, si) => (
                <div key={s._uid} className="flex items-center gap-1.5" data-testid={`op-stage-${pi}-${si}`}>
                  <input className={`${smInp} flex-1`} placeholder="Stage name" value={s.label} onChange={(e) => setStage(pi, si, { label: e.target.value })} />
                  <button onClick={() => moveStage(pi, si, -1)} disabled={si === 0} title="Move up" className="p-1 disabled:opacity-30 hover:text-primary-text"><ArrowUp size={14} weight="bold" /></button>
                  <button onClick={() => moveStage(pi, si, 1)} disabled={si === p.stages.length - 1} title="Move down" className="p-1 disabled:opacity-30 hover:text-primary-text"><ArrowDown size={14} weight="bold" /></button>
                  <button onClick={() => delStage(pi, si)} title="Delete stage" className="p-1 text-text-secondary hover:text-destructive-text"><Trash size={14} weight="bold" /></button>
                </div>
              ))}
              <button onClick={() => addStage(pi)} data-testid={`op-add-stage-${pi}`} className="flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline mt-1">
                <Plus size={13} weight="bold" /> Add stage
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <ShieldCheck size={14} weight="bold" className="text-text-secondary" />
              <span className="text-label uppercase text-text-secondary">Owner sign-off stage</span>
              <select data-testid={`op-approval-${pi}`} className={smInp} value={p.approval_stage} onChange={(e) => setPipeline(pi, { approval_stage: e.target.value })}>
                <option value="">None</option>
                {p.stages.filter((s) => s.key).map((s) => <option key={s._uid} value={s.key}>{s.label}</option>)}
              </select>
              <span className="text-[11px] text-text-secondary">(only the owner can advance to it)</span>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addPipeline} data-testid="op-add-pipeline" className="flex items-center gap-1 text-sm font-semibold text-primary-text hover:underline mt-3">
        <Plus size={14} weight="bold" /> Add pipeline
      </button>

      <p className="text-label uppercase text-primary-text mt-6 mb-2">Task categories</p>
      <div className="flex flex-wrap gap-2">
        {model.task_categories.map((c, i) => (
          <div key={c._uid} className="flex items-center gap-1 border border-hairline rounded-md pl-2 pr-1 py-1" data-testid={`op-cat-${i}`}>
            <input className="bg-transparent text-sm w-28 focus:outline-none" value={c.label} onChange={(e) => setCat(i, e.target.value)} />
            <button onClick={() => delCat(i)} title="Delete" className="text-text-secondary hover:text-destructive-text"><Trash size={13} weight="bold" /></button>
          </div>
        ))}
        <button onClick={addCat} data-testid="op-add-cat" className="flex items-center gap-1 text-sm font-semibold text-primary-text hover:underline px-2 py-1">
          <Plus size={13} weight="bold" /> Add category
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="op-save"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:shadow-xs transition-all disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Model"}
        </button>
        <button onClick={regenerate} disabled={regen} data-testid="op-regenerate"
          className="flex items-center gap-2 border border-hairline px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:bg-surface-hover transition-all disabled:opacity-60">
          <Sparkle size={16} weight="bold" /> {regen ? "Regenerating…" : "Regenerate with AI"}
        </button>
      </div>
    </div>
  );
}
