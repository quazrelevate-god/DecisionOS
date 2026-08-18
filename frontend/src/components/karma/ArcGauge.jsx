// KR-8 · ArcGauge — the reference's instrument: a thin 240° arc with tick
// marks and a needle, not a filled dial. The geometry descends from the old
// OperatingScore HeroCard circle (r·2πr dashoffset math); the voice is new.
//
// The arc opens DOWNWARD (starts at 150°, sweeps 240° clockwise to 30°), so
// the needle at 0 points down-left and at 100 down-right — the way an
// analogue meter reads.
//
// Honesty: when value is null (enough_data false), the needle and progress
// arc simply don't render — a gauge pointing at zero would be a claim.
import * as React from "react";
import { cn } from "@/lib/utils";

const START = 150;      // degrees
const SWEEP = 240;

export function ArcGauge({ value = null, size = 200, className, testid }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, Number(value)));
  const c = size / 2;
  const R = c - 10;
  const CIRC = 2 * Math.PI * R;
  const arcLen = (SWEEP / 360) * CIRC;

  const ticks = React.useMemo(() => {
    return Array.from({ length: 11 }, (_, i) => {
      const a = ((START + (i / 10) * SWEEP) * Math.PI) / 180;
      const r1 = R - 4, r2 = R + 4;
      return {
        x1: c + r1 * Math.cos(a), y1: c + r1 * Math.sin(a),
        x2: c + r2 * Math.cos(a), y2: c + r2 * Math.sin(a),
      };
    });
  }, [c, R]);

  const needleAngle = pct == null ? null : START + (pct / 100) * SWEEP;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={cn("overflow-visible", className)}
      data-testid={testid}
      role="img"
      aria-label={pct == null ? "Score gauge — not enough data yet" : `Score gauge at ${pct} of 100`}
    >
      {/* track */}
      <circle
        cx={c} cy={c} r={R} fill="none" strokeWidth="1.5"
        className="stroke-current opacity-20"
        strokeDasharray={`${arcLen} ${CIRC}`}
        transform={`rotate(${START} ${c} ${c})`}
        strokeLinecap="round"
      />
      {/* ticks */}
      {ticks.map((t2, i) => (
        <line key={i} x1={t2.x1} y1={t2.y1} x2={t2.x2} y2={t2.y2}
          className="stroke-current opacity-25" strokeWidth="1" />
      ))}
      {/* progress */}
      {pct != null && (
        <circle
          cx={c} cy={c} r={R} fill="none" strokeWidth="2.5"
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
          <line x1={c + 14} y1={c} x2={c + R - 8} y2={c}
            className="stroke-current" strokeWidth="1.5" />
          <circle cx={c + R - 8} cy={c} r="3" className="fill-current" />
        </g>
      )}
      <circle cx={c} cy={c} r="3.5" className="fill-current opacity-70" />
    </svg>
  );
}

export default ArcGauge;
