/* The platform admin console's shell (2026-10-22, admin redesign).
 *
 * It was one page with seventeen tabs in a single scrolling row, the open tab
 * held in state: refresh went back to Overview, nothing could be linked, and
 * at 1440 px seven tabs were off the edge. Now:
 *   - a sidebar of thirteen places in six groups (Customers, Support, Money,
 *     Platform, Security), each with an address -- /admin/workspaces/<id>,
 *     /admin/support/<ticket> -- so refresh, Back and sharing a link work;
 *   - Find (Ctrl K) for any workspace, person or page;
 *   - a provider outage is one line under the header and a count on Health,
 *     not a red banner on every page;
 *   - an admin without two-step sign-in is asked to turn it on, every sign-in;
 *   - a read-only admin sees no controls that would only be refused.
 * Old tab names still land in the right place (LEGACY). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../../lib/api";
import AdminLogin from "./AdminLogin";
import AdminInvite from "./AdminInvite";
import { GLASS_PILL } from "../../components/neuglass/glass";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../../components/ui/sheet";
import { AdminContext, FindDialog } from "./adminUi";
import { adminRoleLabel, providerLabel, humanize } from "./adminLabels";
import {
  OverviewSection, AiKeysSection, WorkspacesSection, UsersSection, HealthSection, AuditSection, UsageSection,
} from "./AdminSections";
import { WorkspacePage } from "./WorkspacePage";
import { SupportDeskSection } from "./SupportDeskSection";
import { ReportsSection } from "./ReportsSection";
import { BillingSection } from "./BillingSection";
import { ConfigSection } from "./ConfigSection";
import { AdminRbacSection } from "./AdminRbacSection";
import { AnnouncementsSection } from "./AnnouncementsSection";
import { ComplianceSection } from "./ComplianceSection";
import {
  ShieldStar, SquaresFour, Key, Buildings, Users, Pulse, SignOut, Spinner, ClockCounterClockwise, ChartBar,
  WarningCircle, MagnifyingGlass, Lifebuoy, CurrencyInr, Sliders, ShieldCheck, Megaphone, Scales, Flag, List, X,
} from "@phosphor-icons/react";

// The app's quiet grey ground.
const PAGE = "min-h-[calc(100vh/var(--ui-scale,1))] bg-[linear-gradient(180deg,hsl(220_20%_97%),hsl(220_14%_91%))] text-slate-900";

const NAV = [
  { items: [{ key: "", label: "Overview", icon: SquaresFour }] },
  { group: "Customers", items: [
    { key: "workspaces", label: "Customers", icon: Buildings },
    { key: "users", label: "Users", icon: Users },
  ] },
  { group: "Support", items: [
    { key: "support", label: "Support desk", icon: Lifebuoy, badge: "open_tickets" },
    { key: "reports", label: "Reports", icon: Flag, badge: "open_reports" },
    { key: "announcements", label: "Announcements", icon: Megaphone },
  ] },
  { group: "Money", items: [
    { key: "billing", label: "Billing", icon: CurrencyInr, badge: "failed_payments" },
    { key: "usage", label: "AI usage", icon: ChartBar },
  ] },
  { group: "Platform", items: [
    { key: "health", label: "Health", icon: Pulse, badge: "outages", alarm: true },
    { key: "ai-keys", label: "AI keys", icon: Key },
    { key: "config", label: "Config", icon: Sliders },
  ] },
  { group: "Security", items: [
    { key: "admins", label: "Admins", icon: ShieldCheck },
    { key: "audit", label: "Audit log", icon: ClockCounterClockwise, badge: "live_view_as" },
    { key: "compliance", label: "Compliance", icon: Scales },
  ] },
];
const PLACES = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

/* Where the old seventeen tabs live now. */
const LEGACY = {
  overview: "", tenant360: "workspaces", tenants: "workspaces", impersonation: "audit",
  observability: "health", announce: "announcements",
};

const SECTIONS = {
  "": OverviewSection, workspaces: WorkspacesSection, users: UsersSection,
  support: SupportDeskSection, reports: ReportsSection, announcements: AnnouncementsSection,
  billing: BillingSection, usage: UsageSection,
  health: HealthSection, "ai-keys": AiKeysSection, config: ConfigSection,
  admins: AdminRbacSection, audit: AuditSection, compliance: ComplianceSection,
};

function parsePath(pathname) {
  const rest = pathname.replace(/^\/admin\/?/, "").replace(/\/+$/, "");
  const parts = rest ? rest.split("/") : [];
  return { section: parts[0] || "", id: parts[1] ? decodeURIComponent(parts[1]) : null, sub: parts[2] || null };
}

function NavList({ section, counts, onGo }) {
  return (
    <nav aria-label="Admin console" className="space-y-5">
      {NAV.map((g, gi) => (
        <div key={g.group || gi}>
          {g.group && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{g.group}</div>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const on = section === it.key;
              const n = it.badge ? counts?.[it.badge] || 0 : 0;
              return (
                <li key={it.key}>
                  <a href={`/admin/${it.key}`} data-testid={`admin-nav-${it.key || "overview"}`}
                    aria-current={on ? "page" : undefined}
                    onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onGo(it.key); }}
                    className={`flex h-9 items-center gap-2.5 rounded-pill px-3 text-[13.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${
                      on ? "bg-ng-ink text-white" : "text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900"}`}>
                    <it.icon size={16} weight={on ? "fill" : "regular"} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {n > 0 && (
                      <span aria-label={`${n} waiting`}
                        className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold leading-none ${
                          it.alarm ? "bg-[#cf222e] text-white" : on ? "bg-white/20 text-white" : "bg-slate-900/[0.08] text-slate-700"}`}>
                        {Math.min(99, n)}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      {/* The red mark stays: an operator must never mistake this console for
          a tenant's workspace. */}
      <div className="grid h-8 w-8 place-items-center rounded-xl bg-[#cf222e] text-white">
        <ShieldStar size={18} weight="fill" />
      </div>
      <div className="leading-none">
        <div className="font-display text-[15px] text-slate-900">DecisionOS</div>
        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b91c1c]">Admin console</div>
      </div>
    </div>
  );
}

const NUDGE_KEY = "dos_admin_2fa_later";

export default function AdminPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(undefined); // undefined = checking, null = signed out
  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nudgeLater, setNudgeLater] = useState(() => {
    try { return window.sessionStorage.getItem(NUDGE_KEY) === "1"; } catch { return false; }
  });

  const { section: rawSection, id, sub } = parsePath(location.pathname);
  const isInvite = rawSection === "invite";

  useEffect(() => {
    if (isInvite) return;
    api.get("/admin/me").then((r) => setAdmin(r.data)).catch(() => setAdmin(null));
  }, [isInvite]);

  const go = useCallback((path, opts) => {
    navigate(`/admin${path ? `/${path}` : ""}`, opts);
    setMenuOpen(false);
  }, [navigate]);

  // Old tab names land where that tab's content lives now.
  useEffect(() => {
    if (rawSection in LEGACY) go(LEGACY[rawSection], { replace: true });
  }, [rawSection, go]);

  useEffect(() => {
    if (!admin) return undefined;
    const load = () => {
      api.get("/admin/alerts").then((r) => setAlerts(r.data.active || [])).catch(() => {});
      api.get("/admin/overview").then((r) => setCounts(r.data.needs_attention)).catch(() => {});
    };
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [admin]);

  useEffect(() => {
    if (!admin) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setFindOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [admin]);

  useEffect(() => { window.scrollTo?.(0, 0); }, [rawSection, id]);

  const ctx = useMemo(() => ({
    admin, go,
    canWrite: !!admin && admin.role !== "read_only",
    isSuper: !!admin && (admin.role || "super_admin") === "super_admin",
    setAdmin,
  }), [admin, go]);

  if (isInvite) return <AdminInvite token={id} onDone={() => go("", { replace: true })} />;

  if (admin === undefined)
    return (
      <div className={`${PAGE} flex items-center justify-center gap-2 text-sm text-slate-600`}>
        <Spinner size={16} className="animate-spin" /> Loading console…
      </div>
    );
  if (!admin) return <AdminLogin onSuccess={setAdmin} />;

  const logout = async () => {
    try { await api.post("/admin/logout"); } catch (e) { console.debug("admin logout call failed — clearing session anyway", e); }
    setAdmin(null);
  };
  const later = () => {
    setNudgeLater(true);
    try { window.sessionStorage.setItem(NUDGE_KEY, "1"); } catch { /* private window */ }
  };

  const section = rawSection in SECTIONS ? rawSection : "";
  const Active = SECTIONS[section];
  const showNudge = !admin.two_factor && !nudgeLater && section !== "admins";

  return (
    <AdminContext.Provider value={ctx}>
      <div className={PAGE} data-testid="admin-portal">
        <div className="mx-auto flex max-w-[92rem]">
          {/* Sidebar — wide screens */}
          <aside className="sticky top-0 hidden h-[calc(100vh/var(--ui-scale,1))] w-60 shrink-0 flex-col border-r border-slate-900/[0.06] bg-white/45 px-3 py-5 backdrop-blur-xl lg:flex">
            <div className="mb-6 px-2"><Brand /></div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-4"><NavList section={section} counts={counts} onGo={go} /></div>
          </aside>

          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-20 border-b border-slate-900/[0.06] bg-white/65 backdrop-blur-xl">
              <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
                <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open the menu" data-testid="admin-menu-button"
                  className="grid h-9 w-9 place-items-center rounded-full text-slate-700 hover:bg-slate-900/[0.05] lg:hidden">
                  <List size={20} />
                </button>
                <div className="lg:hidden"><Brand /></div>
                <button type="button" onClick={() => setFindOpen(true)} data-testid="admin-find-button"
                  className={`ml-auto flex h-9 min-w-0 items-center gap-2 rounded-pill px-3.5 text-sm text-slate-500 hover:text-slate-800 sm:w-72 lg:ml-0 ${GLASS_PILL}`}>
                  <MagnifyingGlass size={15} aria-hidden="true" />
                  <span className="hidden min-w-0 flex-1 truncate text-left sm:block">Find a workspace or person</span>
                  <kbd className="hidden rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-slate-500 sm:block">Ctrl K</kbd>
                </button>
                <div className="ml-auto hidden items-center gap-3 sm:flex">
                  <div className="text-right leading-tight">
                    <div className="max-w-[16rem] truncate text-xs font-medium text-slate-800">{admin.email}</div>
                    <div className="text-[11px] text-slate-500">{adminRoleLabel(admin.role)}</div>
                  </div>
                </div>
                <button data-testid="admin-logout" onClick={logout} type="button"
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-slate-700 hover:text-[#b91c1c] ${GLASS_PILL}`}>
                  <SignOut size={14} /> <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>

              {alerts.length > 0 && (
                <div data-testid="admin-alert-banner" role="status"
                  className="flex items-center gap-2 border-t border-[#cf222e]/15 bg-[#cf222e]/[0.06] px-4 py-2 text-[13px] text-[#8f1620] sm:px-6">
                  <WarningCircle size={16} weight="fill" className="shrink-0 text-[#b91c1c]" />
                  <span className="min-w-0 flex-1 truncate">
                    {alerts.length === 1
                      ? `${alerts[0].provider ? providerLabel(alerts[0].provider) : "An AI provider"}: ${humanize(alerts[0].status || "problem").toLowerCase()}`
                      : `${alerts.length} AI provider problems`}
                    {" — customers may see AI features fail."}
                  </span>
                  <button type="button" onClick={() => go("health")} className="shrink-0 font-semibold underline-offset-2 hover:underline">Open Health</button>
                </div>
              )}

              {showNudge && (
                <div data-testid="admin-2fa-nudge"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-amber-700/10 bg-amber-400/[0.12] px-4 py-2 text-[13px] text-[#6a4200] sm:px-6">
                  <ShieldCheck size={16} weight="fill" className="shrink-0" />
                  <span className="min-w-0 flex-1">This account signs in with a password only. Turn on two-step sign-in so a leaked password isn&apos;t enough.</span>
                  <button type="button" onClick={() => go("admins")} className="font-semibold underline-offset-2 hover:underline">Set it up</button>
                  <button type="button" onClick={later} className="text-[#6a4200]/80 hover:text-[#6a4200]">Later</button>
                </div>
              )}
            </header>

            <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <div className="mx-auto max-w-6xl">
                <Active id={id} sub={sub} />
              </div>
            </main>
          </div>
        </div>

        {/* Menu — phones and narrow windows */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" hideClose className="w-72 border-0 bg-[linear-gradient(165deg,hsl(220_20%_98%),hsl(220_14%_93%))] p-0">
            <SheetTitle className="sr-only">Admin console menu</SheetTitle>
            <SheetDescription className="sr-only">Every place in the console</SheetDescription>
            <div className="flex items-center justify-between px-5 pb-4 pt-5">
              <Brand />
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close the menu"
                className="grid h-9 w-9 place-items-center rounded-full text-slate-600 hover:bg-slate-900/[0.05]"><X size={18} /></button>
            </div>
            <div className="h-[calc(100%-4.5rem)] overflow-y-auto px-3 pb-6"><NavList section={section} counts={counts} onGo={go} /></div>
          </SheetContent>
        </Sheet>

        <FindDialog open={findOpen} onOpenChange={setFindOpen} places={PLACES} onGo={go} />
      </div>
    </AdminContext.Provider>
  );
}
