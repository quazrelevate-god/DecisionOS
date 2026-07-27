import { useState, useEffect } from "react";
import api from "../../lib/api";
import AdminLogin from "./AdminLogin";
import {
  OverviewSection, AiKeysSection, TenantsSection, UsersSection, HealthSection, AuditSection,
} from "./AdminSections";
import {
  ShieldStar, SquaresFour, Key, Buildings, Users, Pulse, SignOut, Spinner,
  ClockCounterClockwise,
} from "@phosphor-icons/react";

const TABS = [
  { key: "overview", label: "Overview", icon: SquaresFour, C: OverviewSection },
  { key: "ai-keys", label: "AI Keys", icon: Key, C: AiKeysSection },
  { key: "tenants", label: "Workspaces", icon: Buildings, C: TenantsSection },
  { key: "users", label: "Users", icon: Users, C: UsersSection },
  { key: "audit", label: "Audit Log", icon: ClockCounterClockwise, C: AuditSection },
  { key: "health", label: "Health", icon: Pulse, C: HealthSection },
];

export default function AdminPortal() {
  const [admin, setAdmin] = useState(undefined); // undefined=checking, null=logged out
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    api.get("/admin/me").then((r) => setAdmin(r.data)).catch(() => setAdmin(null));
  }, []);

  const logout = async () => {
    try { await api.post("/admin/logout"); } catch (e) { /* ignore */ }
    setAdmin(null);
  };

  if (admin === undefined)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b] text-white/40 font-mono text-sm gap-2">
        <Spinner size={16} className="animate-spin" /> Loading console…
      </div>
    );
  if (!admin) return <AdminLogin onSuccess={setAdmin} />;

  const Active = TABS.find((t) => t.key === tab)?.C || OverviewSection;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white" data-testid="admin-portal">
      {/* Top bar */}
      <header className="border-b border-white/10 bg-[#0a0a0b] sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-[#e5484d]">
              <ShieldStar size={20} weight="fill" className="text-white" />
            </div>
            <div>
              <div className="font-heading font-black uppercase tracking-tighter leading-none">DecisionOS</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#e5484d]">Admin Console</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-white/40 hidden sm:block">{admin.email}</span>
            <button
              data-testid="admin-logout"
              onClick={logout}
              className="font-mono text-[11px] uppercase tracking-wider px-3 py-2 border border-white/20 text-white/70 hover:border-[#e5484d] hover:text-[#e5484d] transition-colors flex items-center gap-1.5"
            >
              <SignOut size={14} /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Tab nav */}
      <nav className="border-b border-white/10 bg-[#0a0a0b] sticky top-16 z-10">
        <div className="max-w-6xl mx-auto px-5 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              data-testid={`admin-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`font-mono text-[11px] uppercase tracking-wider px-4 py-4 flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
                tab === t.key
                  ? "border-[#e5484d] text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <t.icon size={15} weight={tab === t.key ? "fill" : "regular"} />
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-5 py-8">
        <Active />
      </main>
    </div>
  );
}
