// Mobile PWA — the system Back button closes what is open (2026-09-14).
//
// On a phone, Back is how people leave a drawer, a sheet or a dialog. Nothing
// in the app listened for it, so Back left the PAGE instead: open a task on My
// Work, press Back, and the whole page went with the drawer.
//
// While an overlay is open on a phone this puts one history entry on the stack
// (same URL, a marker in history.state). Back pops that entry and the overlay
// closes; closing the overlay any other way (its X, the scrim, a save) takes the
// entry back off, so the stack ends exactly as it started.
//
//   * Nested overlays each hold their own entry. Only the top one answers Back:
//     after the inner entry pops, the outer overlay's marker is current again.
//   * If the page navigates while an overlay is open, the marker is no longer
//     current and nothing is popped — Back never undoes a navigation.
//   * The push waits a tick. React StrictMode mounts effects twice in
//     development, and an immediate push/back pair races and closes the overlay
//     it has just opened.
//   * Desktop is untouched; a keyboard has Escape.
//
// Wired into ui/dialog, ui/sheet and ui/alert-dialog for every controlled
// overlay, and called directly by the mobile surfaces that aren't built on them.
import { useEffect, useRef } from "react";
import { MOBILE_QUERY } from "./useIsMobile";

const KEY = "dosOverlay";

export function useBackDismiss(open, onOpenChange) {
  const close = useRef(onOpenChange);
  close.current = onOpenChange;

  useEffect(() => {
    if (!open || typeof window === "undefined" || typeof close.current !== "function") return undefined;
    if (!window.matchMedia?.(MOBILE_QUERY).matches) return undefined;

    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let pushed = false;
    let poppedByBack = false;

    const onPop = () => {
      // Our entry is still the current one — an overlay above us popped.
      if (window.history.state?.[KEY] === token) return;
      poppedByBack = true;
      close.current?.(false);
    };
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state || {}), [KEY]: token }, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      if (pushed && !poppedByBack && window.history.state?.[KEY] === token) window.history.back();
    };
  }, [open]);
}

export default useBackDismiss;
