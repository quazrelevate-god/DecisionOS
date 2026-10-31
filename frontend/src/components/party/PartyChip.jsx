import { Link } from "react-router-dom";
import { Buildings } from "@phosphor-icons/react";
import { partyText, partyTone } from "../../lib/party";

/* Epic 11 S12 — the customer / supplier a piece of work is about. Linked: it
   opens their page. In a review: it opens the party dialog (onClick), where
   every guess can be changed. "Matched from 'Toyota'" says why, so a wrong
   match is visible before it is approved. */
const TONES = {
  linked: "bg-sky-50 text-sky-900 ring-sky-200",
  new: "bg-amber-50 text-amber-900 ring-amber-200",
  ask: "bg-amber-100 text-amber-950 ring-amber-300",
  muted: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function PartyChip({ party, onClick, testid, linkTo = true, className = "", addLabel }) {
  const text = partyText(party);
  const base = `inline-flex max-w-full items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${className}`;
  if (!text) {
    if (!onClick || !addLabel) return null;
    return (
      <button type="button" onClick={onClick} data-testid={testid}
        className={`${base} ${TONES.muted} hover:bg-white`}>
        <Buildings size={12} weight="bold" aria-hidden="true" />{addLabel}
      </button>
    );
  }
  const tone = TONES[partyTone(party)];
  const said = party.status === "linked" && party.said && party.confidence === "likely"
    && (party.contact_name || "").toLowerCase() !== party.said.toLowerCase()
    ? ` (matched from “${party.said}”)` : "";
  const body = (
    <>
      <Buildings size={12} weight="bold" aria-hidden="true" />
      <span className="truncate">{text}{said}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-testid={testid}
        aria-label={`Customer or supplier: ${text.replace(/([^?])$/, "$1.")} Change`} className={`${base} ${tone} hover:brightness-[0.98]`}>
        {body}
      </button>
    );
  }
  const id = party.contact_id || party.id;
  if (linkTo && id) {
    return (
      <Link to={`/contacts/${id}`} data-testid={testid} className={`${base} ${tone} hover:underline`}>{body}</Link>
    );
  }
  return <span data-testid={testid} className={`${base} ${tone}`}>{body}</span>;
}
