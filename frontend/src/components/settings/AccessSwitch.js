/* One area of access, on or off (2026-10-05, founder: "I don't like the black
 * dark highlighting").
 *
 * Both access editors drew every area as a tile that turned solid black when
 * on — and nearly every area IS on, so "What owners can open" was a wall of
 * black. Now a light row with a switch: the row stays quiet, the switch carries
 * the state in the app's primary colour (the same one the chosen language
 * uses), and an area that is off reads off at a glance (muted label, grey
 * switch) instead of being the one white tile among black ones.
 *
 * A real switch for assistive tech too: role="switch" + aria-checked.
 */
export function AccessSwitch({ label, on, onToggle, disabled = false, locked = false, testid, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled || locked}
      data-testid={testid}
      title={title}
      className={`group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed ${
        on ? "bg-white/90 ring-slate-900/[0.08]" : "bg-white/45 ring-slate-900/[0.05]"
      } ${disabled || locked ? "" : "hover:bg-white"}`}
    >
      <span className={`min-w-0 text-[13px] leading-snug ${on ? "font-medium text-slate-800" : "text-slate-500"}`}>
        {label}
        {locked && <span className="ml-1.5 text-[11px] font-normal text-slate-400">· always on</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          on ? "bg-primary" : "bg-slate-300"
        } ${locked ? "opacity-60" : ""}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_hsl(0_0%_0%/0.25)] transition-transform ${
            on ? "translate-x-[1.125rem]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export default AccessSwitch;
