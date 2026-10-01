/* DEX-SLIDER Part 2 · the Desk's Dex control on a phone.
 *
 * A well with a handle at the centre and a target at each end. Drag LEFT to
 * Ask, RIGHT to the decision door. It is the iPhone's own slide-to-answer
 * grammar, which is the argument for it: these founders already know that a
 * deliberate drag commits and a half-hearted one does not.
 *
 * IT COMMITS ONLY AT THE FAR END, ON RELEASE. Anywhere short of the end the
 * handle springs back and nothing happens. That is the whole safety property —
 * a capture is somebody's decision reaching their team, and a swipe that half
 * lands must never start one. You can stop, hold, and drag back.
 *
 * REDRAWN AFTER THE FOUNDER SAW IT ON AN IPHONE (2026-10-01), to their own
 * rearrangement:
 *   · It sits in the app's concave Dex-well surface (.kr-slider-well) rather
 *     than on a flat field, so the handle reads as running IN a channel.
 *   · It is taller, because the handle has to be easy to hit. 3.5rem of handle
 *     is 44 real pixels once --ui-scale's 0.8 is applied; the 2.75rem it was
 *     measured 35, and only cleared the touch floor on paper (offsetHeight is
 *     CSS pixels — the same unit-family trap that put the stop in the wrong
 *     place, see `travel`).
 *   · THE ICON SAYS WHERE YOU ARE GOING. At rest it is the sparkle, which is
 *     Dex's own mark throughout the app; carried left it becomes the chat
 *     bubble that Ask wears, carried right the waveform that recording wears.
 *     The two chevrons it replaces said "this slides" and nothing else, which
 *     the handle's position already says.
 *   · The ripple moved in here off the decision door, where over a blurred
 *     Desk it read as smearing. Rings, not waves — a different motion from the
 *     one it replaces — born at the handle, dying at the wall, clipped by the
 *     pill so nothing escapes the control, and answering the mic meter while a
 *     capture is recording.
 *
 * WHY IT DOES NOT FIGHT THE SYSTEM BACK GESTURE. iOS and Android both own the
 * screen edges, and this app now has an iOS edge-swipe back (df5dc98) and an
 * edge swipe that closes sheets (e2ad0e5). Those fire on a touch that STARTS
 * within a few points of the edge. This handle starts at the CENTRE of the
 * track and the track is inset from the page gutter, so a drag begins in the
 * middle of the screen and the system never claims it — the finger may end
 * near an edge, which is not what either gesture reads.
 *
 * NO TAP TO ACTIVATE — the swipe is the control, deliberately. But NM-4 says
 * every interactive thing is reachable without one, so the handle is a real
 * button with a name, it keeps the app's focus ring, and Left/Right arrows
 * commit to either end for assistive technology and external keyboards.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Sparkle, ChatCircleDots, Waveform } from "@phosphor-icons/react";
import { VoiceRipple } from "./VoiceRipple";
import { cn } from "@/lib/utils";

/* How far from an end counts as "arrived". Not zero: a finger that has taken
   the handle to within a few pixels of the stop has made its intention plain,
   and demanding the last three would make the control feel broken. */
const END_SLOP = 6;

/* THE FOUNDER'S OWN NUMBERS, dialled in the lab and handed over verbatim
   (2026-10-01). My first cut of this was a CSS ring animation, which they could
   not see at all — so the slider runs the app's real ripple material instead,
   decoratively: the same canvas the Dex well uses, clipped to the pill, with no
   control of its own. */
const SLIDER_RIPPLE = {
  gain: 0.95, thickness: 3, softness: 2.5, water: 1,
  elastic: 0, speed: 0.9, density: 0.65,
};

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
 * @param {Function} onAsk      reached and released at the LEFT end
 * @param {Function} onDecide   reached and released at the RIGHT end
 * @param {Function} [readLevel] 0..1 mic loudness, read per frame, never state
 * @param {boolean}  [disabled]
 */
export function DexSlider({ onAsk, onDecide, readLevel = null, disabled = false, className }) {
  const { t } = useTranslation();
  const trackRef = React.useRef(null);
  const handleRef = React.useRef(null);
  const [dx, setDx] = React.useState(0);        // handle offset from centre, px
  const lastDxRef = React.useRef(0);           // the same, readable in the same tick
  /* `dragging` IS A REF FIRST AND STATE SECOND, and that is not a micro-
     optimisation. onPointerMove opens with `if (!dragging) return`, and state
     set in onPointerDown is not visible to a move that arrives in the same
     tick — so a FAST FLICK (down, move, up before React re-renders) was
     silently dropped and the control did nothing. Found by driving the real
     slider in a browser rather than by a test, which is the only way a race
     this shape shows up. The ref is the truth the handlers read; the state
     exists only so the handle's CSS transition can be switched off mid-drag. */
  const draggingRef = React.useRef(false);
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

  const settle = React.useCallback(() => { lastDxRef.current = 0; setDx(0); reachedRef.current = null; }, []);

  /* WHERE THE WAVES ARE BORN, in the track's own CSS pixels — which is NOT the
     unit `dx` is in. `dx` comes from clientX and is therefore visual pixels,
     and this app runs at zoom .8, so the two families differ by 1.25x (the same
     trap that put the stop in the wrong place; see `travel`). The ripple's
     stage is the track element, so its coordinates are the element's own box:
     offsetWidth, and dx converted back out of visual space. */
  const [stage, setStage] = React.useState(null);
  React.useEffect(() => {
    const tr = trackRef.current;
    if (!tr || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      const next = { w: tr.offsetWidth, h: tr.offsetHeight, hub: handleRef.current?.offsetWidth || 56 };
      setStage((c) => (c && c.w === next.w && c.h === next.h && c.hub === next.hub ? c : next));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(tr);
    fit();
    return () => ro.disconnect();
  }, []);
  const uiScale = (() => {
    if (typeof window === "undefined") return 1;
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  })();

  const onPointerDown = (e) => {
    if (disabled) return;
    handleRef.current?.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    reachedRef.current = null;
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current || disabled) return;
    const tr = trackRef.current;
    if (!tr) return;
    const r = tr.getBoundingClientRect();
    const max = travel();
    /* Where the finger is, relative to the track's centre, clamped to the
       stops. The handle follows the whole way — it never jumps ahead of the
       finger or lags it. */
    const raw = e.clientX - (r.left + r.width / 2);
    const next = Math.max(-max, Math.min(max, raw));
    lastDxRef.current = next;          // onPointerUp reads this, not `dx`
    setDx(next);
    const at = end(next);
    if (at && reachedRef.current !== at) { reachedRef.current = at; tick("arrive"); }
    if (!at) reachedRef.current = null;
  };

  const onPointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const at = end(lastDxRef.current);
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

  /* WHICH WAY ARE YOU GOING. The icon turns the moment the handle leaves the
     middle, not only at the stop — half a drag should already tell you which
     room you are opening, so that a drag begun by accident can be read and
     abandoned before it commits. */
  const heading = dx < -2 ? "ask" : dx > 2 ? "decide" : null;
  const Glyph = heading === "ask" ? ChatCircleDots : heading === "decide" ? Waveform : Sparkle;

  const Label = ({ side, children }) => (
    <span
      aria-hidden="true"
      className={cn(
        /* /70, not /45. Measured on the rendered control: foreground at 45%
           over the well's own wash lands at 2.99:1 for a 12pt label, against
           the 4.5:1 that accessibility.md › Contrast requires up to 17pt. At
           70% it measures 5.6:1. The two ends still read as quieter than the
           one the handle has arrived at, which is the only thing the lower
           alpha was buying. */
        "pointer-events-none select-none text-[15px] font-medium transition-opacity duration-150",
        at === side ? "text-foreground opacity-100" : "text-foreground/70",
        side === "ask" ? "pl-6" : "pr-6"
      )}
    >{children}</span>
  );

  return (
    <div className={cn("flex w-full items-center", className)} data-testid="dex-slider">
      <div
        ref={trackRef}
        className="kr-slider-well relative flex h-[var(--desk-slider-track)] w-full items-center justify-between overflow-hidden"
        data-at={at || undefined}
      >
        {/* The ripple, under everything and reachable by nothing: VoiceRipple's
            inward mode already wraps itself in `pointer-events-none absolute
            inset-0 overflow-hidden rounded-[inherit]`, so the pill is the wall
            and nothing can be drawn past it. It breathes at rest and answers
            the microphone through the capture's own meter while one is running. */}
        {stage && (
          <VoiceRipple
            mode="in"
            decorative
            config={SLIDER_RIPPLE}
            hubPx={stage.hub}
            hubAt={{ x: stage.w / 2 + dx / uiScale, y: stage.h / 2 }}
            idle={0.16}
            readLevel={readLevel}
            listening={false}
          />
        )}

        <Label side="ask">{t("desk.slider.ask", "Ask")}</Label>
        <Label side="decide">{t("desk.slider.decide", "Decide")}</Label>

        {/* The end the handle is heading for lights, in the page's own brand
            hue at a low alpha — an existing token, no new ramp, and never the
            alert colour, which in this app means money or a deadline at risk. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1.5 w-28 rounded-pill transition-opacity duration-150",
            at ? "opacity-100" : "opacity-0",
            at === "ask" ? "left-1.5" : "right-1.5"
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
          onPointerCancel={() => { draggingRef.current = false; setDragging(false); settle(); }}
          onKeyDown={onKeyDown}
          className={cn(
            "kr-pop absolute left-1/2 grid h-14 w-14 place-items-center rounded-full",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
            "disabled:opacity-50 touch-none"
          )}
          style={{
            transform: `translateX(calc(-50% + ${dx}px))`,
            transition: dragging ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)",
          }}
        >
          <Glyph
            size={24}
            weight={heading ? "regular" : "fill"}
            aria-hidden="true"
            className="text-foreground/80"
          />
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
