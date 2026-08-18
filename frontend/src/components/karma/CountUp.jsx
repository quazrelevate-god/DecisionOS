// KR-4 · CountUp — promoted out of ExecutionSummary, where it lived as a
// module-private helper, because Karma's KPI tiles all want their numerals
// to arrive rather than appear.
//
// Two things the private copy did not have:
//   1. A reduced-motion guard. An animation utility without one is a trap —
//      every consumer would have to remember the check, and none would.
//      Under reduced motion the final value renders on the first frame.
//   2. A `format` prop, so a tile can count in its own notation
//      (n => inrCompact(n)) instead of raw integers.
//
// The ramp stays LINEAR on purpose: an eased count reads as the number
// slowing down to a stop, which implies precision theatre. A linear 700ms
// reads as a meter settling.
import { useEffect, useState } from "react";

export function CountUp({ value, delay = 0, duration = 700, format }) {
  const target = Number(value) || 0;
  const [n, setN] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? target
      : 0
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return undefined;
    }
    let raf, start;
    const startTimer = setTimeout(() => {
      const step = (ts) => {
        if (!start) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        setN(Math.round(p * target));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(startTimer); cancelAnimationFrame(raf); };
  }, [target, delay, duration]);

  return <span>{format ? format(n) : n}</span>;
}

export default CountUp;
