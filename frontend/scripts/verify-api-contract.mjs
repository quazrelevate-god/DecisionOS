#!/usr/bin/env node
/**
 * Static contract check: every api.<method>(path) call in the mobile tree must
 * match a real route on the FastAPI app, with the right HTTP verb.
 *
 *   node scripts/verify-api-contract.mjs [routes.json]
 *
 * WHY THIS EXISTS: the mobile screens were built against scripts/fixture-server.mjs,
 * whose catch-all answers ANY unmapped path or method with 200 OK. That is fine
 * for laying out a screen, and actively dangerous for wiring one up — it let a
 * `POST /workflows/{id}/advance` look like it worked when the real route is
 * PATCH, surfacing only as "405 Method Not Allowed" against the live backend.
 * This closes that gap without needing the backend running.
 *
 * Regenerate routes.json from the backend with:
 *   cd backend && .venv/bin/python -c "import server, json; \
 *     print(json.dumps({r.path: sorted(m for m in r.methods if m not in ('HEAD','OPTIONS')) \
 *       for r in server.app.routes if getattr(r,'methods',None)}, indent=0))" > routes.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');
const ROUTES_FILE = process.argv[2] || path.join(__dirname, 'routes.json');

if (!fs.existsSync(ROUTES_FILE)) {
  console.error(`routes.json not found at ${ROUTES_FILE} — see the header for how to generate it.`);
  process.exit(2);
}
const routes = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));

// Segment-wise comparison, with placeholders on EITHER side matching anything.
//
// Both sides can be dynamic: the route has {task_id}, and the call may build the
// action too — `/decisions/${id}/${action}` for approve|reject. A regex built
// only from the route cannot match `:x` in the action position, which is why an
// earlier version of this script reported false failures on exactly those calls.
const isPlaceholder = (seg) => seg === ':x' || /^\{[^}]+\}$/.test(seg);
const segs = (p) => p.split('/').filter(Boolean);

const routeList = Object.entries(routes).map(([p, methods]) => ({ path: p, methods, segs: segs(p) }));

function matchRoutes(callPath) {
  const cs = segs(callPath);
  return routeList.filter(
    (r) => r.segs.length === cs.length &&
      r.segs.every((rs, i) => isPlaceholder(rs) || isPlaceholder(cs[i]) || rs === cs[i])
  );
}

// Files that talk to the API on behalf of mobile screens.
const TARGETS = [
  'src/pages/mobile',
  'src/components/mobile',
  'src/components/DexCaptureBar.js',
];

const files = [];
const walk = (p) => {
  const abs = path.join(FRONTEND, p);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const f of fs.readdirSync(abs)) walk(path.join(p, f));
  } else if (/\.(js|jsx)$/.test(abs)) files.push(abs);
};
TARGETS.forEach(walk);

// api.get(`/x/${y}`)  |  api.post("/x")  |  api.patch(`/x/${y}/z`, body)
const CALL = /api\.(get|post|patch|put|delete)\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;

const findings = [];
let checked = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Reconstruct calls that may wrap onto the next line.
    const window = lines.slice(i, i + 2).join(' ');
    CALL.lastIndex = 0;
    let m;
    while ((m = CALL.exec(window))) {
      const method = m[1].toUpperCase();
      let raw = m[2].slice(1, -1);
      // Only count the first line's occurrences so a call is not double-reported.
      if (!lines[i].includes(raw.split('${')[0].slice(0, 12))) continue;
      // `${expr}` -> a single path segment; strip query strings.
      const p = `/api${raw.replace(/\$\{[^}]*\}/g, ':x').split('?')[0]}`;
      if (p.includes('${')) continue;
      checked++;
      const hits = matchRoutes(p);
      const rel = path.relative(FRONTEND, file);
      if (!hits.length) {
        findings.push({ kind: 'no-such-route', method, p, file: rel, line: i + 1 });
      } else if (!hits.some((h) => h.methods.includes(method))) {
        // A call whose path is partly dynamic may match several routes; it is a
        // mismatch only if NONE of them accept this verb.
        findings.push({
          kind: 'wrong-method', method, p, file: rel, line: i + 1,
          detail: hits.map((h) => `${h.methods.join(',')} ${h.path}`).join('  |  '),
        });
      }
    }
  }
}

const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.kind}|${f.method}|${f.p}|${f.file}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`checked ${checked} api call(s) across ${files.length} file(s) against ${Object.keys(routes).length} real routes\n`);
if (!unique.length) {
  console.log('  ok   every call matches a real route with a valid method');
  process.exit(0);
}
for (const f of unique) {
  console.log(` FAIL  ${f.kind}: ${f.method} ${f.p}`);
  console.log(`         ${f.file}:${f.line}${f.detail ? `\n         ${f.detail}` : ''}`);
}
console.log(`\n${unique.length} mismatch(es)`);
process.exit(1);
