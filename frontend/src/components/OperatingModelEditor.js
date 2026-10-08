import { useState } from "react";
import { RegenerateWithAi } from "./RegenerateWithAi";
import { StageWorkReview } from "./StageWorkReview";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
import { FlowArrow, FloppyDisk, Plus, Trash, ArrowUp, ArrowDown, ShieldCheck, ListChecks, Lightning, CaretDown } from "@phosphor-icons/react";
import { GlassSelect } from "./karma/GlassSelect";

// 2026-10-05 — the glass fields every other Settings card uses (were square-bordered).
const inp = "w-full rounded-2xl bg-white/80 px-3 py-2 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
const smInp = "rounded-xl bg-white/80 px-2 py-1.5 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
/* 2026-09-29 — THIS EDITOR WAS UNUSABLE ON A PHONE, and it is the screen that
   decides how work moves: pipelines, stages, task templates, approval gates.
   Measured at 375px, a stage's role picker was cut off by 22px, the evidence
   tick by 37px and every row's delete button by 122px — and the page does not
   scroll sideways, so those were not awkward, they were unreachable. The rows
   were single-line flexes built for a desktop and never given a way to wrap.

   Every row now stacks: the thing you are naming takes a line of its own, and
   the controls that act on it wrap underneath instead of off the edge.

   The pickers were native <select>, 76 of them, which on a phone opens the
   OS wheel and everywhere else in this app is a GlassSelect. They are
   GlassSelect now, wearing the same border as the inputs beside them so the
   row still reads as one form. `variant` is deliberately not "pill": that is
   the 48px pill used on page headers and would tower over these fields. */
const smSel = `${smInp} h-[34px] justify-between text-left`;
/* A tap target, not a 22px pixel-hunt. Sprint 16's rule, applied to the
   controls that were hardest to hit precisely because they were half off the
   screen. */
const iconBtn = "grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-kr-accent disabled:opacity-30";
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
      // Audit B-01 — a team that may sign off itself, up to a value.
      delegate_role: p.approval_delegate?.role || "",
      delegate_up_to: p.approval_delegate?.up_to ?? "",
      // 2026-09-22 — working days of silence before a card here is stuck.
      stuck_after_days: p.stuck_after_days ?? "",
      stages: (p.stages || []).map((s) => ({
        _uid: uid(), key: s.key || "", label: s.label || "",
        // 2026-09-22 — working days this stage should take; its work is
        // dated from it when a card arrives (blank = the default, 3).
        days: s.days ?? "",
        // 2026-09-20 (Settings audit) — the stage's department. Voice capture
        // routes a task to the stage its department owns
        // (services/workflows.py); the editor never loaded or sent it, so
        // every save reset it to the first task's role, or to nothing.
        role: s.role || "",
        tasks: (s.tasks || []).map((t) => ({
          _uid: uid(),
          title: t.title || "",
          role: t.role || "",
          evidence_required: !!t.evidence_required,
        })),
        approval: s.approval ? {
          role: s.approval.role || "",
          required: s.approval.required !== false,
          above: s.approval.above ?? "",          // audit B-03
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
  /* 2026-10-05 — one pipeline open at a time. Every pipeline used to show
     every stage with every field, so on a phone this one card was 8,400px
     (~14 screens) and Task templates / Deadlines sat below all of it. Closed,
     a pipeline is one line that says what it holds. Kept by position, not
     _uid, because a save re-issues the uids. A lone pipeline starts open. */
  const [openPi, setOpenPi] = useState(() => (model.pipelines.length === 1 ? 0 : null));

  // Real role list -- populates every role dropdown in the editor so
  // an owner can't pick a stage-task role that doesn't exist in the
  // tenant's RBAC. Owner is always available regardless of what
  // tenant.roles carries.
  // 2026-09-20 — the pickers show the team's name ("Sales"), not its key.
  const ROLE_OPTS = (() => {
    const out = [{ key: "owner", label: "Owner" }];
    for (const r of (tenant?.roles || [])) {
      if (r?.key && r.key !== "owner") out.push({ key: r.key, label: r.label || r.key });
    }
    return out;
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

  const addPipeline = () => { setOpenPi(model.pipelines.length); setModel((m) => ({
    ...m, pipelines: [...m.pipelines, {
      _uid: uid(), key: "", label: "", sub: "", approval_stage: "",
      stages: [{
        _uid: uid(), key: "", label: "",
        tasks: [], approval: null, side_effects: [],
      }],
    }],
  })); };
  const delPipeline = (i) => {
    setOpenPi((o) => (o === i ? null : o !== null && o > i ? o - 1 : o));
    setModel((m) => ({ ...m, pipelines: m.pipelines.filter((_, x) => x !== i) }));
  };

  // WE-04: payload now carries stage tasks/approval/side_effects. The
  // backend normalize_operating_model (WE-03) validates + caps these,
  // so the frontend just strips empty rows before sending.
  const toPayload = () => ({
    pipelines: model.pipelines
      .filter((p) => p.label.trim())
      .map((p) => ({
        key: p.key || undefined, label: p.label.trim(), sub: p.sub.trim(),
        approval_stage: p.approval_stage || null,
        approval_delegate: p.approval_stage && p.delegate_role && Number(p.delegate_up_to) > 0
          ? { role: p.delegate_role, up_to: Number(p.delegate_up_to) } : null,
        stuck_after_days: p.stuck_after_days === "" ? null : Number(p.stuck_after_days),
        stages: p.stages
          .filter((s) => s.label.trim())
          .map((s) => ({
            key: s.key || undefined,
            label: s.label.trim(),
            role: s.role || "",
            days: s.days === "" ? null : Number(s.days),
            tasks: (s.tasks || [])
              .filter((t) => t.title.trim())
              .map((t) => ({
                title: t.title.trim(),
                role: t.role || "",
                evidence_required: !!t.evidence_required,
              })),
            approval: s.approval && s.approval.role
              ? { role: s.approval.role, required: !!s.approval.required,
                  ...(Number(s.approval.above) > 0 ? { above: Number(s.approval.above) } : {}) }
              : null,
            side_effects: (s.side_effects || [])
              .filter((se) => se.kind)
              .map((se) => ({ kind: se.kind, params: se.params || {} })),
          })),
      })),
    // B-02: categories are no longer edited here; what is stored goes back unchanged.
    task_categories: tenant?.operating_model?.task_categories || [],
  });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch("/tenant/operating-model", { operating_model: toPayload() });
      setModel(withUids(opModel(data)));
      if (refreshTenant) await refreshTenant();
      toast.success("Operating model saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save");
    } finally {
      setSaving(false);
    }
  };
  /* 2026-09-21 — the backfill. The server wrote the work into stages that were
     still empty; mirror exactly those into the editor's own copy rather than
     reloading it, so any unsaved change the owner has made elsewhere here
     survives. A stage the owner filled locally in the meantime keeps theirs. */
  const stageWorkApplied = async (_data, fills) => {
    setModel((m) => ({
      ...m,
      pipelines: m.pipelines.map((p) => ({
        ...p,
        stages: p.stages.map((s) => {
          const f = fills.find((x) => x.pipeline_key === p.key && x.stage_key === s.key);
          if (!f || (s.tasks || []).length) return s;
          return { ...s, tasks: f.tasks.map((t) => ({ _uid: uid(), title: t.title, role: t.role || "", evidence_required: false })) };
        }),
      })),
    }));
    if (refreshTenant) await refreshTenant();
  };

  const regenerate = async () => {
    setRegen(true);
    try {
      const { data } = await api.post("/tenant/operating-model/regenerate");
      setModel(withUids(opModel(data)));
      if (refreshTenant) await refreshTenant();
      toast.success("AI regenerated your operating model");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not regenerate");
    } finally {
      setRegen(false);
    }
  };

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-operating-model-card">
      <div className="flex items-center gap-2 mb-1">
        <FlowArrow size={20} weight="bold" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Operating Model</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The workflow pipelines and task categories that shape your Workflows board and My Work — tailored to <span className="font-semibold">{tenant?.industry || "your industry"}</span>. Each stage owns its task templates + approval gate. Add your own or let AI regenerate.
      </p>

      <StageWorkReview model={model} roleOptions={ROLE_OPTS} onApplied={stageWorkApplied} />

      <p className="label-mono text-muted-foreground mb-2">Workflow pipelines</p>
      <div className="space-y-4">
        {model.pipelines.map((p, pi) => {
          const open = openPi === pi;
          const nTasks = p.stages.reduce((n, s) => n + (s.tasks || []).length, 0);
          return (
          <div key={p._uid} className="rounded-2xl bg-white/60 p-3 ring-1 ring-inset ring-slate-900/[0.06]" data-testid={`op-pipeline-${pi}`}>
            <button type="button" onClick={() => setOpenPi(open ? null : pi)} aria-expanded={open}
              data-testid={`op-pipeline-toggle-${pi}`}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{p.label || "Untitled pipeline"}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {p.stages.length} {p.stages.length === 1 ? "stage" : "stages"}
                  {nTasks > 0 && ` · ${nTasks} ${nTasks === 1 ? "task" : "tasks"}`}
                  {p.stages.some((s) => s.label) && ` · ${p.stages.map((s) => s.label || "…").join(" → ")}`}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-slate-500">{open ? "Close" : "Edit"}</span>
              <CaretDown size={14} weight="bold" className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (<div className="mt-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input data-testid={`op-pipeline-label-${pi}`} className={inp} placeholder="Pipeline name (e.g. Appointments)" value={p.label} onChange={(e) => setPipeline(pi, { label: e.target.value })} />
                <input data-testid={`op-pipeline-sub-${pi}`} className={inp} placeholder="Subtitle (e.g. Booked → Completed)" value={p.sub} onChange={(e) => setPipeline(pi, { sub: e.target.value })} />
              </div>
              <button onClick={() => delPipeline(pi)} data-testid={`op-pipeline-delete-${pi}`} title="Delete pipeline" aria-label="Delete pipeline" className={iconBtn}>
                <Trash size={16} weight="bold" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <span className="label-mono text-muted-foreground">Stages (in order)</span>
              {p.stages.map((s, si) => (
                <div key={s._uid} className="rounded-xl bg-slate-900/[0.03] p-2.5 ring-1 ring-inset ring-slate-900/[0.05]" data-testid={`op-stage-${pi}-${si}`}>
                  {/* The stage's NAME gets the line; the controls that act on
                      it sit underneath. All six of these used to share one
                      row, which is how the role picker and the delete ended
                      up past the right edge of a phone. */}
                  <div className="flex items-center gap-1.5">
                    <input className={`${smInp} min-w-0 flex-1`} placeholder="Stage name" value={s.label} onChange={(e) => setStage(pi, si, { label: e.target.value })} />
                    <button onClick={() => moveStage(pi, si, -1)} disabled={si === 0} title="Move up" aria-label="Move stage up" className={`${iconBtn} hover:text-slate-900`}><ArrowUp size={14} weight="bold" /></button>
                    <button onClick={() => moveStage(pi, si, 1)} disabled={si === p.stages.length - 1} title="Move down" aria-label="Move stage down" className={`${iconBtn} hover:text-slate-900`}><ArrowDown size={14} weight="bold" /></button>
                    <button onClick={() => delStage(pi, si)} title="Delete stage" aria-label="Delete stage" className={iconBtn}><Trash size={14} weight="bold" /></button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                      title="Working days this stage should take. Its work is due that many working days after a card arrives. Blank = 3.">
                      <input data-testid={`op-stage-days-${pi}-${si}`} type="number" min="1" max="60" inputMode="numeric"
                        className={`${smInp} w-14 text-center`} placeholder="3" value={s.days}
                        onChange={(e) => setStage(pi, si, { days: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} />
                      days
                    </label>
                    <GlassSelect testid={`op-stage-role-${pi}-${si}`} variant="field" triggerClassName={`${smSel} min-w-[10rem] flex-1`}
                      value={s.role || ""} onChange={(v) => setStage(pi, si, { role: v })}
                      placeholder="Stage owner (from first task)"
                      ariaLabel="Stage owner: the team whose work this stage is"
                      options={[{ value: "", label: "Stage owner (from first task)" },
                                ...ROLE_OPTS.map((r) => ({ value: r.key, label: r.label }))]} />
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
                        <div key={t._uid} className="space-y-1.5" data-testid={`op-stage-task-${pi}-${si}-${ti}`}>
                          <div className="flex items-center gap-1.5">
                            <input className={`${smInp} min-w-0 flex-1`} placeholder="Task title (e.g. Confirm with customer)" value={t.title} onChange={(e) => setStageTask(pi, si, ti, { title: e.target.value })} />
                            <button onClick={() => delStageTask(pi, si, ti)} title="Delete task" aria-label="Delete task template" className={iconBtn}><Trash size={13} weight="bold" /></button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pl-0.5">
                            <GlassSelect testid={`op-stage-task-role-${pi}-${si}-${ti}`} variant="field"
                              triggerClassName={`${smSel} min-w-[9rem] flex-1`}
                              value={t.role || ""} onChange={(v) => setStageTask(pi, si, ti, { role: v })}
                              placeholder="Unassigned" ariaLabel="Assign this task to a team"
                              options={[{ value: "", label: "Unassigned" },
                                        ...ROLE_OPTS.map((r) => ({ value: r.key, label: r.label }))]} />
                            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title="Require attached evidence to close">
                              <input type="checkbox" className="h-4 w-4" checked={!!t.evidence_required} onChange={(e) => setStageTask(pi, si, ti, { evidence_required: e.target.checked })} />
                              evidence
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => addStageTask(pi, si)} data-testid={`op-add-stage-task-${pi}-${si}`}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-900 hover:underline mt-1.5">
                      <Plus size={11} weight="bold" /> Add task template
                    </button>
                  </div>

                  {/* WE-04: per-stage approval gate */}
                  <div className="mt-2.5 pl-1 flex items-center flex-wrap gap-1.5">
                    <ShieldCheck size={12} weight="bold" className="text-muted-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground">Approval to leave this stage</span>
                    <GlassSelect testid={`op-stage-approval-role-${pi}-${si}`} variant="field"
                      triggerClassName={`${smSel} min-w-[9rem] flex-1`}
                      value={s.approval?.role || ""} onChange={(v) => setStageApproval(pi, si, { role: v })}
                      placeholder="None" ariaLabel="Who signs off before a card leaves this stage"
                      options={[{ value: "", label: "None" },
                                ...ROLE_OPTS.map((r) => ({ value: r.key, label: r.label }))]} />
                    {s.approval?.role && (
                      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title="If off, the gate is recorded but skippable">
                        <input type="checkbox" className="h-4 w-4" checked={s.approval.required !== false}
                          onChange={(e) => setStageApproval(pi, si, { required: e.target.checked })} />
                        required
                      </label>
                    )}
                    {/* Audit B-03 (2026-10-09) — only above a value: a card worth
                        less leaves without the sign-off; one with no value waits. */}
                    {s.approval?.role && (
                      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                        title="Leave empty to need it for every card">
                        only above ₹
                        <input type="number" min="0" inputMode="numeric" data-testid={`op-stage-approval-above-${pi}-${si}`}
                          className="kr-pressed h-8 w-28 rounded-pill px-2.5 text-[11px] text-foreground"
                          placeholder="any value" value={s.approval.above ?? ""}
                          onChange={(e) => setStageApproval(pi, si, { above: e.target.value })} />
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
                            className="inline-flex items-center gap-1 rounded-pill bg-white/80 px-2 py-0.5 text-[11px] ring-1 ring-inset ring-slate-900/[0.06]">
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
              <button onClick={() => addStage(pi)} data-testid={`op-add-stage-${pi}`} className="flex items-center gap-1 text-xs font-semibold text-slate-900 hover:underline mt-1">
                <Plus size={13} weight="bold" /> Add stage
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ShieldCheck size={14} weight="bold" className="shrink-0 text-muted-foreground" />
              <span className="label-mono shrink-0 text-muted-foreground">Owner sign-off stage</span>
              <GlassSelect testid={`op-approval-${pi}`} variant="field" triggerClassName={`${smSel} min-w-[9rem] flex-1`}
                value={p.approval_stage || ""} onChange={(v) => setPipeline(pi, { approval_stage: v })}
                placeholder="None" ariaLabel="Stage only the owner can advance a card to"
                options={[{ value: "", label: "None" },
                          ...p.stages.filter((s) => s.key).map((s) => ({ value: s.key, label: s.label }))]} />
              <span className="text-[11px] text-muted-foreground">(only the owner can advance to it)</span>
            </div>
            {/* Audit B-01 (2026-10-08) — "Sales can confirm orders up to 5 lakh;
                above that, me." One team may move a card into the sign-off
                stage itself while the card's value is within the limit. */}
            {p.approval_stage && (
              <div className="mt-2 flex flex-wrap items-center gap-2" data-testid={`op-delegate-${pi}`}>
                <span className="label-mono shrink-0 text-muted-foreground">Except</span>
                <GlassSelect testid={`op-delegate-role-${pi}`} variant="field" triggerClassName={`${smSel} min-w-[9rem]`}
                  value={p.delegate_role || ""} onChange={(v) => setPipeline(pi, { delegate_role: v })}
                  placeholder="No one" ariaLabel="Team that may sign off itself"
                  options={[{ value: "", label: "No one" },
                            ...ROLE_OPTS.filter((r) => r.key !== "owner").map((r) => ({ value: r.key, label: r.label }))]} />
                {p.delegate_role && (
                  <>
                    <span className="text-[11px] text-muted-foreground">may approve up to</span>
                    <input data-testid={`op-delegate-upto-${pi}`} type="number" min="1" inputMode="numeric"
                      className={`${smInp} w-32`} placeholder="500000" value={p.delegate_up_to}
                      onChange={(e) => setPipeline(pi, { delegate_up_to: e.target.value.replace(/[^0-9.]/g, "") })} />
                    <span className="text-[11px] text-muted-foreground">on the card's value; above that, the owner</span>
                  </>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="label-mono text-muted-foreground">Stuck after</span>
              <input data-testid={`op-stuck-days-${pi}`} type="number" min="1" max="30" inputMode="numeric"
                className={`${smInp} w-14 text-center`} placeholder="3" value={p.stuck_after_days}
                onChange={(e) => setPipeline(pi, { stuck_after_days: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} />
              <span className="text-[11px] text-muted-foreground">working days with no movement — the people on the card and the owner are told</span>
            </div>
            </div>)}
          </div>
          );
        })}
      </div>
      <button onClick={addPipeline} data-testid="op-add-pipeline" className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:underline mt-3">
        <Plus size={14} weight="bold" /> Add pipeline
      </button>

      {/* Audit B-02 (2026-10-08) — no separate "task categories" list here
          any more. A task's department is one of the company's teams, so the
          one list to edit is Team & access; this says where it went. */}
      <p className="mt-6 text-sm text-muted-foreground" data-testid="op-departments-note">
        Task departments are your teams — add or rename them in{" "}
        <a href="/settings?tab=team" className="font-medium text-foreground underline underline-offset-2">Team &amp; access</a>.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="op-save"
          className="flex h-11 items-center gap-2 rounded-pill bg-kr-ink px-5 text-sm font-medium text-white transition-all hover:brightness-125 disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Model"}
        </button>
        <RegenerateWithAi onConfirm={regenerate} busy={regen} testid="op-regenerate"
          replaces="your pipelines, stages, task templates and approval gates" />
      </div>
    </div>
  );
}
