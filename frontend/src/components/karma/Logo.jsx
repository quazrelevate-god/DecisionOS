// KR-8.2 · the Karma logo — founder's directive: "change the decisionOS logo
// appropriate for this particular design system. Discard the current logo."
//
// The reference's mark is an ink rounded-square chip with a white glyph and a
// lowercase geometric wordmark beside it. This is that, drawn in code: the
// chip is the same ink as every action circle, the glyph is a bold Urbanist
// "d", the wordmark is the UI face — so the logo is OF the system instead of
// pasted onto it.
//
// The PNG Wordmark component survives untouched for Landing/Login (the
// marketing surfaces keep the registered lockup); only the app shell wears
// this one.
import * as React from "react";
import { cn } from "@/lib/utils";

export function KarmaLogo({ size = "md", className }) {
  const chip = size === "sm" ? "h-7 w-7 rounded-[9px] text-[15px]" : "h-8 w-8 rounded-[10px] text-[17px]";
  const word = size === "sm" ? "text-[15px]" : "text-[17px]";
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)} data-testid="karma-logo">
      <span className={cn("grid place-items-center bg-kr-ink font-bold leading-none text-white", chip)} aria-hidden="true">
        d
      </span>
      <span className={cn("font-semibold tracking-tight leading-none text-foreground", word)}>
        decision<span className="opacity-55">os</span>
      </span>
    </span>
  );
}

export default KarmaLogo;
