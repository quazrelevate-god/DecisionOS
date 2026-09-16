import { Toaster as Sonner, toast } from "sonner"

/* ASK-36 4 · the toast joins the material.
 *
 * WHAT IT WAS. shadcn's default: `bg-background`, `border-border`,
 * `shadow-lg` — a flat card with a 1px hairline and a generic drop shadow,
 * which is the system this branch has otherwise finished retiring. Next to a
 * .kr-pop well or a .kr-bento tile it read as a browser notification that had
 * wandered in, and it is the one surface the founder sees on every screen.
 *
 * WHAT IT IS. The app's own raised recipe, taken from .kr-pop rather than
 * re-invented: a white-glass ground with a lit top lip and the tight contact
 * shadow KR-14.2 replaced the old halo with, at the card radius. The classes
 * are on the ELEMENT (`.kr-toast` in index.css) instead of being hand-rolled
 * here, so the toast re-cuts itself whenever the recipe does.
 *
 * THE ANIMATION IS SUBTLE ON PURPOSE. Sonner's default slides a card in from
 * the edge; a status message that flies is a status message that pulls the eye
 * off the work. `.kr-toast` rises 8px and fades, on the app's own
 * cubic-bezier(.22,1,.36,1) — it settles rather than arrives — and the
 * accompanying icon gets one soft scale-in. Under prefers-reduced-motion both
 * are off and the toast simply appears.
 *
 * The two buttons are the app's pills: the action is INK_PILL's gradient (the
 * thing that moves you on), the cancel the quiet raised one.
 */
const Toaster = ({
  ...props
}) => {
  // ASK-33 Phase 5 — light, always. "system" followed the phone's OS setting,
  // so a dark-mode phone got dark toasts in a light-only app.
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: "kr-toast group toast",
          title: "group-[.toast]:text-[13.5px] group-[.toast]:font-semibold group-[.toast]:leading-snug group-[.toast]:text-foreground",
          description: "group-[.toast]:text-[12.5px] group-[.toast]:leading-snug group-[.toast]:text-foreground/70",
          icon: "kr-toast__icon",
          actionButton: "kr-toast__action",
          cancelButton: "kr-toast__cancel",
          closeButton: "kr-toast__close",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
