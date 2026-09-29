#!/usr/bin/env node
/**
 * B08 · Take out of the native payload what only the WEBSITE needs.
 *
 * Capacitor copies `webDir` — the whole of frontend/build — into the app
 * bundle. That folder is built for a web server, and a web server is allowed
 * to carry things no phone will ever ask for. The shipped APK was 38 MB, and
 * roughly 25 of those were:
 *
 *   · five internal PDFs sitting in public/ (the investor brochure, the
 *     project document, the vision deck, a 15 MB mobile spec, the user
 *     guide). Nothing in src/ or the landing page links to any of them; they
 *     are there so somebody can be sent a URL. Inside an app they are dead
 *     weight that anybody who unzips the APK can read.
 *   · the marketing landing page, which the native app never shows — it opens
 *     at the SPA, and "/" is a web-only concern (server.js).
 *   · the screenshots for the written manual, same story.
 *
 * Source maps are dealt with separately, by not generating them for a native
 * build at all (GENERATE_SOURCEMAP=false in the cap:sync scripts) — a map is
 * the entire source of the app with the comments still in it.
 *
 * WHY A SCRIPT AND NOT A CONFIG. Capacitor has no exclude list for webDir, and
 * the alternative — deleting these from public/ — would take them off the
 * website too, where the URLs are the point. So the native sync prunes the
 * BUILD OUTPUT after the build and before `cap sync`. Railway builds the web
 * app from source with its own `npm run build` and never runs this, so the
 * website is untouched.
 *
 * Run by `npm run cap:sync` and `npm run cap:sync:prod`. Safe to run twice,
 * and safe to run when the files are already gone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "build");

/* Everything here is checked against the app's own source before it goes in:
   nothing under src/ references any of it. Anything the APP draws — public/sky
   (the background art, index.css), the icons, the manifest, offline.html — is
   deliberately absent from this list. */
const DROP = [
  "DecisionOS-Investor-Brochure.pdf",
  "DecisionOS-Vision.pdf",
  "DecisionOS_Mobile_Spec.pdf",
  "DecisionOS_Project_Document.pdf",
  "DecisionOS_User_Guide.pdf",
  "landing",   // the marketing site; the app opens at the SPA
  "manual",    // screenshots for the written manual
];

const size = (p) => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0);
};

if (!fs.existsSync(BUILD)) {
  console.error("prune-native-assets: no build/ — run the build first.");
  process.exit(1);
}

let freed = 0;
const gone = [];
for (const name of DROP) {
  const p = path.join(BUILD, name);
  if (!fs.existsSync(p)) continue;
  freed += size(p);
  fs.rmSync(p, { recursive: true, force: true });
  gone.push(name);
}

/* And any map that slipped through — a build run without the env var, or a
   dependency that ships its own. */
const maps = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".map")) { freed += size(p); fs.rmSync(p); maps.push(f); }
  }
};
walk(BUILD);

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(
  `prune-native-assets: removed ${gone.length} web-only item(s)` +
  `${maps.length ? ` and ${maps.length} source map(s)` : ""} — ${mb(freed)} out of the app bundle.`
);
if (gone.length) console.log(`  ${gone.join(", ")}`);
