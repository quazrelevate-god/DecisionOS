// MPWA-03 · FloatingDock — the 4-slot floating pill that replaces the
// edge-to-edge tab bar on mobile.
//
// A pill detached from the screen edges, not a bar welded to the bottom, so
// lists scroll *under* it (§8: every scroll container gets padding-bottom 96px
// — Layout's `pb-dock` does that).
//
// MPWA-12c (§2.1): Desk absorbed Brief, which FREED A SLOT. My Work is promoted
// out of All Apps into it, giving four verbs: decide, do, money, ask.
//   Desk  /inbox    decide — what needs me, in any time scope
//   Work  /my-work  do     — the flow I am running
//   Money /finance  money  — did it move
//   More            everything else
// Q4 (tell someone to do X) is the Dex FAB, a separate circle.
//
// §9: "Do not add a fourth thing to the dock. Four slots plus the FAB,
// permanently." Four is the count, not a starting point.
//
// Active state carries three cues together (§3.5): regular -> fill weight,
// colour change, AND the label. Never colour alone, never an unlabelled icon.
import * as React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Tray, Wallet, DotsThree, Briefcase, AddressBook } from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
import { DexWave } from "./DexWave";
import { cn } from "@/lib/utils";

/**
 * Resolve the dock's destination slots for this user (§8 "Role variance").
 * `More` is always last and is added by the component, not here.
 *   - no `inbox` permission     -> Work takes slot 1
 *   - no finance/ledger access  -> Money is dropped entirely rather than
 *     replaced by a second Work, since nothing may appear twice
 */
export function dockSlots(user, t = (k, d) => d) {
  const canInbox = hasPerm(user, "inbox");
  const canMoney =
    hasPerm(user, "ledger") || hasPerm(user, "finance") || hasPerm(user, "data_input");

  // Without the `inbox` permission there is no Desk to show, so Work takes slot
  // 1 and the dock collapses to three destinations plus More — the dedupe below
  // removes the repeat rather than showing My Work twice.
  const desk = canInbox
    ? { to: "/inbox", label: t("bottomnav.desk", "Desk"), icon: Tray, testid: "dock-desk" }
    : { to: "/my-work", label: t("bottomnav.work", "Work"), icon: Briefcase, testid: "dock-my-work" };

  const work = { to: "/my-work", label: t("bottomnav.work", "Work"), icon: Briefcase, testid: "dock-work" };

  const money = canMoney
    ? { to: "/finance", label: t("bottomnav.money", "Money"), icon: Wallet, testid: "dock-money" }
    : null;

  /* ASK-38 — CRM comes DOWN from More. It was a tile behind the dots, which is
     two taps and a panel for the screen an owner opens to look somebody up;
     the rest of More is genuinely occasional and CRM is not. Same `people`
     permission the tile carried, so nobody gains access by the move. */
  const crm = hasPerm(user, "people")
    ? { to: "/crm", label: t("nav.crm", "CRM"), icon: AddressBook, testid: "dock-crm" }
    : null;

  const slots = [desk, work, money, crm].filter(Boolean);
  // If a permission collapse duplicated My Work, drop the repeat rather than
  // showing the same destination twice — §8: nothing appears in two places.
  const seen = new Set();
  return slots.filter((s) => (seen.has(s.to) ? false : seen.add(s.to)));
}

function DockItem({ to, label, icon: Icon, testid, active, onClick }) {
  /* KM-49 — THE SELECTED SLOT IS FLAT, and it is an INDICATOR rather than a
     treatment of the whole slot. Founder: "the neumorphic styled option is not
     nice in the bottom fab bar so make it a usual materialistic flat style menu
     selection design." KM-32's inset pair made a 56px slot look dented, and
     depth is the app's grammar for a CONTROL you push, not for where you are.

     ASK-39 — EVERY SLOT IS NAMED, and the pill goes back behind the ICON only.
     ASK-37 put the label inside the live pill and left the rest as icons, on
     the founder's reference. Their call now is the opposite and it is the
     better one at five slots: an unlabelled icon is a guess, and four guesses
     beside one word is a worse bar than five words. It also retires the whole
     measure-and-yield apparatus ASK-38 needed — with every slot the same shape
     there is nothing left to overflow, so "Money" cannot push "Desk" into an
     ellipsis and the bar needs no ResizeObserver to know it.

     DECLUTTERED means the two lines are one object: the icon sits in a 24px
     pill that is the indicator, the label sits directly under it, and the gap
     between them is 2px rather than the 4 a stacked pair defaults to — close
     enough to read as one control, not an icon with a caption. */
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "grid h-6 w-11 place-items-center rounded-pill transition-colors duration-200",
          active ? "bg-white/[.22]" : "bg-transparent"
        )}
      >
        <Icon size={20} weight={active ? "fill" : "regular"} />
      </span>
      <span className="max-w-full truncate text-[length:var(--text-label)] font-semibold leading-none">
        {label}
      </span>
    </>
  );
  // .dock-item carries the >= 56x56 sizing (§8) — see index.css for why it is a
  // class rather than Tailwind min-w/min-h utilities. --dock-item-min drops the
  // WIDTH to the 44px floor MPWA-01 §5.1 requires, because five slots and five
  // words do not fit five 56px boxes on a 360px phone; the height is untouched.
  const cls = cn(
    "dock-item flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "text-white" : "text-white/55 hover:text-white/80"
  );
  const common = {
    style: { "--dock-item-min": "2.75rem" },
    "data-testid": testid,
    "data-active": active ? "true" : undefined,
    className: cls,
    "aria-current": active ? "page" : undefined,
  };
  if (onClick) {
    return <button type="button" onClick={onClick} {...common}>{content}</button>;
  }
  return <NavLink to={to} {...common}>{content}</NavLink>;
}

/**
 * @param {object}   user
 * @param {Function} onMore     opens AllAppsPanel
 * @param {boolean}  moreOpen
 * @param {number}   [moreBadge] count of items needing him behind More (caps at 9)
 * @param {"ask"|"decide"|null} [dexChannel] which Dex the bar is serving, for its
 *        placeholder — the FAB opens Ask, the Desk's Dex well hands over a Decide
 */
export function FloatingDock({
  user, onMore, moreOpen = false, moreBadge = 0,
  dexActive = false, dexLevels = [], dexLevelsRef, dexMode = "voice", dexWaveState = "idle",
  dexDraft = "", onDexDraft, onDexSubmit, dexTranscribing = false, dexChannel = null,
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const slots = React.useMemo(() => dockSlots(user, t), [user, t]);

  /* KM-7 — publish the bar's measured width as --app-dock-w so the More panel
     can be EXACTLY as wide as it. The bar is w-fit and its slot count varies
     by role (dockSlots drops Money without finance access), so any constant
     the panel hard-coded would be right for owners and wrong for everyone
     else. Measured, not guessed, and re-measured on resize. */
  const barRef = React.useRef(null);
  React.useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--app-dock-w", `${Math.round(el.getBoundingClientRect().width)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slots.length]);

  const isActive = (to) =>
    to === "/inbox"
      ? location.pathname === "/inbox" || location.pathname === "/"
      : location.pathname.startsWith(to);


  return (
    <nav
      // lg:hidden — desktop keeps its sidebar, untouched (§8).
      // MPWA-14: `app-dock-left` anchors to the centred shell's left edge, so on
      // a wide display the pill hugs the column instead of the viewport corner.
      // On a phone the offset collapses to the original 1rem.
      className="lg:hidden fixed app-dock-left app-dock-right z-[10000] bottom-safe-4"
      data-testid="floating-dock"
      data-mobile-chrome=""
      aria-label={t("nav.primary", "Primary")}
    >
      <div
        ref={barRef}
        className={cn(
          // KR-14.3 · GLASS DOCK — the pill widens edge-to-edge (via
          // `app-dock-right` also anchoring the right side) and takes a
          // frosted-ink material: a translucent ink fill layered with a heavy
          // backdrop-blur so the bloom softly shows through. A hairline top
          // border and inner highlight sell it as glass rather than paint.
          /* KM-32 — taller (h-16 -> h-[4.5rem]) so the sheet's cards clear the
             FAB instead of sliding under it, and a WARM-WHITE rim: a lit 1px
             edge plus a soft outer halo in the same warm white. That is the
             glow the founder liked in the reference — theirs was blue, and blue
             is not in this palette. */
          /* ASK-38 — px-2 and gap-0.5, down from px-3 and gap-1: CRM makes a
             fifth slot and the bar's own chrome is where the width came from.
             ASK-39 — A SQUIRCLE, not a pill. `rounded-pill` on a 72px bar is a
             36px end cap, which is a lozenge; the founder wants a rounded
             rectangle. --radius-card (28px) is the app's own largest corner and
             at this height it reads as the squircle they asked for without
             becoming a capsule. The Dex FAB takes the same value, so the two
             objects on this baseline are cut to one shape. */
          "flex h-[4.5rem] w-full items-stretch justify-around gap-0.5 rounded-[var(--radius-card)] px-2",
          "bg-kr-ink/55 backdrop-blur-2xl backdrop-saturate-150",
          "border border-[hsl(40_30%_92%/.28)]",
          "shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_0_hsl(40_40%_96%/.22),0_0_20px_-4px_hsl(40_35%_92%/.30)]",
          "max-[359px]:h-16"
        )}
      >
        {/* KM-26 — WHILE DEX IS OPEN THIS BAR *IS* DEX.
            The four destinations step aside and the bar becomes the voice
            surface or the text field, by mode. KM-23 drew a SECOND rounded bar
            above this one to do the same job; the founder's correction was
            that the app already has a bar in exactly the right place with
            exactly the right material, so it should do the work rather than be
            duplicated. py-2 is the "adequate spacing above and below" so the
            ribbons never touch the pill's edge. */}
        {dexActive ? (
          /* KM-51 — the field also appears when there is a DRAFT, whatever the
             mode. After a voice capture the transcript lands here as a preview:
             the founder reads back what Dex heard, edits it if it is wrong, and
             only then presses send. Previously voice mode could only ever draw
             the wave, so a stopped recording had nowhere to be shown. */
          /* KM-53 also shows the field WHILE TRANSCRIBING. Founder: "when the
             voice is getting transcribed, in that meantime I should see
             thinking or transcribing text in the text field, but it's just
             blank." It was blank because the field only appeared once a draft
             existed, and the draft is the very thing being waited for — so the
             one moment that needed a progress signal was the one moment with
             nothing on screen. */
          (dexMode === "type" || dexDraft || dexTranscribing) ? (
            <input
              /* Not while transcribing: the field mounts on its own there, and
                 autoFocus would throw the keyboard up over a read-only box the
                 founder is only meant to be watching. */
              autoFocus={dexMode === "type"}
              data-testid="dock-dex-input"
              value={dexDraft}
              /* Read-only until the transcript lands, because it ARRIVES as a
                 setDraft that replaces the field wholesale — anything typed in
                 the gap would vanish without trace. */
              readOnly={dexTranscribing}
              onChange={(e) => onDexDraft?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onDexSubmit?.(); } }}
              /* ASK-33.1 — the bar says WHICH Dex it is. One string for both
                 ("Ask Dex, or state a decision…") promised the two doors ASK-33
                 removed: this field is reached by the FAB, which opens Ask, and
                 by the Desk's Dex well handing a decision to the sheet. A
                 decision stated on the Ask side goes to /ask and creates
                 nothing, so the placeholder must not invite one. */
              placeholder={dexTranscribing
                ? t("dex.transcribing", "Transcribing…")
                : dexChannel === "decide"
                  ? t("dex.decidePlaceholder", "Tell Dex what you decided…")
                  : t("dex.askPlaceholder", "Ask Dex anything…")}
              aria-label={dexChannel === "decide" ? "Tell Dex what you decided" : "Ask Dex anything"}
              className={cn(
                "min-w-0 flex-1 bg-transparent px-3 text-sm text-white focus:outline-none",
                /* A status the founder is waiting on should not wear the same
                   grey as a hint they are meant to type over. */
                dexTranscribing
                  ? "animate-pulse placeholder:text-white/75"
                  : "placeholder:text-white/40"
              )}
            />
          ) : (
            <div className="min-w-0 flex-1 px-2 py-2" data-testid="dock-dex-wave">
              <DexWave state={dexWaveState} levels={dexLevels} levelsRef={dexLevelsRef} />
            </div>
          )
        ) : (
          slots.map((s) => (
            <DockItem key={s.to} {...s} active={isActive(s.to)} />
          ))
        )}
        <div className={cn("relative", dexActive && "hidden")}>
          <DockItem
            to="#more"
            label={t("bottomnav.more", "More")}
            icon={DotsThree}
            testid="dock-more"
            active={moreOpen}
            onClick={onMore}
          />
          {moreBadge > 0 && (
            <span
              data-testid="dock-more-badge"
              aria-label={`${moreBadge} items need you`}
              className="pointer-events-none absolute right-0 top-0 grid h-5 min-w-5 place-items-center rounded-pill bg-kr-accent px-1 text-[length:var(--text-label)] font-bold leading-none text-white"
            >
              {Math.min(9, moreBadge)}
            </span>
          )}
        </div>
      </div>
    </nav>
  );
}

export default FloatingDock;
