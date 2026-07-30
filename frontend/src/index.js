import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import "@/i18n";
import App from "@/App";

// Dev-only: review real screens without a backend (REACT_APP_PREVIEW_MOCK=1 yarn start).
if (process.env.NODE_ENV !== "production" && process.env.REACT_APP_PREVIEW_MOCK === "1") {
  // eslint-disable-next-line global-require
  require("@/dev/previewMock").installPreviewMock();
}

// Apply persisted theme before first paint (avoids flash)
if (localStorage.getItem("decisionos-theme") === "dark") {
  document.documentElement.classList.add("dark");
}

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
