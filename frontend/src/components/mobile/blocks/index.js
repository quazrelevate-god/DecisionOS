// MPWA-12b — the block system (§3).
//
// Six blocks. Every mobile screen is assembled from these, and each renders a
// `data-block="<type>"` attribute so the harness can read the composition.
//
// The three laws they exist to satisfy:
//   L1  every primary screen renders >= 3 distinct block types
//   L2  content fills >= 85% of the first viewport at 390x844 in fixture B
//   L3  every primary screen carries exactly one data-progress element
//
// L2 does not override the caps (§3): three fires stays three fires. When there
// is only one fire you render the NEXT STRATUM rather than inventing a fourth.
export { Verdict } from "./Verdict";
export { Pulse, Sparkline } from "./Pulse";
export { Queue } from "./Queue";
export { Board, CompletionRing } from "./Board";
export { Grid } from "./Grid";
export { Strip } from "./Strip";

export const BLOCK_TYPES = ["verdict", "pulse", "queue", "board", "grid", "strip"];
