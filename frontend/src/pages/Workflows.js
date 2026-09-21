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
import { useState, useEffect, useCallback, useMemo } from "react";
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
  X,  // the New Workflow dialog's close, as on New Task
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
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
import {
  DRAWER_FIELD, GLASS_MENU, GLASS_MENU_ITEM, INK_PILL,
} from "../components/karma/glass";
import { GlassSelect } from "../components/karma/GlassSelect";
import WorkflowDetail from "../components/workflow/WorkflowDetail";
import { LeftoverReview } from "../components/workflow/LeftoverReview";
/* C2 (2026-09-21) — stuck / late / needs-you, computed in ONE place. These
   rules were written for the Desk's Workflows tile (ASK-52) and the file says
   in its own header that the board should read the same numbers "so the two do
   not drift" — and then the board never imported it. So the Desk could tell a
   founder that four cards needed attention while the board those cards live on
   showed them as ordinary cards in ordinary columns. */
import { workflowAttention } from "./desk/workflowAttention";

function _initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* 2026-09-14, founder — the New card window (New Distribution, New
   Production…) is styled on New Task (pages/Tasks.js): the frosted .kr-bento
   card with a round close, the same sunken fields under plain labels, the
   buyer or supplier as a GlassSelect (never the operating system's list),
   and the black ink Create. */
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
  const pickContact = (id) => {
    const c = (contacts || []).find((x) => x.id === id);
    setForm({ ...form, contact_id: id, counterparty: c ? (c.company || c.name) : form.counterparty });
  };
  const [titleError, setTitleError] = useState("");
  const [busy, setBusy] = useState(false);
  const blank = { title: "", detail: "", amount: "", counterparty: "", contact_id: "" };
  const create = async () => {
    if (!form.title.trim()) { setTitleError(t("workflows.title_required", "Give the workflow a title")); return; }
    setBusy(true);
    try {
      await api.post("/workflows", {
        type, title: form.title.trim(), detail: form.detail, counterparty: form.counterparty,
        contact_id: form.contact_id || null, amount: form.amount ? Number(form.amount) : null,
      });
      toast.success(t("workflows.created"));
      setForm(blank);
      setTitleError("");
      setOpen(false);
      onCreated();
    } catch {
      toast.error(t("workflows.create_failed"));
    } finally {
      setBusy(false);
    }
  };
  /* The New Task dialog's field and label recipes, verbatim (pages/Tasks.js):
     a sunken .kr-pressed groove with a hairline that goes to full ink on
     focus — thin and black, not the 2px brand outline — and a plain sans
     label above every field. `border-solid` is load-bearing: .kr-pressed sets
     `border: 0`, which also resets the style to none. */
  const inp = "w-full kr-pressed rounded-control border border-solid border-kr-ink/25 px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground/40 transition-colors focus:border-kr-ink focus:outline-none focus-visible:outline-none";
  const lbl = "block text-xs font-medium text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTitleError(""); }}>
      <DialogTrigger asChild>
        <button data-testid="new-workflow-button"
          /* KM-31 — neumorphic, not a black slab. It is this page's own
             primary action and the app paints those in depth. */
          className="kr-pop flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-sm font-medium">
          <Plus size={16} weight="bold" aria-hidden="true" /> {t("workflows.new")}
        </button>
      </DialogTrigger>
      {/* The New Task dialog's shell (pages/Tasks.js): a frosted .kr-bento
          sheet, full-screen on the phone, a centred card from lg with its
          own round close. The card takes its natural height under the same
          viewport ceiling New Task uses (divided by the UI scale: CSS zoom
          leaves viewport units alone). */}
      <DialogContent
        className="kr-bento flex flex-col border-0 [&>button.absolute]:hidden
                   left-0 top-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0
                   [border-radius:0]
                   [padding-top:max(1rem,var(--sa-top))]
                   [padding-bottom:max(1rem,var(--sa-bottom))]
                   lg:left-[50%] lg:top-[50%] lg:h-auto lg:max-h-[calc(100dvh/var(--ui-scale,1)-2rem)] lg:overflow-y-auto lg:max-w-2xl
                   lg:-translate-x-1/2 lg:-translate-y-1/2
                   lg:[border-radius:var(--radius-card)]
                   lg:[padding-block:1.5rem]
                   data-[state=open]:[--tw-enter-translate-x:0] data-[state=open]:[--tw-enter-translate-y:0]
                   data-[state=closed]:[--tw-exit-translate-x:0] data-[state=closed]:[--tw-exit-translate-y:0]
                   lg:data-[state=open]:[--tw-enter-translate-x:-50%] lg:data-[state=open]:[--tw-enter-translate-y:-48%]
                   lg:data-[state=closed]:[--tw-exit-translate-x:-50%] lg:data-[state=closed]:[--tw-exit-translate-y:-48%]"
      >
        <DialogHeader className="shrink-0 pr-11">
          <DialogPrimitiveClose
            data-testid="wf-dialog-close"
            aria-label="Close"
            className="kr-pop absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-foreground/70">
            <X size={15} weight="bold" aria-hidden="true" />
          </DialogPrimitiveClose>
          <DialogTitle className="font-display text-xl">{t("workflows.dlg_title", { type: typeLabel })}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("workflows.dlg_desc", { type: typeLabel.toLowerCase() })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
          <div>
            <label className="sr-only" htmlFor="wf-title">{t("workflows.title_ph")}</label>
            <input id="wf-title" data-testid="wf-title-input" autoFocus className={inp}
              placeholder={t("workflows.title_ph")} value={form.title}
              aria-invalid={titleError ? "true" : undefined}
              aria-describedby={titleError ? "wf-title-error" : undefined}
              onChange={(e) => { setForm({ ...form, title: e.target.value }); if (titleError) setTitleError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); create(); } }} />
            {titleError && (
              <p id="wf-title-error" data-testid="wf-title-error" className="mt-1.5 text-xs font-medium text-kr-accent">{titleError}</p>
            )}
          </div>

          <div className="kr-form-row">
            <div>
              <label className={lbl} htmlFor="wf-contact">{contactLabel}</label>
              {/* 2026-09-14, founder — GlassSelect, as on New Task: the field
                  keeps this form's look, the list is the app's glass, never
                  the operating system's. */}
              <GlassSelect id="wf-contact" testid="wf-contact-select" variant="field" triggerClassName={`${inp} mt-1`}
                ariaLabel={contactLabel} value={form.contact_id} onChange={pickContact}
                options={[
                  { value: "", label: t("workflows.select_contact", { label: contactLabel.toLowerCase() }) },
                  ...(contacts || []).map((c) => ({ value: c.id, label: c.company || c.name })),
                ]} />
            </div>
            <div>
              <label className={lbl} htmlFor="wf-amount">{t("workflows.amount_ph")}</label>
              <input id="wf-amount" data-testid="wf-amount-input" className={`${inp} mt-1`} type="number" inputMode="decimal"
                placeholder="0" value={form.amount} onChange={set("amount")} />
            </div>
          </div>

          <div>
            <label className={lbl} htmlFor="wf-counterparty">{t("workflows.counterparty_ph")}</label>
            <input id="wf-counterparty" data-testid="wf-counterparty-input" className={`${inp} mt-1`}
              placeholder={t("workflows.counterparty_ph")} value={form.counterparty} onChange={set("counterparty")} />
          </div>

          <div>
            <label className={lbl} htmlFor="wf-detail">{t("workflows.detail_ph")}</label>
            <textarea id="wf-detail" data-testid="wf-detail-input" className={`${inp} mt-1`} rows={3}
              placeholder={t("workflows.detail_ph")} value={form.detail} onChange={set("detail")} />
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <button data-testid="wf-create-submit" onClick={create} disabled={busy}
            className={`flex h-11 w-full items-center justify-center rounded-pill px-6 text-sm font-medium disabled:opacity-50 sm:w-auto ${INK_PILL}`}>
            {busy ? t("workflows.creating", "Creating…") : t("workflows.create")}
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
              as code in mono. 2026-09-14: the soft glass field every
              other textarea on the page now uses. */}
          <textarea data-testid="wf-override-reason" className={`${DRAWER_FIELD} resize-none`} rows={3}
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
function StandaloneHeader({ show, title, pipelines, activeKey, countOf, onPick, newDialog }) {
  if (!show) return null;
  const active = pipelines.find((p) => p.key === activeKey);
  const activeCount = countOf(activeKey);
  return (
    <StickyHeader className="mb-3 flex flex-col gap-6 lg:hidden" data-testid="workflows-mobile-header">
      <h1 className="font-display text-3xl">{title}</h1>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="workflows-pipeline-menu"
              aria-label="Choose pipeline"
              className="kr-pop flex h-11 min-w-0 flex-1 items-center gap-2 rounded-pill px-4 text-sm font-medium">
              <ListBullets size={16} weight="bold" aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{active?.label || "Pipeline"}</span>
              {/* 2026-09-19 — the phone showed which pipeline, never how many. */}
              {activeCount != null && (
                <span className="shrink-0 font-mono text-xs tabular-nums opacity-60" data-testid="workflows-pipeline-menu-count">
                  {activeCount}
                </span>
              )}
              <CaretDown size={12} weight="bold" aria-hidden="true" className="shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          {/* 2026-09-14, founder — the app's glass list, not the stock popover. */}
          <DropdownMenuContent align="start" sideOffset={8} className={`${GLASS_MENU} min-w-[14rem] p-1.5`}>
            {pipelines.map((pip) => (
              <DropdownMenuItem key={pip.key} onSelect={() => onPick(pip.key)}
                data-testid={`workflows-pipeline-${pip.key}`}
                className={`${GLASS_MENU_ITEM} justify-between gap-3 ${activeKey === pip.key ? "font-semibold text-slate-900" : ""}`}>
                <span>{pip.label}</span>
                <span className="tabular-nums text-xs text-slate-500">{countOf(pip.key) ?? ""}</span>
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
   than from a pill inside My Work. ASK-42 C — and `embedded` is GONE with the
   last thing that used it: My Work's desktop tree rendered this board inside
   itself under a view pill, which is the arrangement the founder has now
   retired on both breakpoints. One way in, one header, one layout. What
   changed when the page became standalone is
   branch, which now looks like every other room: a pinned title, and one row
   under it carrying the pipeline picker and the primary action. */
export default function Workflows() {
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
  /* 2026-09-19 — every pipeline's count, from the server. The board above
     loads one pipeline at a time, and the counts used to be taken from that
     one list: the pipeline on screen showed its number and every other one
     showed 0 until you clicked it (desktop pills and the phone's menu alike). */
  const { data: pipelineCounts } = useQuery({
    queryKey: ["workflows-counts"],
    queryFn: () => api.get("/workflows/counts").then((r) => r.data),
  });
  // Until the counts arrive, the pipeline on screen can still say its own
  // number; the others say nothing rather than a wrong 0.
  const countOf = (key) => (pipelineCounts
    ? (pipelineCounts[key] || 0)
    : (key === activeKey && data ? data.length : null));

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

  const [openId, setOpenId] = useState(null);             // C1 — the card open in the drawer
  /* 2026-09-21 — work left behind: {wf, targetStage, stageLabel, tasks, choices}
     while the "Move on" review is open. */
  const [leftCtx, setLeftCtx] = useState(null);
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
    qc.invalidateQueries({ queryKey: ["workflow"] });   // C1 — the open card too
    qc.invalidateQueries({ queryKey: ["workflows", activeKey, "with_tasks"] });
    qc.invalidateQueries({ queryKey: ["workflows-counts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }, [qc, activeKey]);

  const _postAdvance = async (wf, targetStage, opts = {}) => {
    const body = { stage: targetStage, note: t("workflows.moved_to", { stage: labelOf(targetStage) }) };
    if (opts.override) { body.override = true; body.reason = opts.reason; }
    if (opts.resolutions) body.resolutions = opts.resolutions;
    const { data } = await api.patch(`/workflows/${wf.id}/advance`, body);
    /* A5 (2026-09-21) — the engine has always detected the second of two
       people pressing at once (the compare-and-swap on stage_version), and the
       route used to drop that flag, so the person who LOST the race got the
       same green "→ Dispatched" as the one who won it. On a board two people
       share that is not a cosmetic difference: it is the card telling you that
       you moved something you did not. */
    if (data?.already_advanced) toast.info(`Someone else moved this to ${labelOf(data.stage)} first`);
    else toast.success(`→ ${labelOf(targetStage)}`);
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
      if (status === 409 && /task\(s\) still open/.test(detail)) {
        /* 2026-09-21 — THE GATE ASKS INSTEAD OF WALLING. Open work on the stage
           used to leave one way out: an override with a typed reason, and the
           work stranded behind the card. Now the person sees the tasks and says
           what happens to each; having answered, no override is needed. The
           gate itself is unchanged — nothing leaves a stage by accident. */
        try {
          const { data: left } = await api.get(`/workflows/${wf.id}/leftover`);
          setLeftCtx({ wf, targetStage, stageLabel: left.stage_label, tasks: left.tasks || [], choices: {} });
        } catch {
          setOverrideCtx({ wf, blockedReason: detail.replace(/^Stage not ready:\s*/, ""), targetStage });
        }
      } else if (status === 409) {
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
  /* C1 — opening a card. `dragId` guards the click that a browser fires at
     the end of a drag gesture: without it, dropping a card onto the next
     column also opened its drawer. */
  const openCard = (wf, e) => {
    if (e?.target?.closest?.("button, a")) return;
    if (dragId) return;
    setOpenId(wf.id);
  };

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
  const openCardRow = (data || []).find((w) => w.id === openId) || null;

  /* C2 — the same read the Desk does, over the cards already on screen. */
  const attention = useMemo(() => workflowAttention({
    workflows: data || [],
    userId: user?.id,
    isOwner: user?.role === "owner",
    pipelines,
  }), [data, user, pipelines]);
  const readOf = useMemo(
    () => new Map((attention.cards || []).map((c) => [c.w.id, c])),
    [attention],
  );

  return (
    /* ASK-25 — THE COLUMNS SCROLL, NOT THE PAGE. From lg the page is a flex
       column that fills the frame Layout (or My Work's hub) hands it; the
       header keeps its height and the board takes the rest, and inside the
       board each stage's card list is the scroller. Founder: "entire page is
       scrollable instead, that particular column must be scrollable." The
       phone is untouched — it stacks and scrolls the document as before. */
    <div data-testid="workflows-page" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <StandaloneHeader
        show
        title={t("workflows.title")}
        pipelines={pipelines}
        activeKey={activeKey}
        countOf={countOf}
        onPick={(k) => setTab(k)}
        newDialog={
          <NewWorkflowDialog
            type={activeKey} typeLabel={tabLabel} custLabel={L.customer_singular} vendLabel={L.vendor_singular}
            onCreated={refresh} />
        }
      />
      <header className="hidden lg:mb-7 lg:flex lg:flex-wrap lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("workflows.eyebrow")}</p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">{t("workflows.title")}</h1>
        </div>

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
            const count = countOf(pip.key);
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
                {count != null && (
                  <span className={`font-mono text-xs tabular-nums ${active ? "opacity-70" : "opacity-55"}`}>{count}</span>
                )}
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
      {/* C4 (2026-09-21) — WHAT IS GOING ON, ABOVE THE BOARD. A founder
          opening this page could count the cards and nothing else: whether any
          of them had stalled, run late, or were waiting on them took reading
          every column. The Desk has been able to answer this since ASK-52;
          the board it describes could not. Rendered at every width — the phone
          needs it most, where only one stage is on screen at a time. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground"
        data-testid="workflow-summary">
        <span className="font-medium text-foreground" data-testid="workflow-summary-running">
          {attention.total} running
        </span>
        {attention.needAttention > 0 ? (
          <>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted-foreground/50" />
            <span data-testid="workflow-summary-attention" className="font-medium text-kr-accent">
              {attention.needAttention} need{attention.needAttention === 1 ? "s" : ""} attention
            </span>
            {attention.you > 0 && <span data-testid="workflow-summary-you">· {attention.you} on you</span>}
            {attention.stuck > 0 && <span data-testid="workflow-summary-stuck">· {attention.stuck} stuck</span>}
            {attention.late > 0 && <span data-testid="workflow-summary-late">· {attention.late} late</span>}
          </>
        ) : attention.total > 0 && (
          <>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted-foreground/50" />
            <span data-testid="workflow-summary-clear">nothing is waiting</span>
          </>
        )}
        {attention.advancedToday > 0 && (
          <>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted-foreground/50" />
            <span data-testid="workflow-summary-today">{attention.advancedToday} moved today</span>
          </>
        )}
      </div>
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
      {/* ASK-18 (2026-09-13): the well is back on desktop — the founder
          wanted the sunken tray look for the whole board, just not the
          per-column white cards. Columns clear their own background below
          (bg-none) so only the outer well reads as a container. */}
      <div className="flex flex-col gap-3 lg:kr-glass-well lg:min-h-0 lg:flex-1 lg:gap-0 lg:p-4 lg:overflow-x-auto" data-testid="workflow-board">
        {/* 2026-09-14 — lg:pb-6 is room for the lanes' drop shadow (.kr-lane).
            The board scrolls, so it clips at its padding edge, and with ASK-25
            stretching every lane to the board's floor that shadow would end
            in a hard line along the bottom. */}
        <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:min-w-max lg:flex-row lg:items-stretch lg:pb-6">
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
                /* While a drag is live the column also says "this one accepts"
                   or "this one does not".
                   KM-31 — the mobile stage was .nm-tile: a solid white slab
                   sitting on the sky like a sticker. It is .kr-frost now — the
                   same light glass the Desk's "today's read" wears — so the
                   bloom reads through it.
                   2026-09-14, founder — desktop drops the transparent column
                   it had kept since ASK-18: with only the blur left, the lane
                   blended into the board and the cards into the lane. It wears
                   .kr-lane (index.css), glass drawn by depth and a rim glow,
                   padded so the cards sit inside it rather than on its edge.
                   lg:min-h-0 is ASK-25's: the lane shrinks to the board so its
                   card list scrolls inside it. */
                className={`flex w-full flex-col rounded-tile transition-all kr-frost p-2 lg:kr-lane lg:p-2.5 lg:w-[300px] lg:shrink-0 lg:min-h-0 ${
                  isTarget ? "bg-kr-accent/10 ring-2 ring-kr-accent/60"
                  : dropOk ? "ring-1 ring-dashed ring-foreground/30"
                  : dragId && !isSource ? "opacity-40"
                  : ""
                }`}
              >
                {/* Header row — clickable on mobile to toggle collapse. On
                    desktop it stays a plain non-interactive label.
                    ASK-16 (2026-09-13): desktop centres the label + count
                    over the column width; mobile keeps the caret on the
                    right where the tap target sits. */}
                <button
                  type="button"
                  onClick={() => toggleStage(stg.key)}
                  data-testid={`stage-toggle-${stg.key}`}
                  aria-expanded={isOpen}
                  className="flex items-center justify-between gap-2 px-1.5 pb-2 pt-1 text-left lg:justify-center lg:pointer-events-none"
                >
                  <span className="inline-flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold">{stg.label}</span>
                    <span className="font-mono text-sm tabular-nums opacity-50">{cards.length}</span>
                  </span>
                  <CaretDown
                    size={13}
                    weight="bold"
                    aria-hidden="true"
                    className={`text-muted-foreground transition-transform lg:hidden ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {/* KR-14.21 · MOBILE — when expanded, cards render as a
                    HORIZONTAL scroller (`-mx-2 overflow-x-auto flex-row`).
                    Desktop keeps the original vertical stack. */}
                {/* ASK-25 — from lg this list is the column's own scroller:
                    min-h-0 lets it shrink to the board's height and
                    overflow-y-auto scrolls the cards inside it, so a long
                    stage never lengthens the page. */}
                <div className={`min-h-[140px] flex-1 gap-3 p-1.5 lg:min-h-0 lg:overflow-y-auto lg:flex lg:flex-col ${
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
                    const read = readOf.get(w.id);   // C2 — why this card is asking
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
                        onClick={(e) => openCard(w, e)}
                        /* KM-31 — the card was a fixed w-64 in a horizontal
                           scroller, so inside a 343px stage it sat flush left
                           with a band of empty stage showing down its right
                           side: the "not centred in the outer card" the founder
                           reported. On mobile it fills the stage instead and
                           the height floors rather than fixes, so a short card
                           is short. The scroller keeps its fixed 256px track
                           from lg up, where several columns are side by side. */
                        className={`kr-bento group cursor-grab p-3 active:cursor-grabbing w-full min-h-[220px] lg:w-64 lg:h-[260px] lg:shrink-0 flex flex-col overflow-hidden text-left lg:h-auto lg:w-auto lg:overflow-visible lg:p-3.5 ${
                          dragging ? "opacity-40" : ""
                        } ${busyId === w.id ? "opacity-60" : ""} ${
                          w.id === focusWf ? "ring-2 ring-kr-ink ring-offset-2" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <DotsSixVertical size={15} weight="bold" aria-hidden="true"
                            className="mt-0.5 hidden shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-80 lg:block" />
                          {/* The title is the way IN, and it is a button so a
                              keyboard reaches the card too — the body click
                              below is only a convenience for a mouse. */}
                          <button type="button" onClick={() => setOpenId(w.id)}
                            data-testid={`open-workflow-${w.id}`}
                            aria-label={`Open ${w.title}`}
                            className="min-w-0 flex-1 text-left text-sm font-semibold leading-snug line-clamp-2 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline">
                            {w.title}
                          </button>
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

                        {/* C2 — the one reason that matters most, in the
                            board's own words. The worse reason wins (late,
                            then stuck, then you), which is the same rule the
                            Desk counts by, so the strip above and the badges
                            here can never disagree. */}
                        {read?.reason && (
                          <div className="mt-1.5 lg:pl-[23px]">
                            <span data-testid={`wf-attention-${w.id}`} data-reason={read.reason}
                              className={`inline-flex items-center gap-1 rounded-pill px-2 py-[3px] text-[10.5px] font-semibold leading-none ring-1 ring-inset ${
                                read.reason === "late" ? "bg-red-50 text-red-700 ring-red-100"
                                : read.reason === "stuck" ? "bg-amber-50 text-amber-800 ring-amber-100"
                                : "bg-slate-900 text-white ring-slate-900"
                              }`}>
                              <WarningCircle size={10} weight="bold" aria-hidden="true" />
                              {read.reason === "late"
                                ? `${read.overdueBy} ${read.overdueBy === 1 ? "day" : "days"} late`
                                : read.reason === "stuck" ? `Stuck ${read.idleDays}d`
                                : read.needsSignOff && !read.mine ? "Needs your sign-off" : "Needs you"}
                            </span>
                          </div>
                        )}

                        {(w.counterparty || w.amount != null) && (
                          <div className="mt-1.5 flex items-baseline justify-between gap-2 lg:pl-[23px]">
                            {w.counterparty && <span className="truncate text-xs text-muted-foreground">{w.counterparty}</span>}
                            {w.amount != null && <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">{money(w.amount, tenant?.currency)}</span>}
                          </div>
                        )}
                        {/* ASK-32 4.4 — the decision this card came from. */}
                        {w.decision_id && w.decision_title && (
                          <a href={`/inbox?decision=${encodeURIComponent(w.decision_id)}`} draggable={false}
                            onClick={(e) => e.stopPropagation()} data-testid={`wf-card-decision-${w.id}`}
                            className="mt-1 block truncate text-[11px] text-muted-foreground underline-offset-2 hover:underline lg:pl-[23px]">
                            From decision: {w.decision_title}
                          </a>
                        )}

                        {/* C3 — how far through THIS stage the card is. The
                            board used to say only where a card sat, so "In
                            production" read identically on the day it arrived
                            and on the day it was one task from leaving. */}
                        {w.stage_total > 0 && (
                          <p className="mt-2 font-mono text-[10.5px] tabular-nums text-muted-foreground lg:pl-[23px]"
                            data-testid={`wf-card-stage-progress-${w.id}`}>
                            {w.stage_done} of {w.stage_total} done at this stage
                          </p>
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

      {/* 2026-09-21 — work left behind, on the board's own move. */}
      <Dialog open={!!leftCtx} onOpenChange={(v) => { if (!v) setLeftCtx(null); }}>
        <DialogContent className="max-w-lg max-h-[calc(90vh/var(--ui-scale,1))] overflow-y-auto" data-testid="wf-leftover-dialog">
          {/* pr-8: the dialog's close sits at the top right — the words must not run under it. */}
          <DialogHeader className="pr-8">
            <DialogTitle>Move on to {leftCtx ? labelOf(leftCtx.targetStage) : ""}?</DialogTitle>
            <DialogDescription>
              {leftCtx && (leftCtx.tasks.length === 1 ? "1 task is" : `${leftCtx.tasks.length} tasks are`)} still open
              on {leftCtx?.stageLabel}. Say what happens to each — anything you leave on Keep moves with the card.
            </DialogDescription>
          </DialogHeader>
          {leftCtx && (
            <LeftoverReview tasks={leftCtx.tasks} value={leftCtx.choices}
              onChange={(upd) => setLeftCtx((c) => (c ? { ...c, choices: typeof upd === "function" ? upd(c.choices) : upd } : c))}
              toLabel={labelOf(leftCtx.targetStage)} testid="wf-leftover-review" />
          )}
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setLeftCtx(null)}
              className="min-h-10 rounded-pill px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
              Not yet
            </button>
            <button type="button" data-testid="wf-leftover-confirm" disabled={busyId === leftCtx?.wf?.id}
              onClick={async () => {
                const ctx = leftCtx;
                if (!ctx) return;
                setBusyId(ctx.wf.id);
                try {
                  // Every open task is answered: an unchosen one is sent as Keep.
                  const resolutions = Object.fromEntries(ctx.tasks.map((t) => [t.id, ctx.choices[t.id] || "keep"]));
                  await _postAdvance(ctx.wf, ctx.targetStage, { resolutions });
                  setLeftCtx(null);
                } catch (e) {
                  toast.error(e.response?.data?.detail || t("workflows.cannot_advance"));
                } finally {
                  setBusyId(null);
                }
              }}
              className="min-h-10 rounded-pill bg-neutral-900 px-5 text-sm font-semibold text-white disabled:opacity-50">
              Move to {leftCtx ? labelOf(leftCtx.targetStage) : ""}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* C1 — the card, opened. Everything a person could not do to a workflow
          (add a task to a stage, give a stage's approval, correct the card)
          lives in here, because each one is a thing you do to a stage. */}
      <WorkflowDetail
        workflowId={openId}
        open={!!openId}
        onOpenChange={(v) => { if (!v) setOpenId(null); }}
        onChanged={refresh}
        onAdvance={(card, stageKey) => moveTo(openCardRow || card, stageKey)}
      />

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
