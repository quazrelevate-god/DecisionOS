/* DEPLOY-3 — the frontend serves its own API path, and that is a bug fix
   rather than an architecture preference.
   ────────────────────────────────────────────────────────────────────────
   THE BUG. The PWA worked on Android Chrome and loaded an empty session on
   iPhone — Safari, and every iOS browser, since they are all WebKit. Cause:
   `up.railway.app` is on the PUBLIC SUFFIX LIST, so

       frontend-production-xxxx.up.railway.app
       backend-production-yyyy.up.railway.app

   are not two subdomains of one site. They are two SEPARATE SITES, the same
   way example.com and example.org are. The auth cookie the backend sets is
   therefore a THIRD-PARTY cookie from the app's point of view.

   Chrome still delivers third-party cookies marked `SameSite=None; Secure`.
   Safari has blocked them outright since 13.1 — no prompt, no error, the
   Set-Cookie is simply dropped. So login "succeeded", the cookie vanished,
   /api/auth/me returned 401, and the app rendered a logged-out shell. Exactly
   the reported split, and nothing in the code was wrong.

   THE FIX. Same-origin. The browser now talks only to the frontend, which
   forwards /api to the backend server-side. The backend's Set-Cookie comes
   back through the frontend's own host, so the browser stores it as
   first-party — which every engine accepts. CORS stops being involved at all,
   because there is no longer a cross-origin request to permit.

   The cookies carry no Domain attribute (see backend/core/security.py), so
   they are host-only and attach to whichever host answered. That is what makes
   this work without touching the auth code.

   WHY NOT THE ALTERNATIVES:
     · Custom domains (app./api. on one registrable domain) would also fix it
       and are the better long-term answer — but they need a domain and DNS,
       and this needed fixing now.
     · AUTH_RETURN_TOKEN + a bearer header would dodge cookies entirely, and
       the backend supports it. It is also a real downgrade: the token leaves
       HttpOnly and any XSS can read it. config.py says so itself. Not a thing
       to turn on to fix a layout-independent transport problem.

   The proxy target is the backend's PUBLIC url rather than Railway's private
   network on purpose: private networking requires the target to listen on
   IPv6, and the backend's Dockerfile binds ${HOST}, which is 0.0.0.0. Moving
   it to :: is a separate change and not one to make during an outage. */
const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const PORT = process.env.PORT || 3000;
const TARGET = process.env.API_PROXY_TARGET;
const BUILD = path.join(__dirname, "build");

const app = express();
app.disable("x-powered-by");

if (!TARGET) {
  // Loud, because the failure mode otherwise is a 404 on every API call and a
  // blank app — the same symptom this file exists to fix.
  console.error("[server] API_PROXY_TARGET is not set. /api/* will 404.");
} else {
  console.log(`[server] proxying /api -> ${TARGET}`);
  app.use(
    createProxyMiddleware("/api", {
      target: TARGET,
      changeOrigin: true,   // rewrites Host so Railway's edge routes to the backend
      xfwd: true,           // X-Forwarded-* so the backend sees the real client
      proxyTimeout: 60000,
      timeout: 60000,
      /* The Origin header is deliberately NOT rewritten. The backend's CORS
         allow-list and its CSRF origin check both expect the frontend's
         origin, and forwarding it unchanged keeps those working exactly as
         they did before this file existed. */
      onError(err, req, res) {
        console.error(`[server] proxy error on ${req.method} ${req.url}:`, err.message);
        if (!res.headersSent) res.status(502).json({ detail: "Upstream unavailable" });
      },
    })
  );
}

/* index.html and the service worker must never be cached hard: a PWA that
   caches its own entry point cannot ship an update. Hashed assets under
   /static are content-addressed and safe to keep for a year. */
const NO_STORE = new Set(["/index.html", "/service-worker.js", "/manifest.json"]);

/* KM-53 — /sky is hand-placed art with PERMANENT filenames, so it cannot take
   the year that /static gets. Webpack renames a bundle on every build, which is
   what makes `immutable` safe there; sky/foo.webp keeps its name when the
   picture behind it is replaced, and a year-long max-age then means installed
   PWAs keep the old picture until 2027 without ever asking. That is exactly
   what happened to signup-lg.webp: the bytes on the server were correct and
   every client that had already loaded the page was entitled to ignore them.
   `no-cache` still CACHES — it just revalidates first, so an unchanged image
   costs a 304 and a changed one is picked up on the next load. */
const REVALIDATE = /^\/sky\//;
app.use(
  express.static(BUILD, {
    index: false,
    maxAge: "1y",
    setHeaders(res, filePath) {
      const rel = "/" + path.relative(BUILD, filePath).split(path.sep).join("/");
      if (NO_STORE.has(rel) || REVALIDATE.test(rel)) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      }
    },
  })
);

/* SPA fallback — the same job `serve -s` was doing. Without it every deep link
   (/inbox, /my-work, /finance) 404s on refresh, because react-router owns
   those paths client-side. */
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(BUILD, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`[server] listening on ${PORT}`));
