// KR-4 · BigNumeral — the reference's signature typography: "$ 64,100" with
// the currency small, the leading group huge, and the tail group smaller.
//
// It takes a FORMATTED STRING and splits it, rather than taking a number and
// formatting internally — formatting already has one home (lib/format's
// inr/inrCompact/money) and duplicating it here is how two screens end up
// disagreeing about the same rupee. The split is presentation only:
//
//   ₹6,85,000  →  [₹][6][,85,000]        (Indian grouping: lakhs read small)
//   ₹6.8L      →  [₹][6.8][L]
//   100%       →  [][100][%]
//   4 Years    →  [][4][ Years]
//   —          →  rendered whole (no digits, nothing to split)
//
// Decimals stay in the PRIMARY group (6.8 is one magnitude, not "6 point
// something"); comma groups and trailing units go small.
import * as React from "react";
import { cn } from "@/lib/utils";
import { CountUp } from "./CountUp";

const SPLIT = /^([^\d-]*)(-?\d+(?:\.\d+)?)((?:,\d+)*)(.*)$/;

const SIZES = {
  // KR-8.1: measured against the full-res reference — the score is ~110px
  // and tile numerals ~44px. Everything stepped up accordingly.
  xl: { main: "text-7xl sm:text-8xl", side: "text-3xl" },  // the dashboard score
  lg: { main: "text-5xl", side: "text-2xl" },              // wide money cards
  md: { main: "text-4xl", side: "text-lg" },               // KPI tiles
  sm: { main: "text-xl",  side: "text-sm" },               // inline stats
};

/**
 * @param {string} text      the formatted value, e.g. inrCompact(x)
 * @param {'xl'|'lg'|'md'|'sm'} size
 * @param {boolean} countUp  animate — only when the primary group is a plain
 *                           number (scores, counts); formatted money counts
 *                           whole via CountUp's format prop at the call site
 * @param {boolean} accent   KR-8.12: ink at 80%, not orange. The founder pulled
 *                           red out of the tile numerals entirely — orange now
 *                           lives ONLY on the notification badges (IconChip,
 *                           PillNav, the dock), which is the one place a colour
 *                           is doing a job type weight cannot. A weighted-down
 *                           ink still reads as "this one is different" without
 *                           six tiles shouting at once.
 */
export function BigNumeral({ text, size = "md", countUp = false, accent = false, className, testid }) {
  const s = SIZES[size] || SIZES.md;
  const str = String(text ?? "");
  const m = str.match(SPLIT);

  const tone = accent ? "text-kr-ink/80" : "text-current";

  if (!m) {
    return (
      <span data-testid={testid} className={cn(s.main, "font-semibold leading-none", tone, className)}>
        {str}
      </span>
    );
  }

  const [, prefix, primary, groups, rest] = m;
  const primaryNode =
    countUp && !groups && /^\d+$/.test(primary)
      ? <CountUp value={Number(primary)} />
      : primary;

  return (
    <span data-testid={testid} className={cn("inline-flex items-baseline leading-none", tone, className)}>
      {prefix && <span className={cn(s.side, "font-medium mr-1 opacity-80")}>{prefix.trim()}</span>}
      <span className={cn(s.main, "font-semibold tracking-tight")}>{primaryNode}</span>
      {groups && <span className={cn(s.side, "font-medium opacity-80")}>{groups}</span>}
      {rest && <span className={cn(s.side, "font-medium ml-1 opacity-70")}>{rest.trim()}</span>}
    </span>
  );
}

export default BigNumeral;
