import { useState } from "react";
import { partyText } from "../../lib/party";
import { GLASS_PILL, INK_PILL } from "../neuglass/glass";
import { PartyChip } from "./PartyChip";
import { PartyDialog } from "./PartyDialog";
import { PartySheet, SHEET_BTN } from "./PartySheet";

/* Epic 11 S12 — approving never stops silently on a question it cannot answer.
   When some items still ask "Which Kumar?" or name several parties, this lists
   them first: answer them here (each opens the party dialog), or approve now
   and link them later — those stay unlinked, and the task's drawer (or CRM's
   "Link old work", where its words name exactly one) links them afterwards.
   Nothing is guessed either way.

   openParties: decision.open_parties ([{item_kind, key, title, party}]) */
export function OpenPartiesDialog({ decisionId, openParties, open, onOpenChange, onApprove, onChanged, busy }) {
  const [item, setItem] = useState(null);
  const left = openParties || [];
  const one = left.length === 1;
  return (
    <>
      <PartySheet open={open && !item} onOpenChange={onOpenChange} testid="open-parties-dialog"
        title={!left.length ? "Ready to approve" : one ? "Check who this is about" : `Check who these ${left.length} are about`}
        description={!left.length
          ? "Every customer and supplier is answered."
          : `Dex couldn't tell from what was said. Tap ${one ? "it" : "one"} to pick, or approve now and link ${one ? "it" : "them"} later from the task.`}
        footer={<>
          <button type="button" onClick={() => onOpenChange(false)} data-testid="open-parties-back"
            className={`${SHEET_BTN} ${GLASS_PILL}`}>
            Back to the review
          </button>
          <button type="button" disabled={busy} onClick={onApprove} data-testid="open-parties-approve-anyway"
            className={`${SHEET_BTN} text-white ${INK_PILL}`}>
            {left.length ? "Approve and link later" : "Approve"}
          </button>
        </>}>
        <ul className="space-y-2">
          {left.map((q) => (
            <li key={`${q.item_kind}-${q.key}`}
              className="rounded-2xl bg-white/75 px-3.5 py-3 ring-1 ring-inset ring-slate-900/[0.06]">
              <p className="text-sm font-medium leading-snug text-slate-800">{q.title}</p>
              <div className="mt-2 flex flex-wrap">
                <PartyChip party={q.party} onClick={() => setItem(q)} testid={`open-party-${q.key}`} className="min-h-9" />
              </div>
              <p className="sr-only">{partyText(q.party)}</p>
            </li>
          ))}
        </ul>
      </PartySheet>
      <PartyDialog decisionId={decisionId} item={item} open={!!item}
        onOpenChange={(v) => !v && setItem(null)} onChanged={onChanged} />
    </>
  );
}
