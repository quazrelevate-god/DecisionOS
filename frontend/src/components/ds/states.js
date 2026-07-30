/**
 * The three-way interactive state, defined once.
 *
 * "Busy" and "unavailable" are different claims and must never render
 * identically. This has now gone wrong twice — Button's loading state and
 * VoiceCapture's processing state both took the neutral disabled treatment,
 * because both are non-interactive and the obvious implementation is
 * `disabled={disabled || busy}` followed by styling on that same boolean.
 *
 * The failure is seductive: the component behaves correctly (it cannot be
 * clicked) and only the meaning is wrong. A primary that turns grey the moment
 * it starts working reads as "this broke", not "this is running".
 *
 * So the distinction lives here rather than in each component:
 *
 *   idle      interactive, variant styling
 *   busy      NOT interactive, KEEPS its variant styling + a spinner
 *   disabled  NOT interactive, neutral surface
 *
 * Every component with a loading/processing concept resolves through
 * `interactiveState`, and a test asserts both that busy never equals disabled
 * and that no ds component reintroduces the pattern by hand.
 *
 * @typedef {'idle'|'busy'|'disabled'} InteractiveState
 */

/**
 * Neutral treatment for genuinely unavailable controls. Never a pale tint of
 * the primary — a faded indigo button reads as "primary, but broken" rather
 * than "unavailable".
 */
export const DISABLED_VISUALS =
  "bg-surface-sunken text-text-disabled border-hairline shadow-none hover:bg-surface-sunken";

/** Busy adds no colour of its own; keeping the variant is the entire point. */
export const BUSY_VISUALS = "";

/**
 * Resolve the visual and interaction state of a control.
 *
 * @param {{disabled?: boolean, busy?: boolean}} input
 * @returns {{state: InteractiveState, inert: boolean, className: string}}
 *   `inert` means the control must not accept input — true for both busy and
 *   disabled. `className` is the visual treatment, which differs between them.
 *
 * @example
 * const { inert, className, state } = interactiveState({ disabled, busy: loading });
 * <button disabled={inert} aria-busy={state === "busy"} className={cn(variants(), className)} />
 */
export function interactiveState({ disabled = false, busy = false } = {}) {
  if (busy) return { state: "busy", inert: true, className: BUSY_VISUALS };
  if (disabled) return { state: "disabled", inert: true, className: DISABLED_VISUALS };
  return { state: "idle", inert: false, className: "" };
}
