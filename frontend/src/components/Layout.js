import { useState, useMemo } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { CompanyDialog } from "./CompanyDialog";
import { toast } from "sonner";
import api from "../lib/api";
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
  ChatCircleText,
  Kanban,
  AddressBook,
  SignOut,
  EnvelopeSimple,
  Bell,
  Buildings,
  Sun,
  Briefcase,
  MicrophoneStage,
  List as ListIcon,
  FileArrowUp,
  Tray,
} from "@phosphor-icons/react";

const NAV = [
  { to: "/", label: "Decision Desk", icon: Tray, testid: "nav-inbox", perm: "inbox" },
  { to: "/brief", label: "CEO Brief", icon: Sun, testid: "nav-ceo-brief" },
  { to: "/ingest", label: "Capture", icon: FileArrowUp, testid: "nav-ingest", perm: "data_input" },
  { to: "/workflows", label: "Workflows", icon: Kanban, testid: "nav-workflows", perm: "workflows" },
  { to: "/contacts", label: "People", icon: AddressBook, testid: "nav-contacts", perm: "people" },
  { to: "/my-work", label: "My Work", icon: Briefcase, testid: "nav-my-work" },
  { to: "/meetings", label: "Meeting Notes", icon: MicrophoneStage, testid: "nav-meetings" },
  { to: "/brain", label: "Company Brain", icon: BrainIcon, testid: "nav-brain", perm: "brain" },
];

// Primary items for the mobile bottom tab bar
const BOTTOM_NAV = [
  { to: "/", label: "Decision Desk", icon: Tray, perm: "inbox" },
  { to: "/ingest", label: "Capture", icon: FileArrowUp, perm: "data_input" },
  { to: "/brief", label: "Brief", icon: Sun },
  { to: "/my-work", label: "Work", icon: Briefcase },
  { to: "/brain", label: "Brain", icon: ChatCircleText, perm: "brain" },
];

const Logo = () => (
  <div className="flex items-center gap-2">
    <div className="w-8 h-8 bg-brand-red flex items-center justify-center">
      <span className="font-heading font-black text-white text-lg leading-none">D</span>
    </div>
    <span className="font-heading font-black text-xl tracking-tighter uppercase">DecisionOS</span>
  </div>
);

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const navMain = useMemo(() => NAV.filter((n) => !n.perm || hasPerm(user, n.perm)), [user]);
  const navBottom = useMemo(() => BOTTOM_NAV.filter((n) => !n.perm || hasPerm(user, n.perm)), [user]);
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: notif } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data), refetchInterval: 30000 });
  const unread = notif?.unread || 0;
  const { data: brief } = useQuery({ queryKey: ["fires-count"], queryFn: () => api.get("/brief?period=morning").then((r) => r.data), refetchInterval: 60000, enabled: user?.role === "owner" });
  const fires = brief?.counters?.fires || 0;

  const Bellicon = () => (
    <button onClick={() => navigate("/notifications")} data-testid="notif-bell"
      className="relative w-10 h-10 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors">
      <Bell size={18} weight="bold" />
      {unread > 0 && (
        <span data-testid="notif-count" className="absolute -top-2 -right-2 bg-brand-red text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold">
          {unread}
        </span>
      )}
    </button>
  );

  const ProfileButton = () => (
    <CompanyDialog trigger={
      <button data-testid="company-profile-button" title="Company details"
        className="w-10 h-10 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors">
        <Buildings size={18} weight="bold" />
      </button>
    } />
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
      toast.error("Could not send digest");
    }
  };

  const NavItems = ({ onNavigate }) => (
    <>
      {navMain.map(({ to, label, icon: Icon, testid }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          data-testid={testid}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 px-6 py-3 text-sm border-l-4 transition-colors ${
              isActive
                ? "border-brand-red bg-brand-ink text-white font-semibold"
                : "border-transparent hover:bg-black/5"
            }`
          }
        >
          <Icon size={18} weight="bold" />
          {label}
          {to === "/brief" && fires > 0 && (
            <span data-testid="nav-fires-badge" title={`${fires} fire(s) to put out`}
              className="ml-auto bg-brand-red text-white text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-black font-bold rounded-full animate-pulse">
              {fires}
            </span>
          )}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="min-h-screen flex bg-brand-paper text-brand-ink">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-black bg-white flex-col sticky top-0 h-screen">
        <div className="px-6 py-6 border-b border-black">
          <Logo />
          <CompanyDialog trigger={
            <button data-testid="tenant-name" className="mt-3 label-mono text-muted-foreground truncate block text-left hover:text-brand-red transition-colors w-full">
              {tenant?.name}
            </button>
          } />
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
            <SignOut size={16} weight="bold" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar */}
        <header className="hidden lg:flex h-16 border-b border-black bg-white items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="label-mono text-muted-foreground">Signed in as</span>
            <span className="font-semibold text-sm" data-testid="current-user-name">{user?.name}</span>
            <span className="px-2 py-0.5 text-xs uppercase tracking-wider bg-brand-blue text-white font-semibold" data-testid="current-user-role">
              {user?.role}
            </span>
          </div>
          {user?.role === "owner" && (
            <div className="flex items-center gap-3">
              <button
                onClick={sendDigest}
                data-testid="send-digest-button"
                className="flex items-center gap-2 px-4 py-2 text-sm border border-black bg-brand-yellow font-semibold hover:shadow-brutal-sm transition-all"
              >
                <EnvelopeSimple size={16} weight="bold" /> Send Daily Digest
              </button>
              <ProfileButton />
              <Bellicon />
            </div>
          )}
          {user?.role !== "owner" && (
            <div className="flex items-center gap-3">
              <ProfileButton />
              <Bellicon />
            </div>
          )}
        </header>

        {/* Mobile top app bar */}
        <header className="lg:hidden h-14 border-b border-black bg-white flex items-center justify-between px-4 sticky top-0 z-20">
          <Logo />
          <div className="flex items-center gap-2">
            <ProfileButton />
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
                <CompanyDialog trigger={
                  <button className="mt-2 label-mono text-muted-foreground truncate block text-left hover:text-brand-red transition-colors w-full">{tenant?.name}</button>
                } />
                <div className="mt-3 flex items-center gap-2">
                  <span className="font-semibold text-sm">{user?.name}</span>
                  <span className="px-2 py-0.5 text-xs uppercase tracking-wider bg-brand-blue text-white font-semibold">
                    {user?.role}
                  </span>
                </div>
              </div>
              <nav className="flex-1 py-3 overflow-y-auto">
                <NavItems onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <div className="border-t border-black p-4 space-y-2">
                {user?.role === "owner" && (
                  <button
                    onClick={() => { setDrawerOpen(false); sendDigest(); }}
                    data-testid="mobile-send-digest-button"
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-black bg-brand-yellow font-semibold"
                  >
                    <EnvelopeSimple size={16} weight="bold" /> Send Daily Digest
                  </button>
                )}
                <button
                  onClick={doLogout}
                  data-testid="mobile-logout-button"
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold uppercase tracking-wider bg-white text-brand-red border-2 border-brand-red hover:bg-brand-red hover:text-white transition-colors"
                >
                  <SignOut size={16} weight="bold" /> Sign out
                </button>
              </div>
            </SheetContent>
          </Sheet>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 pb-24 lg:pb-8 overflow-x-hidden">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t border-black bg-white flex z-[10000]" data-testid="mobile-bottom-nav">
        {navBottom.map(({ to, label, icon: Icon }) => {
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
              <span className="text-[10px] uppercase tracking-wide font-semibold leading-none">{label.split(" ")[label.split(" ").length - 1]}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
