import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { kindLabel } from "../../lib/party";

/* Epic 11 S12 — old data gets a review list, not silent changes. Work written
   before Sprint 12 names its customers and suppliers only in words; this lists
   what names exactly one of them ("these 12 tasks name Nippon Audiotronix"),
   everything ticked, for one Link. Untick anything that is wrong. Nothing
   changes until Link is pressed, and a link somebody made meanwhile is kept. */
const KIND_WORD = { task: "task", decision: "decision", workflow: "workflow card" };

export function LinkSuggestionsDialog({ open, onOpenChange }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["crm-link-suggestions"],
    queryFn: async () => (await api.get("/crm/link-suggestions")).data,
    enabled: open,
  });
  const groups = useMemo(() => q.data?.groups || [], [q.data]);
  const all = useMemo(() => groups.flatMap((g) => g.items.map((i) => `${i.kind}:${i.id}:${g.contact.id}`)), [groups]);
  const [off, setOff] = useState(new Set());
  const [openGroup, setOpenGroup] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setOff(new Set()); setOpenGroup(null); } }, [open]);
  const toggle = (k) => setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const picked = all.filter((k) => !off.has(k));

  const link = async () => {
    setBusy(true);
    try {
      const links = picked.map((k) => { const [kind, id, contact_id] = k.split(":"); return { kind, id, contact_id }; });
      const { data } = await api.post("/crm/link-suggestions", { links });
      toast.success(`Linked ${data.count} to their customers and suppliers`);
      qc.invalidateQueries({ queryKey: ["crm-link-suggestions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not link them");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" data-testid="link-suggestions-dialog">
        <DialogHeader>
          <DialogTitle>Link old work to customers and suppliers</DialogTitle>
          <DialogDescription>
            Tasks, decisions and workflow cards that name exactly one of them. Untick anything that's wrong — nothing changes until you press Link.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading && <p className="text-sm text-slate-500">Reading your old work…</p>}
        {!q.isLoading && !groups.length && (
          <p className="text-sm text-slate-600" data-testid="link-suggestions-empty">Nothing to link — your work already names its customers and suppliers.</p>
        )}
        <ul className="space-y-2">
          {groups.map((g) => {
            const keys = g.items.map((i) => `${i.kind}:${i.id}:${g.contact.id}`);
            const on = keys.filter((k) => !off.has(k)).length;
            const expanded = openGroup === g.contact.id;
            return (
              <li key={g.contact.id} className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-inset ring-slate-200"
                data-testid={`link-group-${g.contact.id}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={on === keys.length} aria-label={`Link all to ${g.contact.name}`}
                    ref={(el) => { if (el) el.indeterminate = on > 0 && on < keys.length; }}
                    onChange={() => setOff((s) => { const n = new Set(s); (on === keys.length ? keys.forEach((k) => n.add(k)) : keys.forEach((k) => n.delete(k))); return n; })}
                    className="h-4 w-4" />
                  <button type="button" onClick={() => setOpenGroup(expanded ? null : g.contact.id)}
                    className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold text-slate-900">{g.contact.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      {kindLabel(g.contact.kind)} · {on} of {keys.length} ticked · {expanded ? "hide" : "show"}
                    </span>
                  </button>
                </div>
                {expanded && (
                  <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {g.items.map((i) => {
                      const k = `${i.kind}:${i.id}:${g.contact.id}`;
                      return (
                        <li key={k}>
                          <label className="flex items-start gap-2 text-xs text-slate-700">
                            <input type="checkbox" checked={!off.has(k)} onChange={() => toggle(k)} className="mt-0.5 h-3.5 w-3.5" />
                            <span><span className="text-slate-400">{KIND_WORD[i.kind]} · </span>{i.title}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {!!groups.length && (
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)}
              className="min-h-10 rounded-pill px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100">Not now</button>
            <button type="button" disabled={busy || !picked.length} onClick={link} data-testid="link-suggestions-link"
              className="min-h-10 rounded-pill bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40">
              Link {picked.length}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
