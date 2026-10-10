import { useEffect, useRef } from "react";

/* Audit A-02 (2026-10-09) — the browser's Back button inside sign-up.
   Signup.js turns it into this event; the step on screen answers it with its
   own Back and calls preventDefault, so the browser and the page agree on
   what "back" means. */
export const SIGNUP_BACK = "dos:signup-back";

/* `handler` returns true when it went back. Kept in a ref, so it always sees
   the step as it is now. */
export function useSignupBack(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e) => {
      if (e.defaultPrevented) return;
      if (ref.current?.()) e.preventDefault();
    };
    window.addEventListener(SIGNUP_BACK, on);
    return () => window.removeEventListener(SIGNUP_BACK, on);
  }, []);
}
