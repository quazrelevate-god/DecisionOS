#!/usr/bin/env node
/**
 * Live-reload the native app against the dev server.
 *
 *   npm run cap:dev            # prints what to run, and syncs the native projects
 *   npm run cap:dev -- --ios   # ...then opens Xcode
 *
 * WHY THIS EXISTS
 * ---------------
 * Live reload on a device needs the same LAN address in three places, and
 * getting one of them wrong fails in a way that looks like something else:
 *
 *   1. capacitor.config.ts  server.url      -> where the webview loads the UI
 *   2. REACT_APP_BACKEND_URL                -> where that UI sends API calls
 *   3. FIXTURE_CORS_ORIGIN                  -> which origin the API answers
 *
 * Leave (1) as localhost and the app shows a blank screen — on a phone,
 * localhost is the phone. Leave (2) as localhost and the UI loads but every
 * request fails. Leave (3) at its default and the requests are made and then
 * refused by CORS, which reads in the console like an auth problem.
 *
 * So this resolves the LAN IP once and prints all three consistently.
 */
import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const WEB_PORT = Number(process.env.PORT || 3000);
const API_PORT = Number(process.env.API_PORT || 8000);

// ---------------------------------------------------------------------------
// Resolve the LAN IP. A device on the same Wi-Fi has to be able to route to
// this, so loopback and link-local (169.254.x) addresses are useless here.
// ---------------------------------------------------------------------------
function lanIp() {
  const preferred = [];
  const other = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      (name.startsWith('en') ? preferred : other).push(a.address);
    }
  }
  return preferred[0] || other[0] || null;
}

const ip = process.env.CAP_LAN_IP || lanIp();
if (!ip) {
  console.error(
    'No LAN IP found. Connect to Wi-Fi, or set one explicitly:\n' +
      '  CAP_LAN_IP=192.168.1.21 npm run cap:dev',
  );
  process.exit(1);
}

const webUrl = `http://${ip}:${WEB_PORT}`;
const apiUrl = `http://${ip}:${API_PORT}`;

console.log(`
Live reload against ${webUrl}

Run these in three terminals, in this order:

  1  FIXTURE_CORS_ORIGIN=${webUrl} \\
       node frontend/scripts/fixture-server.mjs --port ${API_PORT}

  2  cd frontend && HOST=0.0.0.0 REACT_APP_BACKEND_URL=${apiUrl} BROWSER=none npm start

  3  cd frontend && CAP_LIVE_RELOAD_URL=${webUrl} npx cap sync ios
     cd frontend && npx cap open ios

HOST=0.0.0.0 in (2) matters — CRA binds to localhost by default and the
device cannot reach that.

To go back to the bundled assets, drop CAP_LIVE_RELOAD_URL and sync again:

  cd frontend && npm run build && npx cap sync
`);

// ---------------------------------------------------------------------------
// Syncing here is a convenience, not the point: it writes server.url into the
// native projects so step 3 above is already done for whichever platform the
// caller named.
// ---------------------------------------------------------------------------
const wantsIos = argv.includes('--ios');
const wantsAndroid = argv.includes('--android');
if (!wantsIos && !wantsAndroid) process.exit(0);

const platform = wantsIos ? 'ios' : 'android';
const env = { ...process.env, CAP_LIVE_RELOAD_URL: webUrl };

console.log(`Syncing ${platform} with server.url=${webUrl} ...`);
const sync = spawnSync('npx', ['cap', 'sync', platform], { stdio: 'inherit', env });
if (sync.status !== 0) process.exit(sync.status ?? 1);

console.log(`Opening ${platform} ...`);
const open = spawnSync('npx', ['cap', 'open', platform], { stdio: 'inherit', env });
process.exit(open.status ?? 0);
