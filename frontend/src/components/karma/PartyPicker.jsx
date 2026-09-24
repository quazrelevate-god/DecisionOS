/* PILOT-1 E — PICK THE SUPPLIER (OR BUYER) FROM CRM, OR TYPE A NEW NAME.
 *
 * The pilot client: "I have added Vendor, but not able to select when adding
 * new expense." The finance forms asked for the supplier in a plain text box
 * that never read CRM, so a supplier added there could not be picked, and the
 * expense kept only a name — spelt however it was typed that day.
 *
 * This is a searchable field over the company's CRM contacts (GET
 * /ledger/parties — a narrow list behind Finance's own permission, so someone
 * without CRM access can still pick). Choosing one links the record to it
 * (vendor_id / contact_id); typing a name that is not there still works, and
 * it is simply saved as that name. Typing a name that IS there, exactly, links
 * it as well.
 *
 * It is a combobox, not the operating system's picker: the app's own glass
 * list, arrow keys and Enter to choose, Escape to close.
 */
import { useId, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, UserPlus } from "@phosphor-icons/react";
import api from "../../lib/api";
import { cn } from "../../lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { GLASS_MENU, GLASS_MENU_LABEL } from "./glass";

const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * @param {"vendor"|"customer"} kind
 * @param {string}   name       the name in the field
 * @param {string}   linkedId   the CRM contact it is linked to, or ""
 * @param {function} onChange   ({ name, id }) => void
 * @param {string}   noun       the tenant's word: "Supplier", "Vendor", "Customer"…
 */
export function PartyPicker({ kind = "vendor", name = "", linkedId = "", onChange, noun, id, testid, className }) {
  const listId = useId();
  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const word = (noun || (kind === "vendor" ? "Supplier" : "Customer")).toLowerCase();

  const partiesQ = useQuery({
    queryKey: ["ledger-parties", kind],
    queryFn: () => api.get(`/ledger/parties?kind=${kind}`).then((r) => r.data),
    staleTime: 60_000,
  });
  const parties = useMemo(() => (Array.isArray(partiesQ.data) ? partiesQ.data : []), [partiesQ.data]);
  const q = norm(name);
  const shown = useMemo(() => {
    const list = q
      ? parties.filter((p) => norm(p.name).includes(q) || norm(p.company).includes(q))
      : parties;
    return list.slice(0, 50);
  }, [parties, q]);
  const exact = parties.find((p) => norm(p.name) === q) || null;
  const offerNew = !!q && !exact;
  /* J2-04 (JOURNEY-1) — AND THE NAME CAN BECOME A REAL SUPPLIER, HERE.
     A wholesaler typed the mill's name on her first bill and it stayed a name:
     nothing ever became a supplier, so the supplier page never counted her oil
     and the next bill was typed again from memory. The only way to make it
     real was CRM, which a finance person does not necessarily have. This adds
     them through Finance's own narrow door (POST /ledger/parties, a name and
     nothing else) and links the record to them in the same tap. "Just use the
     name" is still there under it, for a one-off nobody needs to keep. */
  const rows = offerNew
    ? [...shown, { id: "", name: name.trim(), _add: true }, { id: "", name: name.trim(), _new: true }]
    : shown;

  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const addToCrm = async (row) => {
    if (adding) return;
    setAdding(true);
    try {
      const { data } = await api.post("/ledger/parties", { kind, name: row.name });
      await qc.invalidateQueries({ queryKey: ["ledger-parties", kind] });
      onChange?.({ name: data.name, id: data.id });
      toast.success(data.already_existed
        ? `${data.name} was already in CRM — linked`
        : `${data.name} added as a ${word}`);
      setOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || `Could not add that ${word}`);
    } finally { setAdding(false); }
  };

  const choose = (row) => {
    if (row._add) { addToCrm(row); return; }
    onChange?.({ name: row.name, id: row._new ? "" : row.id });
    setOpen(false);
  };
  const onType = (value) => {
    // Typing is choosing a new name, unless it is exactly one already in CRM.
    const hit = parties.find((p) => norm(p.name) === norm(value));
    onChange?.({ name: value, id: hit ? hit.id : "" });
    setActive(0);
    setOpen(true);
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && rows[active]) {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === "Escape" && open) {
      // Close the list, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  const linked = !!linkedId;

  return (
    <Popover open={open && (rows.length > 0 || partiesQ.isSuccess)} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn("relative min-w-0", className)}>
          <input
            ref={inputRef}
            id={id}
            data-testid={testid}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            value={name}
            onChange={(e) => onType(e.target.value)}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={`Pick a ${word} or type a name`}
            className={cn("nm-field h-11 w-full min-w-0 px-4 text-sm text-slate-800 placeholder:text-slate-400", linked && "pr-24")}
          />
          {linked && (
            <span data-testid={testid ? `${testid}-linked` : undefined}
              className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-pill bg-badge-completed px-2 py-0.5 text-[11px] font-medium text-badge-completed-fg ring-1 ring-inset ring-badge-completed-line">
              <Check size={11} weight="bold" aria-hidden="true" /> In CRM
            </span>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => { if (anchorRef.current?.contains(e.target)) e.preventDefault(); }}
        /* As wide as the field. The anchor's width arrives in screen px and
           this list is drawn at the page's scale (index.css, .ui-scale on
           poppers), so it is divided back out: at 0.8 on a phone the list
           was 0.64 of the field without it. */
        className={cn(GLASS_MENU, "w-[calc(var(--radix-popper-anchor-width)/var(--ui-scale,1))] min-w-[14rem] max-w-[calc((100vw-2rem)/var(--ui-scale,1))] p-1.5")}
      >
        <ul id={listId} role="listbox" aria-label={`${noun || "Contact"}s in CRM`} data-testid={testid ? `${testid}-list` : undefined}
          className="max-h-64 overflow-y-auto">
          {shown.length === 0 && !offerNew && (
            <li className="px-3 py-2.5 text-sm text-slate-500">
              {partiesQ.isLoading ? "Loading…" : `No ${word}s in CRM yet — type a name`}
            </li>
          )}
          {shown.length > 0 && !q && <li className={GLASS_MENU_LABEL} aria-hidden="true">In CRM</li>}
          {rows.map((row, i) => (
            <li key={row._add ? "__add__" : row._new ? "__new__" : row.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              data-testid={testid ? `${testid}-option-${row._add ? "add" : row._new ? "new" : row.id}` : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row)}
              className={cn(
                "relative flex min-h-11 w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 lg:min-h-10",
                i === active && "bg-slate-900/[0.06] text-slate-900",
                row._add && "mt-1 border-t border-slate-900/[0.06] pt-2.5 font-medium text-slate-900",
              )}>
              {row._add ? (
                <>
                  <UserPlus size={14} weight="bold" aria-hidden="true" className="shrink-0 text-slate-600" />
                  <span className="min-w-0 truncate">
                    {adding ? "Adding…" : `Add “${row.name}” as a ${word}`}
                  </span>
                </>
              ) : row._new ? (
                <>
                  <Plus size={14} weight="bold" aria-hidden="true" className="shrink-0 text-slate-500" />
                  <span className="min-w-0 truncate">Just use the name “{row.name}”</span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.company && norm(row.company) !== norm(row.name) && (
                    <span className="min-w-0 max-w-[45%] truncate text-xs text-slate-500">{row.company}</span>
                  )}
                  {row.id === linkedId && <Check size={14} weight="bold" aria-hidden="true" className="shrink-0" />}
                </>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default PartyPicker;
