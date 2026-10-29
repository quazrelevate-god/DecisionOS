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
// 2026-10-29 (founder) — TWO THINGS WERE WRONG, AND BOTH ARE FIXED HERE.
//
// "The three ribbons are layered on top of each other." They were three crisp
// shapes stacked, so the eye read three stickers. Each ribbon is now drawn
// twice: once through a wide, mostly-HORIZONTAL blur (the motion blur — the
// waves travel sideways, so that is the direction they smear) as an aura the
// three share, and once through a faint blur as the body. Where they cross they
// melt into one light instead of overlapping as layers.
//
// "It stays at its peak; the quiet and the loud look the same." Three causes:
//   · it averaged the WHOLE meter window — 28 samples, a second and a half —
//     so a pause between words never reached it. It reads the newest two now.
//   · the capture's meter is a display curve that lifts quiet sounds (rms^0.65)
//     and a room's hum sat a quarter of the way up. The wave undoes that curve
//     and keeps its own idea of this room's floor and this voice's ceiling —
//     a floor that drops at once and rises slowly, a ceiling that jumps and
//     decays — and maps the voice between them, with a gate under the floor
//     and an expander (power 1.35) so near-silence stays near flat.
//   · the resting height was 14% of the wave plus 86% of a level that was
//     never below ~0.2. It is 5% now, and the level can reach zero.
// Each ribbon also follows the voice at its own speed — gold fastest, grey
// slowest — so a word lands as a ripple through the three rather than all of
// them jumping together, and the waves travel a little faster as you speak.
const W = 240;
const H = 44;
const CY = H / 2;
const SEGMENTS = 72;

// Each layer: its own frequency, travel speed (sign = direction), a share of the
// amplitude, a vertical offset, its gradient, and how fast it follows the voice
// (attack, release). Gold sits on top, narrowest and fastest: the highlight.
/* 2026-10-29, second look (founder): "the amplitude was okay, but the width
   of the high-amplitude wave is too little — with that less width it shows
   like a huge shape; it should be stretched to even out across the view."
   The lobes were 2–4 to the bar (frequencies 1.0–2.1, folded by the ribbon's
   mirror into twice that), so a loud word stood up as a few tall spikes in
   the middle. They are about one to two lobes now (0.42–0.95), and the edge
   envelope is flatter (power 0.45, was 0.8), so the same height is carried
   most of the way across the bar and only tapers at the very ends. */
const LAYERS = [
  { freq: 0.42, speed: -0.38, amp: 1.00, lift: 0.5, fill: "dxGrey", op: 0.55, atk: 0.30, rel: 0.07 },
  { freq: 0.68, speed: 0.58, amp: 0.86, lift: -0.35, fill: "dxWhite", op: 0.72, atk: 0.45, rel: 0.11 },
  { freq: 0.95, speed: 0.86, amp: 0.70, lift: 0.0, fill: "dxGold", op: 0.92, atk: 0.62, rel: 0.17 },
];

const STATE_TUNE = {
  idle: { base: 0.08, gain: 0.00, rate: 0.55 },
  listening: { base: 0.05, gain: 0.95, rate: 1.7 },
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
  if (state === "listening") {
    // A whisper of life when silent, so the surface never looks switched off.
    return k.base * (0.7 + 0.3 * Math.sin(t * 1.9)) + k.gain * level;
  }
  return k.base * (0.75 + 0.25 * Math.sin(t * 1.3));
}

/** One layer's path: a closed ribbon around the centre line. */
function ribbonPath(layer, t, amp) {
  const half = (CY - 3) * Math.min(1, amp) * layer.amp;
  const top = [];
  const bottom = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = i / SEGMENTS;
    const x = p * W;
    // Zero at both ends and broad between — see THE EDGE ENVELOPE above, and
    // the second look at LAYERS for why it is so much flatter now.
    const edge = Math.pow(Math.sin(Math.PI * p), 0.45);
    const phase = p * Math.PI * 2 * layer.freq + t * layer.speed * Math.PI;
    // One broad swell, a slower one under it, and only a whisper of detail:
    // the detail term was what cut a loud word into narrow peaks.
    const y =
      Math.sin(phase) +
      0.32 * Math.sin(phase * 0.6 - t * 0.45 + 1.3) +
      0.12 * Math.sin(phase * 1.8 + t * 0.7);
    const h = (y / 1.44) * half * edge;
    const mid = CY + layer.lift * Math.min(1, amp) * 4;
    top.push(`${x.toFixed(2)} ${(mid - Math.abs(h) - 0.4).toFixed(2)}`);
    bottom.push(`${x.toFixed(2)} ${(mid + Math.abs(h) + 0.4).toFixed(2)}`);
  }
  bottom.reverse();
  return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
}

/* The capture's meter (useDexCapture) is pow(rms * 3.2, 0.65): undone here so
   the wave works on loudness proper. */
const unCurve = (v) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 0.65);

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
   gold one is legible on both and does not move. Gradient ids are per
   instance so a light and a dark wave can coexist on one page without the later
   <defs> capturing the earlier one's fill. On ink the ribbons MULTIPLY into
   each other (light ground); on the dark dock they SCREEN (light adds). */
export function DexWave({ state, level, levels, levelsRef, live = false, tone = "onDark", className }) {
  const ink = tone === "ink";
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gid = (n) => `${n}${ink ? "Ink" : ""}${uid}`;
  const auraRefs = React.useRef([]);
  const bodyRefs = React.useRef([]);
  const lineRef = React.useRef(null);
  const blend = ink ? "multiply" : "screen";

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
    let last = performance.now();
    let clock = 0;
    // This room's floor and this voice's ceiling, learnt as it goes.
    const room = { floor: 0.04, ceil: 0.35 };
    const follow = LAYERS.map(() => 0);

    const draw = (amps, t) => {
      for (let i = 0; i < LAYERS.length; i++) {
        const d = ribbonPath(LAYERS[i], t, amps[i]);
        auraRefs.current[i]?.setAttribute("d", d);
        bodyRefs.current[i]?.setAttribute("d", d);
      }
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const tune = STATE_TUNE[st] || STATE_TUNE.idle;

      /* KM-60 — prefer the LIVE ref when the caller passes one, and read only
         its NEWEST samples (see the note at the top of the file). */
      let shaped;
      const arr = levelsRef && Array.isArray(levelsRef.current) ? levelsRef.current : null;
      if (arr && arr.length) {
        const n = arr.length;
        const lin = unCurve(Math.max(arr[n - 1] || 0, arr[n - 2] || 0));
        room.floor += (lin - room.floor) * (lin < room.floor ? 0.3 : 0.003);
        room.ceil += lin > room.ceil
          ? (lin - room.ceil) * 0.5
          : (Math.max(room.floor + 0.12, lin) - room.ceil) * 0.008;
        const gate = room.floor + 0.015;
        const norm = Math.max(0, Math.min(1, (lin - gate) / Math.max(0.06, room.ceil - gate)));
        shaped = Math.pow(norm, 1.35);
      } else {
        // Driven by prop (the lab, the onboarding orb): taken as given.
        shaped = Math.max(0, Math.min(1, levelRef.current));
      }
      if (st !== "listening") shaped = 0;

      const amps = LAYERS.map((l, i) => {
        follow[i] += (shaped - follow[i]) * (shaped > follow[i] ? l.atk : l.rel);
        return envelope(st, clock * tune.rate, follow[i]);
      });
      // The waves travel a little faster while you speak.
      clock += dt * (1 + 0.7 * follow[2]);
      draw(amps, clock * tune.rate);
      if (lineRef.current) lineRef.current.setAttribute("opacity", String(0.22 + Math.min(1, amps[0]) * 0.6));
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      // Draw one settled frame and stop. Motion is the accessibility problem
      // here, not the shape, so the shape stays.
      const amp = envelope("idle", 0, 0);
      draw(LAYERS.map(() => amp), 0);
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
        {/* The motion blur: wide along the travel, narrow across it. */}
        <filter id={gid("dxAura")} x="-15%" y="-80%" width="130%" height="260%">
          <feGaussianBlur stdDeviation="4.2 1.9" />
        </filter>
        <filter id={gid("dxBody")} x="-8%" y="-50%" width="116%" height="200%">
          <feGaussianBlur stdDeviation="1.3 0.55" />
        </filter>
      </defs>

      {/* The hairline the ribbons sit on — it is what makes them read as one
          surface rather than three floating shapes. Its opacity tracks the
          amplitude so it fades back as the waves take over. */}
      <line ref={lineRef} x1="0" y1={CY} x2={W} y2={CY} stroke={ink ? "hsl(230 15% 30% / .38)" : "rgba(255,255,255,.5)"} strokeWidth="0.6" />

      {/* The aura: the three, smeared together into one light. */}
      <g filter={`url(#${gid("dxAura")})`} opacity={ink ? 0.55 : 0.9}>
        {LAYERS.map((l, i) => (
          <path key={i} ref={(n) => { auraRefs.current[i] = n; }}
            fill={`url(#${gid(l.fill)})`} fillOpacity={l.op} style={{ mixBlendMode: blend }} />
        ))}
      </g>
      {/* The bodies: softened, never crisp-edged, blended into each other. */}
      <g filter={`url(#${gid("dxBody")})`}>
        {LAYERS.map((l, i) => (
          <path key={i} ref={(n) => { bodyRefs.current[i] = n; }}
            fill={`url(#${gid(l.fill)})`} fillOpacity={l.op * 0.78}
            style={{ mixBlendMode: i === 0 ? "normal" : blend }} />
        ))}
      </g>
    </svg>
  );
}

export default DexWave;
