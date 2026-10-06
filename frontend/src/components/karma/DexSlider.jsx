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
import { ChatCircle, PaperPlaneTilt, Waveform } from "@phosphor-icons/react";
import { DexWave } from "../mobile/DexWave";
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
/* 2026-10-05 — SUBTLER, AND THE WAVE ITSELF HEAVIER. The founder wanted both
   at once, which sounds contradictory and is not: `thickness` is the ridge's
   weight, `gain` is how far a voice throws it and `density` is how many are in
   flight. A heavier ridge pushed less hard, fewer at a time, reads as one slow
   swell instead of a busy shimmer. gain .95 -> .6, density .65 -> .45,
   thickness 3 -> 4.5; softness stays, since blurring a thicker ridge further
   would spend the weight we just added. */
const SLIDER_RIPPLE = {
  gain: 0.6, thickness: 4.5, softness: 2.5, water: 1,
  elastic: 0, speed: 0.9, density: 0.45,
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
 * @param {React.ReactNode} [menu]  drawn INSIDE the well, above the track: the
 *   dock's More menu, which grows this same container rather than opening a
 *   second one over it.
 */
/**
 * @param {Function} onAsk      reached and released at the LEFT end
 * @param {Function} onDecide   reached and released at the RIGHT end
 * @param {boolean}  [capturing] the right end is open: this track IS the
 *                   recording surface, the handle is parked at it, and pressing
 *                   the handle is the way to stop
 * @param {boolean}  [recording] the microphone is live right now
 * @param {Function} [onStop]   the parked handle was pressed
 * @param {object}   [levelsRef] the capture's rolling loudness window, for DexWave
 */
export function DexSlider({ onAsk, onDecide, readLevel = null, capturing = false,
                            recording = false, onStop, levelsRef = null,
                            /* "light" — the control sits on the page's own pale
                               ground, which is everywhere it ships today.
                               "ink"   — it sits on the black sheet. The well
                               inverts (dark glass, light inset) and the ends go
                               white, because near-black ink on that sheet
                               measured 1.05:1. */
                            tone = "light",
                            /* ASK USES THE SAME CONTROL, NOT A DIFFERENT ONE.
                               (2026-10-05, second pass.) The first cut hung a
                               plus, two mini-buttons and a text field off this
                               component; the founder threw it out, and rightly
                               — Ask now behaves exactly as Decide does, and all
                               the typing, attaching and editing happens in the
                               review card that opens on send. So `composer` is
                               down to the two things that genuinely differ:
                               the handle parks LEFT (the end Ask commits from)
                               and the right end offers nothing, because there
                               is no Decide door to open mid-question. */
                            composer = false,
                            /* THE DOCK USES THIS CONTROL AS ITS BAR. (2026-10-06.)
                               On every page but the Desk the founder wants the
                               navbar to BE the slider: its height, its well,
                               the handle in the middle and the destinations
                               either side, which fade out exactly as fast as
                               the Ask/Decide ends fade in.
                               `behind` is what the well carries under the
                               handle — the dock passes its own items. `onDrag`
                               reports the travel (0..1 and which way) so the
                               caller can fade them in step with the gesture
                               rather than guessing at a duration. */
                            behind = null, onDrag, onPressChange,
                            disabled = false, menu = null, className }) {
  const onInk = tone === "ink";
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
    /* NO INSET. There used to be a 4px tuck at each end, which left the handle
       stopping just short of the wall and reading as a control that had not
       quite finished its travel. The founder asked for the extreme edge, so
       the only thing between the handle and the wall is the handle. */
    return Math.max(0, (tr.getBoundingClientRect().width - h.getBoundingClientRect().width) / 2);
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

  /* PARKED — AT THE END IT CAME FROM. While a capture is open the handle is
     not a handle: it sits at the stop and it is a send button. Dragging is off
     rather than merely ignored, so a stray finger cannot scrub a live
     recording.
     2026-10-05 — THE SIDE WAS HARDCODED RIGHT, which was invisible while the
     only capture started by dragging right (Decide). Ask starts by dragging
     LEFT, so the handle shot back across the whole control and parked on top
     of the plus: the founder's photograph shows the knob and the plus occupying
     the same corner, and their note says it exactly — "when I swipe left the
     button should stay left and it should become a send icon, but it again
     switches back to the right side". A control that travels away from the
     finger that committed it is lying about what it just did. */
  React.useEffect(() => {
    if (!capturing) return;
    draggingRef.current = false;
    setDragging(false);
    const park = () => { const m = composer ? -travel() : travel(); lastDxRef.current = m; setDx(m); };
    park();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(park) : null;
    if (ro && trackRef.current) ro.observe(trackRef.current);
    return () => ro?.disconnect();
  }, [capturing, travel, composer]);
  React.useEffect(() => { if (!capturing) settle(); }, [capturing, settle]);

  const onPointerDown = (e) => {
    /* BEFORE the capturing guard, deliberately: while a capture runs dragging
       is off and this returns early, and a disarm that never ran is how the
       stale flag survived to eat a real press. A touch always disarms. */
    ghostClickRef.current = false;
    setTouched(true);
    if (disabled || capturing) return;
    /* THE TOUCH IS THE SIGNAL, not the travel. The founder wants the dock's
       destinations gone the instant the knob is pressed — "then only it looks
       elegant, otherwise it feels like some sloppy stuff" — rather than
       dissolving across the drag. Reported here so the bar can clear itself
       before the finger has moved a pixel. */
    onPressChange?.(true);
    handleRef.current?.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    reachedRef.current = null;
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current || disabled || capturing) return;
    const tr = trackRef.current;
    if (!tr) return;
    const r = tr.getBoundingClientRect();
    const max = travel();
    /* Where the finger is, relative to the track's centre, clamped to the
       stops. The handle follows the whole way — it never jumps ahead of the
       finger or lags it. */
    const raw = e.clientX - (r.left + r.width / 2);
    /* IN A CONVERSATION THE HANDLE ONLY GOES LEFT. The right end belongs to
       the plus now — the Decide label is already gone from it — and a handle
       that could still travel there would slide under the plus and offer a
       door that makes no sense mid-question. The stop is the centre. */
    const next = Math.max(-max, Math.min(composer ? 0 : max, raw));
    lastDxRef.current = next;          // onPointerUp reads this, not `dx`
    setDx(next);
    const at = end(next);
    if (at && reachedRef.current !== at) { reachedRef.current = at; tick("arrive"); }
    if (!at) reachedRef.current = null;
  };

  /* THE CLICK THAT FOLLOWS A DRAG IS NOT A PRESS. A pointerdown, a move and a
     pointerup on a <button> also produce a `click`, and the handle's click is
     the SEND — so committing Ask with a swipe armed the capture and then, one
     event later, the same gesture pressed send on it, opening the review the
     instant a thumb left the glass with nothing recorded.
     TOLD APART BY THE POINTERDOWN, not by a clock. Two earlier guards were
     wrong in opposite directions: a flag the trailing click cleared assumed
     that click always arrives (WebKit suppresses it after a pointer that
     moved, so the flag stayed set and ate the founder's next REAL press —
     "I need to press twice"); a 400ms window then swallowed any press inside
     it, including the legitimate one verify:dex makes immediately after
     opening the door.
     A ghost click arrives with NO pointerdown of its own. A real press always
     has one. So pointerdown disarms, pointerup after a move arms, and the
     thing in between is the only click ever dropped — no timing, and a stale
     flag cannot survive the next touch. */
  const ghostClickRef = React.useRef(false);
  /* THE RIPPLE WAITS TO BE TOUCHED. (2026-10-06, founder: "hide the ripple
     effect animation loop and start showing once the user touches the slider
     button.") It used to breathe at rest on every screen — a loop running all
     day in the corner of a dock, drawing a canvas frame for nobody. It comes up
     with the finger and stays for as long as there is something to answer: the
     drag itself, and then the capture. */
  const [touched, setTouched] = React.useState(false);
  const onPointerUp = () => {
    onPressChange?.(false);
    setTouched(false);
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const at = end(lastDxRef.current);
    ghostClickRef.current = Math.abs(lastDxRef.current) > 4;
    settle();
    if (!at) return;                       // short of the end: nothing happened
    tick("fire");
    (at === "ask" ? onAsk : onDecide)?.();
  };

  const onKeyDown = (e) => {
    if (disabled || capturing) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); tick("fire"); onAsk?.(); }
    if (e.key === "ArrowRight") { e.preventDefault(); tick("fire"); onDecide?.(); }
  };

  const at = end(dx);
  const pct = (() => { const m = travel(); return m ? Math.min(1, Math.abs(dx) / m) : 0; })();
  /* Reported after paint, not during the pointer handler: the caller re-renders
     on it, and doing that inside the move would put a React commit between the
     finger and the handle. */
  const onDragRef = React.useRef(onDrag);
  onDragRef.current = onDrag;
  React.useEffect(() => {
    onDragRef.current?.(pct, dx < -2 ? "ask" : dx > 2 ? "decide" : null);
  }, [pct, dx]);

  /* WHICH WAY ARE YOU GOING. The icon turns the moment the handle leaves the
     middle, not only at the stop — half a drag should already tell you which
     room you are opening, so that a drag begun by accident can be read and
     abandoned before it commits. */
  const heading = capturing ? null : dx < -2 ? "ask" : dx > 2 ? "decide" : null;
  /* HOLLOW, AND ROUND. The filled sparkle read as a sticker on a white disc at
     this size — the founder's word was "not nice". These are all outline forms
     that answer the handle's own circle: an aperture at rest, the chat bubble
     carried left, the waveform carried right. Outline weight throughout so the
     glyph is a drawing on the surface rather than a second shape stuck to it. */
  /* NOTHING IN IT AT REST. The founder's call: the knob is a plain button until
     it is doing something. A glyph sitting in the dish all the time was
     decoration — the handle's POSITION already says what the control is, and an
     icon that never changes says nothing a second time. It appears the moment
     the handle leaves the middle, which is also the moment it has something to
     say: which room you are opening, or that this is now a send. */
  const Glyph = capturing ? PaperPlaneTilt
    : heading === "ask" ? ChatCircle : heading === "decide" ? Waveform : null;

  /* THE WORDS GET OUT OF THE WAY. The handle now travels to the wall, so it
     arrives exactly where the labels are printed; they fade on approach rather
     than being covered. It is also the right feeling — the chrome that told you
     what the control does has done its job by the time you are committing.
     Driven off `pct` (0..1 of the travel) so it is continuous with the finger
     and reverses on the way back, with no transition fighting the drag. */
  const Label = ({ side, children }) => (
    <span
      aria-hidden="true"
      /* ON THE DESK the ends are NAMED AT REST and get out of the way as the
         handle arrives. IN THE DOCK it is the other way round: the bar already
         carries four destinations, so the ends appear as those fade, which is
         the swap the founder asked to happen "simultaneously". One number
         drives both directions, so they cannot drift apart.
         AND IN THE DOCK ONLY ONE WORD IS EVER SHOWN. (2026-10-06, founder.)
         Both faded up together, so a drag to the right lit "Decide" on the left
         AND "Ask" on the right — and since the gesture is heading right, the
         word sitting at the end you are travelling toward says the opposite of
         what is about to happen: "we are swiping towards the Ask when we swipe
         right as the text indicates". Only the word that NAMES WHERE THIS DRAG
         IS GOING appears; the other is not faded, it is absent.
         `names` is which end this label is the name of, which in the dock is
         the opposite of the side it prints on — that is the swap two commits
         ago, where the word moved out from under the thumb. */
      style={{ opacity: behind
        ? (heading === (side === "ask" ? "decide" : "ask") ? Math.min(1, pct * 1.6) : 0)
        : Math.max(0, 1 - pct * 1.25) }}
      className={cn(
        /* /70, not /45. Measured on the rendered control: foreground at 45%
           over the well's own wash lands at 2.99:1 for a 12pt label, against
           the 4.5:1 that accessibility.md › Contrast requires up to 17pt. At
           70% it measures 6.78:1. */
        "pointer-events-none select-none text-[15px] font-medium",
        onInk ? "text-white/75" : "text-foreground/70",
        side === "ask" ? "pl-7" : "pr-7"
      )}
    >{children}</span>
  );

  return (
    <div className={cn("flex w-full flex-col", className)} data-testid="dex-slider">
      <div className="flex w-full items-center">
      {/* THE WELL IS THE CONTAINER; THE TRACK IS A ROW INSIDE IT.
          (2026-10-06, founder, on the More menu: "the exact dock black
          container should expand to reveal the more menu items" — the first cut
          grew a NEW sheet and left the bar sitting inside it as a cutout, which
          is two containers where there should be one.)
          So anything handed in as `menu` is drawn INSIDE this same well, above
          the track, and the well takes the height: one black object that is a
          pill when it is a bar and a card when it has a menu in it. With no
          menu the two boxes are the same box — the well is exactly the track's
          height and carries the same radius it always did — so nothing about
          the control's geometry, its measurements or its suites changes. */}
      <div
        className={cn("kr-slider-well relative flex w-full overflow-hidden",
          menu ? "flex-col rounded-[var(--radius-card)]" : "h-[var(--desk-slider-track)]",
          onInk && "kr-slider-well--ink")}
        data-at={at || undefined}
        data-testid={menu ? "dex-slider-expanded" : undefined}
      >
      {menu}
      <div
        ref={trackRef}
        className="relative flex h-[var(--desk-slider-track)] w-full shrink-0 items-center justify-between"
      >
        {/* WHAT THE WELL CARRIES. Under the ripple and under the handle, so a
            drag passes over it rather than through it; the caller fades it. */}
        {behind}
        {/* The ripple, under everything and reachable by nothing: VoiceRipple's
            inward mode already wraps itself in `pointer-events-none absolute
            inset-0 overflow-hidden rounded-[inherit]`, so the pill is the wall
            and nothing can be drawn past it. It breathes at rest and answers
            the microphone through the capture's own meter while one is running. */}
        {stage && (touched || capturing) && (
          <VoiceRipple
            mode="in"
            /* Out of the handle, not into it. The well's own ripple runs inward
               because the well is a dish the sound arrives at; here the hub is
               a handle sitting in a channel, and a wave collapsing onto it read
               as the control being drained rather than speaking. */
            from="center"
            decorative
            config={SLIDER_RIPPLE}
            hubPx={stage.hub}
            hubAt={{ x: stage.w / 2 + dx / uiScale, y: stage.h / 2 }}
            idle={0.16}
            readLevel={readLevel}
            listening={false}
          />
        )}

        {capturing ? (
          /* THE SAME WAVE THE DOCK DRAWS WHEN DEX IS LISTENING (DexWave), not a
             second animation that would drift from it — the founder's whole
             point. `tone="ink"` because that one lives on the dark dock and this
             well is light. It reads the capture's own rolling levels, so it
             answers the room without this component holding any audio itself.
             The track is the surface now: there is no blurred screen, no second
             mic, and nothing to dismiss. */
          /* THE GAP GOES WHERE THE HANDLE IS. (2026-10-05.) These paddings
             keep the wave clear of the parked knob, and they were written when
             the only capture parked RIGHT — so in Ask, which parks LEFT, the
             wave was held off an end with nothing on it and ran under the knob
             at the other. The founder's photograph is the right-hand third of
             the control, empty. Mirrored with the park side; 7rem is the
             5.375rem knob and its breathing room, 1.5rem is the wall. */
          <div className={cn("pointer-events-none absolute inset-0 flex items-center",
            composer ? "pl-28 pr-6" : "pl-6 pr-28")} aria-hidden="true">
            <DexWave
              state={recording ? "listening" : "thinking"}
              levelsRef={levelsRef}
              levels={levelsRef?.current}
              live={recording}
              tone={onInk ? "onDark" : "ink"}
              className="h-full w-full"
            />
          </div>
        ) : (
          <>
            {/* THE WORD IS ON THE SIDE THE THUMB IS NOT. (2026-10-06.)
                Founder: "when I swipe right my thumb obviously covers the
                Decide text, and I can clearly see the Ask text on the left."
                Of course — you drag toward the word and then your hand is on
                top of it. So in the dock the ends TRADE PLACES: Decide prints
                on the left, Ask on the right, and each is read over the hand
                that is not moving. What the ends DO is unchanged — left still
                commits Ask and right still commits Decide; only the labels
                moved, because the gesture was never the thing that was wrong. */}
            <Label side="ask">{behind
              ? t("desk.slider.decide", "Decide")
              : t("desk.slider.ask", "Ask")}</Label>
            {!composer && <Label side="decide">{behind
              ? t("desk.slider.ask", "Ask")
              : t("desk.slider.decide", "Decide")}</Label>}
          </>
        )}

        {/* The end the handle is heading for lights, in the page's own brand
            hue at a low alpha — an existing token, no new ramp, and never the
            alert colour, which in this app means money or a deadline at risk. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 w-32 rounded-pill transition-opacity duration-150",
            capturing && "hidden",
            at ? "opacity-100" : "opacity-0",
            at === "ask" ? "left-0" : "right-0"
          )}
          style={{ background: "color-mix(in oklab, var(--brand-600) 14%, transparent)" }}
        />

        <button
          ref={handleRef}
          type="button"
          data-testid="dex-slider-handle"
          disabled={disabled}
          aria-label={capturing
            ? t("desk.slider.send", "Stop recording and send to Dex")
            : t("desk.slider.handle", "Slide left to ask Dex, right to record a decision")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { onPressChange?.(false); setTouched(false); draggingRef.current = false; setDragging(false); settle(); }}
          onKeyDown={onKeyDown}
          /* THREE JOBS, ONE BUTTON. At rest it is the handle. While a capture
             runs it is the send that stops it. In type mode it is the send for
             what is in the field — and it parks itself at the left wall to get
             out of the field's way, which is also where the founder asked for
             it to be. */
          onClick={capturing
            ? () => { if (ghostClickRef.current) { ghostClickRef.current = false; return; } onStop?.(); }
            : undefined}
          className={cn(
            /* THE HANDLE IS THE CONTROL, so it is the size of the control.
               h-14 left 40px of empty channel above and below it and read as a
               small knob rattling around in a big groove. 5.375rem in a 6rem
               track leaves 5px top and bottom — enough to see that it sits IN
               something, and no more. */
            /* kr-slider-knob — the founder's own button.png: a raised disc with
               a dish pressed into its face, rather than the flat kr-pop lozenge
               it was. The glyph sits in the dish. */
            "kr-slider-knob absolute left-1/2 grid h-[5.375rem] w-[5.375rem] place-items-center rounded-full",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
            "disabled:opacity-50 touch-none"
          )}
          style={{
            /* dx / uiScale, and the division is the whole bug. `dx` comes from
               clientX, so it is VISUAL pixels; `translateX` is applied inside
               the app's own `zoom: .8`, so it is read as CSS pixels. Writing
               dx straight in moved the handle 80% of the distance the logic had
               already committed to — the control reported itself at the end
               (pct 100, the labels fully faded, the haptic fired) while the
               handle visibly sat 29px short of the wall. Caught by asserting
               the handle's own rect against the track's, which is the only
               check that could have caught it: every internal number was
               already self-consistent and wrong together. */
            transform: `translateX(calc(-50% + ${dx / (uiScale || 1)}px))`,
            transition: dragging ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)",
          }}
        >
          {Glyph ? <Glyph size={34} weight="regular" aria-hidden="true" className="text-foreground/75" /> : null}
        </button>

        {/* What a screen reader hears while the handle moves. */}
        <span className="sr-only" aria-live="polite">
          {capturing ? (recording
            ? t("desk.slider.listening", "Listening. Press to stop and send.")
            : t("desk.slider.reading", "Dex is reading what you said."))
            : at === "ask" ? t("desk.slider.atAsk", "Release to ask Dex")
            : at === "decide" ? t("desk.slider.atDecide", "Release to record a decision")
              : ""}
        </span>
      </div>
      {/* pct is read by the suite to prove the handle follows the finger. */}
      <span className="sr-only" data-testid="dex-slider-progress">{Math.round(pct * 100)}</span>
      </div>
      </div>
    </div>
  );
}

export default DexSlider;
