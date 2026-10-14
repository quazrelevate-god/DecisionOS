// 2026-09-14, founder · GlassSelect — the app's own dropdown, and the one new
// UI should reach for. A native <select> hands its option list to the
// operating system, which draws it in the OS's chrome on every platform; the
// founder's rule is that no list in DecisionOS looks like that. This is Radix
// Select (keyboard, typeahead, a real listbox for screen readers,
// collision-aware placement, portalled above dialogs and the task drawer)
// wearing the glass list from ./glass.
//
// Close enough to a <select> that a swap is mechanical:
//   <GlassSelect value={v} onChange={setV} ariaLabel="Status"
//     options={[{ value: "a", label: "A" }, { label: "A group", options: [...] }]} />
// onChange receives the VALUE, not an event.
//
// "" is a real choice in this app ("Nobody yet", "Anyone with approval
// access"), but Radix reserves the empty string for "nothing selected", so it
// travels under a sentinel inside the component. A controlled "" with no ""
// option shows the placeholder instead — which is how an action picker
// ("Add a person") reads as a prompt again after every pick.
//
// variant="pill" is the task drawer's white glass pill. variant="field" draws
// nothing of its own, so the trigger takes the host form's field styling
// through triggerClassName.
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CaretDown, CaretUp, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { GLASS_MENU, GLASS_MENU_ITEM, GLASS_MENU_LABEL, GLASS_PILL } from "./glass";

const NONE = "__none__";
const toItem = (v) => (v === "" || v == null ? NONE : String(v));

/**
 * @param {string}   value
 * @param {function} onChange      (value) => void
 * @param {Array}    options       { value, label, disabled? } or { label, options: [...] } for a group
 * @param {string}   placeholder   shown when value is "" and no option has value ""
 * @param {string}   ariaLabel
 * @param {string}   testid        on the trigger; each option gets `${testid}-option-${value || "none"}`
 * @param {Component} icon         optional leading Phosphor icon
 * @param {"pill"|"field"} variant
 */
export function GlassSelect({
  value, onChange, options = [], placeholder = "Select", ariaLabel, id, testid,
  icon: Icon, variant = "pill", triggerClassName, disabled = false, align = "start",
}) {
  const flat = options.flatMap((o) => o.options || [o]);
  const hasEmpty = flat.some((o) => o.value === "");
  const current = value === "" || value == null ? (hasEmpty ? NONE : "") : String(value);

  const item = (o) => (
    <SelectPrimitive.Item key={toItem(o.value)} value={toItem(o.value)} disabled={o.disabled}
      data-testid={testid ? `${testid}-option-${o.value === "" ? "none" : o.value}` : undefined}
      className={GLASS_MENU_ITEM}>
      <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ml-auto pl-3">
        <Check size={14} weight="bold" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );

  return (
    <SelectPrimitive.Root value={current} onValueChange={(v) => onChange?.(v === NONE ? "" : v)} disabled={disabled}>
      <SelectPrimitive.Trigger id={id} aria-label={ariaLabel} data-testid={testid}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-50",
          variant === "pill" && `h-12 rounded-pill px-5 text-[15px] text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`,
          variant === "pill" && Icon && "pl-4",
          triggerClassName,
        )}>
        {Icon && <Icon size={20} weight="regular" aria-hidden="true" className="shrink-0 text-slate-500" />}
        <span className="min-w-0 flex-1 truncate"><SelectPrimitive.Value placeholder={placeholder} /></span>
        <SelectPrimitive.Icon asChild>
          <CaretDown size={14} weight="bold" aria-hidden="true"
            className="shrink-0 text-slate-500 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" side="bottom" align={align} sideOffset={6} collisionPadding={12}
          className={cn(
            GLASS_MENU,
            "max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[max(12rem,var(--radix-select-trigger-width))] max-w-[min(26rem,calc(100vw-1.5rem))]",
          )}>
          <SelectPrimitive.ScrollUpButton className="flex h-7 cursor-default items-center justify-center text-slate-500">
            <CaretUp size={12} weight="bold" aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map((o, i) => (o.options ? (
              <SelectPrimitive.Group key={`group-${o.label}`}>
                {i > 0 && <SelectPrimitive.Separator className="mx-2 my-1 h-px bg-slate-900/[0.07]" />}
                <SelectPrimitive.Label className={GLASS_MENU_LABEL}>{o.label}</SelectPrimitive.Label>
                {o.options.map(item)}
              </SelectPrimitive.Group>
            ) : item(o)))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 cursor-default items-center justify-center text-slate-500">
            <CaretDown size={12} weight="bold" aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export default GlassSelect;
