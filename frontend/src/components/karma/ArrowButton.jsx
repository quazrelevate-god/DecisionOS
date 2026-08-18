// KR-4 · ArrowButton — the reference card's top-right action: a solid ink
// circle with a white ↗. It is the ONLY filled circle in the language, which
// is what makes it read as "go" everywhere it appears.
//
// Inversion is done with local variables, not props: .kr-dark-band and
// .kr-glass re-declare --kr-action-bg/fg so the same component renders
// white-on-ink in the light zone and ink-on-white inside the band — the
// surface decides, the call site doesn't know.
//
// The glyph carries the class `kr-arrow`: it rotates 45° (↗ → →) when the
// button is hovered OR when a parent .kr-lift card is — the whole-card-hover
// case is the common one on stat tiles.
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const SIZES = { sm: 32, md: 40 };

/**
 * @param {string}   label   REQUIRED aria-label — the circle has no text
 * @param {string}   to      renders a Link when given, else a button
 * @param {Function} onClick
 * @param {'sm'|'md'} size
 */
export function ArrowButton({ label, to, onClick, size = "md", className, testid, ...rest }) {
  const px = SIZES[size] || SIZES.md;
  const cls = cn(
    "inline-grid shrink-0 place-items-center rounded-full",
    "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]",
    "transition-transform duration-150 hover:scale-105 active:scale-95",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
    className
  );
  const glyph = (
    <ArrowRight
      size={Math.round(px * 0.45)}
      weight="bold"
      aria-hidden="true"
      className="kr-arrow transition-transform duration-200"
    />
  );
  if (to) {
    return (
      <Link
        to={to}
        aria-label={label}
        data-testid={testid}
        onClick={onClick}
        className={cls}
        style={{ width: px, height: px }}
        {...rest}
      >
        {glyph}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testid}
      onClick={onClick}
      className={cls}
      style={{ width: px, height: px }}
      {...rest}
    >
      {glyph}
    </button>
  );
}

export default ArrowButton;
