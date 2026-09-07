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
// KM-23 — the superscript sparkle is GONE, on the founder's call. At the 9-12px
// it actually shipped at, dropped to 45% ink and hung off the S, it did not read
// as a sparkle: it read as a stray plus sign glued to the wordmark. A mark that
// needs explaining at the size it ships is not earning its place. The glyph still
// means "there is a model behind this" everywhere it has room to be legible —
// the AI Priority control in My Work, the Dex FAB — just not at 9px.
//
// The PNG Wordmark component survives untouched for Landing/Login (the
// marketing surfaces keep the registered lockup); only the app shell wears
// this one.
import * as React from "react";
import { cn } from "@/lib/utils";

export function KarmaLogo({ size = "md", className }) {
  const word =
    size === "sm" ? "text-[16px]"
    : size === "lg" ? "text-[22px]"
    : "text-[19px]";
  return (
    <span className={cn("inline-flex select-none items-start", className)} data-testid="karma-logo">
      <span className={cn("font-semibold leading-none tracking-tight text-foreground", word)}>
        Decision<span className="opacity-55">OS</span>
      </span>
    </span>
  );
}

export default KarmaLogo;
