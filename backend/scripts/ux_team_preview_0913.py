"""Team hands-on pass, 2026-09-13: every control, desktop then mobile, plus a
read-only persona. Writes are aborted after sign-in, so Add / Save access /
Get invite link are pressed but never persist and no invite token is minted.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "team_0913"
results = []
DLG = '[role="dialog"][data-state="open"]'


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<9} {key}: {detail}")


def toasts(p):
    return p.evaluate("""() => [...document.querySelectorAll('[data-sonner-toast]')]
        .map(t => t.textContent.trim()).filter(Boolean)""")


def wait_toast(p, before):
    for _ in range(12):
        now = toasts(p)
        new = [t for t in now if t not in before]
        if new:
            return new
        p.wait_for_timeout(250)
    return []


def dialogs(p):
    return p.locator(DLG).count()


def close_all(p):
    for _ in range(4):
        if not dialogs(p):
            return
        p.keyboard.press("Escape")
        p.wait_for_timeout(450)


INVENTORY = """(sel) => { const ds=[...document.querySelectorAll(sel)]; const d=ds[ds.length-1]; if(!d) return null;
  const vw=innerWidth, vh=innerHeight, r=d.getBoundingClientRect();
  const ctrls=[...d.querySelectorAll('button,a,input,select,textarea')].filter(e=>{const b=e.getBoundingClientRect(); return b.width>0&&b.height>0;})
    .map(e=>{const b=e.getBoundingClientRect(); const cx=b.left+b.width/2, cy=b.top+b.height/2;
      const inView = cy>0&&cy<vh&&cx>0&&cx<vw; const h = inView ? document.elementFromPoint(cx,cy) : null;
      const lab = e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.getAttribute('placeholder') || e.textContent.trim().slice(0,28) || e.getAttribute('data-testid');
      return {name: lab, tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), w: Math.round(b.width), h: Math.round(b.height),
              covered: inView ? !(e===h||e.contains(h)) : null};});
  return {rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], fits: r.left>=0&&r.right<=vw+1&&r.top>=0&&r.bottom<=vh+1,
          scroll:[d.scrollHeight,d.clientHeight], title:(d.querySelector('h2')||{}).textContent, ctrls}; }"""


def roster(p, vp, shots, owner=True):
    p.goto(f"{BASE}/team", wait_until="domcontentloaded")
    p.wait_for_timeout(3500)
    p.screenshot(path=str(shots / f"{vp}_roster.png"), full_page=False)
    info = p.evaluate("""() => { const groups=[...document.querySelectorAll('[data-testid^="team-role-"]')].filter(e=>e.getBoundingClientRect().width>0)
        .map(g=>({k:g.getAttribute('data-testid').slice(10), n:g.querySelectorAll('[data-testid^="team-member-"]').length}));
      const count=(document.querySelector('h2 + span')||{}).textContent;
      return {groups, count, overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
        banner: !!document.querySelector('[data-testid="team-view-only-banner"]'),
        add: !!document.querySelector('[data-testid="add-user-button"]'),
        out: !!document.querySelector('[data-testid="team-currently-out"]'),
        crash: /something went wrong/i.test(document.body.innerText)}; }""")
    rec("roster renders", vp, not info["crash"] and bool(info["groups"]),
        f"groups {info['groups']}, header count '{info['count']}', currently-out strip {info['out']}")
    rec("no page-level horizontal overflow", vp, info["overflow"] <= 1, f"{info['overflow']}px")
    if owner:
        rec("owner sees Add member, no read-only banner", vp, info["add"] and not info["banner"], json.dumps({"add": info["add"], "banner": info["banner"]}))
    else:
        rec("read-only role sees banner, no Add member", vp, info["banner"] and not info["add"], json.dumps({"add": info["add"], "banner": info["banner"]}))
    return info


def search(p, vp):
    s = p.locator('[data-testid="team-search"]:visible')
    if not s.count():
        rec("search present", vp, False, "not visible")
        return
    total = p.locator('[data-testid^="team-member-"]:visible').count()
    for q, note in (("priya", "name"), ("sharma.com", "email"), ("production", "role"), ("zzqq", "no match")):
        s.fill(q)
        p.wait_for_timeout(500)
        n = p.locator('[data-testid^="team-member-"]:visible').count()
        head = p.evaluate("()=>{const h=[...document.querySelectorAll('h2')].find(e=>/Members/.test(e.textContent)); return h&&h.nextElementSibling?h.nextElementSibling.textContent:null}")
        empty = p.locator('[data-testid="team-empty"]:visible')
        et = empty.inner_text().strip() if empty.count() else ""
        ok = (n == 0 and bool(et)) if note == "no match" else (0 < n < total or (note == "email" and n > 0))
        rec(f"search by {note} '{q}'", vp, ok, f"{n} of {total} cards, header '{head}'" + (f", empty state '{et}'" if et else ""))
    s.fill("")
    p.wait_for_timeout(400)
    rec("clearing search restores roster", vp, p.locator('[data-testid^="team-member-"]:visible').count() == total, "")


def profile_checks(p, vp, shots, owner=True, mobile=False):
    cards = p.locator('[data-testid^="team-member-"]:visible')
    n = cards.count()
    opened, failed = 0, []
    for i in range(n):
        close_all(p)
        c = cards.nth(i)
        c.scroll_into_view_if_needed()
        c.click()
        p.wait_for_timeout(700)
        if dialogs(p):
            opened += 1
        else:
            failed.append(c.get_attribute("aria-label"))
    close_all(p)
    rec("every card opens its profile", vp, opened == n, f"{opened}/{n}" + (f" failed {failed}" if failed else ""))

    # pick a non-owner member with a phone, if any, else first non-owner
    target = p.evaluate("""async () => { const r = await fetch('http://localhost:8001/api/users', {headers: {Authorization: 'Bearer ' + (Object.keys(localStorage).filter(k=>/token/i.test(k)).map(k=>localStorage.getItem(k))[0]||'').replace(/"/g,'')}, credentials:'include'});
      if (!r.ok) return null; const us = await r.json(); const me = null;
      const np = us.filter(u=>u.role!=='owner'); const withPhone = np.find(u=>u.phone && /priya/i.test(u.name)) || np.find(u=>u.phone) || np[0];
      return withPhone ? {id: withPhone.id, name: withPhone.name, phone: !!withPhone.phone} : null; }""")
    if not target:
        # the frontend may proxy /api differently; fall back to the first non-owner card by DOM
        el = p.locator('[data-testid^="team-cards-"]:not([data-testid="team-cards-owner"]) [data-testid^="team-member-"]:visible').first
        target = {"id": el.get_attribute("data-testid")[12:], "name": el.get_attribute("aria-label"), "phone": None}
    tid = target["id"]
    card = p.locator(f'[data-testid="team-member-{tid}"]:visible')
    card.scroll_into_view_if_needed()
    card.click()
    p.wait_for_timeout(900)
    inv = p.evaluate(INVENTORY, f'[data-testid="profile-dialog-{tid}"]')
    p.screenshot(path=str(shots / f"{vp}_profile.png"))
    names = [c["name"] for c in inv["ctrls"]]
    rec("profile dialog fits viewport", vp, inv["fits"], f"rect {inv['rect']}, scroll {inv['scroll']}")
    rec("profile controls", vp, None, json.dumps([(c["name"], c["w"], c["h"], c["covered"]) for c in inv["ctrls"]]))
    closes = [x for x in names if x and x.lower() == "close"]
    rec("TM-04 recheck: one Close control", vp, len(closes) == 1, f"Close controls: {len(closes)}")
    small = [(c["name"], c["w"], c["h"]) for c in inv["ctrls"] if (c["w"] < 24 or c["h"] < 24)]
    rec("profile tap targets >= 24px", vp, not small, f"under 24px: {small}")
    has_access = p.locator(f'[data-testid="profile-dialog-{tid}"] >> text=/of \\d+ areas/').count() > 0
    rec("TM-05 recheck: access block visible to this role", vp, (not has_access) if not owner else None,
        f"access block shown={has_access} ({'owner' if owner else 'read-only role'})")
    leave = p.locator(f'[data-testid="member-leave-history-{tid}"]').count() > 0
    rec("leave history on a colleague's profile", vp, leave if owner else (not leave), f"shown={leave}")
    edit = p.locator(f'[data-testid="edit-access-{tid}"]:visible').count()
    invite = p.locator(f'[data-testid="invite-link-{tid}"]:visible').count()
    rec("Edit access / Get invite link visibility", vp, (edit == 1) if owner else (edit == 0 and invite == 0),
        f"edit={edit}, invite={invite}, member has phone={target.get('phone')}")

    # close paths
    x = p.locator(f'[data-testid="profile-dialog-{tid}"] button[aria-label="Close"]:visible')
    if x.count():
        x.first.click()
        p.wait_for_timeout(600)
        rec("custom Close closes profile", vp, dialogs(p) == 0, "")
    card.click()
    p.wait_for_timeout(700)
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)
    rec("Escape closes profile", vp, dialogs(p) == 0, "")
    card.click()
    p.wait_for_timeout(700)
    vs = p.viewport_size
    p.mouse.click(6, vs["height"] - 6)
    p.wait_for_timeout(600)
    rec("click outside closes profile", vp, dialogs(p) == 0, "")
    close_all(p)

    if not mobile:
        card.focus()
        p.keyboard.press("Enter")
        p.wait_for_timeout(700)
        opened_kb = dialogs(p) > 0
        p.keyboard.press("Escape")
        p.wait_for_timeout(700)
        focus_back = p.evaluate("(id)=>document.activeElement && document.activeElement.getAttribute('data-testid')==='team-member-'+id", tid)
        rec("keyboard: Enter opens, focus returns to card on close", vp, opened_kb and focus_back,
            f"opened={opened_kb}, focus back on card={focus_back}")

    if owner:
        edit_access(p, vp, shots, tid, card)
        if target.get("phone"):
            card.click()
            p.wait_for_timeout(700)
            btn = p.locator(f'[data-testid="invite-link-{tid}"]:visible')
            if btn.count():
                before = toasts(p)
                btn.click()
                t = wait_toast(p, before)
                rec("Get invite link (write blocked, no token minted)", vp, None,
                    f"toast {t}; invite modal opened={p.locator('[data-testid=\"invite-link-modal\"]').count() > 0}")
            close_all(p)
    return tid


def edit_access(p, vp, shots, tid, card):
    close_all(p)
    card.click()
    p.wait_for_timeout(700)
    e = p.locator(f'[data-testid="edit-access-{tid}"]:visible')
    if not e.count():
        rec("Edit access opens", vp, False, "no Edit access button")
        return
    e.click()
    p.wait_for_timeout(900)
    n = dialogs(p)
    title = p.evaluate("()=>{const ds=[...document.querySelectorAll('[role=dialog][data-state=open]')]; const d=ds[ds.length-1]; return d&&d.querySelector('h2')?d.querySelector('h2').textContent:null}")
    rec("Edit access opens on top of profile", vp, n >= 1 and bool(title) and "Edit access" in title, f"open dialogs {n}, title '{title}'")
    inv = p.evaluate(INVENTORY, DLG)
    p.screenshot(path=str(shots / f"{vp}_edit_access.png"))
    rec("edit dialog fits viewport", vp, inv["fits"], f"rect {inv['rect']}, scroll {inv['scroll']}")
    save = [c for c in inv["ctrls"] if c["testid"] == "member-save-submit"]
    rec("Save access reachable without scrolling", vp, bool(save) and save[0]["covered"] is not None,
        f"save {[(s['w'], s['h'], s['covered']) for s in save]} (covered=None means off-screen)")

    # toggle each permission and check aria-pressed flips + menu preview follows
    perms = p.locator(f'{DLG} [data-testid^="perm-"]:visible')
    flips = bad = 0
    for i in range(perms.count()):
        b = perms.nth(i)
        a = b.get_attribute("aria-pressed")
        b.click()
        p.wait_for_timeout(120)
        if b.get_attribute("aria-pressed") != a:
            flips += 1
        else:
            bad += 1
        b.click()
        p.wait_for_timeout(120)
    rec("every permission toggle flips aria-pressed and back", vp, bad == 0 and flips > 0, f"{flips} flipped, {bad} did not")
    pv = {}
    for perm, label in (("people", "People"), ("brain", "Company Brain"), ("data_input", "Capture"), ("workflows", "Workflows"), ("inbox", "Decision Desk")):
        b = p.locator(f'{DLG} [data-testid="perm-{perm}"]')
        chip = p.locator(f'{DLG} [data-testid="preview-{label}"]')
        if not b.count() or not chip.count():
            pv[perm] = "missing"
            continue
        before = "line-through" in (chip.get_attribute("class") or "")
        b.click()
        p.wait_for_timeout(150)
        after = "line-through" in (chip.get_attribute("class") or "")
        b.click()
        p.wait_for_timeout(150)
        pv[perm] = before != after
    rec("menu preview follows the permission toggles", vp, all(v is True for v in pv.values()), json.dumps(pv))

    # role -> owner shows the note; saving asks for confirmation
    sel = p.locator(f'{DLG} [data-testid="member-role-select"]')
    opts = sel.evaluate("s=>[...s.options].map(o=>o.value)")
    rec("role options", vp, None, f"{opts}")
    if "owner" in opts:
        sel.select_option("owner")
        p.wait_for_timeout(300)
        note = p.locator(f'{DLG} [data-testid="owner-access-note"]:visible').count()
        rec("choosing Owner swaps the grid for the full-access note", vp, note == 1, f"note={note}")
        seen = []
        p.once("dialog", lambda d: (seen.append(d.message[:80]), d.dismiss()))
        p.locator(f'{DLG} [data-testid="member-save-submit"]').click()
        p.wait_for_timeout(700)
        rec("promoting to Owner asks for confirmation (dismissed)", vp, bool(seen), f"confirm text: {seen}")
        orig = [o for o in opts if o != "owner"][0]
        sel.select_option(orig)
        p.wait_for_timeout(200)
    before = toasts(p)
    p.locator(f'{DLG} [data-testid="member-save-submit"]').click()
    t = wait_toast(p, before)
    rec("Save access with the write blocked shows an error, dialog stays", vp, bool(t) and dialogs(p) >= 1, f"toast {t}, dialogs open {dialogs(p)}")
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)
    rec("Escape from Edit access returns to the profile (not both closed)", vp, dialogs(p) == 1, f"dialogs open after one Escape: {dialogs(p)}")
    close_all(p)


def add_member(p, vp, shots, mobile=False):
    close_all(p)
    b = p.locator('[data-testid="add-user-button"]:visible')
    b.scroll_into_view_if_needed()
    b.click()
    p.wait_for_timeout(900)
    inv = p.evaluate(INVENTORY, DLG)
    p.screenshot(path=str(shots / f"{vp}_add_member.png"))
    rec("Add member opens", vp, inv is not None and inv["title"] == "Add team member", f"title '{inv and inv['title']}', rect {inv and inv['rect']}, scroll {inv and inv['scroll']}")
    save = [c for c in inv["ctrls"] if c["testid"] == "member-save-submit"]
    rec("Add button visible without scrolling", vp, bool(save) and save[0]["covered"] is not None,
        f"dialog scrollHeight/clientHeight {inv['scroll']}; Add covered={save[0]['covered'] if save else 'n/a'}")
    small = [(c["name"], c["w"], c["h"]) for c in inv["ctrls"] if c["h"] < 24 or c["w"] < 24]
    rec("add-member tap targets >= 24px", vp, not small, f"under 24px: {small}")

    D = DLG
    submit = p.locator(f'{D} [data-testid="member-save-submit"]')

    def press(label):
        before = toasts(p)
        submit.scroll_into_view_if_needed()
        submit.click()
        return wait_toast(p, before)

    t = press("empty")
    rec("empty submit -> 'Name and email are required'", vp, any("required" in x.lower() for x in t), f"toast {t}")
    p.locator(f'{D} [data-testid="member-name-input"]').fill("Audit Person")
    p.locator(f'{D} [data-testid="member-email-input"]').fill("audit.person@example.com")
    p.locator(f'{D} [data-testid="member-password-input"]').fill("123")
    t = press("short pw")
    rec("short password -> 6+ char message", vp, any("6+" in x for x in t), f"toast {t}")

    # login method toggle
    p.locator(f'{D} [data-testid="login-method-otp"]').click()
    p.wait_for_timeout(250)
    pw_vis = p.locator(f'{D} [data-testid="member-password-input"]:visible').count()
    hint = p.locator(f'{D} [data-testid="passwordless-hint"]:visible').count()
    ph = p.locator(f'{D} [data-testid="member-phone-input"]').get_attribute("placeholder")
    pressed = [p.locator(f'{D} [data-testid="login-method-{k}"]').get_attribute("aria-pressed") for k in ("password", "otp")]
    rec("Mobile OTP hides password, shows hint, marks phone required", vp, pw_vis == 0 and hint == 1 and "required" in (ph or ""),
        f"password visible={pw_vis}, hint={hint}, phone placeholder '{ph}'")
    rec("TM-01 recheck: login toggle exposes aria-pressed", vp, pressed != [None, None], f"aria-pressed {pressed}")
    p.locator(f'{D} [data-testid="member-phone-input"]').fill("98765")
    t = press("short phone")
    rec("OTP with short phone -> valid mobile message", vp, any("mobile" in x.lower() for x in t), f"toast {t}")
    p.locator(f'{D} [data-testid="login-method-password"]').click()
    p.wait_for_timeout(250)
    ph2 = p.locator(f'{D} [data-testid="member-phone-input"]').get_attribute("placeholder")
    rec("switching back to Password restores the password field", vp,
        p.locator(f'{D} [data-testid="member-password-input"]:visible').count() == 1, f"phone placeholder now '{ph2}'")

    # labels (TM-06 recheck)
    unlabelled = p.evaluate("""(sel)=>{const ds=[...document.querySelectorAll(sel)]; const d=ds[ds.length-1];
      return [...d.querySelectorAll('input,select')].filter(e=>e.getBoundingClientRect().width>0)
        .filter(e=>!(e.labels&&e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby'))
        .map(e=>e.getAttribute('data-testid'))}""", D)
    rec("TM-06 recheck: every field has a programmatic label", vp, not unlabelled, f"unlabelled: {unlabelled}")

    # role defaults
    sel = p.locator(f'{D} [data-testid="member-role-select"]')
    roles = [o for o in sel.evaluate("s=>[...s.options].map(o=>o.value)") if o != "owner"]
    defaults = {}
    for r in roles:
        sel.select_option(r)
        p.wait_for_timeout(150)
        defaults[r] = p.locator(f'{D} [data-testid^="perm-"][aria-pressed="true"]').count()
    rec("role change applies that role's default access", vp, len(set(defaults.values())) > 1 or len(defaults) <= 1, json.dumps(defaults))
    mgr = p.locator(f'{D} [data-testid="member-manager-select"] option').count()
    rec("reporting manager list", vp, mgr > 1, f"{mgr} options (incl. None)")

    p.locator(f'{D} [data-testid="member-password-input"]').fill("audit123")
    sel.select_option(roles[0])
    t = press("valid")
    rec("valid Add with the write blocked -> error toast, dialog stays open", vp, bool(t) and dialogs(p) == 1, f"toast {t}, open={dialogs(p)}")
    # does closing and reopening clear the half-filled form?
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)
    b.click()
    p.wait_for_timeout(800)
    name_val = p.locator(f'{DLG} [data-testid="member-name-input"]').input_value()
    rec("reopening Add member starts blank", vp, name_val == "", f"name field '{name_val}'")
    close_all(p)


def desktop_scroll(p, vp):
    p.goto(f"{BASE}/team", wait_until="domcontentloaded")
    p.wait_for_timeout(3000)
    before = p.evaluate("()=>({doc: document.scrollingElement.scrollTop, main: (document.querySelector('main')||{}).scrollTop||0})")
    p.mouse.move(700, 600)
    p.mouse.wheel(0, 1600)
    p.wait_for_timeout(900)
    after = p.evaluate("""()=>{const m=document.querySelector('main'); const h=[...document.querySelectorAll('h1')].find(e=>/Team/.test(e.textContent));
      const hr = h ? h.getBoundingClientRect() : null;
      return {doc: document.scrollingElement.scrollTop, main: m?m.scrollTop:0, mainScrollable: m? m.scrollHeight>m.clientHeight : null,
              heading_top: hr ? Math.round(hr.top) : null,
              lastCardBottom: (()=>{const cs=[...document.querySelectorAll('[data-testid^="team-member-"]')]; const c=cs[cs.length-1]; return c?Math.round(c.getBoundingClientRect().bottom):null})(),
              vh: innerHeight}}""")
    moved = (after["doc"] - before["doc"]) + (after["main"] - before["main"])
    rec("desktop wheel scrolls the roster (7d2fabe layout)", vp, moved > 0,
        f"doc {before['doc']}->{after['doc']}, main {before['main']}->{after['main']}, heading top {after['heading_top']}, last card bottom {after['lastCardBottom']} / vh {after['vh']}")
    p.mouse.wheel(0, 6000)
    p.wait_for_timeout(900)
    end = p.evaluate("()=>{const cs=[...document.querySelectorAll('[data-testid^=\"team-member-\"]')]; const c=cs[cs.length-1]; return c?Math.round(c.getBoundingClientRect().bottom):null}")
    rec("last member card reachable by scrolling", vp, end is not None and end <= p.viewport_size["height"], f"last card bottom {end} / vh {p.viewport_size['height']}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for role, vp, size, mobile in (
            ("owner", "desk1440", {"width": 1440, "height": 900}, False),
            ("owner", "mob390", {"width": 390, "height": 844}, True),
            ("sales", "sales1440", {"width": 1440, "height": 900}, False),
            ("sales", "salesmob", {"width": 390, "height": 844}, True),
        ):
            print(f"\n=== {role} @ {vp} ===")
            ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
            p = ctx.new_page()
            p.on("console", lambda m, vp=vp: m.type == "error" and errors.append((vp, m.text[:160])))
            p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:160])))
            demo_login(p, BASE, role)
            blocked = []
            p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                    if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
            owner = role == "owner"
            roster(p, vp, OUT, owner)
            search(p, vp)
            profile_checks(p, vp, OUT, owner, mobile)
            if owner:
                add_member(p, vp, OUT, mobile)
            if not mobile and owner:
                desktop_scroll(p, vp)
            rec("writes blocked", vp, None, f"{len(blocked)}: {sorted(set(blocked))}")
            ctx.close()
        b.close()
    print("\n=== console errors ===")
    for e in sorted(set(errors)):
        print("  ", e)
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": sorted(set(errors))}, indent=2), encoding="utf-8")
    print(f"\n{sum(r['ok'] is True for r in results)} pass, {sum(r['ok'] is False for r in results)} fail, {sum(r['ok'] is None for r in results)} info")


if __name__ == "__main__":
    main()
