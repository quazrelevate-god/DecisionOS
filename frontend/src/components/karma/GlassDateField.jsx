/* J14-10 (JOURNEY-1) — the app's own date field.
 *
 * `<input type="date">` hands the whole picker to the operating system: on a
 * phone it opens the OS's date wheel in the middle of a DecisionOS sheet, and
 * it prints the date in whatever order that device is set to. The founder's
 * rule for lists is already "never the one the phone draws" (GlassSelect); a
 * date is the same argument — the leave form is the screen every worker in the
 * company uses, and it was the only place in that form still drawing an OS
 * control.
 *
 * Same shape as GlassSelect so a swap is mechanical:
 *   <GlassDateField value={form.from_date} onChange={(v) => set(v)}
 *     ariaLabel="From" testid="leave-from-date" triggerClassName={inp} />
 *
 * value and onChange both speak ISO `YYYY-MM-DD`, which is what every form and
 * endpoint in this app already passes around. What it SHOWS is Indian order —
 * 29 Sept 2026 — because that is who reads it, and unlike the OS control that
 * does not change with the device's region.
 */
import * as React from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { GLASS_MENU } from "./glass";

/** ISO → Date, treated as a local day. `new Date("2026-09-29")` is UTC
 *  midnight, which is the previous day for everyone east of Greenwich. */
export const isoToDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Date → ISO, local. Not toISOString(), for the same timezone reason. */
export const dateToIso = (d) => {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "29 Sept 2026" — day first, which is how it is said out loud here. */
export const readableDate = (iso) => {
  const d = isoToDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "";
};

export function GlassDateField({
  value, onChange, ariaLabel, testid, placeholder = "Pick a date",
  triggerClassName, disabled = false, min, max,
}) {
  const [open, setOpen] = React.useState(false);
  const selected = isoToDate(value);
  const shown = readableDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          data-testid={testid}
          className={cn(
            "flex w-full items-center gap-2 text-left disabled:opacity-50",
            !shown && "text-foreground/45",
            triggerClassName,
          )}>
          <CalendarBlank size={15} weight="bold" aria-hidden="true" className="shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate">{shown || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(GLASS_MENU, "w-auto p-0")} data-testid={testid ? `${testid}-panel` : undefined}>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          weekStartsOn={1}
          disabled={(d) => (min && dateToIso(d) < min) || (max && dateToIso(d) > max)}
          onSelect={(d) => { onChange(dateToIso(d)); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

export default GlassDateField;
