import { Link } from "react-router-dom";
import { Buildings, Question } from "@phosphor-icons/react";
import { partyParts, partyText, partyTone } from "../../lib/party";

/* Epic 11 S12 — the customer / supplier a piece of work is about. Linked: it
   opens their page. In a review: it opens the party dialog (onClick), where
   every guess can be changed. "Matched from 'Toyota'" says why, so a wrong
   match is visible before it is approved. */
/* 2026-10-31 polish — "ask" and "new" were two ambers a shade apart. They mean
   different things: NEW is settled (approving adds it, details come later);
   ASK is a question only the reviewer can answer. So ASK wears the app's ink,
   the same "your move" the workflow board's "Needs you" badge wears, with a
   question mark instead of the building. */
const TONES = {
  linked: "bg-sky-50 text-sky-900 ring-sky-200",
  new: "bg-amber-50 text-amber-900 ring-amber-200",
  ask: "bg-slate-900 text-white ring-slate-900",
  muted: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function PartyChip({ party, onClick, testid, linkTo = true, className = "", addLabel, compact = false }) {
  const text = partyText(party);
  const base = `inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${className}`;
  if (!text) {
    if (!onClick || !addLabel) return null;
    return (
      <button type="button" onClick={onClick} data-testid={testid}
        className={`${base} rounded-pill ${TONES.muted} hover:bg-white`}>
        <Buildings size={12} weight="bold" aria-hidden="true" />{addLabel}
      </button>
    );
  }
  const toneKey = partyTone(party);
  const tone = TONES[toneKey];
  const said = !compact && party.status === "linked" && party.said && party.confidence === "likely"
    && (party.contact_name || "").toLowerCase() !== party.said.toLowerCase()
    ? ` (matched from “${party.said}”)` : "";
  const x = partyParts(party, { compact });
  const shape = said && !compact ? "rounded-[0.9rem] text-left" : "rounded-pill";
  const Icon = toneKey === "ask" ? Question : Buildings;
  const body = (
    <>
      <Icon size={12} weight="bold" aria-hidden="true" className="shrink-0" />
      <span className="flex min-w-0 flex-col" title={`${text}${said}`}>
        {/* Only the name gives way; what follows it always shows. */}
        <span className="flex min-w-0 items-baseline">
          {x.before && <span className="shrink-0 whitespace-pre">{x.before}</span>}
          {x.name && <span className="min-w-[3ch] truncate">{x.name}</span>}
          <span className="shrink-0 whitespace-pre">{x.after}</span>
        </span>
        {/* Why Dex linked it, on a line of its own: cut short, a wrong match
            could not be seen before it was approved. */}
        {said && <span className="truncate text-[10px] font-normal opacity-75">matched from “{party.said}”</span>}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-testid={testid}
        aria-label={`Customer or supplier: ${text.replace(/([^?])$/, "$1.")} Change`} className={`${base} ${shape} ${tone} hover:brightness-[0.98]`}>
        {body}
      </button>
    );
  }
  const id = party.contact_id || party.id;
  if (linkTo && id) {
    return (
      <Link to={`/contacts/${id}`} data-testid={testid} className={`${base} ${shape} ${tone} hover:underline`}>{body}</Link>
    );
  }
  return <span data-testid={testid} className={`${base} ${shape} ${tone}`}>{body}</span>;
}
