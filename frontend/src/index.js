import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import "@/i18n";
import App from "@/App";
import * as serviceWorkerRegistration from "@/serviceWorkerRegistration";
import { toast } from "sonner";
import { keepFocusedInView } from "./lib/keepFocusedInView";

// ASK-33 Phase 5 — dark mode is removed; the app is designed light-only. A
// "dark" saved by the old theme switch is cleared rather than applied. (The Dex
// room at /brain still sets its own `dark` class — Layout, NM-17.)
try { localStorage.removeItem("decisionos-theme"); } catch { /* storage blocked */ }

// MPWA-05: count sessions so InstallPrompt can wait for the third one (§8).
serviceWorkerRegistration.bumpSessionCount();

/* J14-03 (JOURNEY-1) — COMING BACK TO THE APP SHOWS WHAT IS TRUE NOW.
   refetchOnWindowFocus was off, so a phone put down and picked up again showed
   whatever it held when it was last looked at. With the 60s staleTime it stays
   cheap: coming back inside a minute of the last fetch still serves the cache
   and asks nothing. Reconnecting does the same, which is the factory-floor case
   — out of signal, back in signal, look at the screen.
   The steady drip while a screen is OPEN is hooks/usePulse.js, which asks one
   question for the whole app rather than one per list. */
/* 2026-10-03 — HOW LONG A SCREEN IS ALLOWED TO SAY NOTHING.
 *
 * react-query's default is three retries with exponential backoff, and with
 * nothing set here that is what every list in the app had. Measured in the
 * browser against a failing endpoint: FOUR attempts, 1.0s / 2.1s / 4.1s
 * apart, and the honest "couldn't load this" did not appear for 7.67
 * SECONDS. For most of that the page is neither loading nor failed — it is
 * half-built and silent, which is the state a founder reads as broken.
 *
 * AND A REFUSAL WAS RETRIED LIKE A BLIP. A 403 took the same four attempts
 * and the same 7.6s: asking a server that has just said no, three more
 * times, to be told no three more times. A 4xx is an ANSWER. The only two
 * worth asking again are 408 and 429, which are both the server saying
 * "later" rather than "never".
 *
 * One retry covers the thing retries are actually for — a single dropped
 * request — and brings the message to about a second. Anything longer than
 * that is better served by the Try again button the failure state already
 * carries, and by refetchOnWindowFocus / refetchOnReconnect below, which are
 * how the factory-floor case recovers.
 */
const RETRY_ANYWAY = new Set([408, 429]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        const status = error?.response?.status;
        if (status >= 400 && status < 500 && !RETRY_ANYWAY.has(status)) return false;
        return failureCount < 1;
      },
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

// MPWA-05: register the worker (production only — see the module for why).
// JOURNEY-1 J13 — the new worker takes over at once (service-worker.js,
// skipWaiting), but the page on screen keeps running the version it loaded,
// and nothing said a new one had arrived. Now it says so, and the person
// chooses the moment: nothing reloads under someone mid-approval, and what
// they were typing is kept anyway (lib/drafts.js).
serviceWorkerRegistration.register({
  onUpdate: () => {
    toast("DecisionOS has been updated", {
      id: "app-updated",
      description: "Refresh to use the new version. Anything you are typing is kept.",
      duration: Infinity,
      action: { label: "Refresh", onClick: () => window.location.reload() },
    });
  },
});
// JOURNEY-1 J13 — the field being typed in stays on screen when the keyboard
// opens (lib/keepFocusedInView.js).
keepFocusedInView();
