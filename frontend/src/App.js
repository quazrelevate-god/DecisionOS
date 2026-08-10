import { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { hasPerm } from "./lib/perms";
import { DEMO_MODE } from "./lib/demoData";
import { LockKey } from "@phosphor-icons/react";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
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

function AccessDenied() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-lg py-24 text-center" data-testid="access-denied">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
        <LockKey size={26} weight="bold" />
      </div>
      <h1 className="text-title">Access denied</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        You don't have permission to open this page. Ask your owner to grant access from Team settings.
      </p>
      <button
        onClick={() => navigate("/my-work")}
        data-testid="access-denied-home"
        className="mt-7 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:bg-primary-emphasis active:scale-[0.98]"
      >
        Go to My Work
      </button>
    </div>
  );
}

/** Shared boot state — one treatment instead of three ad-hoc spinners. */
function AppLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <span className="text-lg font-semibold leading-none">D</span>
        </div>
        <p className="label-mono text-muted-foreground">Loading</p>
      </div>
    </div>
  );
}

function Protected({ children, perm, perms, ownerOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" replace />;
  let denied = false;
  if (ownerOnly) denied = user.role !== "owner";
  else if (perms) denied = !perms.some((p) => hasPerm(user, p));
  else if (perm) denied = !hasPerm(user, perm);
  return <Layout>{denied ? <AccessDenied /> : children}</Layout>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (user) return <Navigate to={hasPerm(user, "inbox") ? "/inbox" : "/my-work"} replace />;
  return <Landing />;
}

/** Unmissable marker so demo fixtures are never mistaken for live data.
 *  Positioned clear of the mobile tab bar and the desktop sidebar footer. */
function DemoBadge() {
  return (
    <div
      className="pointer-events-none fixed bottom-[5.5rem] right-3 z-[45] rounded-full border border-primary/30 bg-primary-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-primary shadow-sm lg:bottom-3"
      data-testid="demo-mode-badge"
    >
      Demo data · no backend
    </div>
  );
}

function App() {
  return (
    <div className="App">
      {DEMO_MODE && <DemoBadge />}
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/admin" element={<AdminPortal />} />
            <Route path="/admin/*" element={<AdminPortal />} />
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
