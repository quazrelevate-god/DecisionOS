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
      {/* KR-8.2 — the reference's centre shape: a small ink tab rising out
          of the band's top edge with a grab-handle pill inside it. Pure
          decoration (aria-hidden), but it is what makes the band read as a
          sheet surfacing from below rather than a painted rectangle. */}
      <span
        aria-hidden="true"
        className="absolute -top-[14px] left-1/2 grid h-[18px] w-28 -translate-x-1/2 place-items-end justify-center rounded-t-2xl bg-kr-ink pb-[7px]"
      >
        <span className="block h-[4px] w-9 rounded-full bg-white/30" />
      </span>
      <div ref={reveal ? ref : undefined} className={reveal ? "kr-reveal" : undefined}>
        {children}
      </div>
    </section>
  );
}

export default DarkBand;
