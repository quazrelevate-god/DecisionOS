import { useEffect, lazy, Suspense } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth, rememberArrival } from "./context/AuthContext";
import { hasPerm } from "./lib/perms";
import { LockKey, MapTrifold, ArrowClockwise } from "@phosphor-icons/react";
import { INK_PILL } from "./components/karma/glass";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
// 2026-09-17 — forgetting a password had a backend and no screens: the
// sign-in page had no link, and the link in every reset email we sent
// landed on a route that did not exist.
import { ForgotPassword, ResetPassword } from "./pages/PasswordReset";
import VerifyEmail from "./pages/EmailVerify";
import DeleteAccount from "./pages/DeleteAccount";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import DecisionReview from "./pages/DecisionReview";
import { useUiScale } from "./hooks/useUiScale";
import Workflows from "./pages/Workflows";
// ASK-42 B — /approvals is a room of its own now, not a redirect into My Work.
import Approvals from "./pages/Approvals";
// 2026-09-19 — /leave is YOUR leave again: raise a request, report an
// absence, see every request you have made. (ASK-6 had retired it to Team,
// which left a phone with no way to ask for time off.) Approving stays in
// Approvals; the company's register stays on Team.
import Leave from "./pages/Leave";
// E2-73 (2026-08-15): legacy Inbox.js retired. Sprint 2 shipped the
// new Decision Desk at /inbox; the old Inbox page had no users left.
// /inbox-legacy now redirects to /inbox so any lingering bookmarks work.
import Desk from "./pages/Desk";
import Brain from "./pages/Brain";
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
import CompanyBrain from "./pages/CompanyBrain";
import Calendar from "./pages/Calendar";
// E2-73 (2026-08-15): Meetings.js retired. Sprint 3 (E2-31) hid it
// from the sidebar and redirected /meetings to /. Re-enable path: git
// revert this commit + restore the sidebar NAV entry.
import OperatingScore from "./pages/OperatingScore";
import WorkCoach from "./pages/WorkCoach";
import Ledger from "./pages/Ledger";
/* Play audit W2 (2026-10-08) — the platform-admin portal is ours, not the
   customer's, and an app store reviewer reads a route nobody can find as a
   hidden feature. The native build (REACT_APP_NATIVE=1, set by the cap:sync
   scripts) leaves it out entirely: the condition is a build-time constant, so
   webpack never follows the import and the portal's code is not in the APK.
   The website keeps it, loaded only when somebody opens /admin. */
const AdminPortal = process.env.REACT_APP_NATIVE === "1"
  ? null
  : lazy(() => import("./pages/admin/AdminPortal"));
// MPWA-04: dev-only harness for the §7 mobile components. Tree-shaken out of
// production builds by the NODE_ENV guard on its route below.
import MobileKitchenSink from "./pages/MobileKitchenSink";
// MPWA-12a: design lab (§6), development only — see the route guard below.
import DesignLab from "./pages/DesignLab";
// MOBILE-2: Android's back gesture, inside the Capacitor app.
import { useNativeBack } from "./hooks/useNativeBack";
import PushRationale from "./components/PushRationale";
import MicNoticeHost from "./components/MicNoticeHost";
// B04: the screen for "we cannot reach the server", which is not "signed out".
import { CantReachUs } from "./components/auth/CantReachUs";

/* A screen that is not the page you asked for: no access, no such page.
   2026-10-03 — Access Denied was the last screen still in the retired
   brutalist style (black borders, uppercase, a red square). Both now share
   the quiet layout CantReachUs uses. */
function NotThePage({ testid, Icon, title, body, action, onAction, actionTestid }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center" data-testid={testid}>
      <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-900/[0.05] text-slate-500">
        <Icon size={26} weight="bold" aria-hidden="true" />
      </span>
      <div>
        <h1 className="font-display text-2xl text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
      </div>
      <button type="button" onClick={onAction} data-testid={actionTestid}
        className={`mt-2 inline-flex h-11 items-center rounded-pill px-6 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline ${INK_PILL}`}>
        {action}
      </button>
    </div>
  );
}

function AccessDenied() {
  const navigate = useNavigate();
  return (
    <NotThePage testid="access-denied" Icon={LockKey}
      title="This page isn't open to you"
      body="Your owner can give you access from Team."
      action="Go to My Work" onAction={() => navigate("/my-work")} actionTestid="access-denied-home" />
  );
}

/* 2026-10-03 — A MISTYPED OR OLD ADDRESS SAID NOTHING.
   `*` redirected to "/", which forwarded a signed-in person to the Desk, so
   /taks or a link to a retired page landed somewhere unrelated with no word
   about why. Now it says so, inside the app for someone signed in, and on its
   own for anyone else (who is offered sign-in, not the Desk they cannot see). */
function NotFound() {
  const { user, loading, offline } = useAuth();
  const navigate = useNavigate();
  if (loading) return null;
  if (!user && offline) return <CantReachUs />;
  const page = (
    <NotThePage testid="not-found" Icon={MapTrifold}
      title="We couldn't find that page"
      body="The link may be old, or the address has a typo."
      action={user ? "Take me home" : "Sign in"}
      onAction={() => navigate(user ? "/app" : "/login", { replace: true })}
      actionTestid="not-found-home" />
  );
  return user ? <Layout>{page}</Layout> : <div className="min-h-[calc(100vh/var(--ui-scale,1))] grid place-items-center">{page}</div>;
}

/* 2026-10-03 — ONE BROKEN PAGE COSTS THAT PAGE, NOT THE APP.
   The only boundary sat around <Routes>, outside the Layout, so a page that
   threw took the sidebar and the dock with it, and its message ("the rest of
   the app should still work") was untrue: there was nothing left to click.
   It also never reset, so even Back showed the same apology. This one sits
   INSIDE the Layout, keyed to the address, so the navigation survives and
   going anywhere else clears it. The outer one stays as the last resort. */
function PageBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

function Protected({ children, perm, perms, ownerOnly }) {
  const { user, loading, offline } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="min-h-[calc(100vh/var(--ui-scale,1))] flex items-center justify-center font-mono text-sm uppercase tracking-widest">
        Loading…
      </div>
    );
  /* B04 — the session could not be ASKED about, which is not the same as
     being refused. Sending them to sign in here is what asked a founder with
     no signal for an OTP that could not arrive. */
  if (!user && offline) return <CantReachUs />;
  if (!user) {
    // 2026-10-03 — a link opened signed out is kept for after sign-in.
    rememberArrival(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  let denied = false;
  if (ownerOnly) denied = user.role !== "owner";
  else if (perms) denied = !perms.some((p) => hasPerm(user, p));
  else if (perm) denied = !hasPerm(user, perm);
  return <Layout>{denied ? <AccessDenied /> : <PageBoundary>{children}</PageBoundary>}</Layout>;
}

function Home() {
  const { user, loading, offline } = useAuth();
  if (!loading && !user && offline) return <CantReachUs />;   // B04
  if (loading)
    return (
      <div className="min-h-[calc(100vh/var(--ui-scale,1))] flex items-center justify-center font-mono text-sm uppercase tracking-widest">
        Loading…
      </div>
    );
  if (user) return <Navigate to={hasPerm(user, "inbox") ? "/inbox" : "/my-work"} replace />;
  /* KM-58 — REACHING THIS LINE MEANS A SERVICE WORKER ANSWERED "/".
     
     Since KM-55 the root is a static page served by server.js, so React should
     never render at "/" on a fresh load. If it does, the navigation was served
     from the precached SPA shell by an old worker — KM-57 fixed that worker,
     but a worker cannot fix itself on a device that is still being served by
     the previous one. Founder, after two rounds of this: "no it's not loading,
     it's getting late."

     So React does what only React can do from inside that situation: tear the
     worker and its caches down, then ask the server again. The reload is
     guaranteed to reach the network because there is no longer a worker to
     intercept it.

     This is self-healing rather than permanent — the landing page does not
     register a worker, and the next visit to any app route runs
     serviceWorkerRegistration.register() again, which installs KM-57's fixed
     one. Offline support comes back on its own.

     The sessionStorage guard stays: if the built image ever lacked
     build/landing/index.html, server.js would serve the SPA here and this
     would reload forever. One attempt, then the login page — a wrong
     destination beats an infinite loop. */
  try {
    if (!sessionStorage.getItem("dos-landing-bounce")) {
      sessionStorage.setItem("dos-landing-bounce", "1");
      (async () => {
        try {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
          }
          if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {
          // Storage or SW API unavailable — reload anyway; it may already be fine.
        }
        window.location.replace("/");
      })();
      return null;
    }
  } catch {
    // Private mode with storage disabled: bounce anyway, unguarded.
    window.location.replace("/");
    return null;
  }
  return <Navigate to="/login" replace />;
}

/* MOBILE-2 — the Android back gesture, for the whole app rather than one
   shell (see hooks/useNativeBack). It renders nothing and does nothing in a
   browser; inside the APK it is what stops Back from closing DecisionOS.
   It has to sit INSIDE BrowserRouter, because it navigates. */
function NativeBack() {
  const { pushAsk } = useNativeBack();
  // Play audit W3 — the reason for notifications, before Android asks.
  return pushAsk ? <PushRationale onAnswer={pushAsk.answer} /> : null;
}

/* B?? — the page-level ErrorBoundary now RESETS on navigation. It only clears
   its error when `resetKey` changes (ErrorBoundary.jsx), and nothing supplied
   one — so a screen that threw during render left the whole shell stuck on the
   "Something broke here" card until a manual reload, even after the user tried
   to navigate away. Feeding the pathname as resetKey (the follow-up the comment
   below anticipated) clears the error the moment the route changes. Must sit
   INSIDE BrowserRouter so useLocation has a router context. */
function RoutedBoundary({ children, fallback }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname} fallback={fallback}>{children}</ErrorBoundary>;
}

function App() {
  // UI-SCALE — the whole app zooms with the screen (see hooks/useUiScale).
  useUiScale();
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <NativeBack />
          {/* Play audit W5 — the one-time microphone notice. */}
          <MicNoticeHost />
          {/* MW-10 fix: ErrorBoundary around the routed page area so a
              single broken component costs one page rather than the
              whole product (MW-08 was the canonical example -- a
              ReferenceError in UpdateForm was unmounting the entire
              React tree). If the boundary itself is what needs replacing
              on route change, wrap in a keyed remount at the page level
              in a follow-up. (Done — RoutedBoundary feeds resetKey.)
              MERGE 2026-10-06 — and it keeps the fallback. Their side added the
              route-keyed reset and dropped the shell's own last-resort screen;
              this side had the screen and no reset. Both matter and neither
              needs the other gone, so RoutedBoundary forwards the fallback. */}
          <RoutedBoundary fallback={({ reload }) => (
            /* The last resort: reached only when the shell itself broke, so
               there is no "rest of the app" to promise -- only a reload. */
            <div className="min-h-[calc(100vh/var(--ui-scale,1))] grid place-items-center">
              <NotThePage testid="app-broke" Icon={ArrowClockwise}
                title="DecisionOS hit a problem"
                body="Nothing you saved is lost. Reload to carry on — the error has been logged."
                action="Reload" onAction={reload} actionTestid="app-broke-reload" />
            </div>
          )}>
          <Routes>
            {/* KM-55 — the one place that answers "where does a signed-in user
                belong?". "/" used to do it, but "/" is the marketing site now.
                The static landing bounces authenticated visitors HERE rather
                than working it out itself: the answer depends on hasPerm and
                userPerms, which fall back to per-role defaults, and a vanilla-JS
                copy of that on the landing page would drift the first time a
                role's defaults changed. */}
            <Route path="/app" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            {/* The URL the reset email carries (routers/auth.py). */}
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* And the URL every welcome email has carried since FIX-003-D,
                which until now was a 404 (U7-24.10). */}
            <Route path="/verify-email" element={<VerifyEmail />} />
            {/* PLAY-1 — public on purpose: Play requires a deletion route
                reachable by somebody who has uninstalled the app. The URL is
                registered in the Play Console listing, so it must not move. */}
            <Route path="/delete-account" element={<DeleteAccount />} />
            {/* PLAY-2 — public: Play requires a privacy-policy URL that a
                person can read BEFORE installing, and cross-checks it against
                the Data Safety form. Registered in the Console; do not move. */}
            <Route path="/privacy" element={<Privacy />} />
            {/* PLAY-3 — public for the same reason as /privacy: the terms are
                read before they are agreed to (signup, components/TermsGate). */}
            <Route path="/terms" element={<Terms />} />
            {AdminPortal && <Route path="/admin" element={<Suspense fallback={null}><AdminPortal /></Suspense>} />}
            {AdminPortal && <Route path="/admin/*" element={<Suspense fallback={null}><AdminPortal /></Suspense>} />}
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
            {/* 2026-10-06: the Journal is the decision makers' history, not the owner's alone. */}
            <Route path="/journal" element={<Protected perms={["decisions_approve"]}><Journal /></Protected>} />
            {/* 2026-10-06: the Company Brain — documents + notes, its own place (Dex stays at /brain). */}
            <Route path="/company-brain" element={<Protected perm="brain"><CompanyBrain /></Protected>} />
            <Route path="/my-work" element={<Protected><MyWork /></Protected>} />
            {/* 2026-09-19 — your leave: request, absence, history. The
                register stays on Team, approving in Approvals, per-department
                approvers in Settings > Operations. */}
            <Route path="/leave" element={<Protected><Leave /></Protected>} />
            {/* ASK-25 F3 — the approvals that aren't decisions (task sign-offs
                and leave) live as a view inside My Work, beside My Tasks /
                All Tasks / Workflows. The standalone path stays as a deep
                link that lands there. */}
            {/* ASK-42 B — the approvals hub is its own page, reached from More.
                The old address IS this page now, so every link ever made to
                /approvals lands where it always meant to. */}
            <Route path="/approvals" element={<Protected><Approvals /></Protected>} />
            <Route path="/settings" element={<Protected><Settings /></Protected>} />
            <Route path="/review" element={<Navigate to="/ingest" replace />} />
            <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
            {/* Epic 2 Sprint 2: /inbox renders the 4-chip Decision Desk.
                E2-73 (2026-08-15): legacy Inbox page deleted; /inbox-legacy
                now redirects so any lingering bookmark still resolves. */}
            <Route path="/inbox" element={<Protected perm="inbox"><Desk /></Protected>} />
            <Route path="/inbox-legacy" element={<Navigate to="/inbox" replace />} />
            {/* KM-28 — the decision review is a page, not a pop-up. */}
            <Route path="/decisions/:id" element={<Protected><DecisionReview /></Protected>} />
            {/* KM-31 — a real page, not a redirect into My Work. It is reached
                from the More menu now, so it needs somewhere of its own to be. */}
            <Route path="/workflows" element={<Protected perm="workflows"><Workflows /></Protected>} />
            {/* Epic 2 Sprint A — E2-01: /contacts is retired, redirects to /crm.
                /contacts/:id (ContactProfile 360°) still works so any deep-links
                or Brain-cited sources continue to resolve. */}
            <Route path="/contacts" element={<Navigate to="/crm" replace />} />
            {/* J7-04 / J8-01 — either side of CRM opens the page; the page
                itself shows only the side you hold, and the server refuses
                the other one by name. */}
            <Route path="/contacts/:id" element={<Protected perms={["people", "crm_buyers", "crm_suppliers"]}><ContactProfile /></Protected>} />
            <Route path="/crm" element={<Protected perms={["people", "crm_buyers", "crm_suppliers"]}><CRM /></Protected>} />
            {/* Epic 2 Sprint 4 (E2-27): /ingest merged into /finance's Inbox tab. */}
            <Route path="/ingest" element={<Navigate to="/finance?tab=inbox" replace />} />
            <Route path="/tasks" element={<Navigate to="/my-work" replace />} />
            <Route path="/priorities" element={<Navigate to="/my-work" replace />} />
            <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
            {/* Epic 2 Sprint 3 (E2-31): Meeting Notes hidden this phase.
                Route redirects to home. Meetings.js + backend endpoints
                stay alive so re-enabling is a single-line revert. */}
            <Route path="/meetings" element={<Navigate to="/" replace />} />
            {/* Epic 7 Sprint 1 Phase A (2026-08-17): dropped ownerOnly.
                Endpoint dispatches by role: owner keeps company view,
                every other role gets a self-focused view. Founder ask:
                'if the team person login and go the ops it have to show
                the individuals person metrics'. */}
            <Route path="/operating-score" element={<Protected><OperatingScore /></Protected>} />
            <Route path="/coach" element={<Protected><WorkCoach /></Protected>} />
            {/* Epic 2 Sprint 5 (E2-32): /dex is the new-name alias for the
                Brain page. Route /brain is preserved for bookmark safety. */}
            <Route path="/brain" element={<Protected perm="brain"><Brain /></Protected>} />
            <Route path="/dex" element={<Protected perm="brain"><Brain /></Protected>} />
            {/* Epic 2 Sprint 4 (E2-23 / E2-27): /finance is the merged home
                for Finance + document Capture. Old /ledger + /ingest redirect
                here. Gate broadened to also accept data_input so users who
                had Capture-only access aren't locked out of the Inbox tab. */}
            <Route path="/finance" element={<Protected perms={["finance", "data_input"]}><Ledger /></Protected>} />
            <Route path="/ledger" element={<Navigate to="/finance" replace />} />
            <Route path="/ask" element={<Navigate to="/brain" replace />} />
            {/* U7-09.TEAM (2026-08-17): Team is now visible to any authenticated
                user. Founder ask: 'team section can be show to all the team but
                as view and owner and given access to people only has the edit
                section'. Edit affordances inside TeamPanel already gate on
                hasPerm('team_manage'); non-perm users just see a read-only
                roster. */}
            <Route path="/team" element={<Protected><TeamPage /></Protected>} />
            {/* U7-09.PEOPLE (2026-08-17): unified People page -- open to any
                authenticated user. Employees / Customers / Vendors all
                visible; edit affordances gated per-tab inside the page
                (team_manage for Employees, people for Customers+Vendors).
                Founder ask: 'people section can be show to all the people
                but as view and owner and given access to people only has
                the edit section, other will have the view section'. */}
            {/* RBAC P2 (2026-09-16): the old People page duplicated Team; old links land there. */}
            <Route path="/people" element={<Navigate to="/team" replace />} />
            {/* MPWA-04: component harness, development only. */}
            {process.env.NODE_ENV !== "production" && (
              <Route path="/__mobile-kit" element={<Protected><MobileKitchenSink /></Protected>} />
            )}
            {/* MPWA-12a (§6): not wrapped in <Protected> in development — the
                lab renders the real screens inside iframes, and each of those
                enforces its own auth. Gating the shell too would just double
                the redirect.
                ASK-44 — AND IT IS REACHABLE IN PRODUCTION NOW, owner-only. The
                lab is where the founder reviews something before it goes into
                the app ("use the design lab page… once we finalize it we will
                add it to our web application"), and they review on the deployed
                site, not a dev server — a review surface nobody can reach is
                not a review surface. In production it goes behind the same
                owner gate as the Journal, so the page is the founder's and no
                signed-out visitor sees the workbench. Unlinked either way:
                nothing in the app navigates here. */}
            <Route
              path="/design-lab"
              element={process.env.NODE_ENV === "production"
                ? <Protected ownerOnly><DesignLab /></Protected>
                : <DesignLab />}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </RoutedBoundary>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
