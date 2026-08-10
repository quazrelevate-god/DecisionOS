import {
  Tray,
  Sun,
  Briefcase,
  CalendarBlank,
  FileArrowUp,
  MicrophoneStage,
  NotePencil,
  AddressBook,
  Wallet,
  Brain as BrainIcon,
  Gauge,
  Compass,
  GearSix,
} from "@phosphor-icons/react";

import { hasPerm } from "./perms";

/* ============================================================================
   Information architecture
   ----------------------------------------------------------------------------
   The old sidebar was a flat list of nine unrelated destinations, so nothing
   told you what the product was actually for. The new structure mirrors the
   operating loop the product itself describes:

       Today     — what needs you right now
       Capture   — everything flowing in
       Business  — the records that accumulate
       Workspace — how the company is running, and your setup

   This module is the single source of truth. The sidebar, the mobile drawer,
   the bottom tab bar and the command palette all read from it, so a route can
   never appear in one surface and be missing from another.
   ========================================================================== */

export const NAV_GROUPS = [
  {
    id: "today",
    tkey: "navgroup.today",
    label: "Today",
    items: [
      // `/` redirects authenticated users straight to `/inbox`, so the nav must
      // point at the real URL or the active state can never match.
      { to: "/inbox", label: "Decision Desk", tkey: "nav.inbox", icon: Tray, testid: "nav-inbox", perm: "inbox" },
      { to: "/brief", label: "CEO Brief", tkey: "nav.brief", icon: Sun, testid: "nav-ceo-brief", badge: "fires" },
      { to: "/my-work", label: "My Work", tkey: "nav.mywork", icon: Briefcase, testid: "nav-my-work" },
      { to: "/calendar", label: "Calendar", tkey: "nav.calendar", icon: CalendarBlank, testid: "nav-calendar" },
    ],
  },
  {
    id: "capture",
    tkey: "navgroup.capture",
    label: "Capture",
    items: [
      { to: "/ingest", label: "Documents & Data", tkey: "nav.capture", icon: FileArrowUp, testid: "nav-ingest", perm: "data_input", badge: "captures" },
      { to: "/meetings", label: "Meeting Notes", tkey: "nav.meetings", icon: MicrophoneStage, testid: "nav-meetings" },
      { to: "/journal", label: "Journal", tkey: "nav.journal", icon: NotePencil, testid: "nav-journal", ownerOnly: true },
    ],
  },
  {
    id: "business",
    tkey: "navgroup.business",
    label: "Business",
    items: [
      { to: "/contacts", label: "People", tkey: "nav.people", icon: AddressBook, testid: "nav-contacts", perm: "people" },
      { to: "/ledger", label: "Finance", tkey: "nav.finance", icon: Wallet, testid: "nav-ledger", perms: ["ledger", "finance"] },
      { to: "/brain", label: "Company Brain", tkey: "nav.brain", icon: BrainIcon, testid: "nav-brain", perm: "brain" },
    ],
  },
  {
    id: "workspace",
    tkey: "navgroup.workspace",
    label: "Workspace",
    items: [
      { to: "/operating-score", label: "Operating Score", tkey: "nav.score", icon: Gauge, testid: "nav-operating-score", ownerOnly: true },
      { to: "/coach", label: "Work Coach", tkey: "nav.coach", icon: Compass, testid: "nav-coach" },
      { to: "/settings", label: "Settings", tkey: "nav.settings", icon: GearSix, testid: "nav-settings", ownerOnly: true },
    ],
  },
];

/**
 * Mobile bottom bar. Four destinations plus the centre capture action — capture
 * is the product's atomic gesture, so on a phone it gets the thumb position
 * rather than being buried inside a page.
 */
export const BOTTOM_NAV = [
  { to: "/inbox", label: "Desk", tkey: "bottomnav.desk", icon: Tray, perm: "inbox", testid: "bottomnav-dashboard" },
  { to: "/brief", label: "Brief", tkey: "bottomnav.brief", icon: Sun, testid: "bottomnav-brief" },
  { to: "/my-work", label: "Work", tkey: "bottomnav.work", icon: Briefcase, testid: "bottomnav-my-work" },
  { to: "/brain", label: "Brain", tkey: "bottomnav.brain", icon: BrainIcon, perm: "brain", testid: "bottomnav-brain" },
];

/** True when this user is allowed to see `item`. */
export function canSee(user, item) {
  if (item.ownerOnly) return user?.role === "owner";
  if (item.perms) return item.perms.some((p) => hasPerm(user, p));
  if (item.perm) return hasPerm(user, item.perm);
  return true;
}

/** Nav groups filtered to what this user may open, dropping empty groups. */
export function visibleGroups(user) {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSee(user, i)) })).filter(
    (g) => g.items.length > 0
  );
}

/** A flat, permission-filtered list — used by the command palette. */
export function visibleItems(user) {
  return visibleGroups(user).flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
}

/** Matches a pathname to its nav item so headers can name the current page. */
export function activeItem(pathname) {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  // `/` is a redirect shim onto the Decision Desk.
  const path = pathname === "/" ? "/inbox" : pathname;
  return all
    .filter((i) => path === i.to || path.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
}
