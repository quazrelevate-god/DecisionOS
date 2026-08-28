// KR-8.9 · InsightWell — Dex's read of today, pressed into the page.
//
// THE FOUNDER'S BRIEF, third pass: "remove all the glowing effect. I want a
// borderless box in neumorphic inset box-shadows like a pit or depression
// rather than an extruded pop-up. And a same neumorphic style small round
// pop-up button with a brain / Dex symbol to route it to /brain."
//
// So the aurora is gone entirely — ring, bloom, both conic layers and their
// animated angles. What is left is quieter and, honestly, better suited to a
// panel that has to sit under a greeting all day: no border at all, and the
// edge drawn purely by light. See .kr-well__pane in index.css for the one
// rule that matters (dark inset from the top-left, highlight inset from the
// bottom-right — reverse the pair and the pit becomes a bump).
//
// The Dex button is the same material inverted: .kr-pop, shadows outside
// instead of in. A pit and a bump lit from the same corner read as one
// surface; lit from different corners they read as a mistake.
import * as React from "react";
import { Brain, ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * @param {{headline: string, lines: string[], to: string, cta: string, tone: string}|null} insight
 * @param {boolean} loading
 */
export function InsightWell({ insight, loading = false, className, testid }) {
  return (
    <div className={cn("kr-well", className)} data-testid={testid}>
      <div className="kr-well__pane flex h-full flex-col p-5">
        <span className="text-xs font-semibold tracking-wide text-foreground/75">
          Dex · today&rsquo;s read
        </span>

        {loading || !insight ? (
          <div className="mt-4 space-y-2" aria-hidden="true">
            <div className="ds-skeleton h-5 w-4/5 rounded-control" />
            <div className="ds-skeleton h-3.5 w-3/5 rounded-control" />
          </div>
        ) : (
          <>
            <p
              className="mt-2 text-lg font-semibold leading-snug xl:text-xl"
              data-testid="desk-insight-headline"
            >
              {insight.headline}
            </p>

            {insight.lines.length > 0 && (
              /* KM-1 — the supporting lines are candidates[1..2] from
                 lib/deskInsight (slice(1,3)), i.e. the same facts the KPI tiles
                 print: overdue cash -> "To collect", overdue tasks ->
                 "Delayed", complaints -> "Complaints", weakest -> "Score mix".
                 On a phone those tiles now sit directly ABOVE this box, so the
                 bullets restate the grid in prose one thumb-flick away — the
                 exact duplication NM-14 deleted once already.
                 They also made the box breathe with the news: 172px at the
                 floor with none, ~242px with two. A dashboard element that
                 changes height depending on how bad the week is never looks the
                 same twice. Hidden below lg, it is a stable 172-178px.
                 The HEADLINE stays at every width — it is the one thing here
                 that is a READ rather than a readout. */
              <ul className="mt-3 hidden space-y-1.5 lg:block">
                {insight.lines.map((l) => (
                  /* foreground/70, not text-muted-foreground: the token is
                     tuned for an opaque card, and over glass on the bloom's
                     hot point it measured 4.34:1 — under AA. */
                  <li key={l} className="flex gap-2 text-xs leading-relaxed text-foreground/70">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" />
                    {l}
                  </li>
                ))}
              </ul>
            )}

          </>
        )}

        {/* KR-8.10 — the floor of the well: the action on the left, Dex on
            the right, both 44px tall so they sit on one line rather than
            merely near each other. pt-7 is the founder's "proper space at
            the top of the Chase it" — the bullets were crowding it.
            The row renders even while the insight is loading, because the
            way into Dex should not depend on Dex having finished thinking. */}
        <div className="mt-auto flex items-center justify-between gap-3 pt-5 lg:pt-7">
          {insight && (
            /* Borderless too — a hairline pill next to a shadow-modelled
               well would be two different materials in one box. */
            <Link
              to={insight.to}
              data-testid="desk-insight-cta"
              className="kr-pop inline-flex h-11 w-fit items-center gap-2 rounded-pill px-4 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60"
            >
              {insight.cta}
              <ArrowRight size={12} weight="bold" aria-hidden="true" className="kr-arrow transition-transform duration-200" />
            </Link>
          )}

          {/* The raised twin of the well it sits in. Icon-only, so it carries
              a real label for anything not looking at it. 44px, not the 40px
              the StatTile arrows use — those are presentational spans inside
              a link, this is the tap target. */}
          <Link
            to="/brain"
            aria-label="Ask Dex"
            title="Ask Dex"
            data-testid="desk-insight-dex"
            className="kr-pop ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60"
          >
            <Brain size={19} weight="duotone" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default InsightWell;
