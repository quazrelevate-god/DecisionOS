#!/usr/bin/env node
/**
 * Dev helper — capture a route across the §9.3 matrix:
 * 390x844 + 360x640, light + dark, English + Hindi.
 *
 *   node scripts/shots.mjs /inbox            # all 8 combinations
 *   node scripts/shots.mjs /inbox --only 390x844:dark:hi
 *
 * Writes PNGs to frontend/.audit-artifacts/shots/. Not part of the audit gate.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), '.audit-artifacts', 'shots');
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';

const route = process.argv[2] || '/inbox';
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
const fullPage = !process.argv.includes('--viewport-only');

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x640', width: 360, height: 640 },
];
const THEMES = ['light', 'dark'];
const LANGS = ['en', 'hi'];

fs.mkdirSync(OUT, { recursive: true });
const FROZEN = new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`);
const browser = await chromium.launch();
const written = [];

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const lang of LANGS) {
      const tag = `${vp.name}:${theme}:${lang}`;
      if (only && only !== tag) continue;
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        colorScheme: theme,
      });
      await ctx.clock.setFixedTime(FROZEN);
      // Seed the app's own persistence keys before any script runs.
      await ctx.addInitScript(
        ([t, l]) => {
          localStorage.setItem('decisionos-theme', t);
          localStorage.setItem('dos_lang', l);
        },
        [theme, lang]
      );
      const page = await ctx.newPage();
      // AuthContext applies `user.language` on mount, which overrides the
      // localStorage seed above — so force the language on the wire instead.
      await page.route('**/api/auth/me', async (r) => {
        const res = await r.fetch();
        let body = await res.json().catch(() => null);
        if (body?.user) body.user.language = lang;
        await r.fulfill({ response: res, json: body ?? {} });
      });
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.addStyleTag({
        content: '*,*::before,*::after{animation:none!important;transition:none!important}',
      }).catch(() => {});
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          ['900 24px Chivo', '400 15px Geist', '600 15px Geist'].map((f) =>
            document.fonts.load(f).catch(() => {})
          )
        );
      }).catch(() => {});
      await page.waitForTimeout(700);
      const slug = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
      const file = path.join(OUT, `${slug}__${vp.name}__${theme}__${lang}.png`);
      await page.screenshot({ path: file, fullPage });
      written.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
for (const f of written) console.log(f.replace(process.cwd(), '.'));
