import { useEffect, useState } from "react";

// The one breakpoint this whole track is scoped under (§1: "Every change is
// scoped under the lg breakpoint (1024px)"). Kept in one place so the JS
// branch and Tailwind's `lg:` can never drift apart.
export const MOBILE_QUERY = "(max-width: 1023.98px)";

/**
 * True below lg.
 *
 * Why a JS branch rather than `lg:hidden` on two DOM trees: pages like Desk and
 * CEOBrief are shared with desktop, and §1/§9.2 require desktop to stay
 * pixel-identical. Rendering the original tree untouched above lg — rather than
 * restyling one tree to serve both — makes that guarantee structural instead of
 * something to re-verify on every change. It also keeps a single copy of the
 * DOM in the document, which duplicating trees would not.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    // Re-read on mount in case the viewport changed before the listener existed.
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export default useIsMobile;
