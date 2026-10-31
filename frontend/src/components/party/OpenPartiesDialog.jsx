import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { partyText } from "../../lib/party";
import { PartyChip } from "./PartyChip";
import { PartyDialog } from "./PartyDialog";

/* Epic 11 S12 — approving never stops silently on a question it cannot answer.
   When some items still ask "Which Kumar?" or name several parties, this lists
   them first: answer them here (each opens the party dialog), or approve now
   and link them later — those stay unlinked and turn up in CRM's "Link old
   work" review. Nothing is guessed either way.

   openParties: decision.open_parties ([{item_kind, key, title, party}]) */
export function OpenPartiesDialog({ decisionId, openParties, open, onOpenChange, onApprove, onChanged, busy }) {
  const [item, setItem] = useState(null);
  const left = openParties || [];
  return (
    <>
      <Dialog open={open && !item} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="open-parties-dialog">
          <DialogHeader>
            <DialogTitle>{left.length === 1 ? "One customer/supplier to check" : `${left.length} customers/suppliers to check`}</DialogTitle>
            <DialogDescription>
              Dex couldn't tell who {left.length === 1 ? "this is" : "these are"} about. Pick now, or approve and link {left.length === 1 ? "it" : "them"} later from CRM.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {left.map((q) => (
              <li key={`${q.item_kind}-${q.key}`} className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-inset ring-slate-200">
                <p className="text-sm text-slate-800">{q.title}</p>
                <div className="mt-1">
                  <PartyChip party={q.party} onClick={() => setItem(q)} testid={`open-party-${q.key}`} />
                </div>
                <p className="sr-only">{partyText(q.party)}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} data-testid="open-parties-back"
              className="min-h-10 rounded-pill px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100">
              Back to the review
            </button>
            <button type="button" disabled={busy} onClick={onApprove} data-testid="open-parties-approve-anyway"
              className="min-h-10 rounded-pill bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {left.length ? "Approve and link later" : "Approve"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <PartyDialog decisionId={decisionId} item={item} open={!!item}
        onOpenChange={(v) => !v && setItem(null)} onChanged={onChanged} />
    </>
  );
}
