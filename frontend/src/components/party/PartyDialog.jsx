import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Buildings, CheckCircle, Scissors, UserCircle } from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { kindLabel } from "../../lib/party";
import { GLASS_PILL, INK_PILL } from "../neuglass/glass";
import { KindSelect, PartyPicker } from "./PartyPicker";
import { PartyChip } from "./PartyChip";
import { PartySheet, SHEET_BTN } from "./PartySheet";

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

  const btn = `${SHEET_BTN} ${GLASS_PILL}`;
  const row = "flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl bg-white/80 px-3.5 py-2 text-left text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] transition-colors hover:bg-white disabled:opacity-50";
  return (
    <PartySheet open={open} onOpenChange={onOpenChange} testid="party-dialog"
      title="Who is this about?"
      description={<>
        For <span className="font-medium text-slate-800">“{item.title}”</span>. Nothing goes into CRM until the decision is approved.
      </>}>
      <div className="space-y-4">
        {p.status === "linked" && !picking && (
          <div className="flex flex-wrap items-center gap-2" data-testid="party-dialog-linked">
            <span className="text-xs font-semibold text-slate-600">Linked to</span>
            <PartyChip party={p} linkTo={false} />
          </div>
        )}

        {p.status === "choose" && !picking && (
          <div className="space-y-1.5" data-testid="party-dialog-choose">
            <p className="text-xs font-semibold text-slate-600">Which one did they mean?</p>
            {(p.candidates || []).map((c) => (
              <button key={c.id} type="button" disabled={busy} onClick={() => send({ action: "link", contact_id: c.id })}
                data-testid={`party-dialog-candidate-${c.id}`} className={row}>
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{kindLabel(c.kind)}{c.phone ? ` · ${c.phone}` : ""}</span>
              </button>
            ))}
            <div className="pt-1">
              <button type="button" disabled={busy} className={btn} data-testid="party-dialog-neither"
                onClick={() => send({ action: "new", name: p.said, kind: p.kind || "customer" })}>
                Neither: add “{p.said}” as new
              </button>
            </div>
          </div>
        )}

        {p.status === "several" && !picking && (
          <div className="space-y-2" data-testid="party-dialog-several">
            <p className="text-sm text-slate-700">
              It names {(p.several || []).length}: {(p.several || []).map((c) => c.name).join(", ")}.
            </p>
            {kindKey === "tasks" && (p.several || []).length >= 2 && (
              <button type="button" disabled={busy} className={`${SHEET_BTN} w-full ${INK_PILL}`}
                data-testid="party-dialog-split" onClick={() => send({ action: "split" },
                  `Split into ${(p.several || []).length} tasks, one each`)}>
                <Scissors size={15} weight="bold" aria-hidden="true" />
                Split into {(p.several || []).length} tasks, one each
              </button>
            )}
            <p className="pt-1 text-xs font-semibold text-slate-600">Or keep it as one task, for:</p>
            {(p.several || []).map((c) => (
              <button key={c.id} type="button" disabled={busy} onClick={() => send({ action: "link", contact_id: c.id })}
                data-testid={`party-dialog-one-${c.id}`} className={row}>
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{kindLabel(c.kind)}</span>
              </button>
            ))}
          </div>
        )}

        {p.status === "new" && !picking && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-amber-50/80 px-3.5 py-3 ring-1 ring-inset ring-amber-200/70"
            data-testid="party-dialog-new">
            <p className="min-w-0 flex-1 basis-48 text-[13px] leading-snug text-amber-950">
              <span className="font-semibold">{p.said}</span> isn't in CRM. Approving adds it, marked “Details needed”.
            </p>
            <KindSelect value={p.kind || "customer"} testid="party-dialog-kind" ariaLabel={`What ${p.said} is`}
              onChange={(k) => k !== p.kind && send({ action: "kind", kind: k })} />
          </div>
        )}

        {(p.status === "linked" || p.status === "new") && !picking && (
          <PersonRow party={p} busy={busy} onSave={(person) => send({ action: "person", person })} />
        )}

        {picking ? (
          <div className="space-y-2">
            <PartyPicker value={null} onChange={(v) => v && pick(v)} autoFocus testid="party-dialog-picker"
              defaultKind={p.kind || "customer"} />
            <button type="button" className="min-h-9 text-xs font-medium text-slate-500 underline underline-offset-2"
              onClick={() => setPicking(false)}>
              Back
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-slate-900/[0.06] pt-4">
            <button type="button" disabled={busy} className={btn}
              data-testid="party-dialog-search" onClick={() => setPicking(true)}>
              <Buildings size={15} weight="bold" aria-hidden="true" />
              {p.status && p.status !== "none" ? "Pick a different one" : "Pick a customer or supplier"}
            </button>
            {p.status && p.status !== "none" && (
              <button type="button" disabled={busy} className={btn} data-testid="party-dialog-none"
                onClick={() => send({ action: "none" }, "Not linked to a customer or supplier")}>
                Not a customer or supplier
              </button>
            )}
          </div>
        )}
      </div>
    </PartySheet>
  );
}

/* "Call Sajith from MK Associates": Sajith is saved as a contact person there
   — on by default, one tap to leave him out, or a name to correct. */
function PersonRow({ party, busy, onSave }) {
  const [name, setName] = useState(party.person || "");
  useEffect(() => setName(party.person || ""), [party.person]);
  const at = party.contact_name || party.said;
  return (
    <div className="rounded-2xl bg-white/70 px-3.5 py-3 ring-1 ring-inset ring-slate-900/[0.06]" data-testid="party-dialog-person">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <UserCircle size={15} weight="bold" aria-hidden="true" /> The person to talk to at {at}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name (optional)"
          aria-label={`The person to talk to at ${at}`} data-testid="party-dialog-person-input"
          className={`h-11 min-w-0 flex-1 rounded-pill px-4 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 lg:h-10 ${GLASS_PILL}`} />
        <button type="button" disabled={busy || name.trim() === (party.person || "")}
          onClick={() => onSave(name.trim())} data-testid="party-dialog-person-save"
          className={`${SHEET_BTN} shrink-0 text-white ${INK_PILL}`}>
          <CheckCircle size={15} weight="bold" aria-hidden="true" /> {name.trim() || !party.person ? "Save" : "Remove"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
        {party.person ? `${party.person} will be saved as a contact at ${at}.` : `Saved as a contact at ${at} when the decision is approved.`}
      </p>
    </div>
  );
}
