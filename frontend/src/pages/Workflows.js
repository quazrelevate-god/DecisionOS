import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { lex } from "../lib/lexicon";
import { opModel } from "../lib/operatingModel";
import { PageHeader, Chip } from "../components/common";
import { money, timeAgo, fullTime } from "../lib/format";
import { toast } from "sonner";
import { Plus, ArrowRight, Trash, ClockCounterClockwise, UserCircle, WarningCircle } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";

const STAGE_LABEL = (s) => (s || "").replace(/_/g, " ");

// WE-11/12 helper: a compact avatar chip from a name string (first-name
// initial + last-name initial fallback to first two chars).
function _initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function NewWorkflowDialog({ type, typeLabel, custLabel, vendLabel, onCreated }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", detail: "", amount: "", counterparty: "", contact_id: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const contactType = type === "purchase_payment" ? "vendor" : "customer";
  const contactLabel = contactType === "customer" ? custLabel : vendLabel;
  const { data: contacts } = useQuery({
    queryKey: ["contacts", contactType, "", ""],
    queryFn: () => api.get(`/contacts?type=${contactType}`).then((r) => r.data),
    enabled: open,
  });
  const pickContact = (e) => {
    const id = e.target.value;
    const c = (contacts || []).find((x) => x.id === id);
    setForm({ ...form, contact_id: id, counterparty: c ? (c.company || c.name) : form.counterparty });
  };
  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await api.post("/workflows", { type, title: form.title, detail: form.detail, counterparty: form.counterparty, contact_id: form.contact_id || null, amount: form.amount ? Number(form.amount) : null });
      toast.success(t("workflows.created"));
      setForm({ title: "", detail: "", amount: "", counterparty: "", contact_id: "" });
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(t("workflows.create_failed"));
    }
  };
  const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="new-workflow-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> {t("workflows.new")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{t("workflows.dlg_title", { type: typeLabel })}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t("workflows.dlg_desc", { type: typeLabel.toLowerCase() })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input data-testid="wf-title-input" className={inp} placeholder={t("workflows.title_ph")} value={form.title} onChange={set("title")} />
          <div>
            <label className="label-mono text-muted-foreground">{contactLabel}</label>
            <select data-testid="wf-contact-select" className={`${inp} mt-1`} value={form.contact_id} onChange={pickContact}>
              <option value="">{t("workflows.select_contact", { label: contactLabel.toLowerCase() })}</option>
              {(contacts || []).map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
            </select>
          </div>
          <input data-testid="wf-counterparty-input" className={inp} placeholder={t("workflows.counterparty_ph")} value={form.counterparty} onChange={set("counterparty")} />
          <input className={inp} type="number" placeholder={t("workflows.amount_ph")} value={form.amount} onChange={set("amount")} />
          <textarea className={inp} rows={2} placeholder={t("workflows.detail_ph")} value={form.detail} onChange={set("detail")} />
        </div>
        <DialogFooter>
          <button data-testid="wf-create-submit" onClick={create} className="bg-brand-600 text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">{t("workflows.create")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// WE-13 (2026-08-16): manual-advance UX. When check_stage_ready is
// False on the backend (409), the engine returns a message like
// "Stage not ready: 2 task(s) still open at this stage". We surface
// that inline in a modal and ask the user for a reason. If they
// supply one, we retry with override=true + reason. The reason lands
// in wf.history + audit_log so an override is never invisible.
function OverrideReasonDialog({ open, onOpenChange, wfTitle, blockedReason, onConfirm }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (!open) setReason(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-black rounded-none" data-testid="wf-override-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight flex items-center gap-2">
            <WarningCircle size={18} weight="bold" className="text-brand-600" />
            Stage not ready
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{wfTitle}</span> can't auto-advance yet: {blockedReason}.
            You can still force the transition, but you must record a reason. It goes into the
            workflow history and the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="label-mono text-muted-foreground">Reason for override</label>
          <textarea data-testid="wf-override-reason" className="w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm"
            rows={3}
            placeholder="e.g. Bill is delayed but customer has confirmed by phone, moving on"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <button data-testid="wf-override-cancel" onClick={() => onOpenChange(false)}
            className="border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
            Cancel
          </button>
          <button data-testid="wf-override-confirm"
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={!reason.trim()}
            className="bg-brand-600 text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50">
            Override
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Workflows({ embedded = false }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tenant, user } = useAuth();
  const L = lex(tenant);
  const om = opModel(tenant);
  const pipelines = om.pipelines;
  const [params] = useSearchParams();
  const focusWf = params.get("wf") || params.get("focus");
  const focusWfType = params.get("wf_type") || params.get("type");
  const [tab, setTab] = useState(() => (focusWfType && pipelines.some((p) => p.key === focusWfType)) ? focusWfType : pipelines[0]?.key);
  const activeKey = pipelines.some((p) => p.key === tab) ? tab : pipelines[0]?.key;
  // WE-12: fetch with with_tasks=true so each card carries stage_tasks[].
  const { data } = useQuery({
    queryKey: ["workflows", activeKey, "with_tasks"],
    queryFn: () => api.get(`/workflows?type=${activeKey}&with_tasks=true`).then((r) => r.data),
  });

  useEffect(() => {
    if (!focusWf || !data) return;
    const timer = setTimeout(() => {
      document.getElementById(`workflow-card-${focusWf}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 350);
    return () => clearTimeout(timer);
  }, [focusWf, data]);

  const pipeline = pipelines.find((p) => p.key === activeKey) || pipelines[0];
  const stages = pipeline?.stages || [];
  const stageLabelMap = Object.fromEntries(stages.map((s) => [s.key, s.label]));
  const labelOf = (k) => stageLabelMap[k] || STAGE_LABEL(k);
  const tabLabel = pipeline?.label || "";
  const newWfDialog = (
    <NewWorkflowDialog
      type={activeKey} typeLabel={tabLabel} custLabel={L.customer_singular} vendLabel={L.vendor_singular}
      onCreated={() => qc.invalidateQueries({ queryKey: ["workflows", activeKey, "with_tasks"] })} />
  );

  // WE-13: override state -- when the engine returns 409, we open the
  // reason dialog for the workflow the user was trying to advance.
  const [overrideCtx, setOverrideCtx] = useState(null); // {wf, blockedReason, targetStage}

  const _postAdvance = async (wf, targetStage, opts = {}) => {
    const body = { stage: targetStage, note: t("workflows.moved_to", { stage: labelOf(targetStage) }) };
    if (opts.override) { body.override = true; body.reason = opts.reason; }
    await api.patch(`/workflows/${wf.id}/advance`, body);
    toast.success(`→ ${labelOf(targetStage)}`);
    qc.invalidateQueries({ queryKey: ["workflows", activeKey, "with_tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const advance = async (wf) => {
    const idx = wf.stages.indexOf(wf.stage);
    if (idx >= wf.stages.length - 1) return toast.info(t("workflows.already_final"));
    const next = wf.stages[idx + 1];
    try {
      await _postAdvance(wf, next);
    } catch (e) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail || t("workflows.cannot_advance");
      // WE-13: 409 == stage not ready. Open reason dialog for override.
      if (status === 409) {
        setOverrideCtx({ wf, blockedReason: detail.replace(/^Stage not ready:\s*/, ""), targetStage: next });
      } else {
        toast.error(detail);
      }
    }
  };

  const confirmOverride = async (reason) => {
    if (!overrideCtx) return;
    try {
      await _postAdvance(overrideCtx.wf, overrideCtx.targetStage,
        { override: true, reason });
      setOverrideCtx(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || t("workflows.cannot_advance"));
    }
  };

  const del = async (wf) => {
    if (!window.confirm(t("workflows.delete_confirm", { title: wf.title }))) return;
    try {
      await api.delete(`/workflows/${wf.id}`);
      toast.success(t("workflows.deleted"));
      qc.invalidateQueries({ queryKey: ["workflows", activeKey, "with_tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || t("workflows.delete_failed"));
    }
  };

  return (
    <div>
      {embedded ? (
        <div className="flex justify-end mb-4">
          {newWfDialog}
        </div>
      ) : (
        <PageHeader eyebrow={t("workflows.eyebrow")} title={t("workflows.title")}>
          {newWfDialog}
        </PageHeader>
      )}

      {/* U7-06.1 (2026-08-17): shorter pipeline chips -- full stage flow
          moved to hover tooltip so this row stops chewing horizontal
          space.
          U7-06.4 (2026-08-17): the earlier hide-empty rule (only render
          a pipeline chip when it had at least one workflow) is reverted.
          Founder ask: 'show the complete operational, not only data
          workflow which has the data'. The pipelines represent every
          operational flow this business runs; hiding an empty one made
          the tenant think a whole flow was missing. Zero-count chips
          are muted (label-mono muted-foreground) so live pipelines
          still visually dominate. */}
      <div className="flex flex-wrap border border-black mb-6 w-fit">
        {pipelines
          .map((pip) => {
            const count = (data || []).filter((w) => w.type === pip.key).length;
            return (
              <button key={pip.key} onClick={() => setTab(pip.key)} data-testid={`workflow-tab-${pip.key}`}
                title={pip.sub || undefined}
                className={`px-4 py-2.5 text-left border-r border-black last:border-r-0 transition-colors flex items-center gap-2 ${activeKey === pip.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                <span className="text-sm font-semibold uppercase tracking-wider">{pip.label}</span>
                <span className={`label-mono ${activeKey === pip.key ? "text-white/70" : "text-muted-foreground"}`}>{count}</span>
              </button>
            );
          })}
      </div>

      {/* Brutalist kanban */}
      <div className="border border-black overflow-x-auto">
        <div className="flex min-w-max">
          {stages.map((stg) => {
            const cards = (data || []).filter((w) => w.stage === stg.key);
            return (
              <div key={stg.key} className="w-64 shrink-0 border-r border-black last:border-r-0" data-testid={`stage-column-${stg.key}`}>
                <div className="px-3 py-2 border-b border-black bg-brand-paper sticky top-0">
                  <p className="label-mono">{stg.label}</p>
                  <p className="font-heading font-black text-lg">{cards.length}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[300px] bg-white">
                  {cards.map((w) => {
                    const isLast = w.stages.indexOf(w.stage) >= w.stages.length - 1;
                    const lastEv = (w.history || [])[(w.history || []).length - 1];
                    const updAt = lastEv?.at || w.created_at;
                    const updLabel = lastEv?.note || t("workflows.created_label");
                    // WE-12: inline task list -- current-stage open tasks
                    // enriched with assignee_name. Backend returns
                    // stage_tasks[] on the workflow doc when we call
                    // ?with_tasks=true.
                    const stageTasks = w.stage_tasks || [];
                    return (
                      <div key={w.id} id={`workflow-card-${w.id}`} data-testid={`workflow-card-${w.id}`} className={`border border-black p-3 shadow-hover bg-white transition-all ${w.id === focusWf ? "ring-4 ring-brand-600 ring-offset-2" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight">{w.title}</p>
                          {user?.role === "owner" && (
                            <button onClick={() => del(w)} data-testid={`delete-workflow-${w.id}`} title={t("workflows.delete_card")}
                              className="shrink-0 text-muted-foreground hover:text-brand-600 transition-colors">
                              <Trash size={14} weight="bold" />
                            </button>
                          )}
                        </div>
                        {w.counterparty && <p className="text-xs text-muted-foreground mt-1">{w.counterparty}</p>}
                        {w.amount != null && <p className="font-mono text-xs mt-1">{money(w.amount, tenant?.currency)}</p>}

                        {/* WE-12 (2026-08-16): inline task list for this
                            card's CURRENT stage. Each row shows the
                            task title truncated + an assignee avatar
                            chip. Clicking the row opens the task in
                            My Work. Empty stage-task list renders a
                            small italic "no open tasks" hint. */}
                        {stageTasks.length > 0 ? (
                          <div className="mt-2 space-y-1" data-testid={`wf-card-tasks-${w.id}`}>
                            {stageTasks.slice(0, 4).map((tk) => (
                              <a key={tk.id} href={`/my-work?task=${encodeURIComponent(tk.id)}`}
                                data-testid={`wf-card-task-${w.id}-${tk.id}`}
                                className="flex items-center gap-1.5 text-[11px] border border-border/60 bg-brand-paper/40 px-1.5 py-1 hover:bg-brand-yellow transition-colors">
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-ink text-white text-[9px] font-bold shrink-0"
                                  title={tk.assignee_name || tk.assignee_role || "Unassigned"}>
                                  {_initials(tk.assignee_name) || (tk.assignee_role ? tk.assignee_role.slice(0, 1).toUpperCase() : "?")}
                                </span>
                                <span className="truncate">{tk.title}</span>
                              </a>
                            ))}
                            {stageTasks.length > 4 && (
                              <p className="text-[10px] text-muted-foreground italic pl-1">+ {stageTasks.length - 4} more</p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-2 text-[10px] text-muted-foreground italic">No open tasks at this stage.</p>
                        )}

                        {updAt && (
                          <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1" data-testid={`workflow-updated-${w.id}`} title={fullTime(updAt)}>
                            <ClockCounterClockwise size={11} weight="bold" /> {updLabel} · {timeAgo(updAt)}
                          </p>
                        )}
                        {!isLast && (() => {
                          // U7-06.2 (2026-08-17): show the next stage name
                          // on the Advance button so users know where the
                          // card is heading before they click. Was just
                          // "Advance ->" with no context.
                          const nextKey = w.stages[w.stages.indexOf(w.stage) + 1];
                          const nextLabel = labelOf(nextKey) || nextKey || "next";
                          return (
                            <button onClick={() => advance(w)} data-testid={`advance-workflow-${w.id}`}
                              title={`Move to ${nextLabel}`}
                              className="mt-3 w-full flex items-center justify-center gap-1 border border-black py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
                              {t("workflows.advance")} to {nextLabel} <ArrowRight size={12} weight="bold" />
                            </button>
                          );
                        })()}
                        {isLast && <Chip value={labelOf(w.stage)} className="mt-3" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* WE-13 override reason dialog */}
      <OverrideReasonDialog
        open={!!overrideCtx}
        onOpenChange={(v) => { if (!v) setOverrideCtx(null); }}
        wfTitle={overrideCtx?.wf?.title || ""}
        blockedReason={overrideCtx?.blockedReason || ""}
        onConfirm={confirmOverride}
      />
    </div>
  );
}
