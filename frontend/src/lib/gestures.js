import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================================
   Gesture toolkit
   ----------------------------------------------------------------------------
   Every gesture here maps onto muscle memory people already have from native
   mobile apps:

     · horizontal swipe on a row  → quick actions (mail apps)
     · horizontal swipe on a view → move between sibling views (calendar apps)
     · pull down at the top       → refresh (every feed ever)
     · swipe in from the left edge→ open the navigation drawer
     · long-press                 → secondary action (home-screen icons)
     · drag a sheet down          → dismiss (system bottom sheets — via vaul)

   Gestures are ACCELERATORS, not replacements: every gesture-reachable action
   keeps a visible, tappable, focusable control so keyboard, screen-reader and
   desktop users lose nothing.
   ========================================================================== */

/** True below the `lg` breakpoint, live-updating. */
export function useIsMobile(breakpoint = 1024) {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return mobile;
}

/**
 * Discrete swipe detection — spread the returned handlers on any element.
 * Fires once per touch when the gesture is decisively horizontal (or
 * vertical) and fast enough to read as intent rather than a scroll.
 */
export function useSwipe({ onLeft, onRight, onUp, onDown, threshold = 56 } = {}) {
  const start = useRef(null);

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, []);

  const onTouchEnd = useCallback(
    (e) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      if (Date.now() - s.at > 600) return; // a slow drag is not a swipe
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax >= threshold && ax > ay * 1.5) {
        if (dx < 0) onLeft?.();
        else onRight?.();
      } else if (ay >= threshold && ay > ax * 1.5) {
        if (dy < 0) onUp?.();
        else onDown?.();
      }
    },
    [onLeft, onRight, onUp, onDown, threshold]
  );

  return { onTouchStart, onTouchEnd };
}

/**
 * Long-press — the mobile "right click". Cancels if the finger travels
 * (that's a scroll, not a press). After it fires, the next click is
 * swallowed so the primary tap action doesn't also run.
 */
export function useLongPress(callback, { ms = 450 } = {}) {
  const timer = useRef(null);
  const origin = useRef(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  const begin = useCallback(
    (x, y) => {
      fired.current = false;
      origin.current = { x, y };
      timer.current = setTimeout(() => {
        fired.current = true;
        if (navigator.vibrate) navigator.vibrate(10);
        callback();
      }, ms);
    },
    [callback, ms]
  );

  return {
    onTouchStart: (e) => begin(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: (e) => {
      const o = origin.current;
      if (!o) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - o.x) > 10 || Math.abs(t.clientY - o.y) > 10) clear();
    },
    onTouchEnd: clear,
    onMouseDown: (e) => begin(e.clientX, e.clientY),
    onMouseUp: clear,
    onMouseLeave: clear,
    onContextMenu: (e) => e.preventDefault(),
    onClickCapture: (e) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

/**
 * Swipe in from the left screen edge to open the drawer. Only touches that
 * BEGIN inside the edge zone count, so in-content horizontal gestures
 * (SwipeRow, period paging) never trigger it.
 */
export function useEdgeSwipe({ onOpen, edgeWidth = 28, threshold = 48 } = {}) {
  const start = useRef(null);

  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      start.current = t.clientX <= edgeWidth ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchMove: (e) => {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = Math.abs(t.clientY - s.y);
      if (dx > threshold && dx > dy * 1.5) {
        start.current = null;
        onOpen?.();
      }
    },
    onTouchEnd: () => {
      start.current = null;
    },
  };
}
