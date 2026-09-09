import { useCallback, useEffect, useState, useMemo, useRef } from "react";
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
import AnnouncementBanner from "./AnnouncementBanner";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { WelcomeOverlay } from "./WelcomeOverlay";
// MPWA-03: mobile navigation is the floating dock + All Apps panel. The
// edge-to-edge tab bar and the hamburger drawer are both gone below lg.
import { FloatingDock } from "./mobile/FloatingDock";
import { AllAppsPanel } from "./mobile/AllAppsPanel";
import { DexFab } from "./mobile/DexFab";
import { DexChat } from "./mobile/DexChat";
import { HeaderSlotContext } from "./mobile/HeaderSlot";
import { useDexConversation } from "../hooks/useDexConversation";
import { useIsMobile } from "../hooks/useIsMobile";
import { cn } from "../lib/utils";
import { useDexCapture } from "../hooks/useDexCapture";
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
  /* KM-46 — the dip is as wide as the nav actually is. A fixed centre width
     would drift the moment a translation makes "Decision Desk" longer or
     shorter, and the S-curves would then start somewhere other than the end of
     the pills. Padded a little either side so the curve leaves the last pill
     rather than clipping it. */
  const navRef = useRef(null);
  const [navW, setNavW] = useState(0);
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    /* KM-49 — +36, i.e. 18px of flat each side, down from 24. The vertical gap
       around the pills is 17.4px, so this makes the shelf's padding uniform on
       all four sides; at 24 the flat ran on past the last pill and the founder
       read it as stretched. The curve still starts outside the group either
       way — this only decides how much flat precedes it. */
    const measure = () => setNavW(Math.round(el.getBoundingClientRect().width) + 36);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

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
  /* KM-25 — the mobile shell stops being a document that scrolls and becomes a
     frame: a top region that does not move, and a scroller under it. The slot
     is state rather than a ref because a page's header portals into it and has
     to re-render once the element exists.
     `brandGone` collapses the wordmark + bell on first movement and hands the
     space to the page title, which is what the founder asked for. */
  const [headerSlot, setHeaderSlot] = useState(null);
  const isMobileShell = useIsMobile();
  /* KM-27 — /inbox opts OUT of the collapse, on the founder's call. The Desk
     has no page title to promote: its heading IS the greeting, which belongs to
     the hero rather than to a chrome row, so folding the wordmark away left an
     empty strip and promoted nothing into it. Every other room has a title and
     a control row worth keeping on screen. */
  const collapsingShell = !location.pathname.startsWith("/inbox");
  const [brandGone, setBrandGone] = useState(false);
  // Declared AFTER brandGone: reading it above its useState is a temporal dead
  // zone, which is exactly how the first cut of this white-screened.
  const brandFolded = brandGone && collapsingShell;

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
  /* KM-11 — the capture hook moves UP here from DexSheet, because the thing
     that now renders the voice UI is the dock, not a sheet. Layout is the only
     common parent of the FAB (which starts it), the bar (which draws it) and
     the sheet (which still shows what Dex heard afterwards). */
  /* KM-51 — the transcript sink. useDexCapture is created BEFORE
     useDexConversation (it is the conversation's input), so the setter it needs
     to hand a transcript to does not exist yet. A ref filled on the next line
     down breaks the cycle without reordering two hooks that genuinely depend on
     each other in that direction. */
  /* KM-54 — `qc` and this helper are declared BEFORE the Dex hooks on purpose.
     Both are consts, so they sit in the temporal dead zone until their own line
     runs, and the options object passed to useDexCapture is evaluated the
     moment that call is reached. Referencing either from further down the file
     therefore threw "Cannot access 'qc' before initialization" and rendered a
     blank app — a runtime fault the production build compiles happily, which is
     why it was caught in the browser rather than by the compiler.

     A capture lands in several places, so several caches go stale at once.
     Layout used to invalidate only captures-pending, which is why a new
     decision took up to 30 seconds (Desk's own refetchInterval) to surface
     instead of arriving with the acknowledgement that created it. */
  const qc = useQueryClient();
  const refreshAfterCapture = useCallback(() => {
    ["captures-pending", "desk", "inbox", "tasks", "dex-inflight-count"].forEach(
      (k) => qc.invalidateQueries({ queryKey: [k] })
    );
  }, [qc]);

  const draftSinkRef = useRef(null);
  /* KM-54 — which door Dex was opened by: "ask" or "decide". null means the
     picker has not been used, and the FAB shows the two doors instead of
     opening anything. */
  const [dexChannel, setDexChannel] = useState(null);
  const [dexPicker, setDexPicker] = useState(false);
  const dex = useDexCapture({
    watch: true,
    onRecordingChange: (on, secs) => setDexRecording({ on, secs }),
    onCaptured: refreshAfterCapture,
    // Stopping a recording now yields TEXT for review, not a committed capture.
    onTranscript: (text) => draftSinkRef.current?.(text),
    /* Ask-mode audio goes to /transcribe: text back, nothing persisted. Only
       Decide-mode audio becomes a decision. */
    channel: dexChannel === "ask" ? "dictate" : "capture",
  });
  /* KM-26 — one conversation, three surfaces: the dock hosts the input, the
     FAB submits it, the transcript shows it. None of them can own the state, so
     it lives in the hook and Layout hands it to all three. */
  const chat = useDexConversation({
    dex,
    open: dexOpen,
    channel: dexChannel === "decide" ? "decide" : "ask",
    onCommitted: refreshAfterCapture,
  });
  draftSinkRef.current = chat.setDraft;
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
              : "relative h-10 w-10 rounded-full border border-kr-ink/55 grid place-items-center text-foreground/90 transition-colors hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"}>
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
  /* KM-25 — the slot is published to the whole tree so a page's own header can
     portal into the frame's top region without Layout knowing which page it is.
     Handed down only on mobile: the slot div is `lg:hidden`, so portaling into
     it above lg would render every page header into a display:none box.
     NM-18: `app-sky` is UNCONDITIONAL. The sky it owns is invisible at opacity
     0 off the Dex route, and keeping it mounted is what lets it fade in and out
     with the theme instead of snapping — see .app-sky::before. */
  return (
    <HeaderSlotContext.Provider value={isMobileShell ? headerSlot : null}>
    <div className="app-sky flex h-[100dvh] flex-col overflow-hidden bg-nm text-foreground lg:h-auto lg:min-h-screen lg:overflow-visible">
      {/* The page-artwork layer. Empty and invisible until a room sets
          --sky-art (see "PAGE ARTWORK" in index.css); position:fixed keeps it
          out of this flex column. It is a real element rather than a third
          pseudo-element because ::before is the drifting gradient and ::after
          is the Dex sky, and artwork must not drift. */}
      <div className="app-sky__art" aria-hidden="true" />
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
      {/* KM-46 — the shelf lives on the HEADER, not the nav: it runs edge to
          edge and only dips behind the pills, so the logo and the account block
          sit on the same surface as the navigation. --navplate-w is the dip's
          width, measured from the real nav below rather than assumed — the pill
          labels are translated, so it has to fit whatever language is loaded. */}
      {/* KM-47 — THE PILLS SIT IN THE DIP, NOT IN THE HEADER, and that is what
          the padding-bottom is for. Measured before: 18px of plate above the
          pills and 6.5px below them, because the row was centred in the 76px
          header while the dip's floor is at 84.92% of it. Centring content in a
          box whose bottom has been curved away is centring it in the wrong box.

          88px, not 76: making the gaps merely EQUAL at the old height gives
          12.25px top and bottom, which puts the pills almost against the page
          edge. The founder's own curve file is 126 units tall for a ~44px pill —
          proportionally far airier than 76 was. 88 lands between: 17.4px around
          the pills and a 13px floor left under the dip.

          pb-[13px] is derived, not nudged: with items-center the row's top is
          (88 - P - 40) / 2, and setting that equal to the gap below the pills
          (74.73 - 40 - top) solves to P = 13.26. */}
      <header
        className="kr-navplate hidden lg:grid h-[88px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 pb-[13px] bg-transparent"
        style={navW ? { "--navplate-w": `${navW}px` } : undefined}
      >
        <div className="flex items-center justify-self-start">
          <KarmaLogo />
        </div>

        <PillNav
          testid="header-pill-nav"
          plate
          navRef={navRef}
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
            className="h-10 w-10 rounded-full border border-kr-ink/55 grid place-items-center text-foreground/90 transition-colors hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
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
      {/* KM-25 — `min-h-0 flex-1` is what actually makes the frame work. Without
          it this wrapper sits at `flex: 0 1 auto` with `min-height: auto`, grows
          to its content (measured 3970px inside an 812px root) and hands <main>
          an unbounded height, so main never becomes a scrollport and the page
          scrolls the document exactly as before. The clip only exists if the
          height constraint reaches all the way down. */}
      <div className="flex min-h-0 flex-1 flex-col min-w-0 app-shell lg:max-w-[1400px] lg:w-full lg:mx-auto">
        {/* Mobile top app bar — MPWA-03.
            Two controls, not four; min-h + top inset so nothing sits under the
            status bar in iOS standalone. Untouched by KR-5 beyond what the
            recipes re-skin. */}
        {/* KR-8.2: the mobile bar blends too — transparent, no border, no
            blur, static. The phone reference floats its title on the bloom. */}
        {/* KR-14.17 — the wordmark moves from the row's centre column to
            the left edge, and steps up to `size="lg"` for a stronger app
            identity in the phone header. Grid collapses to two columns
            (logo left, actions right) — the empty centre span is gone. */}
        {/* KM-25 · the top region. It sits OUTSIDE <main>, which is the whole
            point: nothing can scroll through it, so nothing has to be painted
            over. The brand row collapses on first movement and gives its space
            to the page title, which portals into the slot beneath it. */}
        <div className="lg:hidden shrink-0">
          <header
            data-testid="mobile-brand-row"
            aria-hidden={brandFolded}
            className={cn(
              "flex items-center justify-between gap-2 overflow-hidden px-gutter-safe bg-transparent",
              "transition-[max-height,opacity,padding-top] duration-300 ease-out motion-reduce:transition-none",
              brandFolded
                ? "pointer-events-none max-h-0 pt-0 opacity-0"
                : "min-h-14 max-h-24 pt-safe opacity-100"
            )}
          >
            <KarmaLogo size="lg" />
            <div className="flex items-center gap-touch-gap">
              <Bellicon mobile />
            </div>
          </header>
          {/* A page's header lands here. Zero-height on routes with none.
              KM-27 — the title landed hard against the top edge once the brand
              row folded away. `pt-3` on top of the safe inset gives it the
              breathing room the wordmark had, so the promotion reads as the
              title taking that place rather than being shoved into it. */}
          <div
            ref={setHeaderSlot}
            data-testid="page-header-slot"
            className={cn("px-gutter-safe", brandFolded && "pt-safe pt-3")}
          />
        </div>

        {/* MPWA-02: pb-dock clears the floating dock plus the home indicator,
            so the last row is never trapped. */}
        {/* KR-8.4 — `overflow-x-clip`, NOT `-hidden`, and the difference is
            load-bearing: when one axis is hidden and the other visible, CSS
            computes the visible one to `auto`, which silently made <main> a
            scroll container. Every `position: sticky` inside it then stuck to
            main's scrollport — which never scrolls, because the DOCUMENT does
            — so sticky quietly did nothing app-wide. `clip` crops the same
            pixels without creating a scroll container, so sticky works. */}
        {/* KM-25 — below lg this is the SCROLLER, and its top edge is the clip
            the founder asked for: a row scrolled past it is gone, not hidden
            behind a bar. Desktop keeps exactly what KR-8.4 settled on
            (`overflow-x: clip` alone, so <main> is not a scroll container and
            `position: sticky` inside pages still tracks the document). */}
        <main
          ref={mainRef}
          onScroll={(e) => {
            if (!collapsingShell) return;
            const y = e.currentTarget.scrollTop;
            setBrandGone((was) => (was ? y > 2 : y > 4));
          }}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-dock app-canvas lg:overflow-x-clip lg:overflow-y-visible lg:pb-8"
        >
          <AnnouncementBanner />
          <div className="p-4 lg:p-8 px-gutter-safe">{children}</div>
        </main>
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
        dexActive={dexOpen}
        dexLevels={dex.levels}
        dexMode={chat.mode}
        dexWaveState={dex.recording ? "listening" : chat.busy ? "thinking" : "idle"}
        dexDraft={chat.draft}
        onDexDraft={chat.setDraft}
        onDexSubmit={chat.submit}
        /* KM-53 — the gap between "stop" and the transcript coming back.
           `dex.sending` covers the upload and the transcript poll; `!chat.draft`
           narrows it to the window where there is genuinely nothing to show,
           so the placeholder never sits on top of text that has already
           arrived. */
        dexTranscribing={!!dex.sending && !chat.draft}
      />
      {/* KM-11 — the vignette. Rendered always so it can transition rather
          than pop in, and gated by a data attribute. Sits below the dock's
          z-index so the bar stays fully lit while the edges fall away. */}
      <div className="kr-vignette lg:hidden" data-on={dex.recording ? "1" : "0"}
           data-testid="dex-vignette" aria-hidden="true" />

      {/* KM-23 — the FAB opens the CONVERSATION again, and this time it is a
          conversation. KM-11 had made it a bare record toggle because the old
          sheet was only a receipt; DexChat is a transcript you can ask into,
          type into and attach to, so there is something worth opening. Voice
          still starts one tap in, from the mic inside it. */}
      <DexFab
        /* Closed, the FAB no longer opens Dex — it asks WHICH Dex. Open, it is
           the composer's send/mic/stop exactly as before. */
        onOpen={() => (dexOpen ? chat.submit() : setDexPicker((v) => !v))}
        recording={dex.recording}
        seconds={dex.recordSecs}
        onStop={() => dex.stopRecording()}
        intent={dexOpen ? chat.fabIntent : "sparkle"}
        picker={dexPicker && !dexOpen}
        onPick={(kind) => {
          setDexPicker(false);
          if (!kind) return;              // tapped the scrim
          setDexChannel(kind);
          setDexOpen(true);
        }}
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
      {/* KM-23 — one surface, opened deliberately, closed for good.
          The old DexSheet was mounted on `!!dex.understanding`, so it let
          itself back in: finish a capture, dismiss the card, and the next poll
          re-populated `understanding` and the black sheet reappeared on its
          own. That is the ghost card the founder reported. The chat is driven
          by an explicit `dexOpen` instead, and a finished capture becomes a
          message inside it rather than a window of its own. (The poll that
          caused the re-open is separately fenced — see the dismiss token in
          useDexCapture.) */}
      {/* KM-54 — closing clears the channel, so the next tap on the FAB asks
          which Dex you want rather than silently reusing the last answer. A
          door you chose two hours ago is not a door you chose. */}
      <DexChat
        open={dexOpen}
        onClose={() => { setDexOpen(false); setDexChannel(null); }}
        dex={dex}
        chat={chat}
        channel={dexChannel}
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
    </HeaderSlotContext.Provider>
  );
}
