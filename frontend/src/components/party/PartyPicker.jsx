import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import api from "../../lib/api";
import { PARTY_KINDS, kindLabel, kindOf } from "../../lib/party";
import { GLASS_PILL } from "../neuglass/glass";
import { GlassSelect } from "../neuglass/GlassSelect";

/* Epic 11 S12 — "Customer / supplier": search CRM as you type (name and kind
   only, GET /parties/search — anyone who makes work can link it), or add the
   name as a new one right there, with its kind. A new one becomes ONE CRM
   record marked Needs details; a name already in CRM is offered first, so
   "Kumar Export House" finds Kumar Exports before anybody adds a twin.

   value:    null | {id, name, kind}          an existing record
                  | {new: true, name, kind}   added when the work is saved
   onChange: (value) => void

   The kind is the app's glass list in the repeat picker's pill, never the
   operating system's dropdown. */
const KIND_PILL = `h-9 rounded-pill px-3 text-xs font-medium text-slate-700 ${GLASS_PILL}`;
export function KindSelect({ value, onChange, testid, lower = false, ariaLabel = "What kind of customer or supplier" }) {
  return (
    <div className="w-[8.5rem] shrink-0">
      <GlassSelect value={value} onChange={onChange} ariaLabel={ariaLabel} testid={testid} variant="field"
        triggerClassName={KIND_PILL}
        options={PARTY_KINDS.map((k) => ({ value: k.value, label: lower ? k.label.toLowerCase() : k.label }))} />
    </div>
  );
}
export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function usePartySearch(q, enabled = true) {
  const dq = useDebounced((q || "").trim());
  return useQuery({
    queryKey: ["party-search", dq],
    queryFn: async () => (await api.get("/parties/search", { params: { q: dq } })).data,
    enabled: enabled && dq.length >= 2,
    staleTime: 30_000,
  });
}

export function PartyPicker({ value, onChange, testid = "party-picker", autoFocus = false, defaultKind = "customer",
  placeholder = "Search customers and suppliers" }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(defaultKind);
  const search = usePartySearch(q);
  const results = search.data?.results || [];
  const exact = search.data?.exact;

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={`${testid}-value`}>
        <span className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
          value.new ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-sky-50 text-sky-900 ring-sky-200"}`}>
          {value.new ? `New: ${value.name} · ${kindLabel(value.kind)} · details needed` : `${value.name} · ${kindLabel(kindOf(value))}`}
        </span>
        {value.new && (
          <KindSelect value={value.kind} onChange={(k) => onChange({ ...value, kind: k })} testid={`${testid}-kind`} />
        )}
        <button type="button" onClick={() => onChange(null)} aria-label="Remove the customer or supplier"
          data-testid={`${testid}-clear`} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-900/[0.06]">
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
    );
  }

  const clean = q.trim().replace(/\s+/g, " ");
  return (
    <div data-testid={testid}>
      {/* The ring is the pill's, not the input's: a square browser outline
          inside a round field read as a bug. */}
      <label className={`flex h-11 items-center gap-2 rounded-pill px-4 focus-within:ring-2 focus-within:ring-neutral-900/20 lg:h-10 ${GLASS_PILL}`}>
        <MagnifyingGlass size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} placeholder={placeholder}
          aria-label="Search customers and suppliers" data-testid={`${testid}-input`}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus-visible:outline-none" />
      </label>
      {clean.length >= 2 && (
        <ul className="mt-1.5 space-y-1" role="listbox" aria-label="Customers and suppliers">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected="false"
                onClick={() => { onChange({ id: c.id, name: c.name, kind: c.kind, type: c.type }); setQ(""); }}
                data-testid={`${testid}-result-${c.id}`}
                className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-900/[0.05]">
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">
                  {kindLabel(c.kind)}{c.needs_details ? " · details needed" : ""}
                </span>
              </button>
            </li>
          ))}
          {search.isFetching && !results.length && <li className="px-3 py-2 text-xs text-slate-500">Looking in CRM…</li>}
          {!exact && !search.isFetching && (
            <li className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50/80 px-3 py-2.5 ring-1 ring-inset ring-amber-200/70">
              <button type="button" data-testid={`${testid}-add`}
                onClick={() => { onChange({ new: true, name: clean, kind }); setQ(""); }}
                className="inline-flex min-h-9 min-w-0 items-center gap-1.5 text-left text-sm font-semibold text-amber-950">
                <Plus size={14} weight="bold" aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 break-words">Add “{clean}” as a new</span>
              </button>
              <KindSelect value={kind} onChange={setKind} testid={`${testid}-add-kind`} lower />
              <span className="basis-full text-[11px] leading-snug text-amber-900/80">
                It goes into CRM marked “Details needed”. The phone and GST can be added later.
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* What a task body sends for the picker's value. */
export function partyBody(value) {
  if (!value) return { contact_id: "" };
  if (value.new) return { contact_new: { name: value.name, kind: value.kind } };
  return { contact_id: value.id };
}
