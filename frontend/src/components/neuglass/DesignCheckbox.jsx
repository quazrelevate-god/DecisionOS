import { Check } from "@phosphor-icons/react";

/* The design system's checkbox (the one on My Work's task cards): a rounded
   square that fills with the black ink and a white tick. Still a real
   <input type="checkbox"> underneath, so keyboard, forms and tests behave.
   ASK-50 — lifted out of pages/Tasks.js unchanged, because the Decision
   review card needs the same "Needs proof" control New Task has, and two
   copies of a checkbox is how two checkboxes happen. */
export function DesignCheckbox({ checked, onChange, testid, disabled = false, children }) {
  return (
    <label className={`flex items-start gap-3 text-sm leading-snug text-foreground ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span className="relative mt-px grid shrink-0 place-items-center">
        <input type="checkbox" data-testid={testid} checked={checked} onChange={onChange} disabled={disabled}
          className="peer h-5 w-5 cursor-pointer appearance-none rounded-full border-[1.5px] border-neutral-400/80 bg-[#fff] transition-colors checked:border-transparent checked:bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:cursor-not-allowed" />
        <Check size={12} weight="bold" aria-hidden="true" className="pointer-events-none absolute hidden text-white peer-checked:block" />
      </span>
      <span>{children}</span>
    </label>
  );
}

export default DesignCheckbox;
