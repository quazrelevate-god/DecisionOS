import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import api from "../../lib/api";
import { PARTY_KINDS, kindLabel, kindOf } from "../../lib/party";
import { GLASS_PILL } from "../neuglass/glass";

/* Epic 11 S12 — "Customer / supplier": search CRM as you type (name and kind
   only, GET /parties/search — anyone who makes work can link it), or add the
   name as a new one right there, with its kind. A new one becomes ONE CRM
   record marked Needs details; a name already in CRM is offered first, so
   "Kumar Export House" finds Kumar Exports before anybody adds a twin.

   value:    null | {id, name, kind}          an existing record
                  | {new: true, name, kind}   added when the work is saved
   onChange: (value) => void */
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
          <select value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value })}
            aria-label="What kind of party" data-testid={`${testid}-kind`}
            className={`h-8 rounded-pill px-2 text-xs text-slate-700 ${GLASS_PILL}`}>
            {PARTY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        )}
        <button type="button" onClick={() => onChange(null)} aria-label="Remove the customer or supplier"
          data-testid={`${testid}-clear`} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
    );
  }

  const clean = q.trim().replace(/\s+/g, " ");
  return (
    <div data-testid={testid}>
      <label className={`flex h-10 items-center gap-2 rounded-pill px-3 ${GLASS_PILL}`}>
        <MagnifyingGlass size={14} className="text-slate-400" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} placeholder={placeholder}
          aria-label="Search customers and suppliers" data-testid={`${testid}-input`}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
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
            <li className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50/70 px-3 py-2">
              <button type="button" data-testid={`${testid}-add`}
                onClick={() => { onChange({ new: true, name: clean, kind }); setQ(""); }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900">
                <Plus size={14} weight="bold" aria-hidden="true" />
                Add “{clean}” as a new
              </button>
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What kind of party"
                data-testid={`${testid}-add-kind`}
                className="h-8 rounded-pill bg-white px-2 text-xs text-slate-700 ring-1 ring-inset ring-amber-200">
                {PARTY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label.toLowerCase()}</option>)}
              </select>
              <span className="basis-full text-[11px] text-amber-800">
                Added to CRM marked “details needed” — the phone and GST can come later.
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
