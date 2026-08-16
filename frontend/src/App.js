import { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { hasPerm } from "./lib/perms";
import { LockKey } from "@phosphor-icons/react";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
// E2-73 (2026-08-15): legacy Inbox.js retired. Sprint 2 shipped the
// new Decision Desk at /inbox; the old Inbox page had no users left.
// /inbox-legacy now redirects to /inbox so any lingering bookmarks work.
import Desk from "./pages/Desk";
import Brain from "./pages/Brain";
import People from "./pages/People";
// Epic 2 Sprint A — E2-01 / E2-02: dedicated CRM (customers + suppliers) and
// Team (employees) pages replace the tabbed /contacts People surface.
import CRM from "./pages/CRM";
import TeamPage from "./pages/Team";
// E2-73 (2026-08-15): CEOBrief.js retired. Sprint 6 merged its content
// into the Decision Desk header; /brief already redirects to /inbox
// so the page had no live users.
import Notifications from "./pages/Notifications";
import MyWork from "./pages/MyWork";
import Settings from "./pages/Settings";
// E2-30 (2026-08-15): Ingest.js retired. /ingest URL still redirects
// to /finance?tab=inbox (see route below). ReviewPanel + WhatsAppCard
// live in pages/finance/*, imported directly by Ledger.js.
import ContactProfile from "./pages/ContactProfile";
import Journal from "./pages/Journal";
import Calendar from "./pages/Calendar";
// E2-73 (2026-08-15): Meetings.js retired. Sprint 3 (E2-31) hid it
// from the sidebar and redirected /meetings to /. Re-enable path: git
// revert this commit + restore the sidebar NAV entry.
import OperatingScore from "./pages/OperatingScore";
import WorkCoach from "./pages/WorkCoach";
import Ledger from "./pages/Ledger";
import Landing from "./pages/Landing";
import AdminPortal from "./pages/admin/AdminPortal";
// MPWA-04: dev-only harness for the §7 mobile components. Tree-shaken out of
// production builds by the NODE_ENV guard on its route below.
import MobileKitchenSink from "./pages/MobileKitchenSink";
// MPWA-12a: design lab (§6), development only — see the route guard below.
import DesignLab from "./pages/DesignLab";

function AccessDenied() {
  const navigate = useNavigate();
  return (
    <div className="max-w-lg mx-auto text-center py-20" data-testid="access-denied">
      <div className="w-16 h-16 mx-auto flex items-center justify-center border-2 border-black bg-brand-red text-white mb-6">
        <LockKey size={30} weight="bold" />
      </div>
      <h1 className="font-heading text-4xl font-black tracking-tighter uppercase">Access Denied</h1>
      <p className="text-muted-foreground mt-3">You don't have permission to open this page. Ask your owner to grant access from Team settings.</p>
      <button onClick={() => navigate("/my-work")} data-testid="access-denied-home"
        className="mt-6 bg-brand-ink text-white px-6 py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
        Go to My Work
      </button>
    </div>
  );
}

function Protected({ children, perm, perms, ownerOnly }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center font-mono text-sm uppercase tracking-widest">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  let denied = false;
  if (ownerOnly) denied = user.role !== "owner";
  else if (perms) denied = !perms.some((p) => hasPerm(user, p));
  else if (perm) denied = !hasPerm(user, perm);
  return <Layout>{denied ? <AccessDenied /> : children}</Layout>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center font-mono text-sm uppercase tracking-widest">
        Loading…
      </div>
    );
  if (user) return <Navigate to={hasPerm(user, "inbox") ? "/inbox" : "/my-work"} replace />;
  return <Landing />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/admin" element={<AdminPortal />} />
            <Route path="/admin/*" element={<AdminPortal />} />
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Navigate to="/brief" replace />} />
            {/* Epic 2 Sprint 6 (E2-47) and MPWA-12c (§2.1) reached the same
                conclusion independently: Desk and Brief are one surface. E2-47
                merged them on desktop and retired CEOBrief.js; 12c made the
                mode TIME on mobile, so the Desk answers the same questions for
                "now" and for each reporting period.

                One rule for both. `?scope=morning` is what §2.1 requires on
                mobile — "keep the redirect permanently; bookmarks, notifications
                and the daily digest email all link there" — and the desktop Desk
                ignores a scope it does not read, so it behaves exactly as E2-47
                left it. No viewport branch: a redirect is a navigation decision
                and must not be driven by a layout signal (see
                useWasMobileAtMount for what that cost the first time). */}
            <Route path="/brief" element={<Navigate to="/inbox?scope=morning" replace />} />
            <Route path="/journal" element={<Protected ownerOnly><Journal /></Protected>} />
            <Route path="/my-work" element={<Protected><MyWork /></Protected>} />
            <Route path="/leave" element={<Navigate to="/my-work?view=leave" replace />} />
            <Route path="/settings" element={<Protected><Settings /></Protected>} />
            <Route path="/review" element={<Navigate to="/ingest" replace />} />
            <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
            {/* Epic 2 Sprint 2: /inbox renders the 4-chip Decision Desk.
                E2-73 (2026-08-15): legacy Inbox page deleted; /inbox-legacy
                now redirects so any lingering bookmark still resolves. */}
            <Route path="/inbox" element={<Protected perm="inbox"><Desk /></Protected>} />
            <Route path="/inbox-legacy" element={<Navigate to="/inbox" replace />} />
            <Route path="/workflows" element={<Navigate to="/my-work?view=workflows" replace />} />
            {/* Epic 2 Sprint A — E2-01: /contacts is retired, redirects to /crm.
                /contacts/:id (ContactProfile 360°) still works so any deep-links
                or Brain-cited sources continue to resolve. */}
            <Route path="/contacts" element={<Navigate to="/crm" replace />} />
            <Route path="/contacts/:id" element={<Protected perm="people"><ContactProfile /></Protected>} />
            <Route path="/crm" element={<Protected perm="people"><CRM /></Protected>} />
            {/* Epic 2 Sprint 4 (E2-27): /ingest merged into /finance's Inbox tab. */}
            <Route path="/ingest" element={<Navigate to="/finance?tab=inbox" replace />} />
            <Route path="/tasks" element={<Navigate to="/my-work" replace />} />
            <Route path="/priorities" element={<Navigate to="/my-work" replace />} />
            <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
            {/* Epic 2 Sprint 3 (E2-31): Meeting Notes hidden this phase.
                Route redirects to home. Meetings.js + backend endpoints
                stay alive so re-enabling is a single-line revert. */}
            <Route path="/meetings" element={<Navigate to="/" replace />} />
            <Route path="/operating-score" element={<Protected ownerOnly><OperatingScore /></Protected>} />
            <Route path="/coach" element={<Protected><WorkCoach /></Protected>} />
            {/* Epic 2 Sprint 5 (E2-32): /dex is the new-name alias for the
                Brain page. Route /brain is preserved for bookmark safety. */}
            <Route path="/brain" element={<Protected perm="brain"><Brain /></Protected>} />
            <Route path="/dex" element={<Protected perm="brain"><Brain /></Protected>} />
            {/* Epic 2 Sprint 4 (E2-23 / E2-27): /finance is the merged home
                for Finance + document Capture. Old /ledger + /ingest redirect
                here. Gate broadened to also accept data_input so users who
                had Capture-only access aren't locked out of the Inbox tab. */}
            <Route path="/finance" element={<Protected perms={["ledger", "finance", "data_input"]}><Ledger /></Protected>} />
            <Route path="/ledger" element={<Navigate to="/finance" replace />} />
            <Route path="/ask" element={<Navigate to="/brain" replace />} />
            {/* Epic 2 Sprint A — E2-01: /team is now a real page (Employees list)
                gated on team_manage. Owner auto-passes via the all-perms shortcut. */}
            <Route path="/team" element={<Protected perms={["team_manage"]}><TeamPage /></Protected>} />
            {/* MPWA-04: component harness, development only. */}
            {process.env.NODE_ENV !== "production" && (
              <Route path="/__mobile-kit" element={<Protected><MobileKitchenSink /></Protected>} />
            )}
            {/* MPWA-12a (§6): not wrapped in <Protected> — the lab renders the
                real screens inside iframes, and each of those enforces its own
                auth. Gating the shell too would just double the redirect. */}
            {process.env.NODE_ENV !== "production" && (
              <Route path="/design-lab" element={<DesignLab />} />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
