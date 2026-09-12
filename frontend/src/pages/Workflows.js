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
  CaretDown,  // KR-14.21 · mobile stage collapse
  ListBullets,  // KM-31 · the standalone page's pipeline picker
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";
/* ASK-2 fix (2026-09-12): the delete-card handler used to sit behind
   window.confirm. Some browsers and embed contexts silently return false
   from window.confirm with no visible UI, so the click looked like a
   silent no-op even though RBAC and the DELETE endpoint were fine. This
   is the same class of bug FUP-49 fixed on My Work's Complete button.
   Switching to Radix AlertDialog gives us an in-app confirm that renders
   the same in every context. */
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";
import { StickyHeader } from "../components/common";

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
          /* KM-31 — neumorphic, not a black slab. It is this page's own
             primary action and the app paints those in depth. */
          className="kr-pop flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-sm font-medium">
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
      {/* ASK-1 (2026-09-12): surface + button grammar redesigned.
          Before, DialogContent was rounded-cardlg with an nm-edge/40
          hairline -- the retired neumorphic material the rest of the
          redesign moved off. Now on the same white-frost surface the
          BuildReveal panels use: 95% white ground, backdrop-blur, soft
          shadow. */}
      <DialogContent
        className="rounded-2xl border border-white/60 bg-white/95 shadow-[0_10px_32px_-12px_hsl(230_18%_15%/0.35)] backdrop-blur-xl"
        data-testid="wf-override-dialog"
      >
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
          {/* ASK-1: font-mono removed. The user is typing prose ("Bill is
              delayed but the customer confirmed by phone"), which read
              as code in mono. Same FIELD styling every other textarea
              on the page uses. */}
          <textarea data-testid="wf-override-reason" className={FIELD} rows={3}
            placeholder="e.g. Bill is delayed but the customer confirmed by phone, moving on"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {/* ASK-1: Override + Cancel used to carry near-equal weight -- one
            was a raised ink pill, the other a neumorphic tile. Founder's
            ask: Override should read as the consequential action. Now
            Override wears the destructive treatment (red pill, same
            grammar Radix AlertDialogAction uses on Delete Card in ASK-2),
            and Cancel recedes to a ghost link that stays reachable
            without competing for the eye. */}
        <DialogFooter>
          <button data-testid="wf-override-cancel" onClick={() => onOpenChange(false)}
            className="inline-flex items-center rounded-pill px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Cancel
          </button>
          <button data-testid="wf-override-confirm"
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={!reason.trim()}
            className="kr-lift rounded-pill bg-danger-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-danger-600/90 disabled:opacity-50">
            Override
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* KM-31 · the standalone page header.
   The founder's layout: the title pinned like every other room, and ONE row
   under it holding the pipeline picker (the options icon, whose menu lists
   Distribution, Production, Procurement, Order fulfilment…) and the primary
   action beside it. The old page put the pipeline pills on their own wrapping
   row and the New-workflow button somewhere else again, which is two rows and
   two visual weights for what is really one control strip.
   The action is .kr-pop, not a filled slab: it is the page's own control, and
   the app paints those in depth rather than in fill. */
function StandaloneHeader({ show, title, pipelines, activeKey, counts, onPick, newDialog }) {
  if (!show) return null;
  const active = pipelines.find((p) => p.key === activeKey);
  return (
    <StickyHeader className="mb-3 flex flex-col gap-2.5 lg:hidden" data-testid="workflows-mobile-header">
      <h1 className="font-display text-3xl">{title}</h1>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="workflows-pipeline-menu"
              aria-label="Choose pipeline"
              className="kr-pop flex h-11 min-w-0 flex-1 items-center gap-2 rounded-pill px-4 text-sm font-medium">
              <ListBullets size={16} weight="bold" aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{active?.label || "Pipeline"}</span>
              <CaretDown size={12} weight="bold" aria-hidden="true" className="shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="min-w-[14rem]">
            {pipelines.map((pip) => (
              <DropdownMenuItem key={pip.key} onSelect={() => onPick(pip.key)}
                data-testid={`workflows-pipeline-${pip.key}`}
                className={`flex items-center justify-between gap-3 ${activeKey === pip.key ? "font-medium" : ""}`}>
                <span>{pip.label}</span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {counts.filter((w) => w.type === pip.key).length}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="shrink-0" data-testid="workflows-new-slot">{newDialog}</div>
      </div>
    </StickyHeader>
  );
}

/* KM-31 — Workflows is its own PAGE now, reached from the More menu rather
   than from a pill inside My Work. `embedded` survives for the desktop tree,
   which still renders it inside /my-work; what changed is the standalone
   branch, which now looks like every other room: a pinned title, and one row
   under it carrying the pipeline picker and the primary action. */
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
  // KR-14.21 · MOBILE — collapse state per stage key. All stages start
  // MINIMIZED on first open; toggling one flips only its own entry.
  const [openStages, setOpenStages] = useState({});
  const toggleStage = useCallback((key) => {
    setOpenStages((s) => ({ ...s, [key]: !s[key] }));
  }, []);
  const [busyId, setBusyId] = useState(null);
  // ASK-2 fix: workflow card queued for delete-confirmation. Set from the
  // trash-icon click; cleared by the AlertDialog's Cancel / after delete.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  // ASK-2 fix: `del` no longer calls window.confirm (silently no-ops in
  // some browser + embed contexts). It just queues the workflow for the
  // AlertDialog; the actual delete runs from `confirmDelete` below.
  const del = (wf) => setPendingDelete(wf);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/workflows/${pendingDelete.id}`);
      toast.success(t("workflows.deleted"));
      refresh();
      setPendingDelete(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || t("workflows.delete_failed"));
    } finally {
      setDeleting(false);
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
      <StandaloneHeader
        show={!embedded}
        title={t("workflows.title")}
        pipelines={pipelines}
        activeKey={activeKey}
        counts={data || []}
        onPick={(k) => setTab(k)}
        newDialog={
          <NewWorkflowDialog
            type={activeKey} typeLabel={tabLabel} custLabel={L.customer_singular} vendLabel={L.vendor_singular}
            onCreated={refresh} />
        }
      />
      <header className={embedded ? "mb-5 flex flex-wrap items-center justify-between gap-3" : "hidden lg:mb-7 lg:flex lg:flex-wrap lg:items-end justify-between gap-4"}>
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

      {/* KR-14.21 · MOBILE — the drag hint is hidden on the phone (there is
          no drag target when each stage is a collapsed card and a horizontal
          scroller). It still renders from lg up. */}
      <p className="mb-3 hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
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
      {/* KM-31 — the well is DESKTOP-ONLY now. It is what drew the square
          outline the founder saw around the stage cards: on desktop the columns
          are transparent and need a ground to sit in, but on mobile each stage
          is now its own glass card, so the well was a box drawn around boxes.
          The stages stack straight onto the sky instead. */}
      <div className="flex flex-col gap-3 lg:kr-glass-well lg:gap-0 lg:p-4 lg:overflow-x-auto" data-testid="workflow-board">
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
            // KR-14.21 · MOBILE — stages start MINIMIZED. `openStages[key]`
            // is undefined by default (falsy → collapsed); tapping the
            // header row flips it. Desktop ignores this state and always
            // shows the cards.
            const isOpen = !!openStages[stg.key];
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
                   "this one accepts" or "this one does not".
                   KR-14.21 — mobile paints the stage as an nm-tile card so
                   the collapsed rows read as stacked cards; desktop keeps
                   the transparent column look. */
                /* KM-31 — the mobile stage was .nm-tile: a solid white slab
                   sitting on the sky like a sticker. It is .kr-frost now — the
                   same light glass the Desk's "today's read" wears — so the
                   bloom reads through it. Desktop keeps the transparent column. */
                className={`flex w-full flex-col rounded-tile transition-all kr-frost p-2 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:w-[300px] lg:shrink-0 ${
                  isTarget ? "bg-kr-accent/10 ring-2 ring-kr-accent/60"
                  : dropOk ? "ring-1 ring-dashed ring-foreground/30"
                  : dragId && !isSource ? "opacity-40"
                  : ""
                }`}
              >
                {/* Header row — clickable on mobile to toggle collapse. On
                    desktop it stays a plain non-interactive label. */}
                <button
                  type="button"
                  onClick={() => toggleStage(stg.key)}
                  data-testid={`stage-toggle-${stg.key}`}
                  aria-expanded={isOpen}
                  className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-1 text-left lg:pointer-events-none"
                >
                  <p className="truncate text-sm font-semibold">{stg.label}</p>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm tabular-nums opacity-50">{cards.length}</span>
                    <CaretDown
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`text-muted-foreground transition-transform lg:hidden ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {/* KR-14.21 · MOBILE — when expanded, cards render as a
                    HORIZONTAL scroller (`-mx-2 overflow-x-auto flex-row`).
                    Desktop keeps the original vertical stack. */}
                <div className={`min-h-[140px] flex-1 gap-3 p-1.5 lg:min-h-[320px] lg:flex lg:flex-col ${
                  /* KM-31 — a COLUMN on mobile, not a horizontal scroller.
                     With the card now full-width, a row scroller would show one
                     card and hide the rest behind a swipe nobody is told about;
                     stacking them keeps every card in the stage visible. The
                     row layout survives from lg up, where it is a real board. */
                  isOpen ? "flex flex-col lg:-mx-2 lg:flex-row lg:overflow-x-auto lg:px-2" : "hidden lg:flex"
                }`}>
                  {/* KM-31 — the dashed square is gone. On a glass stage it drew a
                      second box inside the first, which is the border the founder
                      was seeing around the cards; the line alone says it. */}
                  {cards.length === 0 && (
                    <div className="grid flex-1 place-items-center rounded-control p-4">
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
                        /* KM-31 — the card was a fixed w-64 in a horizontal
                           scroller, so inside a 343px stage it sat flush left
                           with a band of empty stage showing down its right
                           side: the "not centred in the outer card" the founder
                           reported. On mobile it fills the stage instead and
                           the height floors rather than fixes, so a short card
                           is short. The scroller keeps its fixed 256px track
                           from lg up, where several columns are side by side. */
                        className={`kr-bento group cursor-grab p-3 active:cursor-grabbing w-full min-h-[220px] lg:w-64 lg:h-[260px] lg:shrink-0 flex flex-col overflow-hidden text-left lg:h-auto lg:w-auto lg:shrink lg:overflow-visible lg:p-3.5 ${
                          dragging ? "opacity-40" : ""
                        } ${busyId === w.id ? "opacity-60" : ""} ${
                          w.id === focusWf ? "ring-2 ring-kr-ink ring-offset-2" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <DotsSixVertical size={15} weight="bold" aria-hidden="true"
                            className="mt-0.5 hidden shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-80 lg:block" />
                          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug line-clamp-2 text-left">{w.title}</p>
                          {user?.role === "owner" && (
                            <button onClick={() => del(w)} data-testid={`delete-workflow-${w.id}`} title={t("workflows.delete_card")}
                              /* MW-13 fix: label names the card it deletes.
                                 Before, every Delete button on the board
                                 was announced as the same phrase "Delete
                                 card"; screen-reader users had five
                                 identical Delete buttons with nothing to
                                 distinguish them. w.title is already to
                                 hand where this button renders. */
                              aria-label={`${t("workflows.delete_card")}: ${w.title}`}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-kr-accent">
                              <Trash size={14} weight="bold" aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        {(w.counterparty || w.amount != null) && (
                          <div className="mt-1.5 flex items-baseline justify-between gap-2 lg:pl-[23px]">
                            {w.counterparty && <span className="truncate text-xs text-muted-foreground">{w.counterparty}</span>}
                            {w.amount != null && <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">{money(w.amount, tenant?.currency)}</span>}
                          </div>
                        )}

                        {stageTasks.length > 0 ? (
                          <div className="mt-2.5 space-y-1 min-h-0 flex-1 overflow-hidden" data-testid={`wf-card-tasks-${w.id}`}>
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
                            /* MW-13 fix: label names the card being
                               advanced. Two Advance buttons on the same
                               board were previously announced with the
                               same phrase ("Advance to Delivered"); the
                               card title disambiguates them. */
                            aria-label={`Advance to ${labelOf(nextKey)}: ${w.title}`}
                            /* KM-31 — .nm-btn was the retired flat outline. The
                               advance button is the one thing on the card that
                               DOES something, so it wears the app's raised
                               control material. No transition utility: .kr-pop
                               swaps an outset shadow list for an inset one on
                               press and those do not interpolate. */
                            className="kr-pop mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-pill text-xs font-medium disabled:opacity-50">
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

      {/* ASK-2 fix: in-app Delete confirmation. Replaces window.confirm,
          which silently returned false in some browser + embed contexts
          and made the click look like a silent no-op. Radix AlertDialog
          gives a real focus-trapped modal with keyboard dismissal. */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(v) => { if (!v && !deleting) setPendingDelete(null); }}
      >
        <AlertDialogContent data-testid="delete-workflow-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this card?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.title
                ? <><span className="font-semibold text-foreground">{pendingDelete.title}</span> will be removed from this pipeline. This can't be undone.</>
                : "This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              data-testid="delete-workflow-confirm-action"
              className="bg-danger-600 text-white hover:bg-danger-600/90"
            >
              {deleting ? "Deleting…" : "Delete card"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
