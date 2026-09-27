import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the SAME build the web app ships: `npm run build` writes
 * frontend/build, and webDir points at it. There is no second copy of the UI
 * and no mobile-only source tree — if a screen changes on karma-redesign, the
 * next `npm run build && npx cap sync` carries that change into both stores.
 *
 * Run `npx cap sync` after every build. `cap sync` = `cap copy` (refresh the
 * web assets inside ios/ and android/) + `cap update` (refresh native deps).
 */
const config: CapacitorConfig = {
  appId: 'com.decisionos.app',
  appName: 'DecisionOS',
  webDir: 'build',

  plugins: {
    // Route fetch/XHR through native code instead of the webview.
    //
    // Two things make this necessary rather than a preference, both measured
    // against the Railway backend on 2026-09-27:
    //
    // 1. CORS. A preflight from capacitor://localhost (iOS) or
    //    https://localhost (Android) comes back 400 "Disallowed CORS origin"
    //    with no Access-Control-Allow-Origin. The backend's allow-list is
    //    exact-match by design — config.py refuses to boot with '*' in prod —
    //    and the app's origins are not on it. Native requests are not made by
    //    a browser, so CORS does not apply to them at all.
    //
    // 2. Cookies. Auth is HttpOnly SameSite=None Secure cookies plus a CSRF
    //    double-submit. From a capacitor:// page those are third-party
    //    cookies, which WKWebView blocks by default; widening CORS would not
    //    have fixed that. Native requests use the platform cookie jar.
    //
    // The alternative was adding capacitor://localhost to CORS_ORIGINS on a
    // production backend mid-pilot, which changes more and fixes less.
    CapacitorHttp: {
      enabled: true,
    },
  },

  ios: {
    // The design system assumes a light ground (#F3F3F0). Without this the
    // webview inherits the device's dark appearance and scroll overflow
    // areas flash a colour no screen was designed against.
    backgroundColor: '#F3F3F0',
    // Let the app draw into the safe areas; screens already ship
    // viewport-fit=cover and env(safe-area-inset-*) padding.
    contentInset: 'never',
  },

  android: {
    backgroundColor: '#F3F3F0',
  },

  server: {
    // iOS serves from capacitor://localhost, Android from https://localhost.
    // Both are opaque origins, so every API call must go to an absolute
    // REACT_APP_BACKEND_URL — see docs/DECISIONOS_MOBILE_APP_PLAN.md.
    androidScheme: 'https',

    // LIVE RELOAD — opt-in, and deliberately impossible to ship by accident.
    //
    // Point the native webview at the CRA dev server instead of the bundled
    // assets, so a save in src/ reloads on the device without a rebuild.
    // Enabled only when CAP_LIVE_RELOAD_URL is set in the environment:
    //
    //   npm run cap:dev          # sets it for you, from your LAN IP
    //
    // It must be a LAN address (http://192.168.x.x:3000), never localhost —
    // on a device or simulator, localhost is the device itself.
    //
    // The guard matters more than the feature. A store build that carried a
    // server.url would load the app from whichever laptop happened to be on
    // that network, and would simply fail to start anywhere else. Because
    // this reads an env var that is unset in every normal build, `npm run
    // build && npx cap sync` can never produce that binary.
    ...(process.env.CAP_LIVE_RELOAD_URL
      ? {
          url: process.env.CAP_LIVE_RELOAD_URL,
          // Android blocks plaintext HTTP by default; the dev server is HTTP.
          cleartext: true,
        }
      : {}),
  },
};

export default config;
