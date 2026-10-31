import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Buildings, CheckCircle, Scissors, UserCircle } from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { PARTY_KINDS, kindLabel, partyText } from "../../lib/party";
import { GLASS_PILL } from "../neuglass/glass";
import { PartyPicker } from "./PartyPicker";

/* Epic 11 S12 — the reviewer's word on who a proposed task, meeting or workflow
   is about, before approving (PATCH /decisions/:id/proposal/party). Every
   answer Dex gave can be changed here in one tap:

     Which Kumar?                 the candidates, the same kind first
     2 customers named            Split into one task each, or pick one
     New: Kumar Exports           its kind; or it is really one in CRM
     Sajith at MK Associates      save him as a contact there, or not
     anything                     a different record, or "not a customer or supplier"

   A name answered once is answered on every item naming it (the server's
   apply_same), so the same new party is one CRM record, not one per task. */
export function PartyDialog({ decisionId, item, open, onOpenChange, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (open) setPicking(false); }, [open, item?.key]);
  if (!item) return null;
  const p = item.party || {};
  const kindKey = item.item_kind || "tasks";

  const send = async (body, done) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/decisions/${decisionId}/proposal/party`,
        { item_kind: kindKey, key: item.key, ...body });
      onChanged && onChanged(data);
      if (done) toast.success(done);
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not change it");
    } finally { setBusy(false); }
  };
  const pick = (v) => (v.new
    ? send({ action: "new", name: v.name, kind: v.kind })
    : send({ action: "link", contact_id: v.id }));

  const btn = `min-h-10 rounded-pill px-3 text-xs font-semibold disabled:opacity-50 ${GLASS_PILL}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="party-dialog">
        <DialogHeader>
          <DialogTitle>Who is this about?</DialogTitle>
          <DialogDescription>
            “{item.title}” — {(partyText(p) || "no customer or supplier").replace(/([^?])$/, "$1.")} Nothing reaches CRM until the decision is approved.
          </DialogDescription>
        </DialogHeader>

        {p.status === "choose" && !picking && (
          <div className="space-y-1.5" data-testid="party-dialog-choose">
            <p className="text-xs font-semibold text-slate-600">Which one did they mean?</p>
            {(p.candidates || []).map((c) => (
              <button key={c.id} type="button" disabled={busy} onClick={() => send({ action: "link", contact_id: c.id })}
                data-testid={`party-dialog-candidate-${c.id}`}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-white/80 px-3 py-2 text-left text-sm ring-1 ring-inset ring-slate-200 hover:bg-white">
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{kindLabel(c.kind)}{c.phone ? ` · ${c.phone}` : ""}</span>
              </button>
            ))}
            <button type="button" disabled={busy} className={btn} data-testid="party-dialog-neither"
              onClick={() => send({ action: "new", name: p.said, kind: p.kind || "customer" })}>
              Neither — add “{p.said}” as new
            </button>
          </div>
        )}

        {p.status === "several" && !picking && (
          <div className="space-y-2" data-testid="party-dialog-several">
            <p className="text-xs text-slate-600">
              {(p.several || []).map((c) => c.name).join(", ")}
            </p>
            {kindKey === "tasks" && (p.several || []).length >= 2 && (
              <button type="button" disabled={busy} className={`${btn} inline-flex items-center gap-1.5`}
                data-testid="party-dialog-split" onClick={() => send({ action: "split" },
                  `Split into ${(p.several || []).length} tasks, one each`)}>
                <Scissors size={14} weight="bold" aria-hidden="true" />
                Split into {(p.several || []).length} tasks, one each
              </button>
            )}
            <p className="text-xs font-semibold text-slate-600">Or keep one task, about:</p>
            {(p.several || []).map((c) => (
              <button key={c.id} type="button" disabled={busy} onClick={() => send({ action: "link", contact_id: c.id })}
                data-testid={`party-dialog-one-${c.id}`}
                className="flex min-h-10 w-full items-center justify-between rounded-xl bg-white/80 px-3 py-2 text-left text-sm ring-1 ring-inset ring-slate-200 hover:bg-white">
                <span className="truncate">{c.name}</span>
                <span className="text-[11px] text-slate-500">{kindLabel(c.kind)}</span>
              </button>
            ))}
          </div>
        )}

        {p.status === "new" && !picking && (
          <div className="space-y-2" data-testid="party-dialog-new">
            <p className="text-xs text-slate-600">Approving adds it to CRM, marked “details needed”. It is a:</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="What kind of party">
              {PARTY_KINDS.map((k) => (
                <button key={k.value} type="button" disabled={busy} aria-pressed={p.kind === k.value}
                  data-testid={`party-dialog-kind-${k.value}`}
                  onClick={() => p.kind !== k.value && send({ action: "kind", kind: k.value })}
                  className={`min-h-9 rounded-pill px-3 text-xs font-semibold ${p.kind === k.value ? "bg-slate-900 text-white" : GLASS_PILL}`}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {(p.status === "linked" || p.status === "new") && !picking && (
          <PersonRow party={p} busy={busy} onSave={(person) => send({ action: "person", person })} />
        )}

        {picking ? (
          <div className="space-y-2">
            <PartyPicker value={null} onChange={(v) => v && pick(v)} autoFocus testid="party-dialog-picker"
              defaultKind={p.kind || "customer"} />
            <button type="button" className="text-xs font-medium text-slate-500 underline" onClick={() => setPicking(false)}>
              Back
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={busy} className={`${btn} inline-flex items-center gap-1.5`}
              data-testid="party-dialog-search" onClick={() => setPicking(true)}>
              <Buildings size={14} weight="bold" aria-hidden="true" />
              {p.status ? "A different one" : "Pick a customer or supplier"}
            </button>
            {p.status && p.status !== "none" && (
              <button type="button" disabled={busy} className={btn} data-testid="party-dialog-none"
                onClick={() => send({ action: "none" }, "Not linked to a customer or supplier")}>
                Not a customer or supplier
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* "Call Sajith from MK Associates": Sajith is saved as a contact person there
   — on by default, one tap to leave him out, or a name to correct. */
function PersonRow({ party, busy, onSave }) {
  const [name, setName] = useState(party.person || "");
  useEffect(() => setName(party.person || ""), [party.person]);
  const at = party.contact_name || party.said;
  return (
    <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-inset ring-slate-200" data-testid="party-dialog-person">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <UserCircle size={14} weight="bold" aria-hidden="true" /> A person at {at}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)"
          aria-label={`A contact person at ${at}`} data-testid="party-dialog-person-input"
          className="h-9 min-w-0 flex-1 rounded-pill bg-white px-3 text-sm ring-1 ring-inset ring-slate-200 outline-none" />
        <button type="button" disabled={busy || name.trim() === (party.person || "")}
          onClick={() => onSave(name.trim())} data-testid="party-dialog-person-save"
          className="inline-flex h-9 items-center gap-1 rounded-pill bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-40">
          <CheckCircle size={14} weight="bold" aria-hidden="true" /> {name.trim() ? "Save" : "Leave out"}
        </button>
      </div>
      {party.person && <p className="mt-1 text-[11px] text-slate-500">{party.person} will be saved as a contact at {at}.</p>}
    </div>
  );
}
