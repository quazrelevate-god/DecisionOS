/* Preferences → Your dock (founder, 2026-10-29): "a mock floating dock showing
 * the current items; tap an item, a pop-up shows the alternatives, and the one
 * picked replaces it in the dock."
 *
 * The mock is the real bar's shape and order — two places, the Dex handle,
 * one place, More — on the bar's own ink. The three places are buttons; the
 * handle and More are drawn but fixed (see components/mobile/dockChoice). A
 * pick is saved at once and the live dock under the page redraws with it.
 * Phone only: the desktop has a sidebar, not a dock.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowsClockwise, Check, DotsThree, Lock, SquaresFour } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { useDockChoice } from "../mobile/dockChoice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { GLASS_PILL, GLASS_SHEET, INK_PILL, INK_PLATE } from "../neuglass/glass";
import { cn } from "../../lib/utils";

function Slot({ item, onPick, index, fixed = false }) {
  const Icon = item.icon;
  const body = (
    <>
      <span className={cn("grid h-9 w-9 place-items-center rounded-[0.9rem]",
        fixed ? "bg-white/[0.06] text-white/45" : "bg-white/[0.12] text-white")}>
        <Icon size={19} weight={fixed ? "regular" : "bold"} aria-hidden="true" />
      </span>
      <span className={cn("mt-1 max-w-full truncate text-[11px] font-semibold", fixed ? "text-white/45" : "text-white/90")}>{item.label}</span>
    </>
  );
  if (fixed) {
    return <span className="flex min-w-0 flex-1 flex-col items-center justify-center py-2" aria-hidden="true">{body}</span>;
  }
  return (
    <button type="button" onClick={() => onPick(index)} data-testid={`dock-pref-slot-${index}`}
      aria-label={`Change what slot ${index + 1} opens — now ${item.label}`}
      className="group relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-[1.1rem] py-2 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.97]">
      {body}
      {/* The tap-to-change mark: a gold dot, the app's "look here". */}
      <span aria-hidden="true" className="absolute right-[18%] top-1.5 h-2 w-2 rounded-full bg-[hsl(var(--ng-gold))] ring-2 ring-[hsl(240_4%_9%)]" />
    </button>
  );
}

export function DockCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { slots, rest, custom, choose, reset } = useDockChoice(user, t);
  const [editing, setEditingRaw] = useState(null);   // the slot index being changed
  // The last slot opened, so the pop-up keeps its title while it closes.
  const [shown, setShown] = useState(null);
  const setEditing = (i) => { setEditingRaw(i); if (i != null) setShown(i); };
  const current = shown != null ? slots[shown] : null;
  const more = { label: t("bottomnav.more", "More"), icon: DotsThree };

  const pick = (to, label) => {
    const was = current?.label;
    choose(editing, to);
    setEditing(null);
    if (to !== current?.to) toast.success(`Dock updated — ${label} is where ${was} was`);
  };

  return (
    <div className="ng-bento p-5" data-testid="settings-dock-card">
      <div className="mb-1 flex items-center gap-2">
        <SquaresFour size={20} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Your dock</h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        Tap a place in the dock to choose what it opens. Dex stays in the middle and More stays at the end.
      </p>

      {/* THE MOCK — the bar's ink, rim and shape, and its order. */}
      <div data-testid="dock-pref-mock"
        className={cn("flex h-[5.25rem] items-stretch gap-0.5 rounded-[var(--radius-card)] px-2",
          INK_PLATE, "border border-[hsl(40_30%_92%/.28)] shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_0_hsl(40_40%_96%/.22)]")}>
        {slots.slice(0, 2).map((s, i) => <Slot key={s.to} item={s} index={i} onPick={setEditing} />)}
        <span className="grid w-[4.5rem] shrink-0 place-items-center" aria-hidden="true">
          <span className="ng-slider-knob h-14 w-14 rounded-full" />
        </span>
        {slots.slice(2, 3).map((s) => <Slot key={s.to} item={s} index={2} onPick={setEditing} />)}
        <Slot item={more} fixed />
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Lock size={12} weight="bold" aria-hidden="true" /> Whatever leaves the dock is still one tap away in More.
      </p>

      {custom && (
        <button type="button" onClick={() => { reset(); toast.success("Dock back to how it came"); }}
          data-testid="dock-pref-reset"
          className={cn("mt-4 flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-700", GLASS_PILL)}>
          <ArrowsClockwise size={15} weight="bold" aria-hidden="true" /> Reset to the default
        </button>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className={cn(GLASS_SHEET, "rounded-[1.75rem] p-5 [&>button.absolute]:hidden")} data-testid="dock-pref-picker">
          <DialogTitle className="text-left text-[20px] font-semibold tracking-tight text-slate-900">
            {current ? `Instead of ${current.label}` : "Choose a place"}
          </DialogTitle>
          <DialogDescription className="text-left text-sm text-slate-500">
            Pick what this place in the dock opens.
          </DialogDescription>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {current && (
              <button type="button" onClick={() => setEditing(null)} data-testid="dock-pref-keep"
                className={cn("flex min-h-[3.25rem] items-center gap-2.5 rounded-pill px-3 text-left", INK_PILL)}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15">
                  <current.icon size={15} weight="bold" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.label}</span>
                <Check size={14} weight="bold" aria-hidden="true" className="shrink-0" />
              </button>
            )}
            {[...rest, ...slots.filter((s) => s.to !== current?.to)].map((c) => {
              const Icon = c.icon;
              const inDock = slots.some((s) => s.to === c.to);
              return (
                <button key={c.to} type="button" onClick={() => pick(c.to, c.label)}
                  data-testid={`dock-pref-option-${c.id}`}
                  className={cn("flex min-h-[3.25rem] items-center gap-2.5 rounded-pill px-3 text-left text-slate-800 hover:bg-white", GLASS_PILL)}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900/[0.06]">
                    <Icon size={15} weight="bold" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.label}</span>
                    {inDock && <span className="block text-[11px] text-slate-500">Swaps places</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setEditing(null)}
            className={cn("mt-4 flex h-12 w-full items-center justify-center rounded-pill text-sm font-medium text-slate-700", GLASS_PILL)}>
            Cancel
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DockCard;
