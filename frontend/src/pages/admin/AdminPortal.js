import { useState, useEffect } from "react";
import api from "../../lib/api";
import AdminLogin from "./AdminLogin";
import {
  OverviewSection, AiKeysSection, TenantsSection, UsersSection, HealthSection, AuditSection, UsageSection,
  MaintenanceSection,
} from "./AdminSections";
import { Tenant360Section } from "./Tenant360Section";
import {
  ShieldStar, SquaresFour, Key, Buildings, Users, Pulse, SignOut, Spinner,
  ClockCounterClockwise, ChartBar, WarningCircle, Wrench, MagnifyingGlass,
} from "@phosphor-icons/react";

const TABS = [
  { key: "overview", label: "Overview", icon: SquaresFour, C: OverviewSection },
  { key: "tenant360", label: "Tenant 360", icon: MagnifyingGlass, C: Tenant360Section },
  { key: "usage", label: "Usage", icon: ChartBar, C: UsageSection },
  { key: "ai-keys", label: "AI Keys", icon: Key, C: AiKeysSection },
  { key: "tenants", label: "Workspaces", icon: Buildings, C: TenantsSection },
  { key: "users", label: "Users", icon: Users, C: UsersSection },
  { key: "maintenance", label: "Maintenance", icon: Wrench, C: MaintenanceSection },
  { key: "audit", label: "Audit Log", icon: ClockCounterClockwise, C: AuditSection },
  { key: "health", label: "Health", icon: Pulse, C: HealthSection },
];

export default function AdminPortal() {
  const [admin, setAdmin] = useState(undefined); // undefined=checking, null=logged out
  const [tab, setTab] = useState("overview");
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    api.get("/admin/me").then((r) => setAdmin(r.data)).catch(() => setAdmin(null));
  }, []);

  useEffect(() => {
    if (!admin) return;
    const load = () => api.get("/admin/alerts").then((r) => setAlerts(r.data.active || [])).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [admin]);

  const logout = async () => {
    try { await api.post("/admin/logout"); } catch (e) { console.debug("admin logout call failed — clearing session anyway", e); }
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
        {alerts.length > 0 && (
          <div data-testid="admin-alert-banner"
            className="mb-6 border-2 border-[#e5484d] bg-[#e5484d]/10 p-4 flex items-start gap-3">
            <WarningCircle size={22} weight="fill" className="text-[#e5484d] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-heading font-black uppercase text-[#e5484d] text-sm tracking-tight">
                AI Provider Alert{alerts.length > 1 ? `s (${alerts.length})` : ""}
              </div>
              {alerts.map((a) => (
                <div key={a.id} className="font-mono text-xs text-white/70 mt-1">
                  <span className="uppercase text-white/90">{a.provider}</span> — {(a.status || "").replace(/_/g, " ")}.
                  {" "}Update or clear the key in <button onClick={() => setTab("ai-keys")} className="underline text-[#e5484d]">AI Keys</button> to restore service.
                </div>
              ))}
            </div>
          </div>
        )}
        <Active />
      </main>
    </div>
  );
}
