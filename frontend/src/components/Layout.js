import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import api from "../lib/api";
import {
  Gauge,
  Microphone,
  Brain as BrainIcon,
  ChatCircleText,
  Kanban,
  CheckSquare,
  UsersThree,
  SignOut,
  EnvelopeSimple,
} from "@phosphor-icons/react";

const NAV = [
  { to: "/", label: "Daily Brief", icon: Gauge, testid: "nav-dashboard" },
  { to: "/inbox", label: "Owner Inbox", icon: Microphone, testid: "nav-inbox" },
  { to: "/workflows", label: "Workflows", icon: Kanban, testid: "nav-workflows" },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, testid: "nav-tasks" },
  { to: "/brain", label: "Company Brain", icon: BrainIcon, testid: "nav-brain" },
  { to: "/ask", label: "Ask AI", icon: ChatCircleText, testid: "nav-ask" },
  { to: "/team", label: "Team", icon: UsersThree, testid: "nav-team" },
];

export default function Layout({ children }) {
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen flex bg-brand-paper text-brand-ink">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-black bg-white flex flex-col sticky top-0 h-screen">
        <div className="px-6 py-6 border-b border-black">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-red flex items-center justify-center">
              <span className="font-heading font-black text-white text-lg leading-none">D</span>
            </div>
            <span className="font-heading font-black text-xl tracking-tighter uppercase">DecisionOS</span>
          </div>
          <p className="mt-3 label-mono text-muted-foreground truncate" data-testid="tenant-name">
            {tenant?.name}
          </p>
        </div>

        <nav className="flex-1 py-4">
          {NAV.map(({ to, label, icon: Icon, testid }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              data-testid={testid}
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
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-black p-4">
          <button
            onClick={doLogout}
            data-testid="logout-button"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm border border-black hover:bg-brand-ink hover:text-white transition-colors"
          >
            <SignOut size={16} weight="bold" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-black bg-white flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="label-mono text-muted-foreground">Signed in as</span>
            <span className="font-semibold text-sm" data-testid="current-user-name">{user?.name}</span>
            <span className="px-2 py-0.5 text-xs uppercase tracking-wider bg-brand-blue text-white font-semibold" data-testid="current-user-role">
              {user?.role}
            </span>
          </div>
          {user?.role === "owner" && (
            <button
              onClick={sendDigest}
              data-testid="send-digest-button"
              className="flex items-center gap-2 px-4 py-2 text-sm border border-black bg-brand-yellow font-semibold hover:shadow-brutal-sm transition-all"
            >
              <EnvelopeSimple size={16} weight="bold" /> Send Daily Digest
            </button>
          )}
        </header>
        <main className="flex-1 p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
