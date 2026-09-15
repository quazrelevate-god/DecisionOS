"""Shared demo sign-in for the UX audit scripts.

Kept in one place because the login screen is actively being redesigned: KM /
dd7f91c moved the demo seats behind a "Try DecisionOS on a live workspace"
button, so the role cards now live in a second pane. Every audit script broke at
once. This helper handles both shapes and is the only thing that needs changing
next time the sign-in page is reworked.

Uses the demo seats rather than typed credentials, so no password reaches the
harness or its logs.
"""

ROLES = ("owner", "sales", "production", "finance")


def demo_login(page, base="http://localhost:3000", role="owner", timeout=30000):
    """Sign in as a demo role. Returns True once off the login screen."""
    page.goto(f"{base}/login", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
    if "/login" not in page.url:
        return True

    seat = f'[data-testid="demo-login-{role}"]'

    # New shape: the seats are hidden until the demo pane is opened.
    if page.locator(f"{seat}:visible").count() == 0:
        opener = page.locator('[data-testid="demo-open"]:visible')
        if opener.count():
            opener.first.click()
            page.wait_for_timeout(900)

    loc = page.locator(f"{seat}:visible")
    if loc.count() == 0:
        # last resort: the seats pane may need a beat to animate in
        page.wait_for_timeout(1200)
        loc = page.locator(f"{seat}:visible")
        if loc.count() == 0:
            raise RuntimeError(
                f"no demo seat for {role!r}; login page shape changed again "
                f"(looked for {seat}, and for a demo-open opener)")

    loc.first.click()
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=timeout)
    except Exception:
        pass
    page.wait_for_timeout(1100)
    return "/login" not in page.url
