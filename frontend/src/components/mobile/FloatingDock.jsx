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
import { Tray, Wallet, DotsThree, Briefcase } from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
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

  const slots = [desk, work, money].filter(Boolean);
  // If a permission collapse duplicated My Work, drop the repeat rather than
  // showing the same destination twice — §8: nothing appears in two places.
  const seen = new Set();
  return slots.filter((s) => (seen.has(s.to) ? false : seen.add(s.to)));
}

function DockItem({ to, label, icon: Icon, testid, active, onClick }) {
  const content = (
    <>
      <Icon size={22} weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span className="text-[length:var(--text-label)] font-semibold leading-4">{label}</span>
    </>
  );
  // .dock-item carries the >= 56x56 sizing (§8) — see index.css for why it is
  // a class rather than Tailwind min-w/min-h utilities.
  const cls = cn(
    "dock-item flex flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    // On ink: active = full white, inactive = white at 55%. Colour alone is
    // never the only cue — fill weight + label carry it too (§3.5 held).
    active ? "text-white" : "text-white/55 hover:text-white/80"
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-testid={testid} className={cls} aria-current={active ? "page" : undefined}>
        {content}
      </button>
    );
  }
  return (
    <NavLink to={to} data-testid={testid} className={cls} aria-current={active ? "page" : undefined}>
      {content}
    </NavLink>
  );
}

/**
 * @param {object}   user
 * @param {Function} onMore     opens AllAppsPanel
 * @param {boolean}  moreOpen
 * @param {number}   [moreBadge] count of items needing him behind More (caps at 9)
 */
export function FloatingDock({ user, onMore, moreOpen = false, moreBadge = 0 }) {
  const { t } = useTranslation();
  const location = useLocation();
  const slots = React.useMemo(() => dockSlots(user, t), [user, t]);

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
      className="lg:hidden fixed app-dock-left z-[10000] bottom-safe-4"
      data-testid="floating-dock"
      aria-label={t("nav.primary", "Primary")}
    >
      <div
        className={cn(
          // KR-5: the dock takes the BAND's material — an ink pill, the one
          // Karma object that reads instantly against the greige bloom. Still
          // deliberately not a recipe class: this and the FAB are the two
          // controls the founder must find without looking.
          "flex h-16 items-center gap-1 rounded-pill bg-kr-ink px-2",
          "backdrop-blur-xl",
          "max-[359px]:h-[3.25rem]"
        )}
      >
        {slots.map((s) => (
          <DockItem key={s.to} {...s} active={isActive(s.to)} />
        ))}
        <div className="relative">
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
