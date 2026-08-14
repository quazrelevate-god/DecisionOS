import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import "@/i18n";
import App from "@/App";
import * as serviceWorkerRegistration from "@/serviceWorkerRegistration";

// Apply persisted theme before first paint (avoids flash)
if (localStorage.getItem("decisionos-theme") === "dark") {
  document.documentElement.classList.add("dark");
}

// MPWA-05: count sessions so InstallPrompt can wait for the third one (§8).
serviceWorkerRegistration.bumpSessionCount();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
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
// An update is not force-activated: swapping the bundle under someone
// mid-approval is worse than serving yesterday's shell for one more session.
serviceWorkerRegistration.register();
