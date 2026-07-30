import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be told about the design system's custom type scale.
 *
 * Out of the box it classifies any unknown `text-*` as a COLOUR, so pairing a
 * type-scale step with a text colour — cn("text-label", "text-text-secondary") —
 * looked to it like two competing colours and it silently dropped the font size.
 * Every label in the system rendered at the inherited 16px instead of 11px, with
 * nothing to show for it: the class was in the markup and simply absent from the
 * generated CSS.
 *
 * Registering the scale keeps size and colour in separate groups so both survive.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["display", "h1", "h2", "h3", "body", "body-strong", "small", "label", "badge", "code"],
        },
      ],
    },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
