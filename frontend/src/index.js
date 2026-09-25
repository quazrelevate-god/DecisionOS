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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
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
