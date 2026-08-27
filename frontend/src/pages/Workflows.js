// /workflows (and the Workflows tab inside /my-work) — KR-11.
//
// THE FOUNDER'S CALL: "the workflow section is the main core part of the
// system, so focus more on it — optimize the layout and introduce drag and
// drop if needed." Both, and the drag needed care rather than a library.
//
// ── DRAG TO MOVE A STAGE ────────────────────────────────────────────────
// Dropping a card on a column calls the SAME advance endpoint the button
// calls, including the 409 "stage not ready" path that opens the override
// dialog. That is the whole point: drag is a second way to trigger one
// behaviour, not a second behaviour. If the engine refuses a move, it
// refuses it identically whether you dragged or clicked, and the override
// reason still lands in wf.history and the audit log.
//
// Native HTML5 drag, no new dependency. dnd-kit or react-beautiful-dnd would
// add ~30kB gz to do what four event handlers do here, and this board never
// needs sortable-within-column (stage order is the backend's, not the
// user's) — only cross-column transfer, which is exactly what HTML5 DnD is.
//
// THE BUTTON STAYS, and that is an accessibility decision, not clutter:
// native DnD is mouse-only. It does not fire on touch at all, and it is not
// keyboard-operable. "Advance to <next>" remains on every card as the path
// for a phone, a trackpad user who prefers clicking, and anyone driving by
// keyboard. Drag is the accelerator; the button is the contract.
//
// ONLY THE NEXT STAGE IS A LEGAL DROP, and the board says so before you let
// go. workflow_engine enforces `tgt_idx == cur_idx + 1` and returns 400
// "Can only advance to the next stage" for anything else — backwards, or
// skipping ahead. I assumed otherwise and had to be corrected by a 400 while
// testing a drag back.
// So during a drag exactly ONE column lights up: the card's next stage.
// Every other column goes inert — no preventDefault, so the cursor shows
// "no drop" and the browser refuses the gesture itself. A rule the UI
// enforces beats the same rule delivered as a red toast after the fact.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { lex } from "../lib/lexicon";
import { opModel } from "../lib/operatingModel";
import { money, timeAgo, fullTime, humanStage } from "../lib/format";
import { toast } from "sonner";
import {
  Plus, ArrowRight, Trash, ClockCounterClockwise, WarningCircle, DotsSixVertical, Check,
  SlidersHorizontal,  // KR-14.6 · mobile pipeline filter
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";

function _initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const FIELD = "w-full nm-field px-3 py-2 text-sm";

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
      await api.post("/workflows", {
        type, title: form.title, detail: form.detail, counterparty: form.counterparty,
        contact_id: form.contact_id || null, amount: form.amount ? Number(form.amount) : null,
      });
      toast.success(t("workflows.created"));
      setForm({ title: "", detail: "", amount: "", counterparty: "", contact_id: "" });
      setOpen(false);
      onCreated();
    } catch {
      toast.error(t("workflows.create_failed"));
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="new-workflow-button"
          className="kr-lift flex items-center gap-2 rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-medium text-white transition-all">
          <Plus size={16} weight="bold" aria-hidden="true" /> {t("workflows.new")}
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{t("workflows.dlg_title", { type: typeLabel })}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("workflows.dlg_desc", { type: typeLabel.toLowerCase() })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input data-testid="wf-title-input" className={FIELD} placeholder={t("workflows.title_ph")} value={form.title} onChange={set("title")} />
          <div>
            <label className="text-xs text-muted-foreground">{contactLabel}</label>
            <select data-testid="wf-contact-select" className={`${FIELD} mt-1`} value={form.contact_id} onChange={pickContact}>
              <option value="">{t("workflows.select_contact", { label: contactLabel.toLowerCase() })}</option>
              {(contacts || []).map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
            </select>
          </div>
          <input data-testid="wf-counterparty-input" className={FIELD} placeholder={t("workflows.counterparty_ph")} value={form.counterparty} onChange={set("counterparty")} />
          <input className={FIELD} type="number" placeholder={t("workflows.amount_ph")} value={form.amount} onChange={set("amount")} />
          <textarea className={FIELD} rows={2} placeholder={t("workflows.detail_ph")} value={form.detail} onChange={set("detail")} />
        </div>
        <DialogFooter>
          <button data-testid="wf-create-submit" onClick={create}
            className="kr-lift rounded-pill bg-kr-ink px-5 py-2.5 text-sm font-medium text-white transition-all">
            {t("workflows.create")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * WE-13 — the engine returned 409 "stage not ready". Surface why, take a
 * reason, retry with override. Reached from BOTH the button and a drop.
 */
function OverrideReasonDialog({ open, onOpenChange, wfTitle, blockedReason, targetLabel, onConfirm }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (!open) setReason(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-cardlg border border-nm-edge/40" data-testid="wf-override-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <WarningCircle size={18} weight="bold" aria-hidden="true" className="text-kr-accent" />
            Stage not ready
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{wfTitle}</span> can&rsquo;t move
            {targetLabel ? <> to <span className="font-semibold text-foreground">{targetLabel}</span></> : null} yet: {blockedReason}.
            You can still force it, but you must record a reason — it goes into the workflow
            history and the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Reason for override</label>
          <textarea data-testid="wf-override-reason" className={`${FIELD} font-mono`} rows={3}
            placeholder="e.g. Bill is delayed but the customer confirmed by phone, moving on"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <button data-testid="wf-override-cancel" onClick={() => onOpenChange(false)} className="nm-btn px-4 py-2.5 text-sm font-medium">
            Cancel
          </button>
          <button data-testid="wf-override-confirm"
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={!reason.trim()}
            className="kr-lift rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-medium text-white transition-all disabled:opacity-50">
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
  const [tab, setTab] = useState(() =>
    (focusWfType && pipelines.some((p) => p.key === focusWfType)) ? focusWfType : pipelines[0]?.key);
  // KR-14.9 — sync tab from ?wf_type= when MyWork's mobile filter dropdown
  // changes it externally. Guard against pipeline drift by validating the
  // key against the current pipeline list before applying.
  useEffect(() => {
    if (focusWfType && pipelines.some((p) => p.key === focusWfType) && focusWfType !== tab) {
      setTab(focusWfType);
    }
  }, [focusWfType, pipelines, tab]);
  const activeKey = pipelines.some((p) => p.key === tab) ? tab : pipelines[0]?.key;

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
  const labelOf = (k) => stageLabelMap[k] || humanStage(k);
  const tabLabel = pipeline?.label || "";

  const [overrideCtx, setOverrideCtx] = useState(null);   // {wf, blockedReason, targetStage}
  // Drag state. `dragId` is what is in flight; `overStage` is the column
  // under the pointer, used only to paint the drop target.
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["workflows", activeKey, "with_tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }, [qc, activeKey]);

  const _postAdvance = async (wf, targetStage, opts = {}) => {
    const body = { stage: targetStage, note: t("workflows.moved_to", { stage: labelOf(targetStage) }) };
    if (opts.override) { body.override = true; body.reason = opts.reason; }
    await api.patch(`/workflows/${wf.id}/advance`, body);
    toast.success(`→ ${labelOf(targetStage)}`);
    refresh();
  };

  /**
   * The ONE move path. Button and drop both land here, so the 409 → override
   * flow cannot drift between them.
   */
  const moveTo = async (wf, targetStage) => {
    if (!wf || !targetStage || wf.stage === targetStage) return;
    setBusyId(wf.id);
    try {
      await _postAdvance(wf, targetStage);
    } catch (e) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail || t("workflows.cannot_advance");
      if (status === 409) {
        setOverrideCtx({ wf, blockedReason: detail.replace(/^Stage not ready:\s*/, ""), targetStage });
      } else {
        toast.error(detail);
      }
    } finally {
      setBusyId(null);
    }
  };

  const advance = (wf) => {
    const idx = wf.stages.indexOf(wf.stage);
    if (idx >= wf.stages.length - 1) return toast.info(t("workflows.already_final"));
    return moveTo(wf, wf.stages[idx + 1]);
  };

  const confirmOverride = async (reason) => {
    if (!overrideCtx) return;
    try {
      await _postAdvance(overrideCtx.wf, overrideCtx.targetStage, { override: true, reason });
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
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || t("workflows.delete_failed"));
    }
  };

  const onDrop = (e, stageKey) => {
    e.preventDefault();
    setOverStage(null);
    setDragId(null);
    const id = e.dataTransfer.getData("text/plain");
    const wf = (data || []).find((w) => w.id === id);
    if (wf) moveTo(wf, stageKey);
  };

  const total = (data || []).length;

  return (
    <div data-testid="workflows-page">
      <header className={embedded ? "mb-5 flex flex-wrap items-center justify-between gap-3" : "mb-7 flex flex-wrap items-end justify-between gap-4"}>
        {!embedded && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("workflows.eyebrow")}</p>
            <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">{t("workflows.title")}</h1>
          </div>
        )}

        {/* KR-14.8 · MOBILE — the pipeline pills are folded into MyWork's
            mobile filter dropdown (via the shared `?wf_type=` param). The
            "+ New workflow" trigger stays inline as a mobile-only button
            just below the pill row's caption. */}
        {embedded && (
          <div className="flex w-full lg:hidden" data-testid="workflow-mobile-controls">
            <NewWorkflowDialog
              type={activeKey} typeLabel={tabLabel} custLabel={L.customer_singular} vendLabel={L.vendor_singular}
              onCreated={refresh} />
          </div>
        )}

        {/* Pipeline switch — the same black-hairline pill the nav, the scope
            toggle and Finance's tabs wear. Was a welded bordered block with
            an inverted active slab, which read as the loudest thing on a
            page whose subject is the board below it.
            Empty pipelines still render (U7-06.4, founder: "show the
            complete operational, not only the ones with data") — they just
            carry a 0 and sit at the faded weight.
            KR-14.8 — hidden on mobile (below lg); the sliders dropdown
            above takes over. */}
        <div className="hidden flex-wrap items-center gap-2 lg:flex" data-testid="workflow-pipelines">
          {pipelines.map((pip) => {
            const count = (data || []).filter((w) => w.type === pip.key).length;
            const active = activeKey === pip.key;
            return (
              /* KR-11.3 — neumorphic, not hairline. The founder could not tell
                 the page's own controls from the app's top nav because both
                 wore the same outlined pill. These are RAISED by default and
                 PRESSED when active, which is what the material means and
                 what the kanban cards below them are made of. */
              <button key={pip.key} onClick={() => setTab(pip.key)} data-testid={`workflow-tab-${pip.key}`}
                title={pip.sub || undefined} aria-pressed={active}
                /* No transition on the swap — same wedged-transition bug My
                   Work's toolbar hit: .kr-pop's outset shadow pair and
                   .kr-pressed's inset pair are not interpolable, and the
                   stalled animation leaves the element painting its previous
                   colour. Selection snaps. */
                className={`flex h-10 items-center gap-2 rounded-pill px-4 text-sm ${
                  active ? "kr-pressed font-semibold text-foreground" : "kr-pop text-foreground/75"
                }`}>
                {pip.label}
                <span className={`font-mono text-xs tabular-nums ${active ? "opacity-70" : "opacity-55"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Desktop New Workflow — the mobile controls row above renders its
            own trigger inside the sliders/New pair. */}
        <div className="hidden lg:block">
          <NewWorkflowDialog
            type={activeKey} typeLabel={tabLabel} custLabel={L.customer_singular} vendLabel={L.vendor_singular}
            onCreated={refresh} />
        </div>
      </header>

      {/* One line telling the founder the board is draggable. A drag
          affordance nobody discovers is a feature nobody has. */}
      <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <DotsSixVertical size={13} weight="bold" aria-hidden="true" />
        Drag a card into its next stage, or use its button. {total} in this pipeline.
      </p>

      {/* THE BOARD. Columns are fixed-width and the board scrolls
          horizontally on its own — the page never does. Column headers stay
          put while a long column scrolls under them. */}
      {/* KR-11.5 — the board's tray is glass now, not a grey well. It still
          reads as recessed (the tiles inside are raised against it), but the
          page's weather passes through instead of being covered by a slab. */}
      {/* KR-14.9 — the board stacks VERTICALLY on mobile: each stage is a
          full-width section, cards flow beneath in one column. Drag-to-move
          still works within a section. From lg the original horizontal
          kanban with fixed 300px columns returns unchanged. */}
      <div className="kr-glass-well p-4 lg:overflow-x-auto" data-testid="workflow-board">
        <div className="flex flex-col gap-4 lg:min-w-max lg:flex-row lg:items-stretch">
          {stages.map((stg) => {
            const cards = (data || []).filter((w) => w.stage === stg.key);
            const draggedWf = dragId ? (data || []).find((w) => w.id === dragId) : null;
            const isSource = draggedWf?.stage === stg.key;
            // The single legal destination for whatever is in flight.
            const dropOk = !!draggedWf && (() => {
              const i = draggedWf.stages.indexOf(draggedWf.stage);
              return i >= 0 && draggedWf.stages[i + 1] === stg.key;
            })();
            const isTarget = overStage === stg.key && dropOk;
            return (
              <section
                key={stg.key}
                data-testid={`stage-column-${stg.key}`}
                onDragOver={(e) => {
                  if (!dropOk) return;              // no preventDefault ⇒ browser shows "no drop"
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverStage(stg.key);
                }}
                onDragLeave={() => setOverStage((s) => (s === stg.key ? null : s))}
                onDrop={(e) => onDrop(e, stg.key)}
                /* No fill at rest — the board's inset well is the ground, and
                   a grey panel per column was a box inside a box. The column
                   only paints while a drag is live, and then only to say
                   "this one accepts" or "this one does not". */
                className={`flex w-full flex-col rounded-tile transition-all lg:w-[300px] lg:shrink-0 ${
                  isTarget ? "bg-kr-accent/10 ring-2 ring-kr-accent/60"
                  : dropOk ? "ring-1 ring-dashed ring-foreground/30"
                  : dragId && !isSource ? "opacity-40"
                  : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 px-1.5 pb-1 pt-1">
                  <p className="truncate text-sm font-semibold">{stg.label}</p>
                  <span className="font-mono text-sm tabular-nums opacity-50">{cards.length}</span>
                </div>

                <div className="flex min-h-[140px] flex-1 flex-col gap-3 p-1.5 lg:min-h-[320px]">
                  {cards.length === 0 && (
                    <div className="grid flex-1 place-items-center rounded-control border border-dashed border-foreground/15 p-4">
                      <p className="text-center text-xs text-muted-foreground">
                        {isTarget ? "Drop to move here" : dropOk ? "Drop here to advance" : "Nothing at this stage"}
                      </p>
                    </div>
                  )}

                  {cards.map((w) => {
                    const isLast = w.stages.indexOf(w.stage) >= w.stages.length - 1;
                    const lastEv = (w.history || [])[(w.history || []).length - 1];
                    const updAt = lastEv?.at || w.created_at;
                    const updLabel = lastEv?.note || t("workflows.created_label");
                    const stageTasks = w.stage_tasks || [];
                    const nextKey = !isLast ? w.stages[w.stages.indexOf(w.stage) + 1] : null;
                    const dragging = dragId === w.id;
                    return (
                      <article
                        key={w.id}
                        id={`workflow-card-${w.id}`}
                        data-testid={`workflow-card-${w.id}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", w.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(w.id);
                        }}
                        onDragEnd={() => { setDragId(null); setOverStage(null); }}
                        className={`kr-bento group cursor-grab p-3.5 active:cursor-grabbing ${
                          dragging ? "opacity-40" : ""
                        } ${busyId === w.id ? "opacity-60" : ""} ${
                          w.id === focusWf ? "ring-2 ring-kr-ink ring-offset-2" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <DotsSixVertical size={15} weight="bold" aria-hidden="true"
                            className="mt-0.5 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-80" />
                          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{w.title}</p>
                          {user?.role === "owner" && (
                            <button onClick={() => del(w)} data-testid={`delete-workflow-${w.id}`} title={t("workflows.delete_card")}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-kr-accent">
                              <Trash size={14} weight="bold" aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        {(w.counterparty || w.amount != null) && (
                          <div className="mt-1.5 flex items-baseline justify-between gap-2 pl-[23px]">
                            {w.counterparty && <span className="truncate text-xs text-muted-foreground">{w.counterparty}</span>}
                            {w.amount != null && <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">{money(w.amount, tenant?.currency)}</span>}
                          </div>
                        )}

                        {stageTasks.length > 0 ? (
                          <div className="mt-2.5 space-y-1" data-testid={`wf-card-tasks-${w.id}`}>
                            {stageTasks.slice(0, 4).map((tk) => (
                              <a key={tk.id} href={`/my-work?task=${encodeURIComponent(tk.id)}`}
                                data-testid={`wf-card-task-${w.id}-${tk.id}`}
                                draggable={false}
                                className="flex items-center gap-1.5 rounded-control bg-nm-sunken px-1.5 py-1 text-[11px] transition-colors hover:bg-nm-sunken/70">
                                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-kr-ink text-[9px] font-bold text-white"
                                  title={tk.assignee_name || tk.assignee_role || "Unassigned"}>
                                  {_initials(tk.assignee_name) || (tk.assignee_role ? tk.assignee_role.slice(0, 1).toUpperCase() : "?")}
                                </span>
                                <span className="truncate">{tk.title}</span>
                              </a>
                            ))}
                            {stageTasks.length > 4 && (
                              <p className="pl-1 text-[10px] text-muted-foreground">+ {stageTasks.length - 4} more</p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-2.5 text-[10px] text-muted-foreground">No open tasks at this stage.</p>
                        )}

                        {updAt && (
                          <p className="mt-2.5 flex items-center gap-1 text-[10px] text-muted-foreground"
                            data-testid={`workflow-updated-${w.id}`} title={fullTime(updAt)}>
                            <ClockCounterClockwise size={10} weight="bold" aria-hidden="true" /> {updLabel} · {timeAgo(updAt)}
                          </p>
                        )}

                        {nextKey ? (
                          <button onClick={() => advance(w)} data-testid={`advance-workflow-${w.id}`}
                            disabled={busyId === w.id}
                            title={`Move to ${labelOf(nextKey)}`}
                            className="nm-btn mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium disabled:opacity-50">
                            {t("workflows.advance")} to {labelOf(nextKey)}
                            <ArrowRight size={12} weight="bold" aria-hidden="true" className="kr-arrow transition-transform duration-200" />
                          </button>
                        ) : (
                          <p className="mt-3 flex items-center justify-center gap-1.5 rounded-control bg-kr-ink py-2 text-xs font-semibold text-white">
                            <Check size={12} weight="bold" aria-hidden="true" /> {labelOf(w.stage)}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <OverrideReasonDialog
        open={!!overrideCtx}
        onOpenChange={(v) => { if (!v) setOverrideCtx(null); }}
        wfTitle={overrideCtx?.wf?.title || ""}
        blockedReason={overrideCtx?.blockedReason || ""}
        targetLabel={overrideCtx ? labelOf(overrideCtx.targetStage) : ""}
        onConfirm={confirmOverride}
      />
    </div>
  );
}
