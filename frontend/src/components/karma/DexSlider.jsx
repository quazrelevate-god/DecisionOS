/* DEX-SLIDER Part 2 · the Desk's Dex control on a phone.
 *
 * A track with a handle at the centre and a target at each end. Drag LEFT to
 * Ask, RIGHT to the decision door. It is the iPhone's own slide-to-answer
 * grammar, which is the argument for it: these founders already know that a
 * deliberate drag commits and a half-hearted one does not.
 *
 * IT COMMITS ONLY AT THE FAR END, ON RELEASE. Anywhere short of the end the
 * handle springs back and nothing happens. That is the whole safety property —
 * a capture is somebody's decision reaching their team, and a swipe that half
 * lands must never start one. You can stop, hold, and drag back.
 *
 * WHY IT DOES NOT FIGHT THE SYSTEM BACK GESTURE. iOS and Android both own the
 * screen edges, and this app now has an iOS edge-swipe back (df5dc98) and an
 * edge swipe that closes sheets (e2ad0e5). Those fire on a touch that STARTS
 * within a few points of the edge. This handle starts at the CENTRE of the
 * track and the track is inset from the page gutter, so a drag begins in the
 * middle of the screen and the system never claims it — the finger may end
 * near an edge, which is not what either gesture reads. It still wants
 * confirming on a real iPhone, because that is the only place the real
 * recogniser runs.
 *
 * NO TAP TO ACTIVATE — the swipe is the control, deliberately. But NM-4 says
 * every interactive thing is reachable without one, so the handle is a real
 * button with a name, it keeps the app's focus ring, and Left/Right arrows
 * commit to either end for assistive technology and external keyboards. That costs no
 * visible chrome and makes the control operable without a drag.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/* How far from an end counts as "arrived". Not zero: a finger that has taken
   the handle to within a few pixels of the stop has made its intention plain,
   and demanding the last three would make the control feel broken. */
const END_SLOP = 6;

/* The haptic tick. Capacitor only — the browser PWA has no vibration API worth
   using on iOS and must not throw reaching for one. Resolved lazily so the web
   build never pulls the plugin into its graph. */
async function tick(style) {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: style === "fire" ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch (e) {
    /* No plugin, no permission, no hardware: the control is unchanged. */
  }
}

/**
 * @param {Function} onAsk     reached and released at the LEFT end
 * @param {Function} onDecide  reached and released at the RIGHT end
 * @param {boolean}  [disabled]
 */
export function DexSlider({ onAsk, onDecide, disabled = false, className }) {
  const { t } = useTranslation();
  const trackRef = React.useRef(null);
  const handleRef = React.useRef(null);
  const [dx, setDx] = React.useState(0);        // handle offset from centre, px
  const [dragging, setDragging] = React.useState(false);
  const reachedRef = React.useRef(null);        // which end we last ticked for

  /* The furthest the handle can travel each way: half the track, less half the
     handle, less the track's own padding. Measured, never assumed — the track
     is a percentage of a page whose width we do not own. */
  const travel = React.useCallback(() => {
    const tr = trackRef.current, h = handleRef.current;
    if (!tr || !h) return 0;
    /* getBoundingClientRect, NOT clientWidth/offsetWidth. The app puts every
       phone on CSS `zoom: 0.8` (--ui-scale, ASK-43), and the two families do
       not agree under it: offsetWidth is CSS pixels, while a pointer's clientX
       and a rect are the visual pixels the finger actually moves through. Mixed,
       the stop sits 1.25x further away than the track is wide and the handle
       tops out at 89% of a target it can never reach — measured, before this
       line was what it is. Both sides of the comparison come from rects now. */
    return Math.max(0, (tr.getBoundingClientRect().width - h.getBoundingClientRect().width) / 2 - 4);
  }, []);

  const end = React.useCallback((x) => {
    const max = travel();
    if (max <= 0) return null;
    if (x <= -(max - END_SLOP)) return "ask";
    if (x >= max - END_SLOP) return "decide";
    return null;
  }, [travel]);

  const settle = React.useCallback(() => { setDx(0); reachedRef.current = null; }, []);

  const onPointerDown = (e) => {
    if (disabled) return;
    handleRef.current?.setPointerCapture?.(e.pointerId);
    setDragging(true);
    reachedRef.current = null;
  };

  const onPointerMove = (e) => {
    if (!dragging || disabled) return;
    const tr = trackRef.current;
    if (!tr) return;
    const r = tr.getBoundingClientRect();
    const max = travel();
    /* Where the finger is, relative to the track's centre, clamped to the
       stops. The handle follows the whole way — it never jumps ahead of the
       finger or lags it. */
    const raw = e.clientX - (r.left + r.width / 2);
    const next = Math.max(-max, Math.min(max, raw));
    setDx(next);
    const at = end(next);
    if (at && reachedRef.current !== at) { reachedRef.current = at; tick("arrive"); }
    if (!at) reachedRef.current = null;
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    const at = end(dx);
    settle();
    if (!at) return;                       // short of the end: nothing happened
    tick("fire");
    (at === "ask" ? onAsk : onDecide)?.();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); tick("fire"); onAsk?.(); }
    if (e.key === "ArrowRight") { e.preventDefault(); tick("fire"); onDecide?.(); }
  };

  const at = end(dx);
  const pct = (() => { const m = travel(); return m ? Math.min(1, Math.abs(dx) / m) : 0; })();

  const Label = ({ side, children }) => (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none select-none text-[13px] font-medium transition-opacity duration-150",
        at === side ? "text-foreground opacity-100" : "text-foreground/45",
        side === "ask" ? "pl-4" : "pr-4"
      )}
    >{children}</span>
  );

  return (
    <div className={cn("flex w-full items-center", className)} data-testid="dex-slider">
      <div
        ref={trackRef}
        /* The sunken recipe the app's own fields are cut from, so the track
           reads as a channel the handle sits IN rather than a bar beside it. */
        className="nm-field relative flex h-[3.25rem] w-full items-center justify-between rounded-pill"
        data-at={at || undefined}
      >
        <Label side="ask">{t("desk.slider.ask", "Ask")}</Label>
        <Label side="decide">{t("desk.slider.decide", "Decide")}</Label>

        {/* The end the handle is heading for lights, in the page's own brand
            hue at a low alpha — an existing token, no new ramp, and never the
            alert colour, which in this app means money or a deadline at risk. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1 w-24 rounded-pill transition-opacity duration-150",
            at ? "opacity-100" : "opacity-0",
            at === "ask" ? "left-1" : "right-1"
          )}
          style={{ background: "color-mix(in oklab, var(--brand-600) 14%, transparent)" }}
        />

        <button
          ref={handleRef}
          type="button"
          data-testid="dex-slider-handle"
          disabled={disabled}
          aria-label={t("desk.slider.handle", "Slide left to ask Dex, right to record a decision")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { setDragging(false); settle(); }}
          onKeyDown={onKeyDown}
          className={cn(
            "kr-pop absolute left-1/2 grid h-11 w-11 place-items-center rounded-full",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
            "disabled:opacity-50 touch-none"
          )}
          style={{
            transform: `translateX(calc(-50% + ${dx}px))`,
            transition: dragging ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)",
          }}
        >
          {/* Two chevrons, because the control goes both ways and an arrow one
              way would say it does not. They fade on the side being left. */}
          <span aria-hidden="true" className="flex items-center gap-[3px] text-foreground/70">
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ opacity: dx > 0 ? 0.25 : 1 }}>
              <path d="M6 1 1 6l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ opacity: dx < 0 ? 0.25 : 1 }}>
              <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>

        {/* What a screen reader hears while the handle moves. */}
        <span className="sr-only" aria-live="polite">
          {at === "ask" ? t("desk.slider.atAsk", "Release to ask Dex")
            : at === "decide" ? t("desk.slider.atDecide", "Release to record a decision")
            : ""}
        </span>
      </div>
      {/* pct is read by the suite to prove the handle follows the finger. */}
      <span className="sr-only" data-testid="dex-slider-progress">{Math.round(pct * 100)}</span>
    </div>
  );
}

export default DexSlider;
