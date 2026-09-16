import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
await p.click('[data-testid=demo-open]'); await p.click('[data-testid=demo-login-owner]');
await p.waitForURL(/inbox|my-work/, { timeout: 20000 });
await p.goto('http://localhost:3000/inbox', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
console.log(JSON.stringify(await p.evaluate(() => {
  const bd = document.querySelector('[data-testid=desk-board]'); const r = bd.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrollH: document.documentElement.scrollHeight,
    bg: getComputedStyle(bd).backgroundColor,
    decisionRows: document.querySelectorAll('[data-testid^=desk-decisions-row-]').length,
    approvalRows: document.querySelectorAll('[data-testid^=desk-approvals-row-]').length };
})), 'errors:', errs);
await p.screenshot({ path: process.env.TEMP + '/desk-black.png' });
await b.close();
