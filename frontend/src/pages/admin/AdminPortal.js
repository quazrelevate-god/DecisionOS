import { useState, useEffect } from "react";
import api from "../../lib/api";
import AdminLogin from "./AdminLogin";
import { GLASS_PILL, INK_PILL } from "../../components/karma/glass";
// The app's quiet grey ground, not the old black one.
const PAGE = "min-h-[calc(100vh/var(--ui-scale,1))] bg-[linear-gradient(180deg,hsl(220_20%_97%),hsl(220_14%_91%))] text-slate-900";
import {
  OverviewSection, AiKeysSection, TenantsSection, UsersSection, HealthSection, AuditSection, UsageSection,
} from "./AdminSections";
import { Tenant360Section } from "./Tenant360Section";
import { ImpersonationSection } from "./ImpersonationSection";
import { SupportDeskSection } from "./SupportDeskSection";
import { ReportsSection } from "./ReportsSection";
import { BillingSection } from "./BillingSection";
import { ObservabilitySection } from "./ObservabilitySection";
import { ConfigSection } from "./ConfigSection";
import { AdminRbacSection } from "./AdminRbacSection";
import { AnnouncementsSection } from "./AnnouncementsSection";
import { ComplianceSection } from "./ComplianceSection";
import {
  ShieldStar, SquaresFour, Key, Buildings, Users, Pulse, SignOut, Spinner,
  ClockCounterClockwise, ChartBar, WarningCircle, MagnifyingGlass, UserSwitch, Lifebuoy, CurrencyInr, ChartLineUp, Sliders, ShieldCheck, Megaphone, Scales, Flag,
} from "@phosphor-icons/react";

const TABS = [
  { key: "overview", label: "Overview", icon: SquaresFour, C: OverviewSection },
  { key: "tenant360", label: "Tenant 360", icon: MagnifyingGlass, C: Tenant360Section },
  { key: "impersonation", label: "Impersonation", icon: UserSwitch, C: ImpersonationSection },
  { key: "support", label: "Support", icon: Lifebuoy, C: SupportDeskSection },
  { key: "reports", label: "Reports", icon: Flag, C: ReportsSection },
  { key: "billing", label: "Billing", icon: CurrencyInr, C: BillingSection },
  { key: "observability", label: "Observability", icon: ChartLineUp, C: ObservabilitySection },
  { key: "config", label: "Config", icon: Sliders, C: ConfigSection },
  { key: "admins", label: "Admins", icon: ShieldCheck, C: AdminRbacSection },
  { key: "announcements", label: "Announce", icon: Megaphone, C: AnnouncementsSection },
  { key: "compliance", label: "Compliance", icon: Scales, C: ComplianceSection },
  { key: "usage", label: "Usage", icon: ChartBar, C: UsageSection },
  { key: "ai-keys", label: "AI Keys", icon: Key, C: AiKeysSection },
  { key: "tenants", label: "Workspaces", icon: Buildings, C: TenantsSection },
  { key: "users", label: "Users", icon: Users, C: UsersSection },
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
      <div className={`${PAGE} flex items-center justify-center gap-2 text-sm text-slate-600`}>
        <Spinner size={16} className="animate-spin" /> Loading console…
      </div>
    );
  if (!admin) return <AdminLogin onSuccess={setAdmin} />;

  const Active = TABS.find((t) => t.key === tab)?.C || OverviewSection;

  return (
    <div className={PAGE} data-testid="admin-portal">
      {/* Top bar. The red mark stays: an operator must never mistake this
          console for a tenant's workspace. */}
      <header className="sticky top-0 z-20 border-b border-slate-900/[0.06] bg-white/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#cf222e] text-white">
              <ShieldStar size={20} weight="fill" />
            </div>
            <div>
              <div className="font-display text-lg leading-none text-slate-900">DecisionOS</div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#b91c1c]">Admin console</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-600 sm:block">{admin.email}</span>
            <button
              data-testid="admin-logout"
              onClick={logout}
              className={`inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-xs font-medium text-slate-700 hover:text-[#b91c1c] ${GLASS_PILL}`}
            >
              <SignOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Tab nav */}
      <nav className="sticky top-16 z-10 border-b border-slate-900/[0.06] bg-white/60 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 py-2 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              data-testid={`admin-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-[13px] font-medium transition-colors ${
                tab === t.key
                  ? INK_PILL
                  : "text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900"
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
            className="mb-6 border border-[#cf222e] bg-[#cf222e]/10 p-4 flex items-start gap-3 rounded-xl">
            <WarningCircle size={22} weight="fill" className="text-[#b91c1c] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#b91c1c]">
                AI Provider Alert{alerts.length > 1 ? `s (${alerts.length})` : ""}
              </div>
              {alerts.map((a) => (
                <div key={a.id} className="font-mono text-xs text-slate-600 mt-1">
                  <span className="uppercase text-slate-800">{a.provider}</span> — {(a.status || "").replace(/_/g, " ")}.
                  {" "}Update or clear the key in <button onClick={() => setTab("ai-keys")} className="underline text-[#b91c1c]">AI Keys</button> to restore service.
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
