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
      /* KM-61 — 180s, not 60s, and the 60 was actively breaking signup.
         Railway's HTTP log for a real iPhone registration:

           POST /api/auth/register  499  totalDuration 60000
             "client has closed the request before the server could send
              a response"

         499 at exactly the timeout is THIS proxy hanging up. The backend
         never learned the client had gone: it finished and committed the
         tenant and the user, so the founder was told "Couldn't create your
         workspace" for a workspace that existed, and the retry answered
         "Email already registered". It also explains why the separately
         hosted decisionos.biz worked — that frontend talks to the backend
         directly and never met this ceiling.

         register is the one endpoint that legitimately runs long: it
         provisions a tenant and generates a lexicon, an operating model and
         finance categories. KM-61 makes those three concurrent, which should
         bring it comfortably under a minute; this ceiling is the belt to that
         fix's braces, because a slow model day must not cost a signup.
         Everything else on /api answers in milliseconds. */
      proxyTimeout: 180000,
      timeout: 180000,
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
const REVALIDATE = /^\/(sky|landing)\//;
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

/* KM-55 — "/" IS THE MARKETING SITE NOW, not the app.
   The React app's own Landing.js (the old blue-theme page) is gone; the new
   static landing lives in the CRA public folder, so the build copies it
   verbatim to build/landing and express.static above already serves its css,
   js and images at /landing/*. Only the document itself is remapped, so the
   marketing page owns the bare domain while /login, /signup, /inbox and every
   other route still belong to the SPA below.

   Its asset refs were rewritten to absolute /landing/... precisely because of
   this split: the page is SERVED at "/" but LIVES at /landing/, and relative
   refs would have resolved against "/" and 404'd.

   Checked once at startup rather than per request. If the file is missing the
   app must NOT quietly fall through to the SPA: App.js bounces "/" back here
   for logged-out users, and a silent fallback would be a reload loop. Loud,
   and serve the SPA anyway — its own one-shot guard stops the loop. */
const LANDING = path.join(BUILD, "landing", "index.html");
const HAS_LANDING = require("fs").existsSync(LANDING);
if (!HAS_LANDING) {
  console.error("[server] build/landing/index.html is MISSING — / falls back to the SPA.");
} else {
  console.log("[server] serving the landing page at /");
}
/* KM-58 — "/landing" is the same page at an explicit URL. express.static runs
   with index:false, so the directory alone would not resolve to its index.
   It exists as a plain answer to "is the page actually there?" that does not
   depend on the root route or on whatever a device's service worker believes
   about "/". */
app.get(["/", "/landing", "/landing/"], (req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(HAS_LANDING ? LANDING : path.join(BUILD, "index.html"));
});

/* SPA fallback — the same job `serve -s` was doing. Without it every deep link
   (/inbox, /my-work, /finance) 404s on refresh, because react-router owns
   those paths client-side. */
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(BUILD, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`[server] listening on ${PORT}`));
