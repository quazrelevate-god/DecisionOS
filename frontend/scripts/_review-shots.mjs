#!/usr/bin/env node
/**
 * Post-merge visual review — capture every mobile surface at 390x844 against the
 * busy fixture, plus the two overlays that only exist after a tap.
 *
 * Not part of the gate. This is for looking at.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT = path.resolve('.audit-artifacts', 'review');
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['desk-now', '/inbox'],
  ['desk-morning', '/inbox?scope=morning'],
  ['my-work', '/my-work'],
  ['my-work-board', '/my-work?view=workflows'],
  ['money', '/finance'],
  ['money-income', '/finance?tab=revenue'],
  ['crm', '/crm'],
  ['contact', '/contacts/c_1'],
  ['team', '/team'],
  ['calendar', '/calendar'],
  ['notifications', '/notifications'],
  ['journal', '/journal'],
  ['dex-page', '/brain'],
  ['settings', '/settings'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
await ctx.clock.setFixedTime(new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${page.url()}: ${e.message.split('\n')[0]}`));
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text().slice(0, 160);
    if (!/favicon|posthog|ERR_/i.test(t)) errors.push(`CONSOLE ${new URL(page.url()).pathname}: ${t}`);
  }
});

await signIn(page, BASE);

const settle = async () => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.querySelectorAll('[data-skeleton]').length === 0, { timeout: 9000 }).catch(() => {});
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' }).catch(() => {});
  await page.waitForTimeout(900);
};

for (const [name, route] of ROUTES) {
  await page.goto(`${BASE}${route}${route.includes('?') ? '&' : '?'}fixture=busy`, { waitUntil: 'domcontentloaded' });
  await settle();
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

// Overlays that only exist after a tap.
await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
await settle();
await page.locator('[data-testid="dock-more"]').click();
await page.waitForSelector('[data-testid="allapps-panel"]', { timeout: 6000 });
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, 'all-apps.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

await page.locator('[data-testid="dex-fab"]').click();
await page.waitForSelector('[data-testid="dex-sheet"]', { timeout: 6000 });
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, 'dex-sheet.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const row = page.locator('[data-testid^="desk-queue-row-"]').first();
if (await row.count()) {
  await row.click();
  await page.waitForSelector('[data-testid="focus-view"]', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'focus-decision.png') });
}

await browser.close();
console.log(`captured ${fs.readdirSync(OUT).length} shots -> ${OUT}`);
console.log(errors.length ? `\nRUNTIME ERRORS (${errors.length}):\n` + [...new Set(errors)].join('\n') : '\nno runtime errors');
