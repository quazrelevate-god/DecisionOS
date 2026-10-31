import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { DRAWER_FIELD, GLASS_PILL, INK_PILL } from "../neuglass/glass";
import { PartySheet, SHEET_BTN } from "./PartySheet";

/* Epic 11 S12 — a task about a customer or supplier that CRM has only a name
   for is finished: the person who did it is the one most likely to know their
   phone and GST number. Asked once, here; every field optional; "Later" leaves
   it in the Details-needed list, "Nothing to add" takes it off, and so does a
   saved phone number (the server's rule).
   (POST /tasks/:id/party-details: blank fields only, never overwrites.)

   task: a task with contact_summary {id, name, needs_details} */
/* Ask from anywhere a task is finished. The host is mounted once (App.js), so
   the question survives the finished task leaving the list it was in — asked
   from inside the task's card, it unmounted with the card. */
const EVENT = "dos:party-details";
export function askPartyDetails(task) {
  // After the task's own drawer has settled: its focus coming home would
  // otherwise read as "focus left the prompt" and close it at once.
  if (task?.contact_summary?.needs_details) {
    setTimeout(() => window.dispatchEvent(new CustomEvent(EVENT, { detail: task })), 400);
  }
}

export function PartyDetailsHost() {
  const [task, setTask] = useState(null);
  const qc = useQueryClient();
  useEffect(() => {
    const on = (e) => setTask(e.detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <PartyDetailsPrompt task={task} open={!!task} onOpenChange={(v) => !v && setTask(null)}
      onSaved={() => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["parties-needs-details"] }); }} />
  );
}

export function PartyDetailsPrompt({ task, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ phone: "", tax_id: "", address: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm({ phone: "", tax_id: "", address: "" }); }, [open, task?.id]);
  const party = task?.contact_summary;
  if (!party) return null;
  const save = async (done) => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/party-details`, { ...form, done });
      toast.success(done && !form.phone ? `${party.name} is off the Details needed list` : `Saved to ${party.name} in CRM`);
      onSaved && onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save it");
    } finally { setBusy(false); }
  };
  const field = (key, label, props = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} aria-label={label}
        data-testid={`party-details-${key}`} className={`${DRAWER_FIELD} h-11 py-0 text-sm`} />
    </label>
  );
  const any = Object.values(form).some((v) => v.trim());
  return (
    <PartySheet open={open} onOpenChange={onOpenChange} testid="party-details-prompt"
      contentProps={{ onFocusOutside: (e) => e.preventDefault() }}
      title={`Add details for ${party.name}?`}
      description={`You've finished “${task.title}”. CRM only has their name. Add what you know; every field is optional.`}
      footer={<>
        <button type="button" onClick={() => onOpenChange(false)} disabled={busy} data-testid="party-details-later"
          className={`${SHEET_BTN} mr-auto text-slate-600 hover:bg-slate-900/[0.05]`}>Later</button>
        <button type="button" onClick={() => save(true)} disabled={busy} data-testid="party-details-nothing"
          className={`${SHEET_BTN} ${GLASS_PILL}`}>
          {any ? "Save, that's everything" : "Nothing to add"}
        </button>
        <button type="button" onClick={() => save(false)} disabled={busy || !any} data-testid="party-details-save"
          className={`${SHEET_BTN} px-5 text-white ${INK_PILL}`}>Save</button>
      </>}>
      <div className="space-y-3">
        {field("phone", "Phone", { inputMode: "tel", type: "tel", autoComplete: "off", placeholder: "+91 98765 43210" })}
        {field("tax_id", "GST number", { placeholder: "33ABCDE1234F1Z5", maxLength: 15, autoCapitalize: "characters" })}
        {field("address", "Address", { placeholder: "Town, area or full address" })}
        <p className="text-[11px] leading-snug text-slate-500">
          A phone number takes them off CRM's Details needed list.
        </p>
      </div>
    </PartySheet>
  );
}
