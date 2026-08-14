// MPWA-04 · SheetSelect — drop-in replacement for the 54 native <select>
// calls §4 counts (§7, §5.2.5).
//
// Why: a native picker inside a scroll path makes every scroll a coin flip —
// the wheel opens instead of the list moving. On a task list where the owner
// flicks past twenty rows, that misfires constantly.
//
// Props deliberately mirror <select> so a call-site swap is mechanical:
//   <select value={v} onChange={e => set(e.target.value)}>
//     <option value="a">A</option>
//   </select>
// becomes
//   <SheetSelect value={v} onChange={e => set(e.target.value)} label="Status"
//     options={[{ value: 'a', label: 'A' }]} />
//
// onChange receives a synthetic `{ target: { value, name } }` so existing
// handlers keep working unchanged.
import * as React from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./BottomSheet";

/**
 * @param {string|number} value
 * @param {Function} onChange       receives { target: { value, name } }
 * @param {Array<{value:string,label:string,hint?:string,disabled?:boolean}>} options
 * @param {string} label            sheet heading, and the accessible name
 * @param {string} [placeholder]
 * @param {string} [name]
 * @param {boolean} [disabled]
 */
export function SheetSelect({
  value,
  onChange,
  options = [],
  label,
  placeholder = "Select",
  name,
  disabled = false,
  className,
  triggerClassName,
  "data-testid": testId = "sheet-select",
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => String(o.value) === String(value));

  const pick = (opt) => {
    if (opt.disabled) return;
    setOpen(false);
    onChange?.({ target: { value: opt.value, name } });
  };

  return (
    <div className={cn("w-full", className)}>
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm",
          "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          triggerClassName
        )}
        style={{ minHeight: "var(--control-h-base)" }}
      >
        <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretDown size={18} weight="bold" className="shrink-0 text-muted-foreground" />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label || placeholder}
        size="auto"
        data-testid={`${testId}-sheet`}
      >
        <ul className="-mx-1" role="listbox" aria-label={label || placeholder}>
          {options.map((opt) => {
            const isSel = String(opt.value) === String(value);
            return (
              <li key={String(opt.value)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  disabled={opt.disabled}
                  data-testid={`${testId}-option-${opt.value}`}
                  onClick={() => pick(opt)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 text-left transition-colors",
                    "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    isSel && "bg-accent"
                  )}
                  style={{ minHeight: "var(--control-h-md)" }}
                >
                  <span className="min-w-0">
                    <span className={cn("block text-sm", isSel && "font-semibold")}>
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span className="block text-sm text-muted-foreground">{opt.hint}</span>
                    )}
                  </span>
                  {/* Selection carries a glyph, not just weight — §3.3: colour
                      and weight never carry meaning alone. */}
                  {isSel && <Check size={20} weight="bold" className="shrink-0 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </div>
  );
}

/**
 * Convenience for the common `<option>` shape already in the tree:
 * SheetSelect.from(['todo','done'])  ->  [{value,label}]
 * SheetSelect.from({todo:'Not started'})
 */
SheetSelect.from = (input) =>
  Array.isArray(input)
    ? input.map((v) =>
        typeof v === "object" ? v : { value: v, label: String(v) }
      )
    : Object.entries(input || {}).map(([value, label]) => ({ value, label }));

export default SheetSelect;
