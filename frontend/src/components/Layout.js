import { useEffect, useState, useMemo } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { hasPerm } from "../lib/perms";
import { Wordmark } from "./Wordmark";
import { toast } from "sonner";
import api from "../lib/api";
import { timeAgo } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { Chip } from "./common";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Brain as BrainIcon,
  AddressBook,
  SignOut,
  Bell,
  Sun,
  MoonStars,
  Briefcase,
  GearSix,
  Tray,
  Wallet,
  Gauge, // Epic 2 E2-15: Ops nav entry (Operating Score)
  UsersThree, // Epic 2 E2-01: Team nav entry (Employees list)
} from "@phosphor-icons/react";
import { ProfileDialog } from "./ProfileDialog";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { WelcomeOverlay } from "./WelcomeOverlay";
// MPWA-03: mobile navigation is the floating dock + All Apps panel. The
// edge-to-edge tab bar and the hamburger drawer are both gone below lg.
import { FloatingDock } from "./mobile/FloatingDock";
import { AllAppsPanel } from "./mobile/AllAppsPanel";
import { DexFab } from "./mobile/DexFab";
import { DexSheet } from "./mobile/DexSheet";
import { BottomSheet } from "./mobile/BottomSheet";
import { InstallPrompt } from "./mobile/InstallPrompt";

// Epic 2 Sprint A (E2-01 / E2-02 / E2-15): People retired; CRM (customers +
// suppliers) and Team (employees) are separate top-level entries. Ops is a
// new owner-only shortcut to Operating Score (removed from Brief in E2-11).
const NAV = [
  { to: "/", label: "Decision Desk", tkey: "inbox", icon: Tray, testid: "nav-inbox", perm: "inbox" },
  // Epic 2 Sprint 6 (E2-47): 'CEO Brief' merged into Desk header. Nav
  // entry retired; /brief URL redirects to /inbox in App.js.
  // { to: "/brief", label: "CEO Brief", tkey: "brief", icon: Sun, testid: "nav-ceo-brief" },
  { to: "/my-work", label: "My Work", tkey: "mywork", icon: Briefcase, testid: "nav-my-work" },
  { to: "/operating-score", label: "Ops", tkey: "ops", icon: Gauge, testid: "nav-ops", ownerOnly: true },
  { to: "/crm", label: "CRM", tkey: "crm", icon: AddressBook, testid: "nav-crm", perm: "people" },
  { to: "/team", label: "Team", tkey: "team", icon: UsersThree, testid: "nav-team", perms: ["team_manage"] },
  // Epic 2 Sprint 5 (E2-32): 'Company Brain' -> 'Dex' (single AI persona).
  // Route stays /brain for bookmark safety; /dex is an alias in App.js.
  { to: "/brain", label: "Dex", tkey: "brain", icon: BrainIcon, testid: "nav-brain", perm: "brain" },
  // Epic 2 Sprint 4 (E2-27): 'Capture' nav retired; Finance is now the
  // single home for money + document capture. Route rename /ledger -> /finance.
  { to: "/finance", label: "Finance", tkey: "finance", icon: Wallet, testid: "nav-ledger", perms: ["ledger", "finance", "data_input"] },
  // Epic 2 Sprint 3 (E2-31): 'Meeting Notes' hidden from sidebar per
  // founder ask 2026-08-14 ('we are not going use in this phase').
  // Meetings.js + /api/meetings endpoints stay alive for a future
  // re-enable; the route redirects to / in App.js.
  // { to: "/meetings", label: "Meeting Notes", tkey: "meetings", icon: MicrophoneStage, testid: "nav-meetings" },
  { to: "/settings", label: "Settings", tkey: "settings", icon: GearSix, testid: "nav-settings", ownerOnly: true },
];

// MPWA-03 (§8): BOTTOM_NAV is retired. The mobile 5-item tab bar put CRM and
// My Work in slots the owner rarely flips between, and left Money — the
// second-most-consulted screen for an MSME owner — two taps deep in a drawer.
// Slots now live in FloatingDock (Desk · Work · Money · More) with Dex as the
// FAB; everything else is in AllAppsPanel.
//
// Epic 2 Sprint 6 (E2-47) reached the same place from the other side: it retired
// the Brief slot and took the bottom nav to four. Both agree the tab bar was
// carrying the wrong things — MPWA-03 replaced the bar itself. This supersedes
// Epic 2's E2-10 bottom-nav rebalance, which was a founder decision.

// MPWA-01: `markOnly` drops the wordmark. The mobile app bar cannot hold the
// full wordmark plus four 44px controls at 390px (it measured 407 > 390 once
// the §5.1 touch floor landed), and §5.2.1 forbids clipping at the right edge.
// Interim — MPWA-03 rebuilds this header down to two controls.
// The supplied lockup, at two sizes. `markOnly` used to mean "the D tile
// without the words" — there is no separate mark in the artwork we were given,
// only the full horizontal lockup, so it now means "the compact size" and the
// mobile app bar shows the whole wordmark rather than a lone letter.
const Logo = ({ markOnly = false }) => <Wordmark size={markOnly ? 15 : 22} />;

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const { t } = useTranslation();
  // NAV/BOTTOM_NAV/hasPerm are stable module-level refs; only `user` can change.
  const navMain = useMemo(() => NAV.filter((n) => {
    if (n.ownerOnly && user?.role !== "owner") return false;
    if (n.perms) return n.perms.some((p) => hasPerm(user, p));
    return !n.perm || hasPerm(user, n.perm);
  }), [user]);
  const navigate = useNavigate();
  const { isDark, toggle: toggleTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  // MPWA-03 mobile navigation state.
  const [allAppsOpen, setAllAppsOpen] = useState(false);
  const [dexOpen, setDexOpen] = useState(false);

  // MPWA-12f: an empty state whose primary action is "tell Dex to start one" has
  // to be able to open the sheet, and the sheet's state lives here. A window
  // event rather than threading a callback through every page: the alternative is
  // a prop on Layout -> page -> list -> EmptyState, four levels deep, for one
  // button. 12i uses the same event across the rest of the empty states.
  useEffect(() => {
    const open = () => setDexOpen(true);
    window.addEventListener("dos:open-dex", open);
    return () => window.removeEventListener("dos:open-dex", open);
  }, []);
  const [dexRecording, setDexRecording] = useState({ on: false, secs: 0 });
  const [langOpen, setLangOpen] = useState(false);
  const { data: notif } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data), refetchInterval: 30000 });
  const unread = notif?.unread || 0;
  // MPWA-03 (§8): the bell counts only what actually needs *him* — approvals,
  // escalations and mentions. A badge that also counted "payment received" and
  // "task done" trained him to ignore it, which is worse than no badge.
  const NEEDS_HIM = /decision|approv|escalat|mention|handoff|nudge/i;
  const bellCount = (notif?.notifications || []).filter(
    (n) => !n.read && NEEDS_HIM.test(n.kind || "")
  ).length;
  const qc = useQueryClient();
  const { data: brief } = useQuery({ queryKey: ["fires-count"], queryFn: () => api.get("/brief?period=morning").then((r) => r.data), refetchInterval: 60000, enabled: user?.role === "owner" });
  const fires = brief?.counters?.fires || 0;
  const { data: capPending } = useQuery({ queryKey: ["captures-pending"], queryFn: () => api.get("/captures/pending-count").then((r) => r.data), refetchInterval: 30000 });
  const captureCount = capPending?.count || 0;

  const openNotif = async (n) => {
    if (!n.read) {
      try { await api.post(`/notifications/${n.id}/read`); qc.invalidateQueries({ queryKey: ["notifications"] }); } catch (e) { console.debug("notif mark-read failed (non-blocking)", e); }
    }
    const to = notifLink(n);
    if (to) navigate(to);
  };

  // `mobile` applies the MPWA-03 header rules — 48px target, and a badge that
  // counts only what needs him, capped at 9. Desktop keeps its 40px button and
  // raw unread count so §9.2's pixel-identical requirement holds.
  const Bellicon = ({ mobile = false }) => {
    const items = (notif?.notifications || []).slice(0, 7);
    const count = mobile ? bellCount : unread;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button data-testid="notif-bell"
            aria-label={count > 0 ? `Notifications, ${count} need you` : "Notifications"}
            className={`relative flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors ${mobile ? "w-12 h-12" : "w-10 h-10"}`}>
            <Bell size={mobile ? 22 : 18} weight="bold" />
            {count > 0 && (
              <span data-testid="notif-count" className="absolute -top-2 -right-2 bg-brand-600 text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold">
                {mobile ? Math.min(9, count) : (unread > 99 ? "99+" : unread)}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0 border border-black shadow-brutal" data-testid="notif-dropdown">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black">
            <p className="text-sm font-bold uppercase tracking-tight">{t("header.notifications")}</p>
            {unread > 0 && <span className="label-mono text-brand-600">{unread} {t("header.new")}</span>}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-black/10">
            {items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t("header.all_caught_up")}</p>}
            {items.map((n) => {
              const meta = notifMeta(n);
              return (
                <button key={n.id} data-testid={`notif-item-${n.id}`} onClick={() => openNotif(n)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-2 hover:bg-black/[0.03] transition-colors ${n.read ? "opacity-60" : ""}`}>
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-600 shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip value={meta.label} className={`${meta.cls} text-[9px]`} />
                      <span className="label-mono text-muted-foreground">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="text-sm font-semibold mt-1 truncate">{n.work_title || n.message}</p>
                    {n.sender_name && <p className="label-mono text-muted-foreground truncate">{n.sender_name}</p>}
                  </div>
                </button>
              );
            })}
          </div>
          <button onClick={() => navigate("/notifications")} data-testid="notif-view-all"
            className="w-full px-4 py-3 border-t border-black text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
            {t("header.view_all")}
          </button>
        </PopoverContent>
      </Popover>
    );
  };

  const ThemeToggle = () => (
    <button
      onClick={toggleTheme}
      data-testid="theme-toggle"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle dark mode"
      className="w-10 h-10 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors"
    >
      {isDark ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
    </button>
  );

  const doLogout = () => {
    logout();
    navigate("/login");
  };

  // E2-63 (2026-08-15): send-digest retired. The Desk itself is the
  // brief now (Sprint 6 merged CEOBrief into Desk header) so this
  // email-a-snapshot flow duplicated live data behind an SMTP gate.

  const NavItems = ({ onNavigate }) => (
    <>
      {navMain.map(({ to, label, tkey, icon: Icon, testid }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          data-testid={testid}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 mx-3 px-3 py-2.5 text-sm rounded-lg border-l-2 transition-[background-color,color,border-color] duration-200 ${
              isActive
                ? "border-brand-600 bg-brand-600/[0.08] text-brand-600 font-semibold"
                : "border-transparent text-foreground/70 hover:bg-accent hover:text-foreground"
            }`
          }
        >
          <Icon size={18} weight="bold" />
          {t(`nav.${tkey}`)}
          {to === "/brief" && fires > 0 && (
            <span data-testid="nav-fires-badge" title={`${fires} fire(s) to put out`}
              className="ml-auto bg-brand-600 text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold rounded-full animate-pulse">
              {fires}
            </span>
          )}
          {/* E2-30 (2026-08-15): review badge follows the Inbox tab into
              /finance now that /ingest is retired. Same testid so any
              existing E2E tests still find it. */}
          {to === "/finance" && captureCount > 0 && (
            <span data-testid="nav-review-badge" title={`${captureCount} item(s) to review`}
              className="ml-auto bg-brand-600 text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold rounded-full">
              {captureCount}
            </span>
          )}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="min-h-screen flex bg-brand-paper text-brand-ink">
      <WelcomeOverlay />
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-black bg-white flex-col sticky top-0 h-screen">
        <div className="px-6 py-6 border-b border-black">
          <Logo />
          <p data-testid="tenant-name" className="mt-3 label-mono text-muted-foreground truncate">
            {tenant?.name}
          </p>
          {tenant?.industry && <p className="label-mono text-brand-600 truncate mt-1">{tenant.industry}</p>}
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto py-4">
          <NavItems />
        </nav>
        <div className="border-t border-black p-4 pb-6 shrink-0">
          <div className="mb-2 leading-tight" data-testid="current-user">
            <p className="text-sm font-semibold truncate">{user?.name}</p>
            <p className="label-mono text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button
            onClick={doLogout}
            data-testid="logout-button"
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold uppercase tracking-wider bg-white text-brand-600 border-2 border-brand-600 hover:bg-brand-600 hover:text-white transition-colors"
          >
            <SignOut size={16} weight="bold" /> {t("header.sign_out")}
          </button>
        </div>
      </aside>

      {/* Main.
          MPWA-14: below lg the column is capped and centred (`app-shell`) so
          the app reads as one phone-width surface on any display; on lg it
          resets to fill the space beside the sidebar. */}
      <div className="flex flex-col min-w-0 app-shell lg:max-w-none lg:mx-0 lg:flex-1">
        {/* Desktop top bar */}
        <header className="hidden lg:flex h-16 border-b border-border bg-background/70 backdrop-blur-xl items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="label-mono text-muted-foreground">{t("header.signed_in_as")}</span>
            <span className="font-semibold text-sm" data-testid="current-user-name">{user?.name}</span>
            <span className="px-2 py-0.5 text-[11px] rounded-md uppercase tracking-wider bg-brand-600/10 text-brand-600 border border-brand-600/20 font-semibold" data-testid="current-user-role">
              {user?.role}
            </span>
          </div>
          {/* E2-63: send-digest button retired. Same set of controls
              for owner + non-owner now that the digest is gone. */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
            <Bellicon />
          </div>
        </header>

        {/* Mobile top app bar — MPWA-03.
            Two controls, not four. The theme toggle moved to an All Apps tile
            (he switches theme roughly never and it was occupying prime
            top-bar space beside the bell), and the hamburger drawer is gone
            entirely — nothing should be reachable from two places (§8).
            MPWA-02: min-h + top inset so nothing sits under the status bar in
            iOS standalone, where there is no browser chrome above us. */}
        <header className="lg:hidden min-h-14 border-b border-border bg-background/80 backdrop-blur-xl grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-gutter-safe pt-safe sticky top-0 z-20">
          {/* MPWA-14: the wordmark is centred like Instagram's. A three-track
              grid (1fr · auto · 1fr) pins the logo to the header's true centre
              independent of the bell's width — the equal side tracks guarantee
              it, where a flex spacer only approximated it. `px-gutter-safe` is
              symmetric (16/16) so the centre is the screen's centre, not the
              content box's; the bell rides the right track, pushed to its end. */}
          <span aria-hidden="true" />
          <Logo />
          <div className="flex items-center justify-self-end gap-touch-gap">
            <Bellicon mobile />
          </div>
        </header>

        {/* MPWA-02: pb-dock clears the tab bar (and, from MPWA-03, the floating
            dock) plus the home indicator, so the last row is never trapped. */}
        <main className="flex-1 p-4 lg:p-8 pb-dock lg:pb-8 px-gutter-safe overflow-x-hidden app-canvas">{children}</main>
      </div>

      {/* MPWA-03 — mobile navigation.
          A floating pill detached from the edges (lists scroll *under* it,
          which is what `pb-dock` on main pays for), plus Dex as a separate
          64px circle on the same baseline. Desktop keeps its sidebar. */}
      <FloatingDock
        user={user}
        onMore={() => setAllAppsOpen(true)}
        moreOpen={allAppsOpen}
        moreBadge={captureCount}
      />
      <DexFab
        onOpen={() => setDexOpen(true)}
        recording={dexRecording.on}
        seconds={dexRecording.secs}
        onStop={() => setDexOpen(true)}
      />
      <AllAppsPanel
        open={allAppsOpen}
        onClose={() => setAllAppsOpen(false)}
        user={user}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onSignOut={doLogout}
        onOpenLanguage={() => setLangOpen(true)}
        counts={{ notifications: bellCount, myWork: fires }}
      />
      {/* MPWA-05: third session, dismissible, above the dock (§8). */}
      <InstallPrompt />
      <DexSheet
        open={dexOpen}
        onClose={() => setDexOpen(false)}
        onRecordingChange={(on, secs) => setDexRecording({ on, secs })}
        onCaptured={() => qc.invalidateQueries({ queryKey: ["captures-pending"] })}
      />
      {/* The Language tile opens the existing switcher in a thumb-reachable
          sheet rather than duplicating the language list. */}
      <BottomSheet
        open={langOpen}
        onClose={() => setLangOpen(false)}
        title={t("allapps.language", "Language")}
        data-testid="language-sheet"
      >
        <div className="py-1" onClick={() => setLangOpen(false)}>
          <LanguageSwitcher variant="inline" />
        </div>
      </BottomSheet>
    </div>
  );
}
