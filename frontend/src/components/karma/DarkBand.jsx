// KR-4 · DarkBand — the reference's bottom zone as a component. The CSS
// class (.kr-dark-band, index.css) does the heavy lifting: full-bleed
// negative margins, ink fill, 36px shoulders, and the token re-scope that
// lets every child read light-on-dark without a `dark:` variant.
//
// This wrapper adds the two behavioural halves: the scroll reveal (content
// rises 24px as the band enters the viewport — a first impression, not a
// scroll effect; see useReveal) and the action-button inversion (--kr-action-*
// flips so ArrowButtons render white-on-band automatically).
import * as React from "react";
import { cn } from "@/lib/utils";
import { useReveal } from "../../hooks/useReveal";

/**
 * @param {boolean} reveal  rise-in on first viewport entry (default true)
 *
 * KR-8.4 — the band NEVER scrolls internally. An earlier pass gave it an
 * inner scroller; the founder's correction is that the card travels WITH its
 * content, as one sheet, over whatever is pinned behind it. Page scroll moves
 * the whole section — that is the sheet metaphor the centre tab promises.
 */
export function DarkBand({ children, reveal = true, className, testid }) {
  const ref = useReveal();
  return (
    <section
      className={cn("kr-dark-band relative", className)}
      data-testid={testid}
      style={{
        // ArrowButton inversion: ink circles would vanish on the ink.
        "--kr-action-bg": "0 0% 100%",
        "--kr-action-fg": "var(--kr-ink)",
        // IconChip rings brighten on the band.
        "--kr-chip-line": "40 12% 55%",
      }}
    >
      {/* The grab handle, sitting INSIDE the dip. The dip itself is cut out
          of the band by a mask (see .kr-dark-band) so the bloom shows through
          it; this is only the small dark bar the reference draws in the
          middle of that gap. Ink at low alpha so it reads on whatever the
          bloom happens to be doing behind it.
          KR-8.6 — it was at -11px, i.e. floating ABOVE the band's edge. In
          the reference the bar sits low, in the sag itself: 36×4 at +4px. */}
      <span
        aria-hidden="true"
        className="absolute top-[4px] left-1/2 block h-[4px] w-9 -translate-x-1/2 rounded-full bg-kr-ink/55"
      />
      <div ref={reveal ? ref : undefined} className={reveal ? "kr-reveal" : undefined}>
        {children}
      </div>
    </section>
  );
}

export default DarkBand;
