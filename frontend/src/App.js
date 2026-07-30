import { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { hasPerm } from "./lib/perms";
import { LockKey } from "@phosphor-icons/react";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Inbox from "./pages/Inbox";
import Brain from "./pages/Brain";
import People from "./pages/People";
import CEOBrief from "./pages/CEOBrief";
import Notifications from "./pages/Notifications";
import MyWork from "./pages/MyWork";
import Settings from "./pages/Settings";
import Ingest from "./pages/Ingest";
import ContactProfile from "./pages/ContactProfile";
import Journal from "./pages/Journal";
import Calendar from "./pages/Calendar";
import Meetings from "./pages/Meetings";
import OperatingScore from "./pages/OperatingScore";
import WorkCoach from "./pages/WorkCoach";
import Ledger from "./pages/Ledger";
import Landing from "./pages/Landing";
import AdminPortal from "./pages/admin/AdminPortal";
import DesignSystem from "./pages/DesignSystem";

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
            <Route path="/admin" element={<AdminPortal />} />
            <Route path="/admin/*" element={<AdminPortal />} />
            {/* Token/component reference. Unauthenticated on purpose so the system can be
                reviewed without a session; it renders design tokens only, no app data. */}
            <Route path="/design-system" element={<DesignSystem />} />
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Navigate to="/brief" replace />} />
            <Route path="/brief" element={<Protected><CEOBrief /></Protected>} />
            <Route path="/journal" element={<Protected ownerOnly><Journal /></Protected>} />
            <Route path="/my-work" element={<Protected><MyWork /></Protected>} />
            <Route path="/leave" element={<Navigate to="/my-work?view=leave" replace />} />
            <Route path="/settings" element={<Protected><Settings /></Protected>} />
            <Route path="/review" element={<Navigate to="/ingest" replace />} />
            <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
            <Route path="/inbox" element={<Protected perm="inbox"><Inbox /></Protected>} />
            <Route path="/workflows" element={<Navigate to="/my-work?view=workflows" replace />} />
            <Route path="/contacts" element={<Protected perm="people"><People /></Protected>} />
            <Route path="/contacts/:id" element={<Protected perm="people"><ContactProfile /></Protected>} />
            <Route path="/ingest" element={<Protected perm="data_input"><Ingest /></Protected>} />
            <Route path="/tasks" element={<Navigate to="/my-work" replace />} />
            <Route path="/priorities" element={<Navigate to="/my-work" replace />} />
            <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
            <Route path="/meetings" element={<Protected><Meetings /></Protected>} />
            <Route path="/operating-score" element={<Protected ownerOnly><OperatingScore /></Protected>} />
            <Route path="/coach" element={<Protected><WorkCoach /></Protected>} />
            <Route path="/brain" element={<Protected perm="brain"><Brain /></Protected>} />
            <Route path="/ledger" element={<Protected perms={["ledger", "finance"]}><Ledger /></Protected>} />
            <Route path="/finance" element={<Navigate to="/ledger" replace />} />
            <Route path="/ask" element={<Navigate to="/brain" replace />} />
            <Route path="/team" element={<Navigate to="/contacts" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
