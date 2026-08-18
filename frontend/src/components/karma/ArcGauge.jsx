// KR-8 · ArcGauge — the reference's instrument: a thin arc with a needle,
// not a filled dial. The geometry descends from the old OperatingScore
// HeroCard circle (r·2πr dashoffset math); the voice is new.
//
// KR-8.6 — EXACTLY HALF A CIRCLE. The founder, measuring us against the
// reference: "the gauge meter is exactly half circle, but our UI is showing
// more than half — cut the circle in half." KR-8 had it at 240°, which reads
// as a speedometer; the reference is a true semicircle sitting ON its
// diameter. So: start at 180° (due left), sweep 180° to due right, needle at
// 0 pointing left and at 100 pointing right.
//
// The SVG is CROPPED to that half — height is c + a hair, not `size`. A
// square viewBox would ship 50% empty space under the arc and silently push
// everything beside it out of alignment, which is the other half of the
// founder's note.
//
// Honesty: when value is null (enough_data false), the needle and progress
// arc simply don't render — a gauge pointing at zero would be a claim.
import * as React from "react";
import { cn } from "@/lib/utils";

const START = 180;      // degrees — due left
const SWEEP = 180;      // …clockwise over the top to due right

export function ArcGauge({ value = null, size = 200, className, testid }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, Number(value)));
  const c = size / 2;
  const R = c - 10;
  const CIRC = 2 * Math.PI * R;
  const arcLen = (SWEEP / 360) * CIRC;
  // The drawn box: the upper half, plus 8px so the hub and the needle's tip
  // cap (both centred on the diameter line) are not clipped in half.
  const H = c + 8;

  const needleAngle = pct == null ? null : START + (pct / 100) * SWEEP;

  return (
    <svg
      viewBox={`0 0 ${size} ${H}`}
      width={size}
      height={H}
      className={cn("h-auto overflow-visible", className)}
      data-testid={testid}
      role="img"
      aria-label={pct == null ? "Score gauge — not enough data yet" : `Score gauge at ${pct} of 100`}
    >
      {/* KR-8.1 — retuned against the full-res reference: NO tick ring (it
          read as a stopwatch; the reference's meter is nearly silent), track
          at a whisper, the progress segment THICK (it is the one dark stroke
          in the composition), and a long hair-thin needle from near centre. */}
      <circle
        cx={c} cy={c} r={R} fill="none" strokeWidth="1"
        className="stroke-current opacity-[0.14]"
        strokeDasharray={`${arcLen} ${CIRC}`}
        transform={`rotate(${START} ${c} ${c})`}
        strokeLinecap="round"
      />
      {pct != null && (
        <circle
          cx={c} cy={c} r={R} fill="none" strokeWidth="4"
          className="stroke-current transition-[stroke-dasharray] duration-700 ease-out"
          strokeDasharray={`${(pct / 100) * arcLen} ${CIRC}`}
          transform={`rotate(${START} ${c} ${c})`}
          strokeLinecap="round"
        />
      )}
      {/* needle + hub — the kr-arcgauge-needle class exists so the global
          reduced-motion block can kill its sweep. */}
      {needleAngle != null && (
        <g
          className="kr-arcgauge-needle"
          style={{ transform: `rotate(${needleAngle}deg)`, transformOrigin: `${c}px ${c}px`, transition: "transform 700ms cubic-bezier(.22,1,.36,1)" }}
        >
          <line x1={c + 8} y1={c} x2={c + R + 4} y2={c}
            className="stroke-current" strokeWidth="1" />
          <circle cx={c + R + 4} cy={c} r="2.5" className="fill-current" />
        </g>
      )}
      <circle cx={c} cy={c} r="2.5" className="fill-current opacity-60" />
    </svg>
  );
}

export default ArcGauge;
