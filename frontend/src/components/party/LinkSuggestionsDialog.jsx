import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { CaretDown } from "@phosphor-icons/react";
import { DesignCheckbox } from "../neuglass/DesignCheckbox";
import { GLASS_PILL, INK_PILL } from "../neuglass/glass";
import { PartySheet, SHEET_BTN } from "./PartySheet";
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
    <PartySheet open={open} onOpenChange={onOpenChange} testid="link-suggestions-dialog" wide
      title="Link old work to customers and suppliers"
      description="Tasks, decisions and workflow cards whose words name exactly one of them. Untick anything that's wrong. Nothing changes until you press Link."
      footer={groups.length ? <>
        <button type="button" onClick={() => onOpenChange(false)} className={`${SHEET_BTN} ${GLASS_PILL}`}>Not now</button>
        <button type="button" disabled={busy || !picked.length} onClick={link} data-testid="link-suggestions-link"
          className={`${SHEET_BTN} px-5 text-white ${INK_PILL}`}>
          {busy ? "Linking…" : `Link ${picked.length}`}
        </button>
      </> : null}>
      {q.isLoading && <p className="text-sm text-slate-500">Reading your old work…</p>}
      {!q.isLoading && !groups.length && (
        <p className="text-sm text-slate-600" data-testid="link-suggestions-empty">
          Nothing to link. No older task, decision or workflow card names one of your customers or suppliers on its own.
        </p>
      )}
      <ul className="space-y-2">
        {groups.map((g) => {
          const keys = g.items.map((i) => `${i.kind}:${i.id}:${g.contact.id}`);
          const on = keys.filter((k) => !off.has(k)).length;
          const expanded = openGroup === g.contact.id;
          return (
            <li key={g.contact.id} className="rounded-2xl bg-white/75 px-3.5 py-3 ring-1 ring-inset ring-slate-900/[0.06]"
              data-testid={`link-group-${g.contact.id}`}>
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <DesignCheckbox checked={on === keys.length} testid={`link-group-tick-${g.contact.id}`}
                    onChange={() => setOff((s) => { const n = new Set(s); (on === keys.length ? keys.forEach((k) => n.add(k)) : keys.forEach((k) => n.delete(k))); return n; })}>
                    <span className="block truncate font-semibold text-slate-900">{g.contact.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      {kindLabel(g.contact.kind)} · {on === keys.length ? `all ${keys.length}` : `${on} of ${keys.length}`} ticked
                    </span>
                  </DesignCheckbox>
                </div>
                <button type="button" onClick={() => setOpenGroup(expanded ? null : g.contact.id)}
                  aria-expanded={expanded} data-testid={`link-group-show-${g.contact.id}`}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-pill px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-900/[0.05]">
                  {expanded ? "Hide" : `Show ${keys.length}`}
                  <CaretDown size={12} weight="bold" aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
              </div>
              {expanded && (
                <ul className="mt-2.5 space-y-2 border-t border-slate-900/[0.06] pl-8 pt-2.5">
                  {g.items.map((i) => {
                    const k = `${i.kind}:${i.id}:${g.contact.id}`;
                    return (
                      <li key={k}>
                        <DesignCheckbox checked={!off.has(k)} onChange={() => toggle(k)} testid={`link-item-${i.kind}-${i.id}`}>
                          <span className="text-[13px] text-slate-700">
                            <span className="text-slate-400">{KIND_WORD[i.kind]} · </span>{i.title}
                          </span>
                        </DesignCheckbox>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </PartySheet>
  );
}
