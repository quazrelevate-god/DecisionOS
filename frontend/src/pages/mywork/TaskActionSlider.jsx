/* The task view's one control (founder, 2026-10-29): "the action will be
 * replaced with the slider instead of the existing two buttons, Complete and
 * the chat icon… a compact container with a neumorphic inside shadow and the
 * same circle slider button used in our Dex slider. Swipe right, it marks it
 * complete; swipe left, it opens our dialog box — log note, hand off,
 * escalate."
 *
 * The same materials as the Dex slider (.ng-slider-well, .ng-slider-knob) at a
 * compact height, and the same safety property: it commits only when the
 * handle reaches an end and is let go there; anywhere short of it the handle
 * springs back and nothing happens. Left and Right arrows do the same for a
 * keyboard. A tap without a drag shows the gesture (the handle leans right,
 * then left) rather than doing anything.
 *
 * When this person cannot finish the task (somebody else marks it done, it
 * waits on an approval, its sign-off is pending) the right end says why and
 * the handle will not travel there; the left end still works.
 */
import { useCallback, useRef, useState } from "react";
import { ArrowsLeftRight, ChatText, CheckCircle, Check, Lock } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

const END_SLOP = 6;

async function tick(strong) {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: strong ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch { /* no plugin, no haptics: the control is unchanged */ }
}

const uiScale = () => {
  if (typeof window === "undefined") return 1;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
};

/**
 * @param {Function} onComplete   reached and released at the RIGHT end
 * @param {Function} onUpdate     reached and released at the LEFT end
 * @param {boolean}  canFinish    the right end is open to this person
 * @param {string}   [finishHint] what the right end says when it is not
 * @param {boolean}  [needsProof] the task asks for proof and has none yet
 * @param {string}   [updateLabel]
 */
export function TaskActionSlider({ onComplete, onUpdate, canFinish = true, finishHint = "", needsProof = false,
                                   updateLabel = "Update", busy = false, testid = "task-action-slider" }) {
  const trackRef = useRef(null);
  const knobRef = useRef(null);
  const [dx, setDx] = useState(0);
  const lastRef = useRef(0);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const reachedRef = useRef(null);

  const travel = useCallback(() => {
    const tr = trackRef.current, k = knobRef.current;
    if (!tr || !k) return 0;
    return Math.max(0, (tr.getBoundingClientRect().width - k.getBoundingClientRect().width) / 2 - 4);
  }, []);
  const settle = () => { lastRef.current = 0; setDx(0); reachedRef.current = null; };

  const onPointerDown = (e) => {
    if (busy) return;
    dragRef.current = { x0: e.clientX, moved: false };
    knobRef.current?.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const raw = e.clientX - d.x0;
    if (Math.abs(raw) > 4) d.moved = true;
    const max = travel();
    const next = Math.max(-max, Math.min(canFinish ? max : 0, raw));
    lastRef.current = next;
    setDx(next);
    const at = next <= -(max - END_SLOP) ? "left" : next >= max - END_SLOP ? "right" : null;
    if (at && reachedRef.current !== at) { reachedRef.current = at; tick(false); }
    if (!at) reachedRef.current = null;
  };
  const nudge = () => {
    // Show the gesture: lean right, then left, then home.
    const max = travel() * 0.28;
    setDx(canFinish ? max : 0);
    setTimeout(() => setDx(-max), 260);
    setTimeout(() => setDx(0), 560);
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved) { settle(); nudge(); return; }
    const max = travel();
    const v = lastRef.current;
    settle();
    if (v <= -(max - END_SLOP)) { tick(true); onUpdate?.(); return; }
    if (canFinish && v >= max - END_SLOP) { tick(true); onComplete?.(); }
  };
  const onKeyDown = (e) => {
    if (busy) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); tick(true); onUpdate?.(); }
    if (e.key === "ArrowRight" && canFinish) { e.preventDefault(); tick(true); onComplete?.(); }
  };

  const max = travel() || 1;
  const pct = Math.min(1, Math.abs(dx) / max);
  const toRight = dx > 2, toLeft = dx < -2;
  const Glyph = toRight ? Check : toLeft ? ChatText : ArrowsLeftRight;
  const s = uiScale();

  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div ref={trackRef}
        className="ng-slider-well relative flex h-[4.25rem] w-full items-center justify-between overflow-hidden px-6 select-none">
        {/* What each end is, fading as the handle covers it; the side it is
            heading for takes a faint wash of its own colour. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-l-full transition-opacity"
          style={{ opacity: toLeft ? pct : 0, background: "linear-gradient(90deg, hsl(0 0% 9% / .10), transparent)" }} />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-1/2 rounded-r-full transition-opacity"
          style={{ opacity: toRight ? pct : 0, background: "linear-gradient(270deg, hsl(44 88% 60% / .30), transparent)" }} />
        <span aria-hidden="true" className="relative flex items-center gap-2 text-[14px] font-semibold text-slate-700"
          style={{ opacity: toLeft ? Math.max(0, 1 - pct * 1.4) : 1 }}>
          <ChatText size={17} weight="bold" /> {updateLabel}
        </span>
        <span aria-hidden="true" className={cn("relative flex items-center gap-2 text-[14px] font-semibold",
          canFinish ? (needsProof ? "text-slate-500" : "text-slate-800") : "text-slate-400")}
          style={{ opacity: toRight ? Math.max(0, 1 - pct * 1.4) : 1 }}>
          {canFinish
            ? <>{needsProof ? "Add proof" : "Complete"} <CheckCircle size={17} weight="fill" /></>
            : <><Lock size={14} weight="bold" /> Locked</>}
        </span>

        <button ref={knobRef} type="button" data-testid={`${testid}-handle`} disabled={busy}
          aria-label={canFinish
            ? `Slide right to ${needsProof ? "complete (proof needed first)" : "complete the task"}, left to ${updateLabel.toLowerCase()}`
            : `Slide left to ${updateLabel.toLowerCase()}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; setDragging(false); settle(); }}
          onKeyDown={onKeyDown}
          className="ng-slider-knob absolute left-1/2 top-1/2 grid h-14 w-14 place-items-center rounded-full touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ng-outline disabled:opacity-50"
          style={{
            transform: `translate(calc(-50% + ${dx / s}px), -50%)`,
            transition: dragging ? "none" : "transform 260ms cubic-bezier(.22,1,.36,1)",
          }}>
          <Glyph size={22} weight="bold" aria-hidden="true" className="text-foreground/70" />
        </button>
      </div>
      {!canFinish && finishHint && (
        <p className="px-2 text-center text-[12px] text-slate-500" data-testid={`${testid}-hint`}>{finishHint}</p>
      )}
    </div>
  );
}

export default TaskActionSlider;
