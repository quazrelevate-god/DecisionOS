import {
  Inbox,
  Sunrise,
  Briefcase,
  CalendarDays,
  FileUp,
  AudioLines,
  NotebookPen,
  Users,
  Wallet,
  Brain,
  Gauge,
  Compass,
  Settings2,
  PieChart,
  LayoutGrid,
} from "lucide-react";

import { hasPerm } from "./perms";

/* ============================================================================
   Information architecture
   ----------------------------------------------------------------------------
   The old sidebar was a flat list of nine unrelated destinations, so nothing
   told you what the product was actually for. The structure mirrors the
   operating loop the product itself describes:

       Today     — what needs you right now
       Capture   — everything flowing in
       Business  — the records that accumulate
       Workspace — how the company is running, and your setup

   This module is the single source of truth. The desktop sidebar, the mobile
   launcher grid and the command palette all read from it, so a route can never
   appear in one surface and be missing from another.

   `short` gives compact surfaces (the launcher grid) a label that fits a
   square tile without wrapping to three lines.

   Icons come from lucide — a thin, geometric family chosen to replace the
   heavier Phosphor set the old UI used.
   ========================================================================== */

export const NAV_GROUPS = [
  {
    id: "today",
    tkey: "navgroup.today",
    label: "Today",
    items: [
      // `/` redirects authenticated users straight to `/inbox`, so the nav must
      // point at the real URL or the active state can never match.
      { to: "/inbox", label: "Decision Desk", short: "Desk", tkey: "nav.inbox", icon: Inbox, testid: "nav-inbox", perm: "inbox" },
      { to: "/brief", label: "CEO Brief", short: "Brief", tkey: "nav.brief", icon: Sunrise, testid: "nav-ceo-brief", badge: "fires" },
      { to: "/my-work", label: "My Work", short: "Work", tkey: "nav.mywork", icon: Briefcase, testid: "nav-my-work" },
      { to: "/calendar", label: "Calendar", tkey: "nav.calendar", icon: CalendarDays, testid: "nav-calendar" },
    ],
  },
  {
    id: "capture",
    tkey: "navgroup.capture",
    label: "Capture",
    items: [
      { to: "/ingest", label: "Documents & Data", short: "Docs", tkey: "nav.capture", icon: FileUp, testid: "nav-ingest", perm: "data_input", badge: "captures" },
      { to: "/meetings", label: "Meeting Notes", short: "Meetings", tkey: "nav.meetings", icon: AudioLines, testid: "nav-meetings" },
      { to: "/journal", label: "Journal", tkey: "nav.journal", icon: NotebookPen, testid: "nav-journal", ownerOnly: true },
    ],
  },
  {
    id: "business",
    tkey: "navgroup.business",
    label: "Business",
    items: [
      { to: "/contacts", label: "People", tkey: "nav.people", icon: Users, testid: "nav-contacts", perm: "people" },
      { to: "/ledger", label: "Finance", tkey: "nav.finance", icon: Wallet, testid: "nav-ledger", perms: ["ledger", "finance"] },
      { to: "/brain", label: "Company Brain", short: "Brain", tkey: "nav.brain", icon: Brain, testid: "nav-brain", perm: "brain" },
    ],
  },
  {
    id: "workspace",
    tkey: "navgroup.workspace",
    label: "Workspace",
    items: [
      { to: "/operating-score", label: "Operating Score", short: "Score", tkey: "nav.score", icon: Gauge, testid: "nav-operating-score", ownerOnly: true },
      { to: "/coach", label: "Work Coach", short: "Coach", tkey: "nav.coach", icon: Compass, testid: "nav-coach" },
      { to: "/settings", label: "Settings", tkey: "nav.settings", icon: Settings2, testid: "nav-settings", ownerOnly: true },
    ],
  },
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

/** Matches a pathname to its nav item so chrome can name the current page. */
export function activeItem(pathname) {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  // `/` is a redirect shim onto the Decision Desk.
  const path = pathname === "/" ? "/inbox" : pathname;
  return all
    .filter((i) => path === i.to || path.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

/**
 * The floating pill at the bottom of every mobile screen, per the reference:
 * four destinations plus a grid key that opens the full launcher. The active
 * item gets a tinted pill behind it.
 */
export const PILL_NAV = [
  { to: "/brief", label: "Brief", icon: PieChart, testid: "pill-brief", accent: "peri" },
  { to: "/inbox", label: "Desk", icon: Inbox, testid: "pill-inbox", perm: "inbox", accent: "butter" },
  { to: "/my-work", label: "Work", icon: Briefcase, testid: "pill-work", accent: "sage" },
  { to: "/ledger", label: "Finance", icon: Wallet, testid: "pill-finance", perms: ["ledger", "finance"], accent: "peri" },
];

export const PILL_LAUNCHER = { label: "All sections", icon: LayoutGrid, testid: "pill-launcher" };
