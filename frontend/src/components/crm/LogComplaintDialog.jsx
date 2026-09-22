/* JOURNEY-1 J8 — LOG A COMPLAINT AGAINST A BUYER.
 *
 * The Desk counts open complaints, the buyer's card turns red for one and the
 * Operating Score takes points off for each — but nothing on screen could log
 * one. The only windows that ever posted to /complaints were the retired
 * Contacts page and a phone view nobody opens, so a complaint could only come
 * in by WhatsApp. This is that window, on the buyer's page (desktop and phone)
 * and inside the buyer's edit window on CRM.
 *
 * What happened and how serious — the server's two fields (models/complaints.py).
 * Half-typed words are kept (lib/drafts.js), one draft per buyer, the way
 * every other form here keeps them since PILOT-1 A.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Warning, X } from "@phosphor-icons/react";
import api from "../../lib/api";
import { cn } from "../../lib/utils";
import { useDraft } from "../../hooks/useDraft";
import { DraftNote } from "../karma/DraftNote";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { DRAWER_TRACK, GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL } from "../karma/glass";

const SEVERITY = [
  { key: "low", label: "Minor" },
  { key: "medium", label: "Serious" },
  { key: "high", label: "Urgent" },
];
const BLANK = { text: "", severity: "medium" };

/** Refresh everything that counts open complaints: CRM's cards, the buyer's
 *  page, the Desk's tile and the Operating Score. */
export function invalidateComplaintViews(qc, contactId) {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey?.[0] ?? "");
      return k.startsWith("complaints") || k.startsWith("desk") || k.startsWith("operating")
        || k === "crm-contacts" || (k === "contact-profile" && (!contactId || q.queryKey?.[1] === contactId));
    },
  });
}

export function LogComplaintDialog({ contact, onClose, onSaved }) {
  const qc = useQueryClient();
  const open = !!contact;
  const [form, setForm, draft] = useDraft(contact ? `complaint:${contact.id}` : null, BLANK);
  const [busy, setBusy] = useState(false);
  const who = contact?.company && contact.company !== contact.name ? `${contact.name} · ${contact.company}` : contact?.name;

  const save = async () => {
    const text = form.text.trim();
    if (!text) { toast.error("Say what went wrong first"); return; }
    setBusy(true);
    try {
      await api.post("/complaints", { customer_id: contact.id, text, severity: form.severity });
      toast.success("Complaint logged");
      draft.discard();
      invalidateComplaintViews(qc, contact.id);
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not log the complaint — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="complaint-dialog"
        className={`max-h-[calc(90dvh/var(--ui-scale,1))] max-w-lg gap-5 overflow-y-auto rounded-[1.75rem] p-6 sm:rounded-[1.75rem] [&>button.absolute]:hidden ${GLASS_SHEET}`}>
        <div className="flex items-start gap-3.5">
          <span aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/85 text-rose-600 ring-1 ring-inset ring-slate-900/[0.06]">
            <Warning size={22} weight="regular" />
          </span>
          <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
            <DialogTitle className="text-lg font-semibold text-neutral-900">Log a complaint</DialogTitle>
            <DialogDescription className="truncate text-sm text-neutral-600">{who}</DialogDescription>
          </DialogHeader>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" data-testid="complaint-close" className={GLASS_ICON_BTN}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {draft.restored && (
          <DraftNote onDiscard={() => draft.discard()} label="Kept from before — not saved yet" testid="complaint-draft" className="-my-2" />
        )}

        <div>
          <label htmlFor="complaint-text" className="mb-1.5 block text-xs font-medium text-slate-600">
            What went wrong<span className="text-rose-600"> *</span>
          </label>
          <textarea id="complaint-text" data-testid="complaint-text" rows={4} autoFocus
            value={form.text} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, text: v })); }}
            placeholder="e.g. Shade mismatch on 200 m of indigo shirting, lot 44"
            className="nm-field w-full resize-none px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400" />
        </div>

        <div>
          <p id="complaint-severity-label" className="mb-1.5 text-xs font-medium text-slate-600">How serious</p>
          <div role="radiogroup" aria-labelledby="complaint-severity-label" data-testid="complaint-severity"
            className={`flex gap-1 rounded-pill p-1 ${DRAWER_TRACK}`}>
            {SEVERITY.map((s) => {
              const on = form.severity === s.key;
              return (
                <button key={s.key} type="button" role="radio" aria-checked={on} data-testid={`complaint-severity-${s.key}`}
                  onClick={() => setForm((f) => ({ ...f, severity: s.key }))}
                  className={cn("flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-pill px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
                    on ? `${GLASS_PILL} text-slate-900` : "text-slate-500 hover:text-slate-800")}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { draft.discard(); onClose(); }} disabled={busy} data-testid="complaint-cancel"
            className={`min-h-11 rounded-pill px-5 text-sm font-medium text-neutral-800 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline disabled:opacity-40 ${GLASS_PILL}`}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} data-testid="complaint-save"
            className={`min-h-11 rounded-pill px-6 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline disabled:opacity-50 ${INK_PILL}`}>
            {busy ? "Logging…" : "Log complaint"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LogComplaintDialog;
