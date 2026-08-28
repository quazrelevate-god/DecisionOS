// KM-11 · DexWave — the voice visual that lives INSIDE the bottom bar.
//
// The founder's reference is three overlapping ribbons on a hairline: a
// translucent white one, a dark grey one and a gold one, each a long lens
// shape that swells at its middle and tapers to nothing at both ends, laid
// over each other at different offsets so their overlaps read as a third and
// fourth tone. Not an orb, not a bar chart — a ribbon.
//
// HOW IT REACTS. `levels` is the live amplitude array from useDexCapture. Each
// ribbon reads a different slice of it, so the three do not move as one block:
// the white one tracks the middle of the spectrum, grey the low end, gold the
// high end. With no signal they settle to a low idle swell rather than a flat
// line, because a dead line reads as "broken" and a breathing one reads as
// "listening".
//
// WHY SVG PATHS AND NOT DIVS. A lens that tapers to a point at both ends is a
// curve, and the overlap tones only work if the shapes are genuinely
// translucent and genuinely overlapping. Three <path>s with fill-opacity do
// that in one repaint; the same thing in DOM would be a stack of clipped,
// transformed boxes fighting each other's anti-aliasing.
import * as React from "react";

const W = 240;   // viewBox units; the SVG scales to the bar
const H = 44;
const CY = H / 2;

/**
 * A symmetric lens from x0 to x1, swelling to `amp` at `peak` (0..1 across its
 * own span). Drawn as two mirrored cubics so the top and bottom halves meet at
 * a point rather than a seam.
 */
function ribbon(x0, x1, amp, peak = 0.5) {
  const span = x1 - x0;
  const px = x0 + span * peak;
  const c1 = x0 + span * peak * 0.55;
  const c2 = px - span * 0.08;
  const c3 = px + span * 0.08;
  const c4 = x1 - span * (1 - peak) * 0.55;
  return [
    `M ${x0} ${CY}`,
    `C ${c1} ${CY - amp} ${c2} ${CY - amp} ${px} ${CY - amp}`,
    `C ${c3} ${CY - amp} ${c4} ${CY} ${x1} ${CY}`,
    `C ${c4} ${CY + amp} ${c3} ${CY + amp} ${px} ${CY + amp}`,
    `C ${c2} ${CY + amp} ${c1} ${CY} ${x0} ${CY}`,
    "Z",
  ].join(" ");
}

/** Mean of a slice of the level array, 0..1. */
function band(levels, from, to) {
  if (!levels || !levels.length) return 0;
  const a = Math.floor(levels.length * from);
  const b = Math.max(a + 1, Math.floor(levels.length * to));
  let sum = 0;
  for (let i = a; i < b && i < levels.length; i++) sum += levels[i] || 0;
  return sum / (b - a);
}

export function DexWave({ levels = [], live = false, className }) {
  // Idle keeps a small swell so the surface is alive before you speak.
  const IDLE = 0.16;
  const amp = (v) => 3 + Math.min(1, live ? IDLE + v * 1.5 : IDLE) * (CY - 5);

  const grey = amp(band(levels, 0, 0.34));
  const white = amp(band(levels, 0.33, 0.67));
  const gold = amp(band(levels, 0.66, 1));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      {/* The hairline the ribbons sit on — it is what makes them read as a
          waveform rather than three floating blobs. */}
      <line x1="0" y1={CY} x2={W} y2={CY} stroke="rgba(255,255,255,.55)" strokeWidth="0.6" />

      {/* Painted back to front: grey, then white, then gold. The overlaps are
          the point, so every fill is translucent. */}
      <path d={ribbon(28, 176, grey, 0.42)} fill="rgba(190,196,205,.42)"
        style={{ transition: "d 90ms linear" }} />
      <path d={ribbon(56, 214, white, 0.46)} fill="rgba(255,255,255,.62)"
        style={{ transition: "d 90ms linear" }} />
      <path d={ribbon(92, 236, gold, 0.52)} fill="rgba(214,168,52,.62)"
        style={{ transition: "d 90ms linear" }} />
    </svg>
  );
}

export default DexWave;
