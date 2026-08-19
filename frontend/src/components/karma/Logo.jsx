// KR-14 · the Karma wordmark — text only.
//
// The chip is gone on the founder's call: "remove the logo icon showing 'd'
// and keep the text alone." It was a second mark competing with the wordmark
// beside it at 8px apart, and in a header whose whole left edge is otherwise
// empty it read as a favicon that had wandered onto the page.
//
// CASING is the founder's too — DecisionOS, capital D and capital OS. The
// two-tone split survives: "Decision" at full ink, "OS" dropped back, so the
// product name still reads as one word with a suffix rather than two words.
//
// The sparkle is the same glyph the AI Priority control wears in My Work,
// and reusing it is the point: one mark for "there is a model behind this",
// wherever it appears. Translucent ink, sitting off the wordmark's top-right
// like a superscript — present, not announcing itself.
//
// The PNG Wordmark component survives untouched for Landing/Login (the
// marketing surfaces keep the registered lockup); only the app shell wears
// this one.
import * as React from "react";
import { Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function KarmaLogo({ size = "md", className }) {
  const word = size === "sm" ? "text-[16px]" : "text-[19px]";
  const star = size === "sm" ? 9 : 10;
  return (
    <span className={cn("inline-flex select-none items-start", className)} data-testid="karma-logo">
      <span className={cn("font-semibold leading-none tracking-tight text-foreground", word)}>
        Decision<span className="opacity-55">OS</span>
      </span>
      {/* -ml-px so it hangs off the S rather than adding a word-space, and
          -mt-px to sit it on the cap line instead of the baseline. */}
      <Sparkle
        size={star}
        weight="fill"
        aria-hidden="true"
        className="-ml-px -mt-px shrink-0 text-kr-ink/45"
      />
    </span>
  );
}

export default KarmaLogo;
