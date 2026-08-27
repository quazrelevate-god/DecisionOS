import { useEffect, useState, useMemo, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useSkyFade } from "../hooks/useSkyFade";
import { useTheme } from "../hooks/useTheme";
import { hasPerm } from "../lib/perms";
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
  Briefcase,
  GearSix,
  Tray,
  Wallet,
  Gauge, // Epic 2 E2-15: Ops nav entry (Operating Score)
  UsersThree, // Epic 2 E2-01: Team nav entry (Employees list)
  MagnifyingGlass, // KR-5: the search circle that opens the ⌘K dialog
} from "@phosphor-icons/react";
// KR-5/KR-8.2 — the Karma shell pieces.
import { PillNav } from "./karma";
import { KarmaLogo } from "./karma/Logo";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from "./ui/command";
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
  // KR-5: `/inbox`, not `/`. The root route only ever REDIRECTS a signed-in
  // user here (App.js Home), so a pill pointing at "/" was active for zero
  // real URLs — the Desk pill never lit. Router-driven active state is only
  // honest if the `to` is a destination someone actually lands on.
  { to: "/inbox", label: "Decision Desk", tkey: "inbox", icon: Tray, testid: "nav-inbox", perm: "inbox" },
  // Epic 2 Sprint 6 (E2-47): 'CEO Brief' merged into Desk header. Nav
  // entry retired; /brief URL redirects to /inbox in App.js.
  // { to: "/brief", label: "CEO Brief", tkey: "brief", icon: Sun, testid: "nav-ceo-brief" },
  { to: "/my-work", label: "My Work", tkey: "mywork", icon: Briefcase, testid: "nav-my-work" },
  // Epic 7 Sprint 1 Phase A (2026-08-17): Ops nav item is now visible to
  // every authenticated user. Owner sees the company dashboard; every other
  // role sees their personal operating view (self stats + open work +
  // active workflows). Founder ask: 'if the team person login and go the
  // ops it have to show the individuals person metrics'.
  { to: "/operating-score", label: "Ops", tkey: "ops", icon: Gauge, testid: "nav-ops" },
  { to: "/crm", label: "CRM", tkey: "crm", icon: AddressBook, testid: "nav-crm", perm: "people" },
  // U7-09.TEAM (2026-08-17): Team nav visible to every user. Non-perm
  // viewers get a read-only roster; owner + team_manage users get the
  // edit affordances inside the page.
  { to: "/team", label: "Team", tkey: "team", icon: UsersThree, testid: "nav-team" },
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
  // KR-5: Settings leaves the primary nav — seven destination pills is the
  // ceiling before the strip stops reading as the reference's segment, and
  // Settings is configuration, not a working surface. It lives in the avatar
  // menu now (still ownerOnly), which is where the reference keeps identity-
  // adjacent things. AllAppsPanel keeps its own Settings tile on mobile.
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

// KR-8.2: the shell's logo is KarmaLogo (components/karma/Logo.jsx) — the
// founder discarded the PNG lockup for this design system. Wordmark.jsx
// survives untouched for Landing/Login, which keep the registered artwork.

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
  const location = useLocation();
  const { isDark, toggle: toggleTheme } = useTheme();

  // ── NM-17 · the Dex dissolve ────────────────────────────────────────────
  // /brain renders dark whatever the app's theme is; the transition into the
  // room is cross-faded rather than flipped.
  //
  // KR-5: `wantDark = dexRoute`, full stop. User-facing dark mode retired
  // with the Karma language (approved plan) — Karma is a two-zone light
  // composition and `dark` now means "inside the ink", which only the Dex
  // room asserts at page level. useTheme still owns the stored preference;
  // the mobile AllAppsPanel theme tile keeps working against it for now, and
  // desktop simply no longer reads it.
  const dexRoute = location.pathname.startsWith("/brain") || location.pathname.startsWith("/dex");
  const wantDark = dexRoute;
  const lastDark = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    // Only fade an actual CHANGE. Without this the first paint of every
    // /brain navigation would arm a 480ms transition on the whole document
    // for a swap that is not happening.
    const changed = lastDark.current !== null && lastDark.current !== wantDark;
    lastDark.current = wantDark;

    if (!changed) {
      root.classList.toggle("dark", wantDark);
      return undefined;
    }
    root.classList.add("theme-x");
    root.classList.toggle("dark", wantDark);
    const t = setTimeout(() => root.classList.remove("theme-x"), 520);
    return () => clearTimeout(t);
  }, [wantDark]);

  // NM-18: the sky's token overrides hang off <html>, not off a React node —
  // they have to reach the header and the rail, which are siblings of the
  // canvas. Separate from the dark class above because the two answer
  // different questions: `dark` is "which theme", `data-dex` is "which room".
  useEffect(() => {
    const root = document.documentElement;
    if (dexRoute) root.setAttribute("data-dex", "1");
    else root.removeAttribute("data-dex");
  }, [dexRoute]);


  // KR-13 — replay the page-arrival animation on every route change.
  //
  // The obvious version — key={location.pathname} on a wrapper — would
  // remount the entire subtree on every navigation. On pages carrying six
  // Recharts surfaces and four live queries that is a real cost, and it
  // throws away scroll position and any component state React Router was
  // otherwise happy to keep.
  //
  // So the node stays put and only its animation restarts. Removing the
  // class, reading offsetWidth to force a style flush, then re-adding it is
  // the standard restart: without that read the browser coalesces both
  // mutations into one frame, sees no change, and never replays.
  // KR-13 — the weather cross-fade. This hook OWNS data-page: the attribute
  // has to land at the bottom of the opacity dip rather than at the click,
  // so the stamp and the curtain cannot live in two places.
  useSkyFade(location.pathname);

  const mainRef = useRef(null);
  const wasDex = useRef(dexRoute);
  useEffect(() => {
    const el = mainRef.current;
    const leavingOrEnteringDex = dexRoute || wasDex.current;
    wasDex.current = dexRoute;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // KR-13.1 — NO PAGE TRANSITION ACROSS THE DEX BOUNDARY, in either
    // direction. Dex already runs its own 480ms light↔dark cross-fade over
    // every node in the app (html.theme-x); adding a 320ms rise on top of it
    // meant two easings and two durations fighting over one moment, which is
    // exactly the interference the founder reported. The room swap IS the
    // transition there. Both directions, because leaving Dex runs the same
    // cross-fade as entering it.
    if (leavingOrEnteringDex) {
      el.classList.remove("kr-page-in");
      return;
    }
    el.classList.remove("kr-page-in");
    void el.offsetWidth;
    el.classList.add("kr-page-in");
  }, [location.pathname, dexRoute]);

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
  // KR-5: the global search moved into a ⌘K dialog; same /brain?q= handoff.
  const [globalQuery, setGlobalQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
  // KM-1 — the return value is deliberately not destructured. Its only reader
  // was `counts.myWork`, a prop AllAppsPanel never looked at; the poll itself
  // stays because it keeps /brief?period=morning warm in the cache, which is
  // where the More panel's live tiles will read from (they must not fire
  // requests on open). If that panel work does not land, delete this too.
  useQuery({ queryKey: ["fires-count"], queryFn: () => api.get("/brief?period=morning").then((r) => r.data), refetchInterval: 60000, enabled: user?.role === "owner" });
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
          {/* KR-5: desktop = the reference's outlined circle. The MOBILE
              variant is deliberately untouched — everything already shipped
              on the phone chrome outranks this pass. The badge goes ORANGE:
              a notification count is alert grammar, exactly what --kr-accent
              exists for. */}
          <button data-testid="notif-bell"
            aria-label={count > 0 ? `Notifications, ${count} need you` : "Notifications"}
            className={mobile
              ? "relative flex items-center justify-center border border-border hover:bg-accent transition-colors w-12 h-12"
              : "relative h-10 w-10 rounded-full border border-kr-outline grid place-items-center text-foreground/80 transition-colors hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"}>
            <Bell size={mobile ? 22 : 18} weight="regular" />
            {count > 0 && (
              <span data-testid="notif-count" className={mobile
                ? "absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center rounded-full bg-kr-accent px-1 text-[10px] font-bold leading-none text-white"
                : "absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-kr-accent px-1 text-[10px] font-bold leading-none text-white"}>
                {mobile ? Math.min(9, count) : (unread > 99 ? "99+" : unread)}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0 border border-border shadow-md" data-testid="notif-dropdown">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
            className="w-full px-4 py-3 border-t border-border text-sm font-medium hover:bg-accent transition-colors">
            {t("header.view_all")}
          </button>
        </PopoverContent>
      </Popover>
    );
  };

  // KR-5: ThemeToggle is DELETED from the desktop shell, not hidden — dark
  // mode retired with the Karma language and a control that can never change
  // what is on screen is worse than no control. The mobile AllAppsPanel tile
  // still receives isDark/onToggleTheme below and keeps working against the
  // stored preference; that surface's retirement is a separate product call.

  const doLogout = () => {
    logout();
    navigate("/login");
  };

  // E2-63 (2026-08-15): send-digest retired. The Desk itself is the
  // brief now (Sprint 6 merged CEOBrief into Desk header) so this
  // email-a-snapshot flow duplicated live data behind an SMTP gate.

  // KR-5 — navigation is the header's centred pill strip now (PillNav from
  // the Karma kit). NavItems and RailItems are DELETED, not parked: NavItems
  // had no remaining render site, and the rail is gone with its aside. The
  // Finance capture badge moves onto the Finance pill.
  // NM-2 — the page ground moves onto the soft-depth surface. Depth needs a
  // mid-tone to cast onto: cards sit at the SAME value and are separated by
  // shadow + hairline, not by fill. bg-background stays untouched for
  // surfaces that opt out (sheets, popovers).
  return (
    /* NM-18: `app-sky` is UNCONDITIONAL. The sky it owns is invisible at
       opacity 0 off the Dex route, and keeping it mounted is what lets it fade
       in and out with the theme instead of snapping — see .app-sky::before. */
    <div className="app-sky min-h-screen flex flex-col bg-nm text-foreground">
      <WelcomeOverlay />
      {/* KR-5 — the Karma header. Three tracks: logo · centred pill nav ·
          circular controls + the avatar block. The reference's shell exactly,
          which also KILLS two prior decisions on purpose:
            · the opaque bar (NM-2 "the bar dissolves") — this one FROSTS over
              the bloom instead, because the ground behind it is now weather,
              and content scrolling under an opaque greige strip read as a
              hole in the sky;
            · the sidebar (every shell since RD-1) — seven destinations fit
              the reference's segment strip, so the rail's 72px column goes
              back to the content.
          The search field is demoted from a full-width inset to a circle
          that opens a ⌘K dialog — the reference has no visible field, and
          the field's one real job (ask Dex) survives intact. */}
      {/* KR-8.2 — the founder, against the reference: no "rectangle bar
          suppression". The header is STATIC and fully transparent — chrome
          floating directly on the bloom, scrolling away with the page. The
          frosted sticky strip (KR-5) is deleted, not softened: any fill at
          all reads as a bar. */}
      <header className="hidden lg:grid h-[76px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 bg-transparent">
        <div className="flex items-center justify-self-start">
          <KarmaLogo />
        </div>

        <PillNav
          testid="header-pill-nav"
          items={navMain.map((n) => ({
            to: n.to,
            end: n.to === "/",
            label: t(`nav.${n.tkey}`),
            testid: n.testid,
            // The Finance capture badge rides its pill — same signal the
            // rail's icon badge carried, same source, new seat.
            badge: n.to === "/finance" ? captureCount : 0,
          }))}
        />

        <div className="flex items-center gap-2.5 justify-self-end">
          <button
            type="button"
            data-testid="global-search-open"
            aria-label={t("header.search_ph", "Find anything…")}
            title={`${t("header.search_ph", "Find anything…")} (⌘K)`}
            onClick={() => setSearchOpen(true)}
            className="h-10 w-10 rounded-full border border-kr-outline grid place-items-center text-foreground/80 transition-colors hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
          >
            <MagnifyingGlass size={18} weight="regular" />
          </button>
          <LanguageSwitcher />
          <Bellicon />

          {/* The avatar block — initial circle + stacked name/role, and the
              menu that absorbed the dead rail's foot: identity, workspace,
              Settings (ownerOnly — it left the nav pills), sign out. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                data-testid="rail-user-menu"
                aria-label={user?.name || "Account"}
                className="flex items-center gap-2.5 rounded-pill py-1 pl-1 pr-2.5 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-kr-outline bg-nm-raised text-sm font-semibold">
                  {(user?.name || "?").trim().charAt(0).toUpperCase()}
                </span>
                <span className="hidden xl:block min-w-0 text-left leading-tight">
                  <span className="block max-w-[140px] truncate text-sm font-semibold">{user?.name}</span>
                  <span className="block text-xs capitalize text-muted-foreground">{user?.role || "member"}</span>
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <div className="px-3 py-3 border-b border-border" data-testid="current-user">
                <p className="text-sm font-semibold truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <div className="px-3 py-2.5 border-b border-border">
                <p className="text-xs text-muted-foreground">Workspace</p>
                <p data-testid="tenant-name" className="text-sm font-medium truncate">{tenant?.name}</p>
                {tenant?.industry && (
                  <p className="text-xs text-muted-foreground truncate">{tenant.industry}</p>
                )}
              </div>
              <div className="p-1.5">
                {user?.role === "owner" && (
                  <button
                    onClick={() => navigate("/settings")}
                    data-testid="nav-settings"
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <GearSix size={15} /> {t("nav.settings", "Settings")}
                  </button>
                )}
                <button
                  onClick={doLogout}
                  data-testid="logout-button"
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <SignOut size={15} /> {t("header.sign_out")}
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* KR-5 — ⌘K. The reference shows no search field; the one real job the
          old full-width input had (route a question to Dex) survives as a
          command dialog. Enter submits to the exact navigation the field
          used — /brain?q= — which /brain reads on arrival (NM-13). */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput
          data-testid="global-search"
          placeholder={t("header.search_ph", "Find anything…")}
          value={globalQuery}
          onValueChange={setGlobalQuery}
        />
        <CommandList>
          <CommandEmpty>Type, then Enter — Dex answers.</CommandEmpty>
          {globalQuery.trim() && (
            <CommandItem
              data-testid="global-search-go"
              onSelect={() => {
                const q = globalQuery.trim();
                setSearchOpen(false);
                setGlobalQuery("");
                navigate(`/brain?q=${encodeURIComponent(q)}`);
              }}
            >
              Ask Dex — “{globalQuery.trim()}”
            </CommandItem>
          )}
        </CommandList>
      </CommandDialog>

      {/* Main. MPWA-14: below lg the column is capped and centred (`app-shell`)
          so the app reads as one phone-width surface on any display; at lg the
          rail is gone (KR-5), so the column centres inside a 1400px cap — the
          reference is a centred composition, not an edge-to-edge one. */}
      <div className="flex flex-col min-w-0 app-shell lg:max-w-[1400px] lg:w-full lg:mx-auto lg:flex-1">
        {/* Mobile top app bar — MPWA-03.
            Two controls, not four; min-h + top inset so nothing sits under the
            status bar in iOS standalone. Untouched by KR-5 beyond what the
            recipes re-skin. */}
        {/* KR-8.2: the mobile bar blends too — transparent, no border, no
            blur, static. The phone reference floats its title on the bloom. */}
        <header className="lg:hidden min-h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-gutter-safe pt-safe bg-transparent">
          <span aria-hidden="true" />
          <KarmaLogo size="sm" />
          <div className="flex items-center justify-self-end gap-touch-gap">
            <Bellicon mobile />
          </div>
        </header>

        {/* MPWA-02: pb-dock clears the floating dock plus the home indicator,
            so the last row is never trapped. */}
        {/* KR-8.4 — `overflow-x-clip`, NOT `-hidden`, and the difference is
            load-bearing: when one axis is hidden and the other visible, CSS
            computes the visible one to `auto`, which silently made <main> a
            scroll container. Every `position: sticky` inside it then stuck to
            main's scrollport — which never scrolls, because the DOCUMENT does
            — so sticky quietly did nothing app-wide. `clip` crops the same
            pixels without creating a scroll container, so sticky works. */}
        <main ref={mainRef} className="flex-1 p-4 lg:p-8 pb-dock lg:pb-8 px-gutter-safe overflow-x-clip app-canvas">{children}</main>
      </div>

      {/* MPWA-03 — mobile navigation.
          A floating pill detached from the edges (lists scroll *under* it,
          which is what `pb-dock` on main pays for), plus Dex as a separate
          64px circle on the same baseline. Desktop keeps its sidebar. */}
      <FloatingDock
        user={user}
        onMore={() => setAllAppsOpen(true)}
        moreOpen={allAppsOpen}
        /* KM-1 — the badge on a container must be a promise the container
           keeps. This counted pending WhatsApp captures, but Review Queue is
           not a tile in the panel — it is a TAB inside /finance, which is the
           Money dock slot sitting right beside More. So the founder saw "3",
           opened More, and found nothing counting to three. Notifications is
           the only badged tile inside, so the badge is its count.
           (The capture signal now has no mobile home: it wants a badge on the
           Money slot, which DockItem does not support yet.) */
        moreBadge={bellCount}
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
        counts={{ notifications: bellCount }}
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
