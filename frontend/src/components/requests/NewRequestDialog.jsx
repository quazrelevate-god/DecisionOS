/* Requests (2026-10-21) — the form that raises one.
 *
 * What, how much, by when and why, and who says yes. One request carries as
 * many items as the person needs (twenty bags of cement AND two loads of sand
 * are one trip to the supplier, not two approvals), with the total added up as
 * they type. The approver is the requester's choice: their reporting manager,
 * which is the default, or the owner. An owner's own request has nobody above
 * it, so it is recorded already approved and goes straight to Finance — the
 * same rule leave follows — and the form says so before they press anything.
 *
 * Controlled (`open` / `onOpenChange`): My Work's "+" opens it from a menu.
 * The sheet is the New Task sheet's shape — full-bleed on a phone, centred on a
 * laptop — so the two forms behind the one "+" feel like one family.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import { X, Plus, Paperclip, Trash, UserCircle, Crown, Info } from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useDraft } from "../../hooks/useDraft";
import { REQUEST_TYPES, requestType, blankItem, itemsTotal } from "../../lib/requests";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { GlassDateField } from "../neuglass/GlassDateField";
import { DraftNote } from "../neuglass/DraftNote";
import { DRAWER_LABEL, DRAWER_TRACK, GLASS_PILL, INK_PILL } from "../neuglass/glass";

const MAX_FILES = 10;
const blank = () => ({ type: "purchase", title: "", items: [blankItem()], needed_by: "", reason: "", approver_choice: "manager" });

// The fields are the New Task form's sunken glass (Tasks.js `inp`).
const INP = "w-full ng-pressed rounded-control border border-solid border-ng-ink/25 px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground/40 transition-colors focus:border-ng-ink focus:outline-none focus-visible:outline-none";
const TITLE_INP = "w-full rounded-none border-0 border-b-2 border-solid border-ng-ink/15 bg-transparent px-0.5 pb-2 pt-1 font-display text-xl text-foreground placeholder:text-foreground/35 transition-colors focus:border-ng-ink focus:outline-none focus-visible:outline-none";

export function NewRequestDialog({ open, onOpenChange, onCreated }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm, formDraft] = useDraft("new-request", blank());
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const fileRef = useRef(null);

  const optsQ = useQuery({
    queryKey: ["requests", "approver-options"],
    queryFn: () => api.get("/requests/approver-options").then((r) => r.data),
    enabled: open,
    staleTime: 60_000,
  });
  const opts = optsQ.data;
  const selfOwner = !!opts?.self_owner;
  // The choice the form can honour: "manager" with nobody set is the owner.
  const choice = !opts ? form.approver_choice
    : form.approver_choice === "owner" && opts.owner ? "owner"
    : opts.manager ? "manager" : "owner";

  // Opening reads a kept draft again (the dialog stays mounted between visits).
  useEffect(() => {
    if (open) formDraft.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const kind = requestType(form.type);
  const items = form.items?.length ? form.items : [blankItem()];
  const total = itemsTotal(items);
  const named = items.filter((it) => it.name.trim());

  const setItem = (i, k, v) => {
    setProblem("");
    setForm({ ...form, items: items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) });
  };
  const addItem = () => setForm({ ...form, items: [...items, blankItem()] });
  const removeItem = (i) => setForm({ ...form, items: items.length > 1 ? items.filter((_, j) => j !== i) : [blankItem()] });

  const close = () => { setFiles([]); setProblem(""); onOpenChange?.(false); };
  const discard = () => { formDraft.discard(); setForm(blank()); setFiles([]); setProblem(""); };

  const pickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    setFiles((cur) => [...cur, ...picked].slice(0, MAX_FILES));
  };

  const submit = async () => {
    if (!named.length) { setProblem("Add at least one item — what do you need?"); return; }
    if (kind.finance && total <= 0) { setProblem("Add the amount for at least one item, so your approver knows what it costs."); return; }
    setBusy(true);
    try {
      // The bill or photo goes up first; the request carries the ids.
      const attachment_ids = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f, f.name);
        fd.append("kind", "reference");
        try {
          const { data } = await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
          if (data?.id) attachment_ids.push(data.id);
        } catch (err) {
          toast.error(`"${f.name}" didn't upload — ${err.response?.data?.detail || "the request goes without it"}`);
        }
      }
      const { data } = await api.post("/requests", {
        type: form.type,
        title: form.title.trim(),
        items: named.map((it) => ({
          name: it.name.trim(),
          quantity: kind.qty && it.quantity !== "" ? Number(it.quantity) : null,
          unit: kind.qty ? it.unit.trim() : "",
          amount: !kind.finance || it.amount === "" ? 0 : Number(it.amount),
        })),
        needed_by: form.needed_by || null,
        reason: form.reason.trim(),
        approver_choice: choice,
        attachment_ids,
      });
      toast.success(data?.status === "approved"
        ? (kind.finance ? `${data.number} recorded — it's in Finance to pay` : `${data.number} recorded`)
        : `${data.number} sent to ${data.approver_name || "your approver"}`);
      formDraft.discard();
      setForm(blank());
      setFiles([]);
      setProblem("");
      qc.invalidateQueries({ queryKey: ["requests"] });
      onOpenChange?.(false);
      onCreated?.(data);
    } catch (e) {
      setProblem(e.response?.data?.detail || "The request wasn't sent. Try again.");
    } finally { setBusy(false); }
  };

  const approverButton = (key, person, Icon, caption) => {
    const on = choice === key;
    return (
      <button key={key} type="button" role="radio" aria-checked={on} disabled={!person}
        aria-label={person ? `${person.name}, ${caption}` : `${caption}: not set`}
        onClick={() => setForm({ ...form, approver_choice: key })} data-testid={`request-approver-${key}`}
        className={`flex min-h-[3.25rem] flex-1 items-center gap-2.5 rounded-[1rem] px-3.5 py-2 text-left transition-colors disabled:opacity-40 ${
          on ? `${GLASS_PILL} text-neutral-900` : "text-neutral-600 hover:text-neutral-900"}`}>
        <Icon size={20} weight={on ? "fill" : "regular"} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{person?.name || "Not set"}</span>
          <span className="block text-xs text-neutral-500">{caption}</span>
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange?.(true) : close())}>
      <DialogContent
        data-testid="new-request-dialog"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className={`ng-bento flex flex-col border-0 [&>button.absolute]:hidden
                   left-0 top-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0
                   [border-radius:0]
                   [padding-top:max(1rem,var(--sa-top))]
                   [padding-bottom:max(1rem,var(--sa-bottom))]
                   lg:left-[50%] lg:top-[50%] lg:h-auto lg:max-h-[calc(100dvh/var(--ui-scale,1)-2rem)] lg:overflow-y-auto lg:max-w-2xl
                   lg:-translate-x-1/2 lg:-translate-y-1/2
                   lg:[border-radius:var(--radius-card)]
                   lg:[padding-block:1.25rem]
                   data-[state=open]:[--tw-enter-translate-x:0] data-[state=open]:[--tw-enter-translate-y:0]
                   data-[state=closed]:[--tw-exit-translate-x:0] data-[state=closed]:[--tw-exit-translate-y:0]
                   lg:data-[state=open]:[--tw-enter-translate-x:-50%] lg:data-[state=open]:[--tw-enter-translate-y:-48%]
                   lg:data-[state=closed]:[--tw-exit-translate-x:-50%] lg:data-[state=closed]:[--tw-exit-translate-y:-48%]`}
      >
        <DialogHeader className="shrink-0 pr-11">
          <DialogPrimitiveClose
            data-testid="request-dialog-close"
            aria-label="Close"
            className="ng-pop absolute right-4 top-[calc(var(--sa-top)+0.75rem)] grid h-11 w-11 place-items-center rounded-full text-foreground/70 [min-height:var(--touch-min)] [min-width:var(--touch-min)] lg:top-4 lg:h-9 lg:w-9 lg:[min-height:auto] lg:[min-width:auto]">
            <X size={15} weight="bold" aria-hidden="true" />
          </DialogPrimitiveClose>
          <DialogTitle className="font-display text-xl">New Request</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {kind.finance
              ? "Ask for what you need. Once it's approved, Finance pays or buys it."
              : "Ask for a yes. Approval closes it — nothing goes to Finance."}
          </DialogDescription>
          {formDraft.restored && (
            <DraftNote onDiscard={discard} label="Kept from before — not sent yet" testid="new-request-draft" className="-mb-2 pt-1" />
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-0.5 lg:flex-none lg:overflow-visible lg:pr-0">
          {/* What kind — seven doors, each saying what is behind it. */}
          <fieldset>
            <legend className={DRAWER_LABEL}>What kind of request</legend>
            <div role="radiogroup" aria-label="Kind of request" className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="request-type-picker">
              {REQUEST_TYPES.map((t) => {
                const on = form.type === t.key;
                const Icon = t.icon;
                return (
                  <button key={t.key} type="button" role="radio" aria-checked={on} title={t.hint} aria-label={t.label}
                    onClick={() => { setForm({ ...form, type: t.key }); setProblem(""); }}
                    data-testid={`request-type-${t.key}`}
                    className={`flex min-h-[3.25rem] items-center gap-2 rounded-[1rem] px-3 py-2 text-left text-[13px] leading-tight transition-colors ${
                      on ? `${INK_PILL} font-semibold` : `${GLASS_PILL} font-medium text-neutral-700 hover:text-neutral-900`}`}>
                    <Icon size={18} weight={on ? "fill" : "regular"} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0">{t.short}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="request-type-hint">{kind.label} — {kind.hint}.</p>
          </fieldset>

          <div>
            <label className="sr-only" htmlFor="request-title">Title</label>
            <input id="request-title" data-testid="request-title-input" className={TITLE_INP}
              placeholder={named.length ? `${named[0].name.trim()}${named.length > 1 ? ` and ${named.length - 1} more` : ""}` : "What is it for? (optional)"}
              value={form.title} maxLength={160}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>

          {/* The items, and their total as you type. */}
          <fieldset>
            <legend className={DRAWER_LABEL}>Items</legend>
            <ul className="space-y-2.5" data-testid="request-items">
              {items.map((it, i) => (
                <li key={i} className={`rounded-[1.1rem] p-2.5 ${DRAWER_TRACK}`} data-testid={`request-item-${i}`}>
                  <div className="flex items-center gap-2">
                    <input aria-label={`Item ${i + 1}`} data-testid={`request-item-name-${i}`} className={INP}
                      placeholder={i !== 0 ? "Another item" : !kind.finance ? "e.g. The company van on Saturday"
                        : kind.qty ? "e.g. Cement, 53 grade" : "e.g. Auto fare to the client"}
                      value={it.name} maxLength={200} onChange={(e) => setItem(i, "name", e.target.value)} />
                    <button type="button" onClick={() => removeItem(i)} aria-label={`Remove item ${i + 1}`}
                      data-testid={`request-item-remove-${i}`} disabled={items.length === 1 && !it.name && !it.amount}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-white/70 hover:text-neutral-900 disabled:opacity-30">
                      <Trash size={16} weight="regular" aria-hidden="true" />
                    </button>
                  </div>
                  <div className={`mt-2 grid gap-2 ${kind.qty && kind.finance ? "grid-cols-[1fr_1fr_1.3fr]" : kind.qty ? "grid-cols-2" : "grid-cols-1"} pr-12`}>
                    {kind.qty && (
                      <>
                        <input aria-label={`Quantity for item ${i + 1}`} data-testid={`request-item-qty-${i}`} className={`${INP} tabular-nums`}
                          inputMode="decimal" placeholder="Qty" value={it.quantity}
                          onChange={(e) => setItem(i, "quantity", e.target.value.replace(/[^\d.]/g, ""))} />
                        <input aria-label={`Unit for item ${i + 1}`} data-testid={`request-item-unit-${i}`} className={INP}
                          placeholder="Unit" maxLength={20} value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} />
                      </>
                    )}
                    {/* General is not about money: no amount to type. */}
                    {kind.finance && (
                      <div className="relative">
                        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-foreground/50">₹</span>
                        <input aria-label={`Amount for item ${i + 1}`} data-testid={`request-item-amount-${i}`} className={`${INP} pl-7 tabular-nums`}
                          inputMode="decimal" placeholder="Amount" value={it.amount}
                          onChange={(e) => setItem(i, "amount", e.target.value.replace(/[^\d.]/g, ""))} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3">
              <button type="button" onClick={addItem} data-testid="request-add-item" disabled={items.length >= 50}
                className={`flex h-10 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white disabled:opacity-40 ${GLASS_PILL}`}>
                <Plus size={14} weight="bold" aria-hidden="true" /> Add item
              </button>
              {kind.finance ? (
                <p className="text-right" data-testid="request-total">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Total</span>
                  <span className="font-display text-2xl tabular-nums leading-none text-neutral-900">{inr(total) || "₹0"}</span>
                </p>
              ) : (
                <p className="max-w-[14rem] text-right text-xs text-muted-foreground" data-testid="request-no-money">
                  No money involved — the approval closes it.
                </p>
              )}
            </div>
          </fieldset>

          <div className="ng-form-row">
            <div>
              <span className={`block ${DRAWER_LABEL}`}>Needed by</span>
              <GlassDateField testid="request-needed-by" ariaLabel="Needed by" placeholder="Any time"
                min={new Date().toISOString().slice(0, 10)}
                value={form.needed_by} onChange={(v) => setForm({ ...form, needed_by: v })}
                triggerClassName={INP} />
            </div>
            <div>
              <span className={`block ${DRAWER_LABEL}`}>Bill or photo</span>
              <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
                data-testid="request-file-input" onChange={pickFiles} />
              <button type="button" onClick={() => fileRef.current?.click()} data-testid="request-attach"
                disabled={files.length >= MAX_FILES}
                className={`flex h-11 w-full items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white disabled:opacity-40 ${GLASS_PILL}`}>
                <Paperclip size={15} weight="bold" aria-hidden="true" /> {files.length ? "Add another" : "Attach a bill or quote"}
              </button>
            </div>
          </div>
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2" data-testid="request-files">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className={`flex max-w-full items-center gap-1.5 rounded-pill py-1 pl-3 pr-1 text-xs text-neutral-700 ${GLASS_PILL}`}>
                  <Paperclip size={12} weight="bold" aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-900/5 hover:text-neutral-900">
                    <X size={11} weight="bold" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label className={`block ${DRAWER_LABEL}`} htmlFor="request-reason">Why it's needed</label>
            <textarea id="request-reason" data-testid="request-reason-input" className={`${INP} resize-none`} rows={2} maxLength={2000}
              placeholder="A line for your approver — the job it's for, why now"
              value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>

          {/* Who says yes — the requester's choice (client decision, 2026-10-21). */}
          <fieldset>
            <legend className={DRAWER_LABEL}>Send to</legend>
            {selfOwner ? (
              <p className={`flex items-start gap-2 rounded-[1.1rem] p-3 text-sm text-neutral-700 ${DRAWER_TRACK}`} data-testid="request-self-owner">
                <Info size={16} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-500" />
                You're the owner, so nobody else needs to approve this. It's recorded as approved{kind.finance ? " and goes straight to Finance" : ""}.
              </p>
            ) : optsQ.isError ? (
              <p className="text-sm text-muted-foreground" data-testid="request-approver-failed">
                Couldn't load who approves — it will go to your reporting manager, or the owner if you have none.
              </p>
            ) : (
              <>
                <div role="radiogroup" aria-label="Who approves" className={`flex gap-1 rounded-[1.25rem] p-1 ${DRAWER_TRACK}`} data-testid="request-approver">
                  {approverButton("manager", opts?.manager, UserCircle, "Your reporting manager")}
                  {approverButton("owner", opts?.owner, Crown, "Owner")}
                </div>
                {opts && !opts.manager && (
                  <p className="mt-2 text-xs text-muted-foreground" data-testid="request-no-manager">
                    No reporting manager is set for you, so this goes to the owner.
                  </p>
                )}
              </>
            )}
          </fieldset>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <p role={problem ? "alert" : undefined} data-testid="request-problem"
            className={`text-sm ${problem ? "font-medium text-ng-accent" : "text-muted-foreground"}`}>
            {problem || (user?.name ? `Raised by ${user.name}` : "")}
          </p>
          <button data-testid="request-submit" onClick={submit} disabled={busy}
            className={`flex h-11 w-full items-center justify-center rounded-pill px-6 text-sm font-medium disabled:opacity-50 sm:w-auto ${INK_PILL}`}>
            {busy ? "Sending…" : selfOwner ? "Record request" : "Send request"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
