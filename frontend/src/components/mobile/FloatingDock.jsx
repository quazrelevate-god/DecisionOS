// MPWA-03 · FloatingDock — the 4-slot floating pill that replaces the
// edge-to-edge tab bar on mobile.
//
// A pill detached from the screen edges, not a bar welded to the bottom, so
// lists scroll *under* it (§8: every scroll container gets padding-bottom 96px
// — Layout's `pb-dock` does that).
//
// Slots are chosen against §2's four questions — the destinations the owner
// switches *between* all day, not the ones he visits occasionally:
//   Desk  /inbox    Q2 what's stuck on me      ~8x/day
//   Brief /brief    Q1 anything on fire        every open
//   Money /finance  Q3 did money move          ~4x/day
//   More            everything else
// Q4 (tell someone to do X) is the Dex FAB, a separate circle.
//
// Active state carries three cues together (§3.5): regular -> fill weight,
// colour change, AND the label. Never colour alone, never an unlabelled icon.
import * as React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Tray, Newspaper, Wallet, DotsThree, Briefcase } from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
import { cn } from "@/lib/utils";

/**
 * Resolve the three permanent slots for this user (§8 "Role variance").
 * Slots 2 and 4 never change.
 *   - no `inbox` permission     -> My Work in slot 1 instead of Desk
 *   - no finance/ledger access  -> My Work in slot 3 instead of Money
 */
export function dockSlots(user, t = (k, d) => d) {
  const canInbox = hasPerm(user, "inbox");
  const canMoney =
    hasPerm(user, "ledger") || hasPerm(user, "finance") || hasPerm(user, "data_input");

  const desk = canInbox
    ? { to: "/inbox", label: t("bottomnav.desk", "Desk"), icon: Tray, testid: "dock-desk" }
    : { to: "/my-work", label: t("bottomnav.work", "Work"), icon: Briefcase, testid: "dock-my-work" };

  // §3.5 known collision: Sun was doing duty for /brief AND the Desk's "Due
  // Today" chip while the header used a moon for dark mode — three meanings,
  // two glyphs. /brief takes a document glyph; Sun stays with Due Today only.
  const brief = { to: "/brief", label: t("bottomnav.brief", "Brief"), icon: Newspaper, testid: "dock-brief" };

  const money = canMoney
    ? { to: "/finance", label: t("bottomnav.money", "Money"), icon: Wallet, testid: "dock-money" }
    : { to: "/my-work", label: t("bottomnav.work", "Work"), icon: Briefcase, testid: "dock-my-work-alt" };

  const slots = [desk, brief, money];
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
    active ? "text-primary" : "text-neutral-500 hover:text-foreground"
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
      className="lg:hidden fixed left-4 z-[10000] bottom-safe-4"
      data-testid="floating-dock"
      aria-label={t("nav.primary", "Primary")}
    >
      <div
        className={cn(
          "flex h-16 items-center gap-1 rounded-pill border border-border bg-card px-2",
          "shadow-brutal-lg backdrop-blur-xl",
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
              className="pointer-events-none absolute right-0 top-0 grid h-5 min-w-5 place-items-center rounded-pill bg-danger-600 px-1 text-[length:var(--text-label)] font-bold leading-none text-white"
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
