/* Filling in the work for stages that have none — the owner's review.
 *
 * 2026-09-21. Companies set up before the operating-model prompt asked for it
 * have stages that carry NO work, so a card reaching one tells nobody to do
 * anything. This asks the AI for the work of every EMPTY stage and shows it
 * here, stage by stage, before anything is saved: the owner keeps, edits or
 * drops each line. Saving writes only into stages that are still empty
 * (services/ai/stage_work.py) — and only for cards that reach a stage from now
 * on; nothing lands on cards already sitting on one.
 *
 * Why a review and not a silent migration: from the moment this is saved, the
 * company's staff start being assigned work automatically. That is the
 * owner's decision to make, with the words in front of them.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkle, Plus, Trash, CircleNotch } from "@phosphor-icons/react";
import api, { formatApiError } from "../lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";

const field = "w-full rounded-md border border-nm-edge/40 bg-card px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40";

/** Stages in the editor's current model that carry no work — not counting
 *  each pipeline's LAST stage. That one is usually a resting state (Paid,
 *  Delivered, Cleared) that rightly has nothing to do, and counting it kept the
 *  banner up forever on a company whose every working stage was filled. */
export function countEmptyStages(model) {
  return (model?.pipelines || []).reduce((n, p) => {
    const working = (p.stages || []).slice(0, -1);
    return n + working.filter((s) => s.key && !(s.tasks || []).length).length;
  }, 0);
}

export function StageWorkReview({ model, roleOptions = [], onApplied }) {
  const empty = useMemo(() => countEmptyStages(model), [model]);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);   // [{pipeline_key, pipeline_label, stage_key, stage_label, role, keep, tasks:[{title, role}]}]

  if (!empty) return null;

  const ask = async () => {
    setAsking(true);
    try {
      const { data } = await api.post("/tenant/operating-model/stage-work/suggest");
      const got = (data.suggestions || []).map((s) => ({
        ...s, keep: (s.tasks || []).length > 0,
        tasks: (s.tasks || []).map((t) => ({ title: t.title, role: t.role || "" })),
      }));
      if (!got.length) { toast.info("Every stage already has its work."); return; }
      setRows(got);
      setOpen(true);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not get suggestions");
    } finally {
      setAsking(false);
    }
  };

  const setRow = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setTask = (i, ti, patch) => setRows((r) => r.map((x, j) => (j !== i ? x : {
    ...x, tasks: x.tasks.map((t, k) => (k === ti ? { ...t, ...patch } : t)),
  })));
  const dropTask = (i, ti) => setRows((r) => r.map((x, j) => (j !== i ? x : {
    ...x, tasks: x.tasks.filter((_, k) => k !== ti),
  })));
  const addTask = (i) => setRows((r) => r.map((x, j) => (j !== i ? x : {
    ...x, keep: true, tasks: [...x.tasks, { title: "", role: x.role || "" }],
  })));

  const kept = rows.filter((r) => r.keep && r.tasks.some((t) => t.title.trim()));

  const save = async () => {
    setSaving(true);
    try {
      const fills = kept.map((r) => ({
        pipeline_key: r.pipeline_key, stage_key: r.stage_key,
        tasks: r.tasks.filter((t) => t.title.trim()).map((t) => ({ title: t.title.trim(), role: t.role || "" })),
      }));
      const { data } = await api.post("/tenant/operating-model/stage-work", { fills });
      const filled = data?.stage_work?.filled || [];
      const skipped = data?.stage_work?.skipped || [];
      toast.success(`Added work to ${filled.length} stage${filled.length === 1 ? "" : "s"}`);
      if (skipped.length) {
        toast.info(`${skipped.length} left as they were: ${skipped.map((s) => s.reason).join(", ")}`);
      }
      onApplied?.(data, fills.filter((f) => filled.some((x) => x.pipeline_key === f.pipeline_key && x.stage_key === f.stage_key)));
      setOpen(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  // Group rows by pipeline for display, keeping each row's index for edits.
  const groups = [];
  rows.forEach((r, i) => {
    let g = groups.find((x) => x.key === r.pipeline_key);
    if (!g) { g = { key: r.pipeline_key, label: r.pipeline_label, items: [] }; groups.push(g); }
    g.items.push({ r, i });
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5"
        data-testid="stage-work-banner">
        <p className="min-w-0 flex-1 text-xs text-amber-900">
          <span className="font-semibold">{empty} stage{empty === 1 ? " has" : "s have"} no work.</span>{" "}
          A card that reaches {empty === 1 ? "it" : "one of them"} tells nobody to do anything.
        </p>
        <button type="button" onClick={ask} disabled={asking} data-testid="stage-work-suggest"
          className="inline-flex items-center gap-1.5 rounded-pill bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {asking ? <CircleNotch size={13} className="animate-spin" /> : <Sparkle size={13} weight="fill" />}
          {asking ? "Thinking…" : "Suggest the work"}
        </button>
      </div>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[calc(90vh/var(--ui-scale,1))] overflow-y-auto"
          data-testid="stage-work-review">
          <DialogHeader>
            <DialogTitle>The work for each stage</DialogTitle>
            <DialogDescription>
              Keep, change or drop anything. When a card reaches one of these stages, its work is created and
              assigned to that department. This applies from now on; cards already on a stage aren&rsquo;t changed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.key}>
                <p className="label-mono mb-2 text-muted-foreground">{g.label}</p>
                <div className="space-y-2.5">
                  {g.items.map(({ r, i }) => (
                    <div key={`${r.pipeline_key}-${r.stage_key}`} data-testid={`stage-work-${r.pipeline_key}-${r.stage_key}`}
                      className={`rounded-md border p-2.5 ${r.keep ? "border-nm-edge/60 bg-accent/30" : "border-dashed border-nm-edge/40 opacity-70"}`}>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={r.keep} onChange={(e) => setRow(i, { keep: e.target.checked })}
                          data-testid={`stage-work-keep-${r.pipeline_key}-${r.stage_key}`} className="h-4 w-4 accent-neutral-900" />
                        {r.stage_label}
                        {r.role && <span className="text-[11px] font-normal text-muted-foreground">· {r.role}</span>}
                      </label>
                      {r.keep && (
                        <div className="mt-2 space-y-1.5 pl-6">
                          {r.tasks.length === 0 && (
                            <p className="text-[11px] italic text-muted-foreground">No suggestion for this stage — add your own, or leave it empty.</p>
                          )}
                          {r.tasks.map((t, ti) => (
                            <div key={ti} className="flex items-center gap-1.5">
                              <input className={field} value={t.title} placeholder="What needs doing at this stage"
                                onChange={(e) => setTask(i, ti, { title: e.target.value })}
                                data-testid={`stage-work-task-${r.pipeline_key}-${r.stage_key}-${ti}`} />
                              <select className={`${field} !w-auto`} value={t.role} onChange={(e) => setTask(i, ti, { role: e.target.value })}
                                aria-label="Department">
                                <option value="">Unassigned</option>
                                {roleOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                              </select>
                              <button type="button" onClick={() => dropTask(i, ti)} title="Drop this"
                                className="p-1 text-muted-foreground hover:text-kr-accent"><Trash size={14} weight="bold" /></button>
                            </div>
                          ))}
                          {r.tasks.length < 6 && (
                            <button type="button" onClick={() => addTask(i)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                              <Plus size={11} weight="bold" /> Add a task
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={saving}
              className="rounded-pill px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving || !kept.length} data-testid="stage-work-apply"
              className="rounded-pill bg-neutral-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving…" : `Add work to ${kept.length} stage${kept.length === 1 ? "" : "s"}`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default StageWorkReview;
