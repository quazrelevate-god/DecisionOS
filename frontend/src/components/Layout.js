import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useSkyFade } from "../hooks/useSkyFade";
import { usePulse } from "../hooks/usePulse";
import { hasPerm } from "../lib/perms";
import { roleLabel } from "../lib/departments";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { timeAgo } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { Chip } from "./common";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { GLASS_MENU } from "./karma/glass";
import {
  Brain as BrainIcon,
  AddressBook,
  SignOut,
  Bell,
  Briefcase,
  GearSix,
  BookOpen,
  Tray,
  Wallet,
  Gauge, // Epic 2 E2-15: Ops nav entry (Operating Score)
  UsersThree, // Epic 2 E2-01: Team nav entry (Employees list)
  Buildings,  // 2026-09-20: the founder's other companies, in the profile menu
  Plus,
} from "@phosphor-icons/react";
// KR-5/KR-8.2 — the Karma shell pieces.
import { PillNav } from "./karma";
import { KarmaLogo } from "./karma/Logo";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from "./ui/command";
import { ProfileDialog } from "./ProfileDialog";
import AnnouncementBanner from "./AnnouncementBanner";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { WelcomeOverlay } from "./WelcomeOverlay";
// B20 — the demo workspace says it is one.
import { DemoWorkspaceBanner } from "./DemoWorkspaceBanner";
// 2026-10-03 — losing the connection mid-use says so before a save fails.
import { ConnectionNotice } from "./ConnectionNotice";
// 2026-09-19 — members sign in by mobile; owners also have email + password.
import OwnerCredentialsGate from "./auth/OwnerCredentialsGate";
import WelcomeMemberCard from "./auth/WelcomeMemberCard";
// MPWA-03: mobile navigation is the floating dock + All Apps panel. The
// edge-to-edge tab bar and the hamburger drawer are both gone below lg.
import { FloatingDock } from "./mobile/FloatingDock";
// DEX-SLIDER Part 1 — the Desk trades its Ask circle for the slider's left end.
import { DEX_SLIDER } from "../lib/flags";
import { AllAppsPanel } from "./mobile/AllAppsPanel";
import { DexFab } from "./mobile/DexFab";
import { DexChat } from "./mobile/DexChat";
import { HeaderSlotContext } from "./mobile/HeaderSlot";
import { DockSlider } from "./mobile/DockSlider";
import { DeskDexWell } from "../pages/desk/DeskDexWell";
import { saveAsDraft } from "../lib/decisionDrafts";
// DEX-SLIDER Part 2 — the Desk's slider opens Ask, which lives up here.
import { DexDoorsContext } from "./mobile/DexDoors";
import { useDexConversation } from "../hooks/useDexConversation";
import { isReading } from "../lib/dexOutcome";
import { toastDexOutcome } from "../lib/dexOutcomeToast";
import { DexFailureNotice } from "./mobile/DexFailureNotice";
import { useIsMobile } from "../hooks/useIsMobile";
import { cn } from "../lib/utils";
import { useDexCapture } from "../hooks/useDexCapture";
import { BottomSheet } from "./mobile/BottomSheet";
import { InstallPrompt } from "./mobile/InstallPrompt";

// Epic 2 Sprint A (E2-01 / E2-02 / E2-15): People retired; CRM (customers +
// suppliers) and Team (employees) are separate top-level entries. Ops is a
// new owner-only shortcut to Operating Score (removed from Brief in E2-11).
/* Whether a nav entry shows, given the role and a permission check. Exported
   with NAV so the Team page's "They will see these menus" preview answers with
   the same rule as the real nav (2026-10-03 — it was a hand-kept copy that
   still listed CEO Brief and Meeting Notes, both long retired). */
export function navEntryOpen(n, isOwner, has) {
  if (n.ownerOnly && !isOwner) return false;
  if (n.perms) return n.perms.some((p) => has(p));
  return !n.perm || has(n.perm);
}

export const NAV = [
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
  // J7-04 / J8-01 — CRM is in the nav for either side of it.
  { to: "/crm", label: "CRM", tkey: "crm", icon: AddressBook, testid: "nav-crm", perms: ["people", "crm_buyers", "crm_suppliers"] },
  // U7-09.TEAM (2026-08-17): Team nav visible to every user. Non-perm
  // viewers get a read-only roster; owner + team_manage users get the
  // edit affordances inside the page.
  { to: "/team", label: "Team", tkey: "team", icon: UsersThree, testid: "nav-team" },
  // Epic 2 Sprint 5 (E2-32): 'Company Brain' -> 'Dex' (single AI persona).
  // Route stays /brain for bookmark safety; /dex is an alias in App.js.
  { to: "/brain", label: "Dex", tkey: "brain", icon: BrainIcon, testid: "nav-brain", perm: "brain" },
  // Epic 2 Sprint 4 (E2-27): 'Capture' nav retired; Finance is now the
  // single home for money + document capture. Route rename /ledger -> /finance.
  { to: "/finance", label: "Finance", tkey: "finance", icon: Wallet, testid: "nav-ledger", perms: ["finance", "data_input"] },
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

/* MW-18 — routes that opt OUT of the shell's 1400px cap. Keep this short and
   make a page earn its place: the cap exists because most pages are composed
   against it, and a page that goes edge-to-edge has to be built for it. */
// 2026-09-16: /team opts in — the desktop org chart is a pannable canvas that
// uses the whole width, the founder's reference drawn edge to edge.
const WIDE_ROUTES = ["/my-work", "/team"];

/* ASK-34 item 6 — /inbox BREATHES ON A WIDE MONITOR, and only /inbox.
   The Desk is composed as ONE TRACK: the greeting, the score row, the Dex
   well, the KPI tiles and the black board all share the same left and right
   edges (the board's column formula is the hero's left column re-derived, see
   Desk.js). So the width has to be given to the track, never to the board —
   widening the black card alone would push its edges past the well and the
   tiles it lines up with. That means giving it HERE, on the shell that carries
   every one of them, not in the page.
   Measured at 1920 (UI-SCALE puts the app at a 1600px CSS viewport there): the
   1400 cap left 200 CSS px of empty page, and with the content wrapper's own
   2rem the board's edge sat 158 device px in from the screen. It reads boxed
   in. This is deliberately NOT a bigger number for everyone — MW-18 is the
   record of what happened last time a global container moved, and every other
   page is still composed against 1400.
   A pixel cap AND a percentage, because either alone fails at one end: the
   percentage keeps a real gutter at 1536 where a flat 1640 would be inert and
   the board would run to the padding, and the pixel cap stops the track
   sprawling on a 2560 monitor. `2xl` only — `sm`/`md` are banned inside
   .app-shell (tailwind.config.js) and `xl` fires at 1280, where 1400 is
   already more width than the viewport has. */
const DESK_WIDE = "2xl:max-w-[min(1640px,94%)]";

/* The founder's other companies. One person holds a SEPARATE user row per
   workspace (register and Team invite each create one), so this list comes
   from the server, which links them by the mobile they confirmed. */
function WorkspaceSwitcher() {
  const { tenant, user, switchWorkspace } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");

  /* On mount, which IS on open: the menu's content is mounted by the popover
     only while it is open, so this asks once per opening and never on an
     ordinary page load.

     NO CANCELLATION FLAG, deliberately — the same trap BasicsFlow documents.
     The popover mounts and unmounts this content as it opens (and React's
     StrictMode double-invokes the effect besides), so a `live` flag captured
     per run was false by the time the answer arrived and every response was
     thrown away: the list fetched 200 OK and the menu still showed nothing.
     A setState on a component that has gone is ignored by React 18. */
  useEffect(() => {
    api.get("/auth/me/workspaces")
      .then(({ data }) => setRows(data?.workspaces || []))
      .catch(() => { /* the menu still works without it */ });
  }, []);

  const go = async (tenantId) => {
    setBusy(tenantId);
    try {
      await switchWorkspace(tenantId);
      /* A different workspace is a different everything — start it clean
         rather than reconciling every cached query in place.
         2026-10-02 — AND THIS ONE STAYS A FULL LOAD, deliberately. lib/navigate
         exists now and the consent toast uses it, but a router navigation here
         would keep every cached query from the company being left behind: the
         reload IS the feature. */
      window.location.href = "/";
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't open that company");
      setBusy("");
    }
  };

  const others = rows.filter((r) => r.tenant_id !== tenant?.id);
  /* 2026-09-20 (Yokesh) — starting a company is an owner's move. Someone who
     works in this workspace still sees the other companies THEY belong to and
     can move between them; they are simply not invited to found one from here.
     With neither, there is nothing to draw. */
  const canAddCompany = user?.role === "owner";
  if (!others.length && !canAddCompany) return null;
  return (
    <div className="border-b border-slate-900/[0.06] p-1.5" data-testid="workspace-switcher">
      {others.map((r) => (
        <button key={r.tenant_id} onClick={() => go(r.tenant_id)} disabled={!!busy}
          data-testid={`switch-workspace-${r.tenant_id}`}
          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900 disabled:opacity-60">
          <Buildings size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{r.tenant_name}</span>
          {/* The role held in ANOTHER company, whose role list this one has
              never seen — so the humanised key is the best that is honest. */}
          <span className="shrink-0 text-[11px] text-slate-500">{roleLabel(r.role, null, "")}</span>
        </button>
      ))}
      {canAddCompany && (
        <button onClick={() => navigate("/signup?add=1")}
          data-testid="add-company"
          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900">
          <Plus size={15} /> {t("header.add_company", "Add a company")}
        </button>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const { t } = useTranslation();
  /* J14-03 — one small "has anything moved?" for the whole signed-in app, which
     refreshes the lists that changed. Mounted here rather than on each screen so
     the cost does not grow with what is open. See hooks/usePulse.js. */
  usePulse(!!user);
  // NAV/BOTTOM_NAV/hasPerm are stable module-level refs; only `user` can change.
  const navMain = useMemo(() => NAV.filter((n) => navEntryOpen(n, user?.role === "owner", (p) => hasPerm(user, p))), [user]);
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
    // ASK-43 — own pixels, not visual ones: navW is used as a CSS width inside
    // the zoomed shell. Identical at scale 1; a fifth out at the phone's 0.8
    // (this shelf is desktop-only, so it is correctness rather than a fix).
    const measure = () => setNavW(Math.round(el.offsetWidth) + 36);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const navigate = useNavigate();
  const location = useLocation();

  // ── NM-17 · the Dex dissolve ────────────────────────────────────────────
  // /brain renders dark whatever the app's theme is; the transition into the
  // room is cross-faded rather than flipped.
  //
  // KR-5: `wantDark = dexRoute`, full stop. User-facing dark mode retired
  // with the Karma language (approved plan) — Karma is a two-zone light
  // composition and `dark` now means "inside the ink", which only the Dex
  // room asserts at page level. ASK-33 Phase 5 (founder, 2026-09-16) removed
  // the rest: useTheme, the Settings and Login switches and the All Apps theme
  // branch are gone, and index.js clears any saved "dark". This class now
  // belongs to the Dex room alone.
  const dexRoute = location.pathname.startsWith("/brain") || location.pathname.startsWith("/dex");
  /* DEX-SLIDER Part 1 — the Desk, and only the Desk. The slider's left end IS
     Ask there, so a second way in beside the bar is one too many; every other
     phone page keeps the circle, because asking about the page you are on is
     the whole point of it. /inbox is the Desk's route (App.js); "/" and "/app"
     resolve to it or to /my-work, so they are not it. */
  const deskHasSlider = DEX_SLIDER && location.pathname.startsWith("/inbox");

  /* The doors handed down to the page. Ask is exactly what the circle opened —
     same sheet, same channel, same conversation — so the slider is a second
     way to the same room and not a second room. Memoised so a page that reads
     it does not re-render on every tick of Layout's own state. */
  const dexDoors = useMemo(() => ({
    openAsk: () => { setDexChannel("ask"); setDexOpen(true); setDexInline(false); },
    /* The Desk's own door: same channel, same conversation, drawn in its sheet.
       `chat` and `dex` ride along because the page cannot reach Layout's state
       any other way, and the whole point is that it is not a second copy. */
    openAskInline: () => { setDexChannel("ask"); setDexOpen(true); setDexInline(true); },
    closeAsk: () => { setDexOpen(false); setDexChannel(null); setDexInline(false); },
  }), []);
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
  /* ASK-INLINE (2026-10-05) — the same conversation, hosted by the Desk.
     The founder's redesign puts Ask inside the Desk's black sheet rather than
     in a sheet of its own: the board clears, the KPI grid folds away and the
     transcript takes the space, with the slider below it as the composer.
     What must NOT change is that there is ONE conversation. Layout still owns
     it — the dock, the FAB and the Desk have always shared a single `chat`,
     and two would mean a founder's question going to a transcript they are not
     looking at. So this flag only decides WHERE it is drawn: `true` and the
     overlay sheet stands down because the Desk is already drawing it. */
  const [dexInline, setDexInline] = useState(false);
  /* KM-25 — the mobile shell stops being a document that scrolls and becomes a
     frame: a top region that does not move, and a scroller under it. The slot
     is state rather than a ref because a page's header portals into it and has
     to re-render once the element exists.
     ASK-35 1.5 — what it no longer is: a wordmark row that folds away. */
  const [headerSlot, setHeaderSlot] = useState(null);
  const isMobileShell = useIsMobile();
  /* 2026-10-06 — AND EVERY OTHER ROOM GETS THE SLIDER TOO, as the dock itself.
     The founder's point was that Dex looked like two different features: a
     slider on the Desk and the old circle in the corner everywhere else. So
     off the Desk the bar IS the control (DockSlider), the circle is gone, and
     the only place that still runs the original dock is the Desk, which has
     its own slider on its own sheet and is explicitly out of scope. */
  /* 2026-10-06 — UNIVERSAL, the Desk included. The founder: "remove the slider
     container from the home screen desk and make this dock change universal...
     keep this centred slider button for the desk screen also." So there is one
     Dex control in the product again — this bar — and the Desk's sheet goes
     back to being a list of decisions. */
  const dockIsSlider = DEX_SLIDER && isMobileShell;
  /* Decide, off the Desk. The right end of the bar hands over to the SAME
     component the Desk uses in its overlay form — one capture, one review, one
     decision pipeline, rather than a second implementation that would drift. */
  const [dockDecide, setDockDecide] = useState(false);
  /* THE BAR HAS TO SEE THE CAPTURE, or Decide looks dead. (2026-10-06 —
     founder: "no ask and no decide function is responding, only the slide
     function is there.")
     They were half right and the half matters: swiping right DID mount the
     well and start the microphone — it just started it somewhere the bar could
     not see, so there was no waveform, no send, and no way to stop what was
     already recording. The Desk solved this long ago by having the well
     publish its meter back to the slider; this is the same wire, to the same
     control, now that the control is the dock. */
  const [dockLive, setDockLive] = useState({ recording: false, capturing: false, levelsRef: null });
  const dockStopRef = useRef(null);
  const onDockMeter = useCallback((c) => {
    dockStopRef.current = c.stop;
    setDockLive({ recording: !!c.recording, capturing: !!c.capturing, levelsRef: c.levelsRef });
  }, []);
  /* The page reserves room against --dock-h, and the slider bar is taller than
     the one it replaces. Published on <html> so the CSS can switch the token
     without every consumer learning which bar is up. */
  useEffect(() => {
    const root = document.documentElement;
    if (dockIsSlider) root.dataset.dockSlider = "1"; else delete root.dataset.dockSlider;
    return () => { delete root.dataset.dockSlider; };
  }, [dockIsSlider]);
  useEffect(() => { if (!dockIsSlider) setDockDecide(false); }, [dockIsSlider]);
  // ASK-42 D — the Desk is the one room with a top bar; several rules below
  // ask the same question, so it is asked once.
  const onInbox = location.pathname.startsWith("/inbox");
  /* ASK-35 1.5 — KM-25's `brandGone` / `collapsingShell` / `brandFolded` and
     main's onScroll handler are gone with the row they folded. KM-27 had
     already opted /inbox out of the collapse, and the row existed on no other
     route, so the fold state was being computed for a row that could never
     read it. */

  // MPWA-12f: an empty state whose primary action is "tell Dex to start one" has
  // to be able to open the sheet, and the sheet's state lives here. A window
  // event rather than threading a callback through every page: the alternative is
  // a prop on Layout -> page -> list -> EmptyState, four levels deep, for one
  // button. 12i uses the same event across the rest of the empty states.
  /* ASK-35 2.7 — ASK-33 Phase 4-B's HAND-OFF IS GONE. The Desk's Dex well had
     no workspace below lg, so it sent the capture and passed it here with
     { channel: "decide", … }; it expands in place now, so nothing dispatches
     that channel and `handoffRef`, the decide branch of this listener and the
     setDexChannel("decide") call have all gone with it. What is left is the
     plain open — MPWA-12f's empty states, which want the ASK sheet.
     DexChat's `channel` prop and its Decide copy are deliberately LEFT: they
     cost nothing while unused and they are the cheapest way back if the sheet
     ever takes a decision again. */
  /* ASK-33.1 — the Desk well asks, before it sends, whether the Dex behind the
     sheet is still reading a note; a second capture would retire that poll and
     leave a failure with nowhere to land. It STAYS: the Ask sheet can still be
     busy, and the well must still be able to refuse a send. */
  const dexReadingRef = useRef(null);
  useEffect(() => {
    const onState = (e) => { if (e.detail) e.detail.reading = !!dexReadingRef.current?.(); };
    window.addEventListener("dos:dex-state", onState);
    return () => window.removeEventListener("dos:dex-state", onState);
  }, []);
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
  /* KM-54 — which door Dex was opened by: "ask" or "decide"; null while it is
     closed. ASK-33 Phase 4 — there is no picker any more: the FAB opens "ask",
     and "decide" is set only when the Desk's Dex well hands a decision to the
     sheet (handoffRef, below). DexFab.jsx records why the doors collapsed and
     what that trade costs. */
  const [dexChannel, setDexChannel] = useState(null);
  const dex = useDexCapture({
    watch: true,
    onRecordingChange: (on, secs) => setDexRecording({ on, secs }),
    onCaptured: refreshAfterCapture,
    // Stopping a recording now yields TEXT for review, not a committed capture.
    // ASK-32 1.6 — the held note's id comes back with the words.
    onTranscript: (text, noteId) => draftSinkRef.current?.(text, noteId),
    /* Ask-mode audio goes to /transcribe: text back, nothing persisted. Only
       Decide-mode audio becomes a decision. */
    channel: dexChannel === "ask" ? "dictate" : "capture",
    /* KM-60 — the meter does NOT write state here. This hook lives in Layout,
       so every sample re-rendered the entire shell and the page inside it ~18
       times a second while recording. That is the main-thread pressure behind
       "I can't stop the recording, but I can when I go quiet": a tap has to
       wait its turn, and the busier the wave the longer the queue. The dock's
       wave now reads dex.levelsRef on its own animation frame instead — the
       same motion, none of the renders. */
    meterState: false,
  });
  /* KM-26 — one conversation, three surfaces: the dock hosts the input, the
     FAB submits it, the transcript shows it. None of them can own the state, so
     it lives in the hook and Layout hands it to all three. */
  /* ASK-33 Phase 4 — every Decide ending, wherever it was sent from. The Desk
     refreshes as it lands (the decision exists only once the note is
     structured), and when the sheet has been closed by then the ending is a
     toast, not a sheet that re-opens itself (KM-23's ghost card). Read through
     refs: a toast's buttons act long after this render. */
  const dexOpenRef = useRef(dexOpen);
  dexOpenRef.current = dexOpen;
  const dexChatRef = useRef(null);
  const onDexEnding = useCallback((message) => {
    refreshAfterCapture();
    if (dexOpenRef.current) return false;
    toastDexOutcome(message, {
      onReview: (id) => navigate(`/inbox?decision=${encodeURIComponent(id)}`),
      // Phase 5 — re-sent from the notice with the sheet closed: quiet, so no
      // transcript no one is reading gets "Reading it again…".
      onRetry: (o) => dexChatRef.current?.retry(o.retry, null, { quiet: !dexOpenRef.current }),
      canRetry: () => !!dexChatRef.current?.canRetry,
    });
    // Reported here, so it is not also left in the transcript (Phase 5).
    return true;
  }, [navigate, refreshAfterCapture]);
  const chat = useDexConversation({
    dex,
    open: dexOpen,
    channel: dexChannel === "decide" ? "decide" : "ask",
    onCommitted: refreshAfterCapture,
    userId: user?.id,
    onEnding: onDexEnding,
  });
  /* The value the Desk actually receives. Re-made when the conversation ticks,
     unlike `dexDoors` above, which is memoised once because a page that only
     opens a door must not re-render on every word Dex says. Declared HERE, not
     beside the doors, because `chat` does not exist until this line. */
  const dexDeskHost = useMemo(() => ({
    ...dexDoors, chat, dex, inline: dexInline && dexOpen,
  }), [dexDoors, chat, dex, dexInline, dexOpen]);
  draftSinkRef.current = chat.setDraftFromVoice;
  dexChatRef.current = chat;
  dexReadingRef.current = () => isReading(dex) || chat.busy;
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
  /* ASK-34 C3 — WHO SEES THE JOURNAL IS THE BACKEND'S ANSWER, NOT OURS.
     desk.py has returned `shortcuts: { ceo_journal: is_owner, … }` all along and
     the frontend has ignored it, so the rule lived in two places waiting to
     disagree. The menu entry reads it. Same query key as pages/desk/
     useDeskMetrics, so on /inbox this costs nothing at all and elsewhere it is
     one request that the rest of the shortcuts can also be hung off later. */
  const { data: deskSummary } = useQuery({
    queryKey: ["desk-summary"],
    queryFn: () => api.get("/desk/summary").then((r) => r.data),
    refetchInterval: 60000,
  });
  const showJournal = !!deskSummary?.shortcuts?.ceo_journal;
  const captureCount = capPending?.count || 0;

  const openNotif = async (n) => {
    if (!n.read) {
      try { await api.post(`/notifications/${n.id}/read`); qc.invalidateQueries({ queryKey: ["notifications"] }); } catch (e) { console.debug("notif mark-read failed (non-blocking)", e); }
    }
    const to = notifLink(n);
    if (to) navigate(to);
  };

  /* ASK-35 1.5 — DESKTOP ONLY NOW. The `mobile` variant existed for one call
     site, the phone's brand row, and that row is gone; the phone reaches
     notifications through the dock's More badge and AllAppsPanel's
     Notifications tile. Desktop keeps exactly what it had — the 40px outlined
     circle and the raw unread count — so §9.2's pixel-identical requirement
     still holds. */
  const Bellicon = () => {
    const items = (notif?.notifications || []).slice(0, 7);
    return (
      <Popover>
        <PopoverTrigger asChild>
          {/* KR-5: the reference's outlined circle. The badge goes ORANGE: a
              notification count is alert grammar, exactly what --kr-accent
              exists for. */}
          {/* J2-14 (JOURNEY-1) — THE BADGE COUNTS WHAT NEEDS THEM, on the
              desktop as well. It wore the raw unread count, so on a first day
              it read "3 need you" beside a Desk with nothing waiting: the
              three were the welcome and the two the sign-up wrote. The phone's
              bell has counted only approvals, escalations and mentions since
              MPWA-03 (§8) — `bellCount`, ten lines up — and a badge that means
              one thing on a phone and another on a laptop is two badges. The
              panel below still says how many are NEW, which is every one of
              them: that word is honest, "need you" was not. */}
          <button data-testid="notif-bell"
            aria-label={bellCount > 0 ? `Notifications, ${bellCount} need you` : "Notifications"}
            className="relative h-10 w-10 rounded-full border border-kr-ink/55 grid place-items-center text-foreground/90 transition-colors hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline">
            <Bell size={18} weight="regular" />
            {bellCount > 0 && (
              <span data-testid="notif-count"
                className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-kr-accent px-1 text-[10px] font-bold leading-none text-white">
                {bellCount > 99 ? "99+" : bellCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        {/* 2026-09-14, founder — the top bar's dropdowns wear the app's glass
            list: the white glass panel, hairline rules, rounded rows. */}
        <PopoverContent align="end" className={`${GLASS_MENU} w-80 p-0`} data-testid="notif-dropdown">
          <div className="flex items-center justify-between border-b border-slate-900/[0.06] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("header.notifications")}</p>
            {unread > 0 && <span className="text-xs font-medium text-slate-700">{unread} {t("header.new")}</span>}
          </div>
          <div className="max-h-96 space-y-0.5 overflow-y-auto p-1.5">
            {items.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{t("header.all_caught_up")}</p>}
            {items.map((n) => {
              const meta = notifMeta(n);
              return (
                <button key={n.id} data-testid={`notif-item-${n.id}`} onClick={() => openNotif(n)}
                  className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-900/[0.05] ${n.read ? "opacity-60" : ""}`}>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-900" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip value={meta.label} className={`${meta.cls} text-[9px]`} />
                      <span className="text-[11px] text-slate-500">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-900">{n.work_title || n.message}</p>
                    {n.sender_name && <p className="truncate text-[11px] text-slate-500">{n.sender_name}</p>}
                  </div>
                </button>
              );
            })}
          </div>
          <button onClick={() => navigate("/notifications")} data-testid="notif-view-all"
            className="w-full border-t border-slate-900/[0.06] px-4 py-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-900/[0.04]">
            {t("header.view_all")}
          </button>
        </PopoverContent>
      </Popover>
    );
  };

  // KR-5: ThemeToggle is DELETED from the desktop shell, not hidden — dark
  // mode retired with the Karma language and a control that can never change
  // what is on screen is worse than no control. ASK-33 Phase 5 finished the
  // job on the founder's call: no theme switch anywhere, no stored preference.

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
    <DexDoorsContext.Provider value={isMobileShell ? dexDeskHost : null}>
    {/* ASK-43 — the phone's shell divides by the scale too. Viewport units are
        not divided by CSS zoom, so at 0.8 a bare 100dvh paints at 80% of the
        screen and the app stops short of the bottom; the desktop half of this
        line has divided 100vh since the day the scale existed, for that. */}
    <div className="app-sky flex h-[calc(100dvh/var(--ui-scale,1))] flex-col overflow-hidden bg-nm text-foreground lg:h-[calc(100vh/var(--ui-scale,1))]">
      {/* The page-artwork layer. Empty and invisible until a room sets
          --sky-art (see "PAGE ARTWORK" in index.css); position:fixed keeps it
          out of this flex column. It is a real element rather than a third
          pseudo-element because ::before is the drifting gradient and ::after
          is the Dex sky, and artwork must not drift. */}
      <div className="app-sky__art" aria-hidden="true" />
      {/* B20 — above everything, on every screen, for as long as they are in
          the demo. It renders nothing in a real workspace. */}
      <DemoWorkspaceBanner />
      <ConnectionNotice />
      <WelcomeOverlay />
      {/* An owner who came in by mobile adds an email and password first;
          a member's first screen asks them to check their details. */}
      <OwnerCredentialsGate />
      <WelcomeMemberCard />
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
        /* minmax(0,1fr) on the LEFT track only. A bare 1fr has an `auto`
           minimum, so the workspace name grew the cell to its own max-content
           and ran on underneath the nav plate instead of ellipsing — measured
           at 1280 with a long name, the cell's right edge was 687 against a
           nav starting at 371. The right track keeps its auto minimum on
           purpose: the controls in it are fixed-size and must never be
           squeezed, and with room to spare both tracks still take an equal
           share, so the pills stay on the centre line. */
        className="kr-navplate hidden lg:grid h-[88px] shrink-0 grid-cols-[minmax(0,1fr)_auto_1fr] items-center gap-4 px-6 pb-[13px] bg-transparent"
        style={navW ? { "--navplate-w": `${navW}px` } : undefined}
      >
        {/* 2026-09-19, founder — the workspace's name sits after the wordmark,
            a pipe between them: the left cell of this header has been empty
            since the rail went, and which company you are looking at was
            otherwise only inside the account menu. min-w-0 + truncate because
            this cell is a 1fr grid track — a long workspace name has to cut
            rather than push the centred pill strip off its axis. */}
        {/* NO justify-self here. With `justify-self: start` the cell is sized
            shrink-to-fit, which resolved to its max-content and left the flex
            box wider than its own grid track — so nothing ever pressed on the
            name and the ellipsis could not engage, however many min-w-0s were
            added inside it (measured: a 740px cell in a 373px track). Letting
            it stretch makes the box exactly the track, and the content still
            sits left because flex-start is the default. */}
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
          <KarmaLogo className="shrink-0" />
          {tenant?.name && (
            <>
              <span aria-hidden="true" className="shrink-0 select-none text-[17px] font-light leading-none text-foreground/25">|</span>
              {/* min-w-0 on the SPAN, not only on the flex box around it.
                  `truncate` sets overflow/ellipsis/nowrap but NOT min-width,
                  and a flex item defaults to min-width:auto — so without this
                  the name refuses to shrink below its longest word, overflows
                  its grid track and runs on under the nav plate. The wordmark
                  and the pipe are shrink-0 so the name is the only thing that
                  gives. */}
              <span data-testid="header-workspace" title={tenant.name}
                className="min-w-0 truncate text-[15px] font-medium leading-none text-foreground/70">
                {tenant.name}
              </span>
            </>
          )}
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
          {/* 2026-09-19, founder — the global search circle is HIDDEN. Only
              the button: ⌘K still opens the same dialog (the key handler and
              CommandDialog below are untouched), so nothing is lost, and this
              is one line to put back. */}
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
                  {/* 2026-09-29 — was `{user?.role}` under `capitalize`, which
                      left the underscores in: every non-owner read
                      "Accounts_&_buyer_payments" under their own name, on
                      every screen. `capitalize` is gone with it, because the
                      company's own label is already cased the way the owner
                      typed it. */}
                  <span className="block text-xs text-muted-foreground">{roleLabel(user?.role, tenant?.roles, "Member")}</span>
                </span>
              </button>
            </PopoverTrigger>
            {/* 2026-09-14, founder — the glass list, like every other dropdown. */}
            <PopoverContent align="end" className={`${GLASS_MENU} w-64 p-0`}>
              <div className="border-b border-slate-900/[0.06] px-4 py-3" data-testid="current-user">
                <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <div className="border-b border-slate-900/[0.06] px-4 py-2.5">
                <p className="text-xs text-slate-500">Workspace</p>
                <p data-testid="tenant-name" className="truncate text-sm font-medium text-slate-800">{tenant?.name}</p>
                {tenant?.industry && (
                  <p className="truncate text-xs text-slate-500">{tenant.industry}</p>
                )}
              </div>
              {/* 2026-09-20 — a founder may run more than one company on one
                  mobile. The others they can sign in to, and the way to start
                  another: both only when the menu is open, so the app does not
                  ask on every page load. */}
              <WorkspaceSwitcher />
              <div className="p-1.5">
                {/* ASK-34 C3 — the Journal's way in. It had none: /journal was
                    reachable only by typing the URL. It sits above Settings
                    because it is something you READ about the company, next to
                    the identity and workspace blocks it follows, where Settings
                    is configuration. Shown on the backend's own flag. */}
                {/* 2026-10-06 — the Company Brain's way in on desktop. Not an
                    eighth pill: seven is the strip's ceiling (KR-5), and the Brain
                    is a place you go to look things up, like the Journal. */}
                {hasPerm(user, "brain") && (
                  <button
                    onClick={() => navigate("/company-brain")}
                    data-testid="nav-company-brain"
                    className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900"
                  >
                    <BrainIcon size={15} /> {t("nav.company_brain", "Company Brain")}
                  </button>
                )}
                {showJournal && (
                  <button
                    onClick={() => navigate("/journal")}
                    data-testid="nav-journal"
                    className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900"
                  >
                    <BookOpen size={15} /> {t("nav.journal", "Journal")}
                  </button>
                )}
                {user?.role === "owner" && (
                  <button
                    onClick={() => navigate("/settings")}
                    data-testid="nav-settings"
                    className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900"
                  >
                    <GearSix size={15} /> {t("nav.settings", "Settings")}
                  </button>
                )}
                <button
                  onClick={doLogout}
                  data-testid="logout-button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900"
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
      {/* MW-18 — THE CAP IS BACK, and it is lifted per route rather than
          deleted. Dropping lg:max-w-[1400px] to satisfy a My Work ask changed
          a GLOBAL container: at 1920 every page went edge to edge, and the
          pages that were composed against a cap fell apart — Finance KPI
          tiles ~610px wide with the value and its arrow 550px apart, a
          1,856px Capture bar holding three small buttons, Team member cards
          with the name and '6 permissions' at opposite ends. Nothing
          overflowed; it just made the eye travel.
          My Work wants the width (a 4-column card grid genuinely uses it), so
          it opts in by route and everything else keeps the composition it was
          designed for. */}
      <div className={cn(
        "flex min-h-0 flex-1 flex-col min-w-0 app-shell lg:w-full lg:mx-auto",
        !WIDE_ROUTES.some((p) => location.pathname.startsWith(p)) && "lg:max-w-[1400px]",
        location.pathname.startsWith("/inbox") && DESK_WIDE
      )}>
        {/* Mobile top app bar — MPWA-03.
            Two controls, not four; min-h + top inset so nothing sits under the
            status bar in iOS standalone. Untouched by KR-5 beyond what the
            recipes re-skin. */}
        {/* KR-8.2: the mobile bar blends too — transparent, no border, no
            blur, static. The phone reference floats its title on the bloom. */}
        {/* KM-25 · the top region. It sits OUTSIDE <main>, which is the whole
            point: nothing can scroll through it, so nothing has to be painted
            over.
            ASK-35 1.5 — THE WORDMARK + BELL ROW IS GONE. It ran on /inbox only
            and cost the Desk ~56px of the one screen that has the most to say;
            the greeting, the score and the dial all start that much higher now.
            NOTHING IS ORPHANED, checked before deleting rather than assumed:
            the bell's count is `bellCount`, which the dock's More slot already
            wears (moreBadge, below) and AllAppsPanel already carries a
            Notifications tile with the same count and a route to
            /notifications. The wordmark's only other job was identity, and the
            app is installed by then.
            WHAT WENT WITH IT: the fold. `collapsingShell` was false on /inbox
            and the row existed nowhere else, so `brandGone`/`brandFolded` and
            main's onScroll were computing a state that could never be read. */}
        <div className="lg:hidden shrink-0">
          {/* ASK-42 D — THE DESK'S OWN TOP BAR IS BACK, and only the Desk's.
              ASK-35 1.5 deleted the wordmark-and-bell row for 56px of a screen
              that needed them; the founder wants identity and the bell back,
              "very subtle and blended, consuming compact space, just for the
              inbox page". So it is 32px of row, not 56: the wordmark at its
              smallest step and dropped to 60% ink, the bell at 18px in the same
              weight, both on the page's own bloom with no bar, no fill, no rule
              and nothing sticky. It owns the safe-area inset that the slot
              below used to carry, so the Desk's own content starts where it
              started — the bar is the 32px, not 32px plus an inset.
              THE BELL IS A LINK, not a popover: the phone has a whole room for
              notifications and a dropdown on a 390px screen is a worse version
              of it. Its target is the 44px floor even though the row is 32 —
              -my-1.5 lets the box overhang the row rather than setting the
              row's height, which is the same trick the dock's slots use.
              Notifications left the More menu in the same breath (AllAppsPanel)
              — this is where the count lives now. */}
          {onInbox && (
            <div
              data-testid="desk-topbar"
              className="px-gutter-safe flex items-center justify-between gap-3 pt-[calc(var(--sa-top)+0.375rem)]"
            >
              <KarmaLogo size="sm" className="opacity-60" />
              <Link
                to="/notifications"
                data-testid="desk-topbar-bell"
                aria-label={bellCount > 0 ? `Notifications, ${bellCount} need you` : "Notifications"}
                /* h-14 below lg: 44 CSS px is 35 REAL px under --ui-scale's 0.8, and the
                   bell is the only control in the top bar — there is nothing
                   beside it to crowd. accessibility.md › Offer sufficiently
                   sized controls. Desktop keeps 44 CSS, which is already 44pt
                   there. */
                className="relative -my-1.5 -mr-2 grid h-11 w-11 max-lg:h-14 max-lg:w-14 place-items-center rounded-full text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
              >
                <Bell size={18} weight="regular" aria-hidden="true" />
                {bellCount > 0 && (
                  <span
                    data-testid="desk-topbar-bell-dot"
                    aria-hidden="true"
                    className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-kr-accent ring-2 ring-[hsl(var(--background))]"
                  />
                )}
              </Link>
            </div>
          )}
          {/* A page's header lands here. Zero-height on routes with none.
              ASK-42 D — on /inbox the bar above owns the inset, so this slot
              adds nothing there; every other room still opens on 1.75rem of air
              over the safe area. */}
          <div
            ref={setHeaderSlot}
            data-testid="page-header-slot"
            className={cn(
              "px-gutter-safe",
              onInbox ? "pt-1" : "pt-[calc(var(--sa-top)+1.75rem)]",
            )}
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
          /* ASK-20 — lg:pb-0, not lg:pb-8. The bottom breathing room already
             comes from the content wrapper's own lg:p-8; main's copy of it was
             doubling to 64px, which read as dead space once main stopped being
             the scroller and its box could no longer scroll that padding away. */
          data-app-scroller=""
          /* ASK-39 1 — /inbox DROPS `pb-dock` ON A PHONE, and it has to for the
             Desk to stop scrolling. `.pb-dock` is 7.5rem of clearance so the
             last row of a scrolling page is never trapped under the floating
             dock; the Desk's black sheet has carried that same clearance INSIDE
             itself since ASK-35 1.2, so here it was being paid twice — and the
             second payment is 120px of empty document below a page that now
             measures exactly one screen, which is the whole of the overflow.
             Every other route keeps it: they scroll, and they have no sheet. */
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overflow-x-hidden app-canvas lg:overflow-x-clip lg:pb-0",
            onInbox ? "lg:pb-dock" : "pb-dock"
          )}
        >
          <AnnouncementBanner />
          {/* ASK-39 1 — and /inbox drops the wrapper's own bottom padding on a
              phone too, for the same reason: the Desk's sheet runs to the floor
              and carries its own clearance, so 1rem of wrapper below it is 1rem
              the page would have to scroll. */}
          {/* ASK-42 A/D — and on /inbox the wrapper is main's OWN height below
              lg (max-lg:h-full), which is what lets the Desk stop guessing.
              It sized itself with `100svh - safe-inset - 1.5rem`, a copy of
              this shell's arithmetic kept in another file, and the moment the
              Desk's top bar went back above main that copy was wrong by the
              height of the bar — every phone width scrolled by exactly 34px.
              main is a height-definite flex child, so `h-full` here and on the
              page inside it is the real number, whatever the chrome above main
              turns out to be. */}
          <div className={cn(
            "p-4 lg:p-8 px-gutter-safe lg:h-full lg:min-h-0 lg:flex lg:flex-col",
            /* ASK-46 — /inbox carries the dock's clearance again below lg. It
               dropped it in ASK-39 because the black sheet ran to the floor and
               held the clearance inside itself; the sheet is a card in the
               middle of the page now (index.css) and Dex sits under it, so the
               floor is the page's to keep clear. `h-full` and the padding
               together are what put Dex just above the bar: the page is exactly
               one screen, and its last row ends where the clearance starts.
               --dock-clear, not .pb-dock: 7.5rem is the clearance a SCROLLING
               page leaves so its last row sails past the bar, and this page
               does not scroll — it wants the bar's height, its inset and a
               seam, which is what that token is (index.css). And it has to be
               read as a variable rather than a class, because `.pb-dock` is
               hand-written CSS and Tailwind cannot build a `max-lg:` variant of
               a class it does not know — `lg:pb-dock` on <main> above has been
               generating nothing for exactly as long as it has been there. */
            onInbox && "max-lg:h-full max-lg:pb-[var(--dock-clear)]"
          )}>{children}</div>
        </main>
      </div>

      {/* MPWA-03 — mobile navigation.
          A floating pill detached from the edges (lists scroll *under* it,
          which is what `pb-dock` on main pays for), plus Dex as a separate
          64px circle on the same baseline. Desktop keeps its sidebar. */}
      {dockIsSlider ? (
        /* THE BAR IS THE CONTROL. Ask opens INSIDE it (the panel grows to half
           the screen and then scrolls); Decide hands over to the same capture
           and review card the Desk uses, through DeskDexWell's overlay, so
           there is one Decide in the product rather than two. */
        <DockSlider
          user={user}
          chat={chat}
          askOpen={dexOpen && dexInline}
          /* Decide's capture belongs to the well; Ask's is Layout's own. The
             bar shows whichever is live, and its handle stops that one. */
          capturing={dockDecide ? dockLive.capturing : !!dex.recording}
          recording={dockDecide ? dockLive.recording : !!dex.recording}
          levelsRef={dockDecide ? dockLive.levelsRef : dex.levelsRef}
          onStop={() => (dockDecide ? dockStopRef.current?.() : dex.stopRecording())}
          onAsk={() => { setDexChannel("ask"); setDexOpen(true); setDexInline(true); if (!dex.recording) dex.startRecording(); }}
          onDecide={() => setDockDecide(true)}
          onCloseAsk={() => { setDexOpen(false); setDexChannel(null); setDexInline(false); }}
          /* A TOGGLE, because More is now a state of the bar rather than a card
             over it: the same press that grew the dock puts it back, which is
             what a person does when the thing they opened is still under their
             thumb. (The floating panel below keeps `true` — there the press is
             caught by its own overlay, and a toggle would close it on the way
             through.) */
          onMore={() => setAllAppsOpen((v) => !v)}
          moreOpen={allAppsOpen}
          onOpenDecision={(id) => navigate(`/inbox?decision=${encodeURIComponent(id)}`)}
        />
      ) : (
      <FloatingDock
        /* With no circle beside it the bar centres itself (index.css,
           .app-dock-right-wide). Everywhere else the anchoring is untouched. */
        /* …and the dock gives the width back when the circle returns, or the
           two would overlap on the one screen that has both. */
        wide={deskHasSlider && (!dexOpen || dexInline)}
        user={user}
        onMore={() => setAllAppsOpen(true)}
        moreOpen={allAppsOpen}
        /* KM-1 — the badge on a container must be a promise the container
           keeps. This counted pending WhatsApp captures, but Review Queue is
           not a tile in the panel — it is a TAB inside /finance, which is the
           Money dock slot sitting right beside More. So the founder saw "3",
           opened More, and found nothing counting to three.
           ASK-42 D — and by that same rule it is GONE. It became the
           notification count because Notifications was the one badged tile in
           the panel; that tile has left for the Desk's top bar, so the number
           on More now counts something nothing inside More can show. The bell
           on /inbox carries it. */
        /* ASK-INLINE — the dock knows nothing about a conversation the Desk
           is hosting. Left as it was, the shared draft reached its own field
           and the founder got two composers echoing each other, one in the
           slider and one in the dock. These four are the whole of that leak. */
        dexActive={dexOpen && !dexInline}
        dexLevels={dex.levels}
        /* KM-60 — the live meter, read on the wave's own animation frame.
           `dexLevels` stays for the state-shaped API; this is what actually
           drives the motion, and it costs Layout no renders. */
        dexLevelsRef={dex.levelsRef}
        dexMode={dexInline ? "voice" : chat.mode}
        dexWaveState={dex.recording ? "listening" : chat.busy ? "thinking" : "idle"}
        dexDraft={dexInline ? "" : chat.draft}
        onDexDraft={chat.setDraft}
        onDexSubmit={chat.submit}
        /* KM-53 — the gap between "stop" and the transcript coming back.
           `dex.sending` covers the upload and the transcript poll; `!chat.draft`
           narrows it to the window where there is genuinely nothing to show,
           so the placeholder never sits on top of text that has already
           arrived. */
        dexTranscribing={!dexInline && !!dex.sending && !chat.draft}
        /* ASK-33.1 — which Dex the bar is serving, for its placeholder. */
        dexChannel={dexChannel}
      />
      )}
      {/* KM-11 — the vignette. Rendered always so it can transition rather
          than pop in, and gated by a data attribute. Sits below the dock's
          z-index so the bar stays fully lit while the edges fall away. */}
      <div className="kr-vignette lg:hidden" data-on={dex.recording ? "1" : "0"} data-mobile-chrome=""
           data-testid="dex-vignette" aria-hidden="true" />

      {/* KM-23 — the FAB opens the CONVERSATION again, and this time it is a
          conversation. KM-11 had made it a bare record toggle because the old
          sheet was only a receipt; DexChat is a transcript you can ask into,
          type into and attach to, so there is something worth opening. Voice
          still starts one tap in, from the mic inside it. */}
      {/* DEX-SLIDER Part 1 — NOT ON THE DESK. The slider's left end opens the
          same Ask sheet, so the circle would be a second door to one room.
          It is removed from this page only — `deskHasSlider` is false on My
          Work, Finance, CRM and the rest, where the circle is exactly as it
          was. With the flag off it is everywhere again, Desk included.

          …BUT IT COMES BACK THE MOMENT THE SHEET IS OPEN, and missing that is
          what broke Ask when it was opened from the slider. This circle has TWO
          jobs: shut, it is the door into Ask; open, it IS the composer's
          mic/send button, because KM-26 made the dock and this circle the Ask
          sheet's composer rather than drawing a second bar over them. The
          slider replaced the first job only. Removing the circle outright took
          the send button with it, so Ask opened on the Desk as a bar with
          nowhere to press — and only on the Desk, which is exactly the shape
          of the report. `dexOpen` is the whole fix. */}
      {/* ASK-INLINE — and NOT while the Desk's slider is the composer. The
          dock grows a mic and a field whenever Ask is open, which is right when
          Ask is a sheet over the page and wrong when the slider below the
          transcript is already carrying both. Two composers on one screen is
          the bug the founder called out the first time, arriving from the
          other side. */}
      {/* 2026-10-06 — and NOT where the dock is the slider: "remove the dex
          button entirely in other pages". The circle now exists only on a
          phone whose shell has neither slider, which is the flag-off path. */}
      {!dockIsSlider && (!deskHasSlider || (dexOpen && !dexInline)) && (
      <DexFab
        /* ASK-33 Phase 4 — closed, the FAB opens Dex in ASK: one tap, no
           picker, no scrim (KM-54's two doors collapsed; see DexFab.jsx). Open,
           it is the composer's send/mic/stop exactly as before. */
        onOpen={() => {
          if (dexOpen) { chat.submit(); return; }
          setDexChannel("ask");
          setDexOpen(true);
        }}
        recording={dex.recording}
        seconds={dex.recordSecs}
        onStop={() => dex.stopRecording()}
        intent={dexOpen ? chat.fabIntent : "sparkle"}
      />
      )}
      {/* DECIDE, OFF THE DESK. The same well the Desk opens from its own
          slider's right end, in the surface that draws no screen of its own —
          just the capture and its review card. It mounts only while open, so
          a page that never swipes right never pays for it. */}
      {/* MOUNTED, NOT MOUNTED-ON-DEMAND. (2026-10-06 — the second bug in this
          change, and the one the suites caught.) Rendering it only while
          `dockDecide` was true meant the component appeared with `open` already
          true, and its auto-start fired before its capture hook had settled:
          the microphone never began, the well published recording:false for the
          whole capture, and the handle's stop toggled the mic ON instead of
          handing over to the pop-up. The Desk always kept this mounted and
          toggled `open`, which is the transition the auto-start is written
          against — so that is what it gets. */}
      {dockIsSlider && (
        <DeskDexWell
          surface="overlay"
          open={dockDecide}
          phone
          onMeter={onDockMeter}
          /* WHERE THE CAPTURE'S STATUS PILL LANDS. The well renders it into
             whatever container it is given, and it used to be given the Desk's
             own column — so moving the well to Layout left "Dex is reading…"
             and "Decision ready" with no place in the layout at all, drawn
             behind the bar. It floats just above the bar now, on every page,
             which is also where it belongs once Decide can be started from
             anywhere. --dock-h follows whichever bar is up. */
          className="fixed inset-x-3 z-[10050] mx-auto max-w-md"
          style={{ bottom: "calc(var(--dock-bottom) + var(--dock-h, 4.5rem) + 0.75rem)" }}
          onClose={() => { setDockDecide(false); setDockLive({ recording: false, capturing: false, levelsRef: null }); }}
          onReview={(id) => { setDockDecide(false); navigate(`/inbox?decision=${encodeURIComponent(id)}`); }}
          /* "Save as draft — decide later", which the Desk used to wire and I
             did not: without it the pop-up's third answer was a button that
             did nothing. verify:dex caught it by watching for the POST. */
          onLater={(id) => saveAsDraft(id).then((ok) => {
            qc.invalidateQueries({ queryKey: ["desk"] });
            return ok;
          })}
        />
      )}
      {/* 2026-10-06 — THE FLOATING MENU IS THE OLD DOCK'S. With the slider in
          the bar, More grows the bar itself (mobile/DockSlider's DockMorePanel)
          and this card would be a second menu opening behind it. It stays for
          the path that still has the old dock — the flag off — where there is
          nothing to grow. */}
      <AllAppsPanel
        open={allAppsOpen && !dockIsSlider}
        onClose={() => setAllAppsOpen(false)}
        user={user}
        onSignOut={doLogout}
        onOpenLanguage={() => setLangOpen(true)}
      />
      {/* MPWA-05: third session, dismissible, above the dock (§8). */}
      <InstallPrompt />
      {/* ASK-33 Phase 5 — a failed Dex capture that must stay until dismissed,
          docked above the dock. While the sheet is open it moves into the
          sheet's own flow instead (DexChat). */}
      {!dexOpen && <DexFailureNotice placement="dock" />}
      {/* KM-23 — one surface, opened deliberately, closed for good.
          The old DexSheet was mounted on `!!dex.understanding`, so it let
          itself back in: finish a capture, dismiss the card, and the next poll
          re-populated `understanding` and the black sheet reappeared on its
          own. That is the ghost card the founder reported. The chat is driven
          by an explicit `dexOpen` instead, and a finished capture becomes a
          message inside it rather than a window of its own. (The poll that
          caused the re-open is separately fenced — see the dismiss token in
          useDexCapture.) */}
      {/* KM-54 — closing clears the channel, so the sheet never silently reuses
          a door opened earlier. ASK-33 Phase 4: the next tap on the FAB opens
          Ask; Decide is reached from the Desk's Dex well. */}
      <DexChat
        open={dexOpen && !dexInline}
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
    </DexDoorsContext.Provider>
    </HeaderSlotContext.Provider>
  );
}
