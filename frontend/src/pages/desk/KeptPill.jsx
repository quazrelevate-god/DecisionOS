/* KEPT-PILL — "what you said is kept", as a floating pill you can flick away.
 *
 * 2026-10-06, founder: "a small text that shows 'what you said is kept, not
 * sent' when we discard anything in between when we use the Dex decide — the
 * way it displays in the home screen is not quite nice. So make it a pop-up
 * floating pill with the swipe gesture closable functionality."
 *
 * It was DraftNote: a 12px line with two text buttons, printed across the top of
 * the Desk. Everything about it was true and none of it looked like the app
 * speaking. This is the same words and the same two ways out in the material the
 * capture's own status pill already uses (.kr-pop, rounded-pill) — so the two
 * things that can appear in that spot are one family — plus the gesture a pill
 * like this invites: drag it anywhere, and past a thumb's width it goes.
 *
 * A SWIPE HIDES, IT DOES NOT DISCARD. The words stay kept — the next capture
 * opens on them — and `Discard` remains the only thing that throws them away.
 * Hiding and deleting must never be the same gesture, least of all the careless
 * one, so the swipe is the harmless one and the destructive one needs a press.
 *
 * Pointer events, not touch events: the same handlers answer a finger on the
 * phone and a mouse in the suites, and `setPointerCapture` means a drag that
 * leaves the pill still belongs to it.
 */
import { useRef, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

/** Past this, in CSS px of travel, the flick counts. Under it the pill springs
 *  back — a tap on Open or Discard moves the pointer by a pixel or two and must
 *  never read as a swipe. */
const AWAY = 56;

export function KeptPill({ label, onOpen, onDiscard, testid = "dex-well-draft" }) {
  const [gone, setGone] = useState(false);
  const [d, setD] = useState({ x: 0, y: 0 });
  const from = useRef(null);
  const dragging = useRef(false);

  if (gone) return null;

  const down = (e) => {
    /* Not on the buttons: a press there is a press, and dragging the pill out
       from under a finger that is trying to tap would be its own bug. */
    if (e.target.closest("button[data-testid$='-open'], button[data-testid$='-discard']")) return;
    from.current = { x: e.clientX, y: e.clientY };
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!dragging.current || !from.current) return;
    setD({ x: e.clientX - from.current.x, y: e.clientY - from.current.y });
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const far = Math.hypot(d.x, d.y) > AWAY;
    from.current = null;
    if (far) setGone(true); else setD({ x: 0, y: 0 });
  };

  const travelled = Math.hypot(d.x, d.y);
  return (
    <div
      role="status"
      data-testid={testid}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{
        transform: `translate3d(${d.x}px, ${d.y}px, 0)`,
        opacity: Math.max(0.25, 1 - travelled / (AWAY * 2.5)),
        transition: dragging.current ? "none" : "transform 200ms cubic-bezier(.22,1,.36,1), opacity 200ms linear",
        touchAction: "none",
      }}
      /* OPAQUE, because of where it lands. This floats just above the dock,
         which on the Desk is over the black sheet — and the app's usual pop
         material is a 38% white wash that over black reads as a grey smudge
         with dark type on it (measured on the phone: the "Discard" label all
         but disappeared). A solid white pill with a real shadow is what says
         "this is sitting on top of the page" on both grounds. */
      className={cn(
        "mb-1.5 flex min-h-11 w-fit max-w-full items-center gap-2 rounded-pill px-4",
        "bg-white text-slate-900 shadow-[0_6px_20px_rgb(0_0_0/.28)] ring-1 ring-black/[.06]",
        "text-sm select-none"
      )}
    >
      <ClockCounterClockwise size={14} weight="bold" aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      {onOpen && (
        <button type="button" onClick={onOpen} data-testid={`${testid}-open`}
          className="-mr-1 inline-flex min-h-11 shrink-0 items-center rounded-pill px-2 font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60">
          Open
        </button>
      )}
      <button type="button" onClick={onDiscard} data-testid={`${testid}-discard`}
        className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-pill px-2 font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60">
        Discard
      </button>
    </div>
  );
}

export default KeptPill;
