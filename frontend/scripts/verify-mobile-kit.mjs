#!/usr/bin/env node
/**
 * MPWA-04 verification — proves the BottomSheet contract by driving it, not by
 * reading it. Checks §7's "must" list plus SheetSelect's drop-in behaviour.
 *
 *   node scripts/verify-mobile-kit.mjs
 *
 * Exits non-zero on any failed assertion.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));
await page.goto(`${BASE}/__mobile-kit`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="mobile-kitchen-sink"]', { timeout: 15000 });
await page.waitForTimeout(400);

// ---------------------------------------------------------------- renders
for (const id of [
  'kit-statuschip', 'kit-mobilecard', 'kit-sheetselect', 'kit-money',
  'kit-skeleton', 'kit-stalestamp', 'kit-emptystate', 'kit-undo',
]) {
  check(`renders ${id}`, await page.locator(`[data-testid="${id}"]`).isVisible());
}

// ------------------------------------------------- money formatting (§5.3)
const moneyText = await page.locator('[data-testid="kit-money"]').innerText();
check('inr() groups Indian: ₹4,80,000', moneyText.includes('₹4,80,000'));
check('inr() groups Indian: ₹22,00,000', moneyText.includes('₹22,00,000'));
check('inrCompact() -> ₹1.84Cr', moneyText.includes('₹1.84Cr'));
check('inrCompact() -> ₹4.0L', /₹4\.0L/.test(moneyText));
check('no Western grouping anywhere', !/₹\d{1,3},\d{3},\d{3}|₹\d{3},\d{3}(?!\d)/.test(moneyText), moneyText.match(/₹[\d,]+/g)?.join(' '));

// --------------------------------------------- MobileCard: 2-line clamp (§3.4)
const clamp = await page.locator('[data-testid="kit-card-1"] .line-clamp-2').first();
const clampCss = await clamp.evaluate((el) => getComputedStyle(el).webkitLineClamp);
check('MobileCard title clamps to 2 lines, not 1', clampCss === '2', `-webkit-line-clamp: ${clampCss}`);
const chevrons = await page.locator('[data-testid="kit-card-1"] svg').count();
check('MobileCard is one tap target', await page.locator('[data-testid="kit-card-1"]').evaluate(
  (el) => el.tagName === 'BUTTON' && el.querySelectorAll('a,button,[role="button"]').length === 0
), `${chevrons} svg(s) inside, 0 nested controls`);

// ------------------------------------------------- BottomSheet contract (§7)
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(250);
const beforeY = await page.evaluate(() => Math.round(window.scrollY));
check('scrolled before opening', beforeY > 300, `scrollY=${beforeY}`);

await page.locator('[data-testid="kit-card-1"]').click();
await page.waitForSelector('[data-testid="bottom-sheet"]', { timeout: 5000 });
await page.waitForTimeout(450);

check('sheet has a visible close button (not only a handle)',
  await page.locator('[data-testid="bottom-sheet-close"]').isVisible());

const closeBox = await page.locator('[data-testid="bottom-sheet-close"]').boundingBox();
check('close button clears 44px', closeBox.width >= 44 && closeBox.height >= 44,
  `${Math.round(closeBox.width)}x${Math.round(closeBox.height)}`);

const scrim = await page.locator('[data-testid="bottom-sheet-scrim"]')
  .evaluate((el) => getComputedStyle(el).backgroundColor);
const [sr, sg, sb] = scrim.match(/\d+/g).map(Number);
check('scrim is neutral, not tinted', Math.max(sr, sg, sb) - Math.min(sr, sg, sb) <= 12, scrim);

// Background scroll must be locked. NB: the lock pins the body with
// `position: fixed`, so window.scrollY is 0 *by definition* while a sheet is
// open — that is the signature of the technique, not a failure. What matters
// is that the page does not visually move, so measure a reference element's
// viewport position across a wheel event instead.
const lockSig = await page.evaluate(() => ({
  bodyPosition: getComputedStyle(document.body).position,
  bodyTop: document.body.style.top,
  refTop: Math.round(
    document.querySelector('[data-testid="kit-emptystate"]').getBoundingClientRect().top
  ),
}));
await page.mouse.wheel(0, 600);
await page.waitForTimeout(300);
const afterWheel = await page.evaluate(() =>
  Math.round(document.querySelector('[data-testid="kit-emptystate"]').getBoundingClientRect().top)
);
check('background is pinned, not merely overflow-hidden',
  lockSig.bodyPosition === 'fixed' && lockSig.bodyTop === `-${beforeY}px`,
  `body position=${lockSig.bodyPosition} top=${lockSig.bodyTop}`);
check('background does not scroll behind the sheet',
  Math.abs(afterWheel - lockSig.refTop) <= 2,
  `reference element top ${lockSig.refTop} -> ${afterWheel}`);

// focus trap: Tab must never leave the sheet
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focusInside = await page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="bottom-sheet"]');
  return !!sheet && sheet.contains(document.activeElement);
});
check('focus is trapped inside the sheet', focusInside,
  await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName));

// the sheet body scrolls even though the page does not
const bodyScrolled = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="bottom-sheet-body"]');
  if (!b) return null;
  const can = b.scrollHeight > b.clientHeight;
  return { can, overscroll: getComputedStyle(b).overscrollBehaviorY };
});
check('sheet body contains its own overscroll', bodyScrolled?.overscroll === 'contain',
  JSON.stringify(bodyScrolled));

// money-committing action sits on the 56px tier (§5.1)
const approve = await page.locator('[data-testid="kit-sheet-approve"]').boundingBox();
check('Approve button is on the 56px tier', Math.round(approve.height) >= 56,
  `${Math.round(approve.height)}px`);
const approveText = await page.locator('[data-testid="kit-sheet-approve"]').innerText();
check('amount is inside the button (§5.5)', approveText.includes('₹4,80,000'), approveText);

// Escape closes, and the page returns to where it was
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('Escape closes the sheet',
  (await page.locator('[data-testid="bottom-sheet"]').count()) === 0);
const afterY = await page.evaluate(() => Math.round(window.scrollY));
check('scroll position restored on close', Math.abs(afterY - beforeY) <= 2,
  `${beforeY} -> ${afterY}`);

// ------------------------------------------------------ SheetSelect drop-in
const before = await page.locator('[data-testid="kit-sheetselect"]').innerText();
check('SheetSelect shows the current value', before.includes('In progress'), before.replace(/\n/g, ' '));
await page.locator('[data-testid="sheet-select"]').click();
await page.waitForSelector('[data-testid="sheet-select-sheet"]', { timeout: 5000 });
await page.waitForTimeout(350);
const optBox = await page.locator('[data-testid="sheet-select-option-waiting"]').boundingBox();
check('options clear 44px', optBox.height >= 44, `${Math.round(optBox.height)}px`);
await page.locator('[data-testid="sheet-select-option-waiting"]').click();
await page.waitForTimeout(450);
const after = await page.locator('[data-testid="kit-sheetselect"]').innerText();
check('SheetSelect emits {target:{value}} like <select>', after.includes('waiting'),
  after.replace(/\n/g, ' '));
check('picker sheet closed after choosing',
  (await page.locator('[data-testid="sheet-select-sheet"]').count()) === 0);

// no native <select> introduced by the kit
check('kit introduces no native <select>',
  (await page.locator('select').count()) === 0);

// ----------------------------------------------------------- UndoSnackbar
await page.locator('[data-testid="kit-undo-trigger"]').click();
await page.waitForSelector('[data-testid="undo-snackbar"]', { timeout: 5000 });
const snack = await page.locator('[data-testid="undo-snackbar"]').boundingBox();
const vh = page.viewportSize().height;
check('undo sits above the dock line', vh - (snack.y + snack.height) >= 88,
  `${Math.round(vh - (snack.y + snack.height))}px from the bottom`);
const undoBox = await page.locator('[data-testid="undo-snackbar-undo"]').boundingBox();
check('Undo button clears 44px', undoBox.height >= 44, `${Math.round(undoBox.height)}px`);
const t0 = await page.locator('[data-testid="undo-snackbar-undo"]').innerText();
await page.waitForTimeout(2100);
const t1 = await page.locator('[data-testid="undo-snackbar-undo"]').innerText();
check('undo counts down visibly', t0 !== t1, `"${t0.replace(/\n/g, ' ')}" -> "${t1.replace(/\n/g, ' ')}"`);
await page.waitForTimeout(3400);
check('undo window auto-expires after ~5s',
  (await page.locator('[data-testid="undo-snackbar"]').count()) === 0);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);
