import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import "@/i18n";
import App from "@/App";

/* Two ways to run on the fixture instead of a backend, deliberately separate.
 *
 * REACT_APP_PREVIEW_MOCK — dev only, and double-guarded on NODE_ENV so it can
 * never reach a production bundle by accident. This is the design-review flag
 * and its safety property is worth keeping exactly as it is.
 *
 * REACT_APP_DEMO — permitted in a production build, because a hosted demo has
 * to be a real static build and there is no backend to point it at. It is a
 * second, differently-named flag rather than a loosened guard so that nobody
 * turns on fake data by reaching for the familiar one, and so a grep for
 * "DEMO" finds every place this matters.
 *
 * Anything built with REACT_APP_DEMO=1 shows a permanent "Demo data" marker —
 * see DemoBanner. Fixture figures must never be mistakable for a real
 * business's numbers, least of all in front of investors.
 */
/* Written as two independent conditions rather than one `||`, because webpack
 * can only drop the require() when it can statically prove the branch dead.
 * Combined into a single expression it cannot, so the whole fixture — company
 * name, figures and all — was being bundled into ordinary production builds
 * and merely never executed. Inert, but no reason to ship it to real users. */
if (process.env.REACT_APP_DEMO === "1") {
  // eslint-disable-next-line global-require
  require("@/dev/previewMock").installPreviewMock();
} else if (process.env.NODE_ENV !== "production" && process.env.REACT_APP_PREVIEW_MOCK === "1") {
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
