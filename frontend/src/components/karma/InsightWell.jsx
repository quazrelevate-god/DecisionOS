// KR-8.7 · InsightWell — Dex's read of today, sunk into the page.
//
// THE FOUNDER'S BRIEF: "a subtle recessed, inset, or indented concave depth
// box with beautiful gradient filled glassmorphism style… and a looping
// natural subtle wavy glow-ish random cyclic animation" on the border,
// against the supplied border.png (blue → violet → magenta → rose → orange,
// bright ring plus an outer bloom).
//
// THREE LAYERS, IN DOM ORDER, and the order is the whole trick — painting is
// resolved by document position, NOT z-index. An earlier pass on this
// codebase burned a debugging cycle on exactly this: a negative-z-index
// pseudo-element inside an `isolation: isolate` box paints ABOVE its
// parent's own background, so a "behind" glow lands in front of the glass.
// Layering by DOM order has no such trap.
//
//   glow   the conic ring again, oversized and blurred — the bloom that
//          leaks past the edge. Under everything.
//   pane   the glass itself. Opaque enough to hide the glow behind it, so
//          only the leaked halo reads.
//   ring   the 1.5px conic hairline, masked to the border box. Last, so it
//          sits on top of the pane's own edge.
//
// The two conic layers run on SEPARATE angle properties at different periods
// and opposite directions (18s / 27s), and the glow breathes on a third,
// coprime period (7s). Nothing here is random — but three cycles that never
// line up read as "natural" rather than as a spinning wheel, which is what
// the founder asked for.
import * as React from "react";
import { Sparkle, ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * @param {{headline: string, lines: string[], to: string, cta: string, tone: string}|null} insight
 * @param {boolean} loading
 */
export function InsightWell({ insight, loading = false, className, testid }) {
  return (
    <div className={cn("kr-well", className)} data-testid={testid}>
      <span aria-hidden="true" className="kr-well__glow" />

      <div className="kr-well__pane flex h-full flex-col p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full border border-white/25">
            <Sparkle size={12} weight="fill" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold tracking-wide opacity-80">
            Dex · today&rsquo;s read
          </span>
        </div>

        {loading || !insight ? (
          <div className="mt-4 space-y-2" aria-hidden="true">
            <div className="ds-skeleton h-5 w-4/5 rounded-control" />
            <div className="ds-skeleton h-3.5 w-3/5 rounded-control" />
          </div>
        ) : (
          <>
            <p
              className="mt-3 text-lg font-semibold leading-snug xl:text-xl"
              data-testid="desk-insight-headline"
            >
              {insight.headline}
            </p>

            {insight.lines.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {insight.lines.map((l) => (
                  <li key={l} className="flex gap-2 text-xs leading-relaxed opacity-70">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" />
                    {l}
                  </li>
                ))}
              </ul>
            )}

            <Link
              to={insight.to}
              data-testid="desk-insight-cta"
              className="kr-lift mt-auto inline-flex w-fit items-center gap-2 rounded-pill border border-white/25 px-3.5 py-2 pt-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {insight.cta}
              <ArrowRight size={12} weight="bold" aria-hidden="true" className="kr-arrow transition-transform duration-200" />
            </Link>
          </>
        )}
      </div>

      <span aria-hidden="true" className="kr-well__ring" />
    </div>
  );
}

export default InsightWell;
