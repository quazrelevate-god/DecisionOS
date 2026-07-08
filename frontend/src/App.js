import { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Inbox from "./pages/Inbox";
import Workflows from "./pages/Workflows";
import Brain from "./pages/Brain";
import Team from "./pages/Team";
import Contacts from "./pages/Contacts";
import CEOBrief from "./pages/CEOBrief";
import Notifications from "./pages/Notifications";
import MyWork from "./pages/MyWork";
import Ingest from "./pages/Ingest";
import ContactProfile from "./pages/ContactProfile";
import Journal from "./pages/Journal";
import Priorities from "./pages/Priorities";
import Calendar from "./pages/Calendar";
import Meetings from "./pages/Meetings";
import OperatingScore from "./pages/OperatingScore";
import WorkCoach from "./pages/WorkCoach";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center font-mono text-sm uppercase tracking-widest">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Inbox /></Protected>} />
            <Route path="/dashboard" element={<Navigate to="/brief" replace />} />
            <Route path="/brief" element={<Protected><CEOBrief /></Protected>} />
            <Route path="/journal" element={<Protected><Journal /></Protected>} />
            <Route path="/my-work" element={<Protected><MyWork /></Protected>} />
            <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
            <Route path="/inbox" element={<Protected><Inbox /></Protected>} />
            <Route path="/workflows" element={<Protected><Workflows /></Protected>} />
            <Route path="/contacts" element={<Protected><Contacts /></Protected>} />
            <Route path="/contacts/:id" element={<Protected><ContactProfile /></Protected>} />
            <Route path="/ingest" element={<Protected><Ingest /></Protected>} />
            <Route path="/tasks" element={<Navigate to="/my-work" replace />} />
            <Route path="/priorities" element={<Protected><Priorities /></Protected>} />
            <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
            <Route path="/meetings" element={<Protected><Meetings /></Protected>} />
            <Route path="/operating-score" element={<Protected><OperatingScore /></Protected>} />
            <Route path="/coach" element={<Protected><WorkCoach /></Protected>} />
            <Route path="/brain" element={<Protected><Brain /></Protected>} />
            <Route path="/ask" element={<Navigate to="/brain" replace />} />
            <Route path="/team" element={<Protected><Team /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
