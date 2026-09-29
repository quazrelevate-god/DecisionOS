/**
 * Shared sign-in for the verification suites.
 *
 * The suites were originally written against the fixture server, which answers
 * `/auth/me` locally so every page was already "signed in". Against the real
 * backend a fresh Playwright context has no token and every route bounces to
 * /login — which is what a suite should do, but it has to get past it first.
 *
 * Uses the login screen's own demo button rather than typing credentials, so no
 * password appears in the harness or its logs.
 */
export async function signIn(page, base, { role = 'owner', timeout = 25000 } = {}) {
  const at = () => new URL(page.url()).pathname;
  if (!at().startsWith('/login')) {
    await page.goto(`${base}/inbox`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  }
  if (!at().startsWith('/login')) return true;

  /* B22 rebuilt the sign-in card and put the demo behind a door: the role
     cards live in a pane that `demo-open` reveals, where they used to sit on
     the card itself. Open it only when the role button is not already there,
     so this keeps working against both layouts. */
  const btn = page.locator(`[data-testid="demo-login-${role}"]`);
  if (!(await btn.isVisible().catch(() => false))) {
    const door = page.locator('[data-testid="demo-open"]');
    if (await door.isVisible().catch(() => false)) {
      await door.click();
      await page.waitForTimeout(400);
    }
  }
  await btn.waitFor({ timeout: 10000 });
  await btn.click();
  await page
    .waitForURL((u) => !new URL(u).pathname.startsWith('/login'), { timeout })
    .catch(() => {});
  // The token lands in storage before the first authed render finishes.
  await page.waitForTimeout(900);
  return !at().startsWith('/login');
}

export default signIn;
