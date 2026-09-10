import * as React from "react";

// KM-23 · DexWave — the voice surface, rebuilt.
//
// WHAT THIS REPLACED. Three "lens" blobs whose `d` was recomputed on render and
// eased between with `transition: d 90ms`. Two things made it read as amateur.
// It was not a wave: a lens that swells in the middle and tapers at both ends is
// a leaf, and three leaves at different offsets is a logo, not motion. And it
// moved on React's clock — a state write per audio frame, each one a re-render,
// each one a 90ms CSS ease chasing the last, so the shape arrived late and in
// steps. You could see it ticking.
//
// WHAT IT IS NOW. Real waves on a real clock. Each layer is a travelling sum of
// sines sampled across the width, redrawn every animation frame by writing `d`
// straight to the path node — no React state, no re-render, no CSS transition
// racing the next frame. Layers run at different frequencies, speeds and
// directions, so where they cross they produce interference the eye reads as
// depth rather than as three copies of one line.
//
// WHY A SUM OF SINES AND NOT ONE. A single sine is a test pattern — perfectly
// periodic, and the eye locks onto the repeat within a second. Adding a second
// and third component at incommensurate frequencies (1, 2.3, 0.55 here) gives a
// period long enough that it never visibly repeats, which is the whole
// difference between "animated" and "alive".
//
// THE EDGE ENVELOPE. Every layer is multiplied by sin(pi * x)^0.8, so amplitude
// is zero at both ends and full in the middle. Without it the waves get sliced
// off flat against the viewBox and the whole thing reads as a crop of something
// bigger; with it they resolve into the surface at both ends.
//
// FOUR STATES, one amplitude envelope each:
//   idle       a slow, shallow swell — present, not asking for anything
//   listening  amplitude tracks the mic (0..1), fast and tight
//   thinking   a rhythmic pulse, breathing in and out on a fixed cycle
//   speaking   two incommensurate envelopes multiplied, so the motion has the
//              uneven cadence of speech instead of a metronome
const W = 240;
const H = 44;
const CY = H / 2;
const SEGMENTS = 64;

// Each layer: its own frequency, travel speed (sign = direction), a share of the
// amplitude, a vertical offset, and its gradient. Gold sits on top and is the
// narrowest and fastest, so it reads as the highlight riding the others.
const LAYERS = [
  { freq: 1.00, speed: -0.55, amp: 1.00, lift: 0.6, fill: "dxGrey", op: 0.55 },
  { freq: 1.45, speed: 0.80, amp: 0.82, lift: -0.4, fill: "dxWhite", op: 0.72 },
  { freq: 2.10, speed: 1.25, amp: 0.58, lift: 0.0, fill: "dxGold", op: 0.85 },
];

const STATE_TUNE = {
  idle: { base: 0.10, gain: 0.00, rate: 0.55 },
  listening: { base: 0.14, gain: 0.86, rate: 1.85 },
  thinking: { base: 0.30, gain: 0.00, rate: 1.10 },
  speaking: { base: 0.34, gain: 0.30, rate: 1.45 },
};

/** Amplitude envelope in 0..1 for a state at time t (seconds) and mic level. */
function envelope(state, t, level) {
  const k = STATE_TUNE[state] || STATE_TUNE.idle;
  if (state === "thinking") {
    // A clean breath: one slow cycle, never reaching zero so the surface
    // never looks switched off mid-thought.
    return k.base * (0.55 + 0.45 * Math.sin(t * 2.2));
  }
  if (state === "speaking") {
    // Two envelopes at incommensurate rates, multiplied. Speech is not a
    // metronome, and a single sine here is instantly recognisable as one.
    const a = 0.62 + 0.38 * Math.sin(t * 3.1);
    const b = 0.72 + 0.28 * Math.sin(t * 1.7 + 1.1);
    return k.base * a * b + k.gain * level * 0.5;
  }
  if (state === "listening") return k.base + k.gain * level;
  return k.base * (0.75 + 0.25 * Math.sin(t * 1.3));
}

/** One layer's path: a closed ribbon around the centre line. */
function ribbonPath(layer, t, amp) {
  const half = (CY - 3) * amp * layer.amp;
  const top = [];
  const bottom = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = i / SEGMENTS;
    const x = p * W;
    // Zero at both ends, full in the middle — see THE EDGE ENVELOPE above.
    const edge = Math.pow(Math.sin(Math.PI * p), 0.8);
    const phase = p * Math.PI * 2 * layer.freq + t * layer.speed * Math.PI;
    const y =
      Math.sin(phase) +
      0.42 * Math.sin(phase * 2.3 + t * 0.7) +
      0.22 * Math.sin(phase * 0.55 - t * 0.5);
    const h = (y / 1.64) * half * edge;
    const mid = CY + layer.lift * amp * 4;
    top.push(`${x.toFixed(2)} ${(mid - Math.abs(h) - 0.4).toFixed(2)}`);
    bottom.push(`${x.toFixed(2)} ${(mid + Math.abs(h) + 0.4).toFixed(2)}`);
  }
  bottom.reverse();
  return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
}

/**
 * @param {"idle"|"listening"|"thinking"|"speaking"} [state]
 * @param {number}   [level]   live mic amplitude 0..1 (listening)
 * @param {number[]} [levels]  legacy: an array of bar levels; averaged to `level`
 * @param {boolean}  [live]    legacy: true === listening
 */
/* KM-62 — `tone` lets the same wave sit on a LIGHT surface.
   The ribbons were built for the dark dock: white and grey over near-black. On
   the signup interview's glass they would be invisible, which is why that
   surface had a solid black pill painted behind it purely to make the wave
   legible — a black slab on a photograph, and the founder asked for it gone.
   "ink" swaps the two neutral ribbons for ink and darkens the hairline; the
   gold one is legible on both and does not move. Gradient ids are suffixed per
   tone so a light and a dark wave can coexist on one page without the later
   <defs> capturing the earlier one's fill. */
export function DexWave({ state, level, levels, levelsRef, live = false, tone = "onDark", className }) {
  const ink = tone === "ink";
  const gid = (n) => (ink ? `${n}Ink` : n);
  const pathRefs = React.useRef([]);
  const lineRef = React.useRef(null);

  // Legacy call sites (the dock, the onboarding interview) pass `levels`+`live`.
  const derived =
    typeof level === "number"
      ? level
      : Array.isArray(levels) && levels.length
        ? levels.reduce((a, b) => a + (b || 0), 0) / levels.length
        : 0;
  const resolved = state || (live ? "listening" : "idle");

  // Refs, not state: the loop reads the newest value every frame without the
  // component re-rendering, which is the entire point of the rewrite.
  const stateRef = React.useRef(resolved);
  const levelRef = React.useRef(0);
  stateRef.current = resolved;

  React.useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    const t0 = performance.now();
    // The mic is jumpy at frame rate. Smoothing toward the target rather than
    // snapping is what separates a level meter from a wave.
    const smooth = { v: 0 };

    const frame = (now) => {
      const t = (now - t0) / 1000;
      /* KM-60 — prefer the LIVE ref when the caller passes one. The `levels`
         prop only changes when the owning component re-renders, so driving the
         wave from it tied its smoothness to React's clock — the exact coupling
         the note at the top of this file says was removed. A ref is read fresh
         every frame and costs the owner nothing. */
      let target = levelRef.current;
      if (levelsRef && Array.isArray(levelsRef.current) && levelsRef.current.length) {
        const arr = levelsRef.current;
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] || 0;
        target = sum / arr.length;
      }
      target = Math.max(0, Math.min(1, target));
      smooth.v += (target - smooth.v) * 0.18;
      const amp = envelope(stateRef.current, t * (STATE_TUNE[stateRef.current] || STATE_TUNE.idle).rate, smooth.v);
      for (let i = 0; i < LAYERS.length; i++) {
        const node = pathRefs.current[i];
        if (node) node.setAttribute("d", ribbonPath(LAYERS[i], t * (STATE_TUNE[stateRef.current] || STATE_TUNE.idle).rate, amp));
      }
      if (lineRef.current) lineRef.current.setAttribute("opacity", String(0.28 + amp * 0.7));
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      // Draw one settled frame and stop. Motion is the accessibility problem
      // here, not the shape, so the shape stays.
      const amp = envelope("idle", 0, 0);
      LAYERS.forEach((l, i) => pathRefs.current[i]?.setAttribute("d", ribbonPath(l, 0, amp)));
      return undefined;
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // levelsRef is the only closed-over value: a stable useRef from the
    // capture hook, or undefined for callers that drive the wave by prop. It
    // is listed so the dependency lint stays clean, and re-listing it is
    // harmless even if it ever changed — the loop would simply re-schedule.
  }, [levelsRef]);

  levelRef.current = derived;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
      data-dex-state={resolved}
    >
      <defs>
        {/* Horizontal gradients, not flat fills: a ribbon that is the same
            colour end to end reads as a sticker. Fading the ends also hides
            where the envelope has taken the amplitude to nothing. */}
        <linearGradient id={gid("dxGrey")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={ink ? "hsl(230 16% 46%)" : "rgb(190,196,205)"} stopOpacity="0" />
          <stop offset="35%" stopColor={ink ? "hsl(230 16% 46%)" : "rgb(206,212,220)"} stopOpacity=".85" />
          <stop offset="70%" stopColor={ink ? "hsl(230 18% 36%)" : "rgb(168,176,188)"} stopOpacity=".7" />
          <stop offset="100%" stopColor={ink ? "hsl(230 16% 46%)" : "rgb(190,196,205)"} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={gid("dxWhite")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={ink ? "hsl(230 22% 20%)" : "#fff"} stopOpacity="0" />
          <stop offset="45%" stopColor={ink ? "hsl(230 22% 20%)" : "#fff"} stopOpacity={ink ? ".82" : ".95"} />
          <stop offset="100%" stopColor={ink ? "hsl(230 22% 20%)" : "#fff"} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={gid("dxGold")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(44 88% 60%)" stopOpacity="0" />
          <stop offset="30%" stopColor="hsl(44 92% 66%)" stopOpacity=".9" />
          <stop offset="65%" stopColor="hsl(36 90% 58%)" stopOpacity=".8" />
          <stop offset="100%" stopColor="hsl(44 88% 60%)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The hairline the ribbons sit on — it is what makes them read as one
          surface rather than three floating shapes. Its opacity tracks the
          amplitude so it fades back as the waves take over. */}
      <line ref={lineRef} x1="0" y1={CY} x2={W} y2={CY} stroke={ink ? "hsl(230 15% 30% / .38)" : "rgba(255,255,255,.5)"} strokeWidth="0.6" />

      {LAYERS.map((l, i) => (
        <path
          key={i}
          ref={(n) => { pathRefs.current[i] = n; }}
          fill={`url(#${gid(l.fill)})`}
          fillOpacity={l.op}
          style={{ mixBlendMode: i === 0 ? "normal" : "screen" }}
        />
      ))}
    </svg>
  );
}

export default DexWave;
