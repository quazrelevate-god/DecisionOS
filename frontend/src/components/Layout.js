import { useState, useMemo } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { hasPerm } from "../lib/perms";
import { toast } from "sonner";
import api from "../lib/api";
import { timeAgo } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { Chip } from "./common";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import {
  Microphone,
  Brain as BrainIcon,
  AddressBook,
  SignOut,
  EnvelopeSimple,
  Bell,
  Sun,
  MoonStars,
  Briefcase,
  GearSix,
  MicrophoneStage,
  List as ListIcon,
  FileArrowUp,
  Tray,
  UserCircle,
  Wallet,
  Gauge, // Epic 2 E2-15: Ops nav entry (Operating Score)
  UsersThree, // Epic 2 E2-01: Team nav entry (Employees list)
} from "@phosphor-icons/react";
import { ProfileDialog } from "./ProfileDialog";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { WelcomeOverlay } from "./WelcomeOverlay";

// Epic 2 Sprint A (E2-01 / E2-02 / E2-15): People retired; CRM (customers +
// suppliers) and Team (employees) are separate top-level entries. Ops is a
// new owner-only shortcut to Operating Score (removed from Brief in E2-11).
const NAV = [
  { to: "/", label: "Decision Desk", tkey: "inbox", icon: Tray, testid: "nav-inbox", perm: "inbox" },
  { to: "/brief", label: "CEO Brief", tkey: "brief", icon: Sun, testid: "nav-ceo-brief" },
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

// Primary items for the mobile bottom tab bar — kept at 5 slots.
// People slot is replaced by CRM (which surfaces customers + suppliers only);
// Team lives in the sidebar drawer only.
const BOTTOM_NAV = [
  { to: "/", label: "Desk", tkey: "desk", icon: Tray, perm: "inbox" },
  { to: "/brief", label: "Brief", tkey: "brief", icon: Sun },
  { to: "/my-work", label: "Work", tkey: "work", icon: Briefcase },
  { to: "/crm", label: "CRM", tkey: "crm", icon: AddressBook, perm: "people" },
  { to: "/brain", label: "Dex", tkey: "brain", icon: BrainIcon, perm: "brain" },
];

const Logo = () => (
  <div className="flex items-center gap-2.5">
    <div className="w-9 h-9 bg-brand-red rounded-lg flex items-center justify-center shrink-0">
      <span className="font-logo font-black text-white text-xl leading-none">D</span>
    </div>
    <span className="font-logo font-black text-2xl tracking-tight uppercase leading-none">
      <span className="text-foreground">Decision</span><span className="text-brand-red">OS</span>
    </span>
  </div>
);

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const { t } = useTranslation();
  // NAV/BOTTOM_NAV/hasPerm are stable module-level refs; only `user` can change.
  const navMain = useMemo(() => NAV.filter((n) => {
    if (n.ownerOnly && user?.role !== "owner") return false;
    if (n.perms) return n.perms.some((p) => hasPerm(user, p));
    return !n.perm || hasPerm(user, n.perm);
  }), [user]);
  const navBottom = useMemo(() => BOTTOM_NAV.filter((n) => !n.perm || hasPerm(user, n.perm)), [user]);
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggle: toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { data: notif } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data), refetchInterval: 30000 });
  const unread = notif?.unread || 0;
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

  const Bellicon = () => {
    const items = (notif?.notifications || []).slice(0, 7);
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button data-testid="notif-bell"
            className="relative w-10 h-10 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors">
            <Bell size={18} weight="bold" />
            {unread > 0 && (
              <span data-testid="notif-count" className="absolute -top-2 -right-2 bg-brand-red text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0 border border-black shadow-brutal" data-testid="notif-dropdown">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black">
            <p className="text-sm font-bold uppercase tracking-tight">{t("header.notifications")}</p>
            {unread > 0 && <span className="label-mono text-brand-red">{unread} {t("header.new")}</span>}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-black/10">
            {items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t("header.all_caught_up")}</p>}
            {items.map((n) => {
              const meta = notifMeta(n);
              return (
                <button key={n.id} data-testid={`notif-item-${n.id}`} onClick={() => openNotif(n)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-2 hover:bg-black/[0.03] transition-colors ${n.read ? "opacity-60" : ""}`}>
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-red shrink-0" />}
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

  const sendDigest = async () => {
    try {
      const { data } = await api.post("/brief/send-digest");
      toast.success(data.sent ? `Digest emailed to ${data.to}` : `Digest generated (email not configured — logged)`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send digest");
    }
  };

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
                ? "border-brand-red bg-brand-red/[0.08] text-brand-red font-semibold"
                : "border-transparent text-foreground/70 hover:bg-accent hover:text-foreground"
            }`
          }
        >
          <Icon size={18} weight="bold" />
          {t(`nav.${tkey}`)}
          {to === "/brief" && fires > 0 && (
            <span data-testid="nav-fires-badge" title={`${fires} fire(s) to put out`}
              className="ml-auto bg-brand-red text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold rounded-full animate-pulse">
              {fires}
            </span>
          )}
          {to === "/ingest" && captureCount > 0 && (
            <span data-testid="nav-review-badge" title={`${captureCount} item(s) to review`}
              className="ml-auto bg-brand-red text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold rounded-full">
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
          {tenant?.industry && <p className="label-mono text-brand-red truncate mt-1">{tenant.industry}</p>}
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
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold uppercase tracking-wider bg-white text-brand-red border-2 border-brand-red hover:bg-brand-red hover:text-white transition-colors"
          >
            <SignOut size={16} weight="bold" /> {t("header.sign_out")}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar */}
        <header className="hidden lg:flex h-16 border-b border-border bg-background/70 backdrop-blur-xl items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="label-mono text-muted-foreground">{t("header.signed_in_as")}</span>
            <span className="font-semibold text-sm" data-testid="current-user-name">{user?.name}</span>
            <span className="px-2 py-0.5 text-[11px] rounded-md uppercase tracking-wider bg-brand-red/10 text-brand-red border border-brand-red/20 font-semibold" data-testid="current-user-role">
              {user?.role}
            </span>
          </div>
          {user?.role === "owner" && (
            <div className="flex items-center gap-3">
              <button
                onClick={sendDigest}
                data-testid="send-digest-button"
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-foreground text-background font-semibold hover:opacity-90 transition-opacity"
              >
                <EnvelopeSimple size={16} weight="bold" /> {t("header.send_digest")}
              </button>
              <LanguageSwitcher />
              <ThemeToggle />
              <Bellicon />
            </div>
          )}
          {user?.role !== "owner" && (
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <ThemeToggle />
              <Bellicon />
            </div>
          )}
        </header>

        {/* Mobile top app bar */}
        <header className="lg:hidden h-14 border-b border-border bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 sticky top-0 z-20">
          <Logo />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <Bellicon />
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <button
                data-testid="mobile-menu-button"
                aria-label="Open menu"
                className="w-10 h-10 flex items-center justify-center border border-black bg-white hover:bg-brand-ink hover:text-white transition-colors"
              >
                <ListIcon size={20} weight="bold" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 border-r border-black rounded-none bg-white flex flex-col" data-testid="mobile-drawer">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
              <div className="px-6 py-5 border-b border-black">
                <Logo />
                <p className="mt-2 label-mono text-muted-foreground truncate">{tenant?.name}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="font-semibold text-sm">{user?.name}</span>
                  <span className="px-2 py-0.5 text-[11px] rounded-md uppercase tracking-wider bg-brand-red/10 text-brand-red border border-brand-red/20 font-semibold">
                    {user?.role}
                  </span>
                </div>
              </div>
              <nav className="flex-1 py-3 overflow-y-auto">
                <NavItems onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <div className="border-t border-black p-4 space-y-2 pb-24">
                {user?.role === "owner" && (
                  <button
                    onClick={() => { setDrawerOpen(false); sendDigest(); }}
                    data-testid="mobile-send-digest-button"
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg bg-foreground text-background font-semibold"
                  >
                    <EnvelopeSimple size={16} weight="bold" /> {t("header.send_digest")}
                  </button>
                )}
                <button
                  onClick={doLogout}
                  data-testid="mobile-logout-button"
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold uppercase tracking-wider bg-white text-brand-red border-2 border-brand-red hover:bg-brand-red hover:text-white transition-colors"
                >
                  <SignOut size={16} weight="bold" /> {t("header.sign_out")}
                </button>
              </div>
            </SheetContent>
          </Sheet>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 pb-24 lg:pb-8 overflow-x-hidden app-canvas">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t border-black bg-white flex z-[10000]" data-testid="mobile-bottom-nav">
        {navBottom.map(({ to, label, tkey, icon: Icon }) => {
          const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              data-testid={`bottomnav-${to === "/" ? "dashboard" : to.slice(1)}`}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 border-r border-black/10 last:border-r-0 transition-colors ${
                active ? "bg-brand-ink text-white" : "text-brand-ink hover:bg-black/5"
              }`}
            >
              <Icon size={20} weight={active ? "fill" : "bold"} />
              <span className="text-[10px] uppercase tracking-wide font-semibold leading-none">{t(`bottomnav.${tkey}`)}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
