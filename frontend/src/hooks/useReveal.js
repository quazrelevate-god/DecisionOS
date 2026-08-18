// KR-4 · useReveal — "appear as you arrive", the Karma dark band's entrance.
//
// An IntersectionObserver that stamps `is-in` on the element the first time
// 15% of it enters the viewport, then disconnects — a reveal is a first
// impression, not a scroll-linked effect, so it must never re-run when the
// founder scrolls back up.
//
// Reduced motion: the element is marked in IMMEDIATELY (no observer at all).
// The CSS pair (.kr-reveal / .is-in) also neutralises itself under the media
// query, so the guard is belt-and-braces — either alone is sufficient, and
// the double coverage means a future edit can break one without breaking the
// promise.
import { useEffect, useRef } from "react";

export function useReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-in");
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.disconnect();
          }
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return ref;
}

export default useReveal;
