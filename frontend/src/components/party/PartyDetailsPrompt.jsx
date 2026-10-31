import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";

/* Epic 11 S12 — a task about a customer or supplier that CRM has only a name
   for is finished: the person who did it is the one most likely to know their
   phone and GST number. Asked once, here; every field optional; "Later" leaves
   it in the Needs-details list, "Nothing to add" takes it off.
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
      toast.success(done && !form.phone ? `${party.name} is off the Needs details list` : `Saved to ${party.name} in CRM`);
      onSaved && onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save it");
    } finally { setBusy(false); }
  };
  const field = (key, label, props = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} aria-label={label}
        data-testid={`party-details-${key}`}
        className="mt-1 h-10 w-full rounded-xl bg-white px-3 text-sm ring-1 ring-inset ring-slate-200 outline-none focus:ring-slate-400" />
    </label>
  );
  const any = Object.values(form).some((v) => v.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="party-details-prompt" onFocusOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add {party.name}'s details?</DialogTitle>
          <DialogDescription>CRM only has their name. Fill in what you know — all optional.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {field("phone", "Phone", { inputMode: "tel", autoComplete: "off" })}
          {field("tax_id", "GST number", { placeholder: "33ABCDE1234F1Z5", maxLength: 15 })}
          {field("address", "Address")}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy} data-testid="party-details-later"
            className="min-h-10 rounded-pill px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">Later</button>
          <button type="button" onClick={() => save(true)} disabled={busy} data-testid="party-details-nothing"
            className="min-h-10 rounded-pill px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            {any ? "Save, that's all" : "Nothing to add"}
          </button>
          <button type="button" onClick={() => save(false)} disabled={busy || !any} data-testid="party-details-save"
            className="min-h-10 rounded-pill bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40">Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
