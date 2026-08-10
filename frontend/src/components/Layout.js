import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  CaretUpDown,
  EnvelopeSimple,
  GearSix,
  List as ListIcon,
  MagnifyingGlass,
  Microphone,
  MoonStars,
  SidebarSimple,
  SignOut,
  Sun,
  UserCircle,
} from "@phosphor-icons/react";

import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import api from "../lib/api";
import { timeAgo } from "../lib/format";
import { notifMeta, notifLink } from "../lib/notif";
import { hasPerm } from "../lib/perms";
import { visibleGroups, BOTTOM_NAV, canSee, activeItem } from "../lib/nav";
import { cn } from "../lib/utils";
import { Chip } from "./common";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "./ui/sheet";
import { ProfileDialog } from "./ProfileDialog";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { WelcomeOverlay } from "./WelcomeOverlay";
import { CommandPalette, openCommandPalette } from "./CommandPalette";

const SIDEBAR_KEY = "decisionos-sidebar-collapsed";

/* -------------------------------------------------------------------------- */
/* Brand mark                                                                  */
/* -------------------------------------------------------------------------- */

const Logo = ({ collapsed = false }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs"
      aria-hidden="true"
    >
      <span className="text-[15px] font-semibold leading-none tracking-tight">D</span>
    </div>
    {!collapsed && (
      <span className="truncate text-[17px] font-semibold leading-none tracking-tight">
        Decision<span className="text-primary">OS</span>
      </span>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Icon button — one shape for every piece of chrome                           */
/* -------------------------------------------------------------------------- */

function IconButton({ label, children, className, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground",
        "transition-[background-color,color,transform] duration-200 active:scale-[0.96]",
        "hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { isDark, toggle: toggleTheme } = useTheme();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "1"
  );

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const groups = useMemo(() => visibleGroups(user), [user]);
  const navBottom = useMemo(() => BOTTOM_NAV.filter((n) => canSee(user, n)), [user]);
  const current = activeItem(location.pathname);

  /* ---- live counters ---------------------------------------------------- */

  const { data: notif } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then((r) => r.data),
    refetchInterval: 30000,
  });
  const unread = notif?.unread || 0;

  const { data: brief } = useQuery({
    queryKey: ["fires-count"],
    queryFn: () => api.get("/brief?period=morning").then((r) => r.data),
    refetchInterval: 60000,
    enabled: user?.role === "owner",
  });
  const { data: capPending } = useQuery({
    queryKey: ["captures-pending"],
    queryFn: () => api.get("/captures/pending-count").then((r) => r.data),
    refetchInterval: 30000,
  });

  const counters = useMemo(
    () => ({ fires: brief?.counters?.fires || 0, captures: capPending?.count || 0 }),
    [brief, capPending]
  );

  /* ---- actions ---------------------------------------------------------- */

  const doLogout = useCallback(() => {
    logout();
    navigate("/login");
  }, [logout, navigate]);

  const sendDigest = useCallback(async () => {
    try {
      const { data } = await api.post("/brief/send-digest");
      toast.success(
        data.sent
          ? `Digest emailed to ${data.to}`
          : "Digest generated (email not configured — logged)"
      );
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send digest");
    }
  }, []);

  // Capture is the product's atomic gesture, so it is reachable from anywhere:
  // the header CTA, the mobile FAB and ⌘K all land on the right surface for
  // this user's permissions.
  const goCapture = useCallback(() => {
    setDrawerOpen(false);
    if (hasPerm(user, "inbox") || hasPerm(user, "voice_capture")) navigate("/");
    else if (hasPerm(user, "data_input")) navigate("/ingest");
    else navigate("/my-work");
  }, [user, navigate]);

  const openNotif = async (n) => {
    if (!n.read) {
      try {
        await api.post(`/notifications/${n.id}/read`);
        qc.invalidateQueries({ queryKey: ["notifications"] });
      } catch (e) {
        console.debug("notif mark-read failed (non-blocking)", e);
      }
    }
    const to = notifLink(n);
    if (to) navigate(to);
  };

  /* ---- chrome pieces ---------------------------------------------------- */

  const NotificationBell = () => {
    const items = (notif?.notifications || []).slice(0, 7);
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="notif-bell"
            aria-label={`${t("header.notifications")}${unread ? ` (${unread})` : ""}`}
            className={cn(
              "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground",
              "transition-[background-color,color,transform] duration-200 active:scale-[0.96]",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            )}
          >
            <Bell size={18} weight="bold" />
            {unread > 0 && (
              <span
                data-testid="notif-count"
                data-numeric
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[9px] font-semibold leading-none text-destructive-foreground ring-2 ring-background"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[22rem] overflow-hidden rounded-xl border border-border bg-popover p-0 shadow-lg"
          data-testid="notif-dropdown"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">{t("header.notifications")}</p>
            {unread > 0 && (
              <span className="label-mono text-primary">
                {unread} {t("header.new")}
              </span>
            )}
          </div>
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.length === 0 && (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                {t("header.all_caught_up")}
              </p>
            )}
            {items.map((n) => {
              const meta = notifMeta(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  data-testid={`notif-item-${n.id}`}
                  onClick={() => openNotif(n)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors duration-200 hover:bg-accent",
                    n.read && "opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-primary"
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip value={meta.label} tone={meta.tone} />
                      <span className="label-mono text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">
                      {n.work_title || n.message}
                    </p>
                    {n.sender_name && (
                      <p className="label-mono truncate text-muted-foreground">{n.sender_name}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => navigate("/notifications")}
            data-testid="notif-view-all"
            className="w-full border-t border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
          >
            {t("header.view_all")}
          </button>
        </PopoverContent>
      </Popover>
    );
  };

  const ThemeToggle = () => (
    <IconButton
      onClick={toggleTheme}
      data-testid="theme-toggle"
      label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
    </IconButton>
  );

  /** One nav row, shared by the desktop sidebar and the mobile drawer. */
  const NavRow = ({ item, onNavigate, compact }) => {
    const count = item.badge ? counters[item.badge] : 0;
    const row = (
      <NavLink
        to={item.to}
        end={item.end}
        data-testid={item.testid}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "group relative flex items-center gap-3 rounded-lg text-sm",
            "transition-[background-color,color] duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
            compact ? "justify-center px-0 py-2.5" : "px-3 py-2",
            isActive
              ? "bg-primary-subtle font-medium text-primary"
              : "text-sidebar-muted hover:bg-accent hover:text-sidebar-foreground"
          )
        }
      >
        {({ isActive }) => (
          <>
            {/* Active indicator — a Klein hairline, not a filled block. */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-200",
                isActive ? "opacity-100" : "opacity-0"
              )}
            />
            <item.icon size={18} weight={isActive ? "fill" : "regular"} className="shrink-0" />
            {!compact && <span className="truncate">{t(item.tkey, item.label)}</span>}
            {count > 0 &&
              (compact ? (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive"
                />
              ) : (
                <span
                  data-testid={item.badge === "fires" ? "nav-fires-badge" : "nav-review-badge"}
                  data-numeric
                  className="ml-auto rounded-md bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-4 text-destructive"
                >
                  {count}
                </span>
              ))}
          </>
        )}
      </NavLink>
    );

    if (!compact) return row;
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {t(item.tkey, item.label)}
        </TooltipContent>
      </Tooltip>
    );
  };

  const NavTree = ({ onNavigate, compact = false }) => (
    <div className={cn("flex flex-col gap-6", compact ? "px-2" : "px-3")}>
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-1">
          {compact ? (
            <div className="mx-auto mb-1 h-px w-6 bg-sidebar-border" aria-hidden="true" />
          ) : (
            <p className="label-mono px-3 pb-1 text-muted-foreground/70">{t(g.tkey, g.label)}</p>
          )}
          {g.items.map((item) => (
            <NavRow key={item.to} item={item} onNavigate={onNavigate} compact={compact} />
          ))}
        </div>
      ))}
    </div>
  );

  const UserMenu = ({ align = "start", className }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="current-user"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
            "transition-[background-color] duration-200 hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold uppercase text-primary"
            aria-hidden="true"
          >
            {(user?.name || "?").slice(0, 2)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" data-testid="current-user-name">
              {user?.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
          </span>
          <CaretUpDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60 rounded-xl">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal">
          <span className="truncate text-sm font-medium">{user?.name}</span>
          <span
            data-testid="current-user-role"
            className="rounded-md border border-primary/25 bg-primary-subtle px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
          >
            {user?.role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setProfileOpen(true)} data-testid="menu-profile">
          <UserCircle size={16} weight="bold" /> Profile
        </DropdownMenuItem>
        {user?.role === "owner" && (
          <DropdownMenuItem onSelect={() => navigate("/settings")} data-testid="menu-settings">
            <GearSix size={16} weight="bold" /> {t("nav.settings")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={doLogout}
          data-testid="logout-button"
          className="text-destructive focus:text-destructive"
        >
          <SignOut size={16} weight="bold" /> {t("header.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /* ---- render ----------------------------------------------------------- */

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background text-foreground">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <WelcomeOverlay />
        <CommandPalette
          user={user}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onCapture={goCapture}
          onLogout={doLogout}
        />
        <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />

        {/* ---------------- Desktop sidebar ---------------- */}
        <aside
          data-testid="sidebar"
          data-collapsed={collapsed ? "true" : "false"}
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex",
            "transition-[width] duration-300 ease-out",
            collapsed ? "w-[4.5rem]" : "w-[17rem]"
          )}
        >
          <div
            className={cn(
              "flex h-16 shrink-0 items-center border-b border-sidebar-border",
              collapsed ? "justify-center px-2" : "justify-between px-4"
            )}
          >
            <Logo collapsed={collapsed} />
            {!collapsed && (
              <IconButton
                label="Collapse sidebar"
                onClick={() => setCollapsed(true)}
                data-testid="sidebar-collapse"
                className="h-8 w-8"
              >
                <SidebarSimple size={17} weight="bold" />
              </IconButton>
            )}
          </div>

          {collapsed && (
            <div className="flex justify-center py-3">
              <IconButton
                label="Expand sidebar"
                onClick={() => setCollapsed(false)}
                data-testid="sidebar-expand"
              >
                <SidebarSimple size={17} weight="bold" />
              </IconButton>
            </div>
          )}

          {/* Workspace identity — the tenant, not a decorative label. */}
          {!collapsed && (
            <div className="border-b border-sidebar-border px-4 py-3">
              <p data-testid="tenant-name" className="truncate text-sm font-medium">
                {tenant?.name}
              </p>
              {tenant?.industry && (
                <p className="label-mono mt-0.5 truncate text-muted-foreground">
                  {tenant.industry}
                </p>
              )}
            </div>
          )}

          {/* ⌘K entry point sits above the nav — search before browse. */}
          <div className={cn("py-3", collapsed ? "px-2" : "px-3")}>
            {collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <IconButton
                    label="Search and commands"
                    onClick={openCommandPalette}
                    data-testid="sidebar-command-collapsed"
                    className="mx-auto"
                  >
                    <MagnifyingGlass size={17} weight="bold" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="right">Search · ⌘K</TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={openCommandPalette}
                data-testid="sidebar-command"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
                  "text-sm text-muted-foreground shadow-xs",
                  "transition-[border-color,background-color] duration-200 hover:border-border-strong hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <MagnifyingGlass size={16} weight="bold" />
                <span className="flex-1 text-left">{t("command.trigger", "Search…")}</span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                  ⌘K
                </kbd>
              </button>
            )}
          </div>

          <nav
            aria-label="Main navigation"
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4"
          >
            <NavTree compact={collapsed} />
          </nav>

          <div className="shrink-0 border-t border-sidebar-border p-2">
            {collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={doLogout}
                    data-testid="logout-button-collapsed"
                    aria-label={t("header.sign_out")}
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <SignOut size={17} weight="bold" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("header.sign_out")}</TooltipContent>
              </Tooltip>
            ) : (
              <UserMenu />
            )}
          </div>
        </aside>

        {/* ---------------- Main column ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Desktop header */}
          <header className="sticky top-0 z-20 hidden h-16 items-center justify-between gap-4 border-b border-border glass px-6 lg:flex">
            <div className="flex min-w-0 items-center gap-3">
              {current && (
                <>
                  <current.icon
                    size={17}
                    weight="bold"
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h2 className="truncate text-[15px] font-semibold tracking-tight">
                    {t(current.tkey, current.label)}
                  </h2>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={goCapture}
                data-testid="header-capture"
                className={cn(
                  "mr-1 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-xs",
                  "transition-[background-color,box-shadow,transform] duration-200",
                  "hover:-translate-y-px hover:bg-primary-emphasis hover:shadow-sm active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <Microphone size={16} weight="bold" />
                {t("header.capture", "Capture")}
              </button>

              {user?.role === "owner" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      onClick={sendDigest}
                      data-testid="send-digest-button"
                      label={t("header.send_digest")}
                    >
                      <EnvelopeSimple size={18} weight="bold" />
                    </IconButton>
                  </TooltipTrigger>
                  <TooltipContent>{t("header.send_digest")}</TooltipContent>
                </Tooltip>
              )}

              <LanguageSwitcher />
              <ThemeToggle />
              <NotificationBell />
            </div>
          </header>

          {/* Mobile header */}
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-border glass px-3 lg:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
                <SheetTrigger asChild>
                  <IconButton label="Open menu" data-testid="mobile-menu-button">
                    <ListIcon size={20} weight="bold" />
                  </IconButton>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-[19rem] flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0"
                  data-testid="mobile-drawer"
                >
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <SheetDescription className="sr-only">Main navigation menu</SheetDescription>

                  <div className="border-b border-sidebar-border px-4 py-4">
                    <Logo />
                    <p className="mt-3 truncate text-sm font-medium">{tenant?.name}</p>
                    {tenant?.industry && (
                      <p className="label-mono mt-0.5 truncate text-muted-foreground">
                        {tenant.industry}
                      </p>
                    )}
                  </div>

                  <nav
                    aria-label="Main navigation"
                    className="min-h-0 flex-1 overflow-y-auto py-4"
                  >
                    <NavTree onNavigate={() => setDrawerOpen(false)} />
                  </nav>

                  <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3 pb-6">
                    {user?.role === "owner" && (
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerOpen(false);
                          sendDigest();
                        }}
                        data-testid="mobile-send-digest-button"
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors duration-200 hover:bg-accent"
                      >
                        <EnvelopeSimple size={16} weight="bold" /> {t("header.send_digest")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={doLogout}
                      data-testid="mobile-logout-button"
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/25 bg-destructive-subtle px-3 py-2.5 text-sm font-medium text-destructive transition-colors duration-200 hover:bg-destructive/15"
                    >
                      <SignOut size={16} weight="bold" /> {t("header.sign_out")}
                    </button>
                  </div>
                </SheetContent>
              </Sheet>

              {current ? (
                <h2 className="truncate text-[15px] font-semibold tracking-tight">
                  {t(current.tkey, current.label)}
                </h2>
              ) : (
                <Logo />
              )}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                label="Search and commands"
                onClick={openCommandPalette}
                data-testid="mobile-command"
              >
                <MagnifyingGlass size={18} weight="bold" />
              </IconButton>
              <ThemeToggle />
              <NotificationBell />
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="app-canvas flex-1 overflow-x-hidden p-4 pb-28 lg:p-8 lg:pb-10"
          >
            {children}
          </main>
        </div>

        {/* ---------------- Mobile bottom bar ---------------- */}
        <nav
          aria-label="Primary"
          className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-border glass pb-[env(safe-area-inset-bottom)] lg:hidden"
          data-testid="mobile-bottom-nav"
        >
          {navBottom.slice(0, 2).map((item) => (
            <BottomTab key={item.to} item={item} location={location} t={t} />
          ))}

          {/* Capture takes the thumb position — it is the core gesture. */}
          <div className="relative flex w-[4.5rem] shrink-0 items-start justify-center">
            <button
              type="button"
              onClick={goCapture}
              data-testid="bottomnav-capture"
              aria-label={t("header.capture", "Capture")}
              className={cn(
                "-mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground",
                "shadow-lg ring-4 ring-background",
                "transition-transform duration-200 active:scale-[0.94]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <Microphone size={24} weight="fill" />
            </button>
          </div>

          {navBottom.slice(2).map((item) => (
            <BottomTab key={item.to} item={item} location={location} t={t} />
          ))}
        </nav>
      </div>
    </TooltipProvider>
  );
}

/** A single mobile tab. Extracted so the FAB can sit between two halves. */
function BottomTab({ item, location, t }) {
  const active = item.end
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      data-testid={item.testid}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-2.5",
        "transition-colors duration-200",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <item.icon size={21} weight={active ? "fill" : "regular"} />
      <span className="text-[10px] font-medium leading-none">{t(item.tkey, item.label)}</span>
    </NavLink>
  );
}
