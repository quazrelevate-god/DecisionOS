/* J14-03 (JOURNEY-1) — THE SCREENS TELL THE TRUTH WHILE YOU SIT IN FRONT OF THEM.
 *
 * Until now every list fetched once and then stopped. The audit sat on four
 * screens for 75 seconds each — a task sent to a phone, a leave approved by the
 * owner, a task reassigned under somebody, a task deleted under somebody — and
 * not one of them changed. Every finding had the same shape: the database knew,
 * the person did not.
 *
 * This asks the server one small question (`/api/pulse`) on a timer and
 * refreshes only the lists whose answer moved. One request for the whole app
 * rather than one per list, so the cost does not grow with what is on screen —
 * which is the difference between this and polling each query.
 *
 * It sleeps when the tab is hidden and wakes when it comes back, so a phone in
 * a pocket is not asking anything. Coming back to the app refreshes at once,
 * which is the case that matters most on a factory floor: pick the phone up and
 * what you see is now true.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";

/* How often to ask while somebody is looking at a screen. Twenty seconds is the
   founder's tolerance for "a leave was approved and I have not been told yet",
   and it is cheap: four indexed count/max pairs per ask. */
export const PULSE_MS = 20_000;

/* Which queries each kind of change touches. Keys are react-query key PREFIXES
   — ["tasks"] matches ["tasks", "asked"], ["tasks", "approvals"] and the rest —
   so a new list on an existing feed is refreshed without being named here. */
const TOUCHES = {
  tasks: [["tasks"], ["task"], ["desk"], ["desk-summary"]],
  leaves: [["leaves"], ["leave"], ["desk"], ["desk-summary"]],
  decisions: [["decisions"], ["decision"], ["desk"], ["desk-summary"]],
  notifications: [["notifications"]],
};

export function usePulse(enabled = true) {
  const qc = useQueryClient();
  const last = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;

    const ask = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      let now;
      try {
        now = (await api.get("/pulse")).data || {};
      } catch (e) {
        // Offline, or signed out, or the server is having a moment. The screens
        // keep what they have; the next tick tries again. Never a toast: this
        // runs in the background and nobody asked it a question.
        return;
      }
      if (stopped) return;
      const before = last.current;
      last.current = now;
      if (!before) return;          // the first answer is the baseline, not news
      Object.keys(TOUCHES).forEach((kind) => {
        if (now[kind] && before[kind] !== undefined && now[kind] !== before[kind]) {
          TOUCHES[kind].forEach((key) => qc.invalidateQueries({ queryKey: key }));
        }
      });
    };

    /* Coming back to the app is the moment worth spending a request on, so ask
       straight away rather than waiting out the rest of the interval. */
    const onVisible = () => { if (document.visibilityState === "visible") ask(); };

    ask();
    timer.current = setInterval(ask, PULSE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [enabled, qc]);
}

export default usePulse;
