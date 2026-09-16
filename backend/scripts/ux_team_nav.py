"""Finding a person on the Team page, for the UX audit scripts.

Sakthivel's Team redesign (8b60707, 2026-09-16) draws the heads of each team and
folds the people under them away, so a member's card is not in the DOM at all
until their department is opened. Every audit script that clicked straight at
`team-member-<id>` timed out on the redesign. One helper, in one place, so the
next reshuffle of that page is a single edit.
"""


def reveal_member(page, uid, settle_ms=400, max_steps=10):
    """Open whatever the member's card is folded inside. True once it is there.

    The canvas opens one path at a time: the heads are drawn first, a team's
    people appear when its head is opened, and anyone who reports to one of
    those appears when THAT card is opened. So walk down, opening each closed
    toggle in turn, until the card we want is on screen.
    """
    sel = f'[data-testid="team-member-{uid}"]'
    if page.locator(sel).count():
        return True
    clicked = set()
    for _ in range(max_steps):
        toggles = page.locator('[data-testid^="team-dept-toggle-"], [data-testid^="team-reports-toggle-"]')
        opened_one = False
        for i in range(toggles.count()):
            t = toggles.nth(i)
            try:
                tid = t.get_attribute("data-testid")
                if not tid or tid in clicked or t.get_attribute("aria-expanded") == "true":
                    continue
                clicked.add(tid)
                t.click()
            except Exception:
                continue
            page.wait_for_timeout(settle_ms)
            opened_one = True
            break          # the canvas just redrew — ask it again
        if page.locator(sel).count():
            return True
        if not opened_one:
            break
    return page.locator(sel).count() > 0


def open_member(page, base, uid, wait_id, timeout=20000):
    """Land on Team, unfold the member's team, open their profile. True on success.

    `wait_id` is the calling script's own testid wait, so failures are reported
    the same way as every other check in that script.
    """
    page.goto(f"{base}/team")
    wait_id(page, "team-tree", timeout)
    if not reveal_member(page, uid):
        return False
    page.locator(f'[data-testid="team-member-{uid}"]').first.click()
    return wait_id(page, f"profile-dialog-{uid}")
