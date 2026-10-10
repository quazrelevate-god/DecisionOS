import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, takeReturnTo } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { KarmaLogo } from "../components/karma/Logo";
import OtpBoxes from "../components/auth/OtpBoxes";
import { DeviceMobile, ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";
// B11 — the dev OTP is ignored by a production build (lib/devOtp).
import { devOtpFrom } from "../lib/devOtp";
import { currentDraft } from "../lib/onboardingDraft";
import { normIndianMobile } from "../lib/phone";
import { STORE_BUILD } from "../lib/storeBuild";

// KM-66 — the demo takes the whole card, not a corner of it. The default
// state is the sign-in form; a single professional invitation ("Try
// DecisionOS on a live workspace") sits at the foot, quietly pulsing to
// draw a first-time visitor's eye without begging for it. Clicking it swaps
// the entire card — form, tabs, links all fade out together — and fades in
// a role picker. Cards carry the role name and a one-line descriptor;
// icons were removed because the descriptors already earn the row on their
// own and the icons were making a set of four read as a menu. The choices
// themselves still call demoLogin — this is a UI revamp, not a routing
// change.
/* PLAY (2026-10-10, founder) — NO DEMO IN THE APP. The store build signs in,
   registers and resets a password, and nothing else: no live-workspace
   invitation, no role seats, no shared demo password. Every line of it is
   behind STORE_BUILD (lib/storeBuild), a build-time constant, so the store
   bundle does not carry it at all; the website keeps its demo as it was. */
const DEMO = STORE_BUILD ? [] : [
  { role: "Owner",      email: "owner@sharma.com",      hint: "Full workspace view" },
  { role: "Sales",      email: "sales@sharma.com",      hint: "Customer pipeline" },
  { role: "Production", email: "production@sharma.com", hint: "Operations floor" },
  { role: "Finance",    email: "finance@sharma.com",    hint: "Books & cashflow" },
];

// MPWA-11 (§8): "56px fields and buttons" on mobile. min-h-touch-lg is 56px
// below lg and unset above it, so desktop keeps its py-3 geometry. text-base
// also stops iOS Safari zooming the viewport on focus.
/* KM-59 — the signup page's grammar, not the old neumorphic tile: a sunken
   trough for anything you type into, a raised pill for anything you press.
   `.signup-stage`/.login-stage restyle both against the photograph, so the two
   auth screens are now one design rather than two that happen to adjoin. */
const inputCls = "kr-pressed w-full rounded-pill bg-transparent px-4 py-3 text-base lg:text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 min-h-touch-lg lg:min-h-0";
const labelCls = "label-mono text-muted-foreground";

// Masks a phone to show only the last 4 digits, e.g. +91 98765 43210 -> +91 ••••• •3210
const maskPhone = (raw) => {
  if (!raw) return "your mobile";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return raw;
  return `••••• ${digits.slice(-4)}`;
};

export default function Login() {
  const { login, loginWithOtp } = useAuth();
  const navigate = useNavigate();
  /* 2026-09-20 — onboarding sends a founder here when the number they just
     confirmed already runs a company ("Open"), with the number and the
     workspace in the link. Open on the mobile tab with it filled in, so all
     they do is ask for the code. */
  const _opened = new URLSearchParams(window.location.search);
  const _fromSignup = _opened.get("phone") || "";
  /* J2-13 (JOURNEY-1) — THE PAGE OPENS ON MOBILE + CODE. It opened on Email &
     password, which is a form most people here cannot fill: somebody who signed
     up by number, or who was invited, has no password at all, and the next
     morning this screen asked them for one. Everybody has their phone. The
     password tab is still one tap away for the people who set one. */
  const [loginTab, setLoginTab] = useState("otp");
  const [otpPhone, setOtpPhone] = useState(_fromSignup);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  // 2026-09-19 — which workspace the code is for. A number can belong to more
  // than one (a consultant serving two clients, a founder who also works at a
  // friend's shop). The API then sends NOTHING and answers with a list; this
  // page used to ignore that answer, say "OTP sent", and wait for a code that
  // was never coming.
  const [otpTenant, setOtpTenant] = useState(_opened.get("tenant") || null);
  const [otpChoices, setOtpChoices] = useState(null);
  // Audit A-03: proof the code was read back, for picking a company after it.
  const [pickToken, setPickToken] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [invite, setInvite] = useState(null);
  /* B09 / B26 (2026-09-29) — an invite link has three states, and this screen
     used to draw only one of them. `inviteToken` is "this person arrived
     through a link", which is true before we know anything about it;
     `inviteLoading` is the second or two while the server is asked, during
     which the form was live and a fast typist could send an OTP the invite
     was about to replace; `inviteError` is a link that is expired, spent or
     wrong, which used to land in the generic error — and the generic error
     for an unknown number offers "Start a new company with this number". An
     invited member who waited a week to tap their link was being walked into
     founding a second company instead of joining the one that invited them. */
  const inviteToken = useMemo(
    () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("invite")),
    []
  );
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);
  const [inviteError, setInviteError] = useState("");
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // KM-66 — the demo section starts collapsed to a single invitation. It
  // opens on the founder's own click; there is no way to hit it accidentally
  // by tabbing through, and the four seats never appear before they are asked
  // for. Once opened, a small back arrow returns to the compact button.
  const [demoOpen, setDemoOpen] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // OTP resend cooldown ticker (30s, matches backend cooldown)
  const startResendTimer = () => setResendIn(30);
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Legacy signup deep-links (/login?signup=1) now go to the new onboarding experience.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("signup") === "1" || sp.get("mode") === "signup") {
      navigate("/signup", { replace: true });
    }
    // Runs once on mount to handle the deep-link: a later navigate identity
    // change must not send someone to /signup again mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Invite deep-link: /?invite=<token> — auto-switch to OTP and text the code.
  const inviteStarted = useRef(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token || inviteStarted.current) return;
    inviteStarted.current = true;
    setLoginTab("otp");
    (async () => {
      try {
        const { data } = await api.get(`/auth/invite/${token}`);
        setInvite({ ...data, token });
        const start = await api.post(`/auth/invite/${token}/start`);
        // Audit D-03: the invite answers with the masked number only; verify reads
        // the real one from the invite, so this is just what the screen shows.
        setOtpPhone(start.data.phone_masked || "");
        // The invite already names the workspace; carry it to verify.
        setOtpTenant(start.data.tenant_id || null);
        setOtpSent(true);
        startResendTimer();
        const dev = devOtpFrom(start.data);
        if (dev) { setOtpCode(dev); toast.info(`Dev OTP: ${dev} (auto-filled)`); }
        else toast.success("We texted a login code to your mobile");
      } catch (err) {
        setInviteError(formatApiError(err.response?.data?.detail) || "This invite link is invalid or expired.");
      } finally {
        setInviteLoading(false);
      }
    })();
    // Runs once on mount to handle the ?invite= deep-link; deps intentionally empty.
  }, []);

  /* MOBILE-2 — SIGNING IN REPLACES THE SIGN-IN SCREEN. These pushed, so the
     sign-in page stayed one entry behind the Desk: harmless in a browser,
     where nobody presses Back after signing in, and wrong in the APK, where
     Back is the phone's own gesture and the first thing it did from the Desk
     was show a signed-in founder the sign-in screen again. */
  const doLogin = async (e) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await login(form.email, form.password); navigate(takeReturnTo() || "/", { replace: true }); }
    catch (err) { setError(formatApiError(err.response?.data?.detail) || "Failed"); }
    finally { setBusy(false); }
  };
  const demoLogin = async (email) => {
    if (STORE_BUILD) return;
    setError(""); setBusy(true);
    try { await login(email, "demo1234"); navigate(takeReturnTo() || "/", { replace: true }); }
    catch (err) { setError(formatApiError(err.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const requestOtp = async (e, pickTenant) => {
    e?.preventDefault?.(); setError(""); setBusy(true);
    const tenant = pickTenant || otpTenant;
    // 2026-09-19 — an invited member's first sign-in goes through their link;
    // their number alone opens nothing yet, so "Resend" asks the link again.
    if (invite?.token) {
      try {
        const { data } = await api.post(`/auth/invite/${invite.token}/start`);
        startResendTimer();
        const devResend = devOtpFrom(data);
        if (devResend) { setOtpCode(devResend); toast.info(`Dev OTP: ${devResend} (auto-filled)`); }
        else toast.success(data.detail || "We texted you a new code");
      } catch (err) { setError(formatApiError(err.response?.data?.detail) || "Failed"); }
      finally { setBusy(false); }
      return;
    }
    /* Audit A-03 — the server now answers every well-formed number alike
       (it no longer says "no account"), so a number that cannot be an account
       is caught here: accounts are Indian mobiles. */
    if (!normIndianMobile(otpPhone)) {
      setError("Enter a 10-digit Indian mobile number");
      setBusy(false);
      return;
    }
    try {
      const { data } = await api.post("/auth/otp/request", { phone: otpPhone, ...(tenant ? { tenant_id: tenant } : {}) });
      if (data.ambiguous) {
        // No code went out. Ask which workspace, then ask again for that one.
        setOtpChoices(data.choices || []);
        return;
      }
      setOtpChoices(null); setPickToken("");
      setOtpTenant(data.tenant_id || tenant || null);
      setOtpSent(true);
      startResendTimer();
      const dev = devOtpFrom(data);
      if (dev) { toast.info(`Dev OTP: ${dev} (auto-filled)`); setOtpCode(dev); }
      else toast.success(data.detail || "We've texted you a code");
    } catch (err) {
      const detail = formatApiError(err.response?.data?.detail) || "Failed";
      /* 2026-10-08 — "Change", then the same number again inside 30 seconds:
         the server refuses a second code ("Please wait 17s…") because the first
         one is still on its way and still good. The page showed that as an
         error and stayed on the number, with nowhere to type the code that had
         arrived. Go to the code boxes instead and count down the resend. */
      const wait = err.response?.status === 429 && /please wait (\d+)s/i.exec(detail);
      if (wait) {
        setOtpChoices(null);
        setOtpTenant(tenant || null);
        setOtpSent(true);
        setResendIn(Number(wait[1]) || 30);
        toast.info("We sent you a code a moment ago — enter that one");
      } else setError(detail);
    }
    finally { setBusy(false); }
  };
  /* The server's refusal for a company this number is not in (auth_otp.py).
     Since audit A-03 it no longer says "no account" for an unknown number. */
  const unknownNumber = /not registered|no account is registered/i.test(error || "");

  /* Audit A-03 — the second half of a many-company sign-in: the code was read
     back and the companies are on screen; open the one they pick. */
  const pickCompany = async (tenantId) => {
    setError(""); setBusy(true);
    try {
      await loginWithOtp(otpPhone, "", tenantId, null, pickToken);
      navigate(takeReturnTo() || "/", { replace: true });
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Failed");
      setOtpChoices(null); setPickToken(""); setResendIn(0);
    } finally { setBusy(false); }
  };
  const submitOtp = async (e, typedCode) => {
    /* B30 makes the event optional — six digits submits without one.
       MOBILE-2 keeps `replace`: the sign-in screen must not sit behind the
       Desk, where the phone's Back gesture would show it to somebody who has
       just signed in. B18 adds the clearing of a refused code.
       2026-10-08 — `typedCode`: the sixth digit submits the code AS TYPED.
       This read `otpCode` from state, which had not caught up yet, so every
       code typed by hand went to the server one digit short and came back
       "Incorrect OTP" -- only the dev auto-fill (which uses the button) got in. */
    e?.preventDefault?.(); setError(""); setBusy(true);
    const code = typeof typedCode === "string" ? typedCode : otpCode;
    try {
      const res = await loginWithOtp(otpPhone, code, otpTenant, invite?.token);
      if (res?.choose) { setOtpChoices(res.choose); setPickToken(res.pick_token || ""); return; }
      navigate(takeReturnTo() || "/", { replace: true });
    }
    catch (err) {
      const detail = formatApiError(err.response?.data?.detail) || "Failed";
      /* 2026-10-08 — five wrong codes, or a code left past five minutes, and
         the server throws the code away ("Too many attempts. Request a new
         OTP", then "Request an OTP first"). The resend link stayed behind its
         30-second countdown all the same, so the only thing on screen to do
         was wait. The code is gone: say so, and offer the new one now. */
      const spent = /send yourself a|request an otp first|request a new|expired/i.test(detail);
      setError(spent ? "That code can't be used any more — send yourself a new one below." : detail);
      if (spent) setResendIn(0);
      /* B18 (2026-09-29) — A REFUSED CODE WAS LEFT IN THE BOXES. The founder
         then had to clear six of them by hand before they could try the one
         their phone had just received, on the screen where they are already
         annoyed. Emptied, with the caret back in the first box. */
      setOtpCode("");
      requestAnimationFrame(() => document.querySelector('[data-testid="otp-box-0"]')?.focus());
    }
    finally { setBusy(false); }
  };

  return (
    /* KM-59 — the login page becomes the signup page's twin.
       Founder: "rearrange the login page UI items and change the theme and
       design to match the signup page, and use the signup-lg image as
       background but copy it as a separate dedicated image."

       WHAT WENT. A split screen: a solid indigo half carrying a headline and a
       PNG lockup, against a white half holding the form. It was the last
       surface still wearing the retired blue, and it disagreed with the page
       one click away — you registered on a photograph and signed in on a slab.

       `relative isolate` is load-bearing, exactly as on signup: the art layer
       is position:fixed at z-index:-1, and a negative-z child only paints above
       its parent's background if that parent is a stacking context. Without it
       the picture escapes to the root context, lands behind the body fill, and
       the page renders white. */
    <div className="login-stage relative isolate flex min-h-[calc(100vh/var(--ui-scale,1))] flex-col bg-white text-foreground">
      {/* The artwork. It reuses .app-sky__art--aside wholesale — that layer
          carries two pictures, two fits, the phone radial mask and the desktop
          full-bleed, all measured against the DOM in KM-41/KM-42 — and only
          the two image URLs are re-pointed, in index.css under .login-stage.
          Duplicating the geometry would have meant maintaining that arithmetic
          twice. */}
      <div className="app-sky__art app-sky__art--aside" aria-hidden="true" />

      {/* ASK-33 Phase 5 — the dark-mode switch that sat here is gone: the app
          is designed light-only (founder, 2026-09-16). */}

      {/* Header — signup's exact header: on a phone the wordmark alone,
          centred; on desktop a floating glass pill with the way out on the
          right. KarmaLogo replaces the PNG Wordmark, which is the founder's
          "replace the old DecisionOS logo with our current one": the app shell
          has worn the text mark since KR-14 and this was the last screen still
          showing the old lockup. */}
      {/* IOS-1 (2026-09-30) — the top inset, found on the first iOS run.
          Capacitor sets contentInset: 'never' and the page ships
          viewport-fit=cover, so on iOS the webview draws UNDER the status
          bar. With a flat pt-4 the wordmark sat 16px from the physical top
          — behind the Dynamic Island on a 17 Pro, behind the notch on a 13
          mini — and simply was not there. Android has no such inset, which
          is why it looked right for weeks.
          Same shape the app shell already uses (Layout.js:941). --sa-top is
          0 in a browser, so desktop and web are unchanged. */}
      <header className="px-4 pt-[calc(var(--sa-top)+1rem)] lg:px-8 lg:pt-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-4 rounded-pill px-4 py-2.5 lg:kr-frost lg:justify-between lg:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" data-testid="login-logo">
            <KarmaLogo size="md" />
          </Link>
          <Link
            to="/signup"
            data-testid="login-register-link"
            /* J1-01 made this visible at every width: on a phone, the screen
               the app opens on had no way to sign up at all.
               2026-09-29, founder — off the phone again. In the app it sat in
               the middle of the header, beside the wordmark, and the first
               thing the screen offered somebody opening DecisionOS to sign in
               was a way to start a different company. The two paths J1-01
               actually needed are both still on this screen and both below the
               fold of the decision: "Need a workspace? Register" under the
               form, and — the one that matters — "Start a new company with
               this number" offered to a number we do not know. Desktop keeps
               the pill: there it sits at the far right of a wide header,
               nowhere near the form, and nobody has complained about it. */
            className="kr-pop hidden h-9 shrink-0 items-center rounded-pill px-4 text-xs font-medium lg:flex"
          >
            Create a workspace
          </Link>
        </div>
      </header>

      {/* Stage — one glass card, centred, the same pane the signup questions
          sit in. The old page's left-hand headline is gone rather than
          relocated: the picture is the atmosphere now, and a marketing
          paragraph on the screen you reach by choosing "Sign in" is answering
          a question nobody asked there. */}
      {/* B22 (2026-09-29) — THE CARD SAT IN THE MIDDLE OF AN EMPTY SCREEN.
          `items-center` centres it in the whole column, so on a phone the top
          45% was picture and nothing else while the fields sat low — exactly
          where the keyboard comes up. Opening it then shoved the card, and at
          360x640 the number field and Send OTP were the first things pushed
          out of the way.
          The card starts near the top third on a phone (`items-start` with a
          measured lead) and keeps the centred composition from lg, where
          there is height to spare and no keyboard to dodge. */}
      {/* The lead itself lives in index.css (.login-stage__main), which is
          where this app keeps its values — and it has to answer a question
          Tailwind cannot ask here: how tall is the screen. */}
      <main className="login-stage__main flex flex-1 items-start justify-center px-4 pb-8 lg:items-center lg:px-8 lg:pb-12">
        <div className="kr-well w-full max-w-md" data-testid="login-card">
          <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-8">
          {/* KM-66 — the whole card swaps between two panes: SIGN IN and
              LIVE DEMO. Not a section-inside-a-card, a full-card swap.
              AnimatePresence with mode="wait" so the exit finishes before
              the enter begins — the two panes never overlap during the
              transition. */}
          <AnimatePresence mode="wait" initial={false}>
          {/* The store build never opens the demo pane (no way in, above). */}
          {STORE_BUILD || !demoOpen ? (
          <motion.div
            key="signin-pane"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
          <h2 className="font-display text-3xl mb-1">Sign in</h2>
          <p className="text-sm text-muted-foreground mb-6">Access your company brain.</p>

          {/* A sunken track with a raised pill on the live tab — the same
              "selected means pushed in" grammar as signup's phase rail, and
              the app's segmented controls. No transition-colors on these: the
              .kr-pop/.kr-pressed pair swaps an outset shadow list for an inset
              one and those do not interpolate, so a transition makes the
              selection snap through a broken frame instead of moving. */}
          <div className="kr-pressed mb-5 flex gap-1 rounded-pill p-1" data-testid="login-tabs">
            <button onClick={() => { setLoginTab("password"); setError(""); }} data-testid="login-tab-password"
              className={`flex-1 rounded-pill px-3 py-2 text-xs font-medium ${loginTab === "password" ? "kr-pop" : "text-foreground/60 hover:text-foreground"}`}>
              Email &amp; Password
            </button>
            <button onClick={() => { setLoginTab("otp"); setError(""); }} data-testid="login-tab-otp"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-pill px-3 py-2 text-xs font-medium ${loginTab === "otp" ? "kr-pop" : "text-foreground/60 hover:text-foreground"}`}>
              <DeviceMobile size={14} weight="bold" /> Mobile number
            </button>
          </div>

          {loginTab === "password" && (
            <form onSubmit={doLogin} className="space-y-4">
              <input data-testid="login-email-input" type="email" autoComplete="email" inputMode="email"
                autoCapitalize="none" autoCorrect="off" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
              <input data-testid="login-password-input" type="password" autoComplete="current-password"
                className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />
              {error && <p data-testid="auth-error" className="text-sm text-danger-600 font-semibold">{error}</p>}
              {/* 2026-10-08 — everyone who signed up on this app signed up with
                  their mobile, and has no password. The email they type here is
                  real, so "Invalid email or password" reads as a wrong password;
                  the way in is the other tab. */}
              {error && (
                <p className="text-xs text-muted-foreground" data-testid="login-password-mobile-hint">
                  Signed up with your mobile number? There&rsquo;s no password on that account &mdash;{" "}
                  <button type="button" onClick={() => { setLoginTab("otp"); setError(""); }} data-testid="login-use-mobile"
                    className="font-semibold text-foreground/80 underline underline-offset-2 hover:text-foreground">
                    sign in with a mobile code
                  </button>.
                </p>
              )}
              <button type="submit" disabled={busy} data-testid="auth-submit-button" className="kr-lift flex h-12 w-full items-center justify-center rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50">{busy ? "…" : "Sign in"}</button>
              {/* 2026-09-17 — where a person looks for it: under the password
                  they just failed to remember. */}
              <div className="text-center">
                <Link to="/forgot-password" data-testid="login-forgot-password"
                  className="text-sm font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">
                  Forgot your password?
                </Link>
              </div>
            </form>
          )}

          {loginTab === "otp" && (
            <form onSubmit={otpSent ? submitOtp : (e) => requestOtp(e)} className="space-y-4" data-testid="otp-form">
              {/* B09 — the link is bad: say so, name who to ask, and offer
                  nothing that starts a different company. */}
              {inviteError && (
                <div className="kr-pressed rounded-cardlg p-3" data-testid="invite-error" role="alert">
                  <p className="text-sm font-medium tracking-tight">This invite link doesn&rsquo;t work any more</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {inviteError} Ask whoever invited you to send a new one — your place in their workspace is still there.
                  </p>
                </div>
              )}
              {/* B26 — and while we are still asking, the form is not the
                  answer: the number it would text is the one on the invite. */}
              {inviteLoading && !inviteError && (
                <div className="kr-pressed rounded-cardlg p-3" data-testid="invite-loading" role="status">
                  <p className="text-sm font-medium tracking-tight">Opening your invite…</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">One moment — we&rsquo;re sending a code to the number it was sent to.</p>
                </div>
              )}
              {invite && (
                <div className="kr-pressed rounded-cardlg p-3" data-testid="invite-welcome">
                  <p className="font-medium uppercase tracking-tight text-sm">Welcome, {invite.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You've been invited to <strong>{invite.company}</strong>. Enter the code we sent to {invite.phone_masked} to sign in — no password needed.</p>
                </div>
              )}
              {/* B26 — while the invite is resolving there is nothing useful to
                  type: the number is the invite's, and it is about to arrive. */}
              {inviteLoading && !inviteError ? null : !otpSent ? (
                <>
                  <div>
                    <label className={labelCls}>Mobile number</label>
                    {/* B29 — the phone's own keypad, and the number it already
                        knows about itself. */}
                    <input data-testid="otp-phone-input" type="tel" autoComplete="tel" inputMode="tel"
                      className={`${inputCls} mt-1`} placeholder="Registered mobile number" value={otpPhone}
                      onChange={(e) => { setOtpPhone(e.target.value); setOtpChoices(null); setOtpTenant(null); }} required />
                  </div>
                  {otpChoices && (
                    <div className="space-y-2" data-testid="otp-workspace-picker">
                      <p className="text-sm text-muted-foreground">
                        This number is in more than one workspace. Which one are you signing in to?
                      </p>
                      {otpChoices.map((c) => (
                        <button key={c.tenant_id} type="button" disabled={busy}
                          onClick={() => requestOtp(null, c.tenant_id)}
                          data-testid={`otp-workspace-${c.tenant_id}`}
                          className="kr-pop flex w-full items-center justify-between rounded-pill px-4 py-3 text-left text-sm disabled:opacity-50">
                          <span className="font-semibold">{c.tenant_name || "Workspace"}</span>
                          {c.user_name && <span className="text-xs text-muted-foreground">as {c.user_name}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {error && <p data-testid="auth-error" className="text-sm text-danger-600 font-semibold">{error}</p>}
                  {/* J1-01 (JOURNEY-1) — A NUMBER WE DO NOT KNOW IS A NEW
                      CUSTOMER, NOT AN ERROR. The phone opens here, the number
                      came back "not registered", and the only way on was a
                      line of small print. Somebody standing at a locked door
                      is told where the open one is, with their number carried
                      across so they do not type it twice. */}
                  {/* 2026-10-08 — a sign-up left half-way has no account yet, so this
                      number is "not registered". If this browser holds that sign-up,
                      the way forward is to finish it, not to start a new one. */}
                  {unknownNumber && !inviteToken && (
                    <button type="button" data-testid="otp-start-company"
                      onClick={() => navigate(currentDraft() ? "/signup" : `/signup?phone=${encodeURIComponent(otpPhone)}`)}
                      className="kr-pop flex h-12 w-full items-center justify-center rounded-pill px-4 text-sm font-medium">
                      {currentDraft() ? "Finish setting up your company" : "Start a new company with this number"}
                    </button>
                  )}
                  {unknownNumber && !inviteToken && currentDraft() && (
                    <p className="text-center text-xs text-muted-foreground" data-testid="otp-unfinished-signup">
                      You started signing up and didn't finish, so there's no account to sign in to yet — your answers are kept.
                    </p>
                  )}
                  {/* While the workspaces are on screen they ARE the buttons:
                      a Send OTP beside them would only ask the question again. */}
                  {!otpChoices && (
                    <button type="submit" disabled={busy} data-testid="otp-submit-button" className="kr-lift flex h-12 w-full items-center justify-center rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50">
                      {busy ? "Sending…" : "Text me a code"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="kr-pressed flex items-center justify-between rounded-pill px-3 py-2.5" data-testid="otp-phone-confirm">
                    <div className="flex items-center gap-2 min-w-0">
                      <DeviceMobile size={16} weight="bold" className="shrink-0 text-foreground/70" />
                      <span className="text-sm font-mono truncate">Code sent to <strong>{invite?.phone_masked || maskPhone(otpPhone)}</strong></span>
                    </div>
                    {/* B30 — not on an invite. The number belongs to the
                        invitation, Resend texts THAT number whatever is typed
                        here, and letting somebody edit it offered a change the
                        screen could not honour. */}
                    {!inviteToken && (
                      <button type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); setResendIn(0); setOtpTenant(null); setOtpChoices(null); setPickToken(""); }} data-testid="otp-change-number"
                        className="text-xs font-semibold uppercase text-foreground/70 underline-offset-2 hover:text-foreground hover:underline whitespace-nowrap ml-2 shrink-0">Change</button>
                    )}
                  </div>
                  {/* Audit A-03 — a number in several companies: the code was
                      right, and only now are its companies shown. */}
                  {otpChoices && pickToken ? (
                    <div className="space-y-2" data-testid="otp-workspace-picker">
                      <p className="text-sm text-muted-foreground">
                        This number is in more than one workspace. Which one are you signing in to?
                      </p>
                      {otpChoices.map((c) => (
                        <button key={c.tenant_id} type="button" disabled={busy}
                          onClick={() => pickCompany(c.tenant_id)}
                          data-testid={`otp-workspace-${c.tenant_id}`}
                          className="kr-pop flex w-full items-center justify-between rounded-pill px-4 py-3 text-left text-sm disabled:opacity-50">
                          <span className="font-semibold">{c.tenant_name || "Workspace"}</span>
                          {c.user_name && <span className="text-xs text-muted-foreground">as {c.user_name}</span>}
                        </button>
                      ))}
                      {error && <p data-testid="auth-error" className="text-sm text-danger-600 font-semibold">{error}</p>}
                    </div>
                  ) : (<>
                  <div>
                    <label className={labelCls}>Enter 6-digit code</label>
                    <div className="mt-2">
                      {/* B30 (2026-09-29) — SIX DIGITS IS THE ANSWER, on both
                          screens. Signing up submitted the moment the sixth
                          digit landed and signing in made you press a button,
                          so the same six taps behaved differently depending on
                          which door you came through. It submits here too —
                          and the button stays, because an autofilled code
                          arrives all at once and somebody who paused mid-code
                          still needs it. */}
                      <OtpBoxes value={otpCode} disabled={busy}
                        onChange={(v) => {
                          setOtpCode(v);
                          if (error) setError("");
                          if (v.length === 6 && !busy) submitOtp(null, v);
                        }} />
                    </div>
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-danger-600 font-semibold">{error}</p>}
                  <button type="submit" disabled={busy || otpCode.length !== 6} data-testid="otp-submit-button" className="kr-lift flex h-12 w-full items-center justify-center rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50">
                    {busy ? "Verifying…" : "Verify & sign in"}
                  </button>
                  <div className="text-center text-sm" data-testid="otp-resend-row">
                    {resendIn > 0 ? (
                      <span className="text-muted-foreground">Resend code in <span className="font-semibold tabular-nums">{resendIn}s</span></span>
                    ) : (
                      <button type="button" onClick={requestOtp} disabled={busy} data-testid="otp-resend" className="font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">Didn't get it? Text it again</button>
                    )}
                  </div>
                  {/* Audit A-03 — the server no longer says "no account", so
                      the way to a new company (or back to an unfinished
                      sign-up) is offered here, where a new person ends up. */}
                  {!inviteToken && (
                    <p className="text-center text-xs text-muted-foreground" data-testid="otp-new-here">
                      {currentDraft() ? "Didn't finish signing up? " : "New to DecisionOS? "}
                      <button type="button" data-testid="otp-start-company-from-code"
                        onClick={() => navigate(currentDraft() ? "/signup" : `/signup?phone=${encodeURIComponent(otpPhone)}`)}
                        className="font-semibold text-foreground/80 underline underline-offset-2 hover:text-foreground">
                        {currentDraft() ? "Finish setting up your company" : "Start a company with this number"}
                      </button>
                    </p>
                  )}
                  </>)}
                </>
              )}
            </form>
          )}

          <Link to="/signup" data-testid="toggle-auth-mode" className="mt-4 inline-block text-sm font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">Need a workspace? Register →</Link>

          {/* The demo invitation. A white pill — no idle animation, no
              pulse, no bounce. It just sits there. On hover it lifts
              -3px and scales to 1.05, and that is the whole story. The
              resting shadow gives it baseline depth. */}
          {/* B22 — the demo is a side door, not the way in. It kept the same
              white pill as the primary action and sat under a divider that
              gave it its own section; it reads as secondary now — the same
              size, quieter, and without the block of space that made it look
              like a second front door. */}
          {!STORE_BUILD && (
          <div className="mt-6 border-t border-white/45 pt-4">
            <motion.button
              type="button"
              onClick={() => { setError(""); setDemoOpen(true); }}
              data-testid="demo-open"
              className="relative z-10 flex h-12 w-full items-center justify-between rounded-pill bg-white/60 px-5 text-sm font-medium text-foreground/80 ring-1 ring-inset ring-slate-900/[0.06] transition-colors hover:bg-white hover:text-foreground disabled:opacity-50"
              disabled={busy}
              whileHover={{ scale: 1.05, y: -3 }}
              whileTap={{ scale: 1.02 }}
            >
              <span>Try DecisionOS on a live workspace</span>
              <ArrowRight size={16} weight="bold" className="text-foreground/70" />
            </motion.button>
          </div>
          )}
          </motion.div>
          ) : (
          /* LIVE DEMO pane — the entire sign-in card gives way to this. Four
             role cards in a 2×2 grid, headed by a small mono eyebrow
             naming the workspace and a plain heading naming the action.
             Back link returns to the sign-in pane; clicking any card
             signs in as that role via the existing demoLogin. */
          <motion.div
            key="demo-pane"
            data-testid="demo-seats"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
          >
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-3xl">Sign in as any role</h2>
                <p className="text-sm text-muted-foreground mt-1.5">See the workspace the way that role sees it.</p>
              </div>
              <button
                type="button"
                onClick={() => { setError(""); setDemoOpen(false); }}
                data-testid="demo-close"
                className="kr-pop inline-flex shrink-0 items-center gap-1 rounded-pill px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/70 hover:text-foreground"
                aria-label="Back to sign in"
              >
                <ArrowLeft size={12} weight="bold" /> Back
              </button>
            </div>

            {/* 2×2 grid at every breakpoint — four roles read as a set,
                not a wrapping row of chips. Icons intentionally omitted:
                the descriptor line already earns the row on its own, and
                four icons in a row of four boxes made the set look like
                an app tray. min-h-touch keeps the tap target comfortable
                on a phone. Stagger delays give the cards a laid-out feel
                rather than a slab-drop.

                Cards share the CTA's hover grammar — scale 1.05, -3px
                lift, border transitions from transparent to black over
                300ms. `hover:z-10` puts the hovered card above its
                neighbours so the grow doesn't get clipped by siblings;
                border-2 border-transparent at rest keeps the layout
                from shifting 2px on hover. */}
            <div className="grid grid-cols-2 gap-touch-gap" role="group" aria-label="Choose a role to sign in as">
              {DEMO.map((d, i) => (
                <motion.button
                  key={d.email}
                  type="button"
                  onClick={() => demoLogin(d.email)}
                  disabled={busy}
                  data-testid={`demo-login-${d.role.toLowerCase()}`}
                  className="relative z-0 flex min-h-touch flex-col items-start gap-1.5 rounded-cardlg border-2 border-transparent bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_hsl(230_18%_15%/0.08),0_4px_10px_-6px_hsl(230_18%_15%/0.12)] transition-[border-color,box-shadow] duration-300 ease-out hover:z-10 hover:border-black hover:shadow-[0_8px_22px_-8px_hsl(230_18%_15%/0.35)] disabled:opacity-50"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut", delay: 0.04 + i * 0.05 }}
                  whileHover={{ scale: 1.05, y: -3 }}
                  whileTap={{ scale: 1.02 }}
                >
                  <span className="text-sm font-semibold">{d.role}</span>
                  <span className="label-mono text-muted-foreground">{d.hint}</span>
                </motion.button>
              ))}
            </div>

            {error && <p data-testid="auth-error" className="mt-4 text-sm text-danger-600 font-semibold">{error}</p>}
          </motion.div>
          )}
          </AnimatePresence>
          </div>
        </div>
      </main>

      {/* The same glass chip signup uses, and for the same measured reason:
          11px muted type printed straight onto a photograph failed contrast
          there, and a ground fixes it without changing the colour. */}
      <footer className="flex justify-center px-4 pb-5 lg:px-8">
        <p className="kr-frost w-fit max-w-full rounded-pill px-4 py-1.5 text-center text-[11px] text-muted-foreground">
          {/* J1-03 / J2-02 (JOURNEY-1, founder 24 Sep) — THE THREE THINGS THIS
              IS, in the founder's own words: the workflow engine is the
              product, the Decision Desk and Workflows are what it runs, Dex is
              how you talk to it. "Voice-first · AI-structured · Multi-tenant"
              was a line about our architecture, printed in their footer:
              "multi-tenant" is a promise to US that other companies' data is
              not in theirs, and it is not a sentence a workshop owner has ever
              needed to read. */}
          {/* Audit A-07 (2026-10-09) — and the first screen a visitor sees
              should say what it does for them, not name our parts. */}
          Your team&rsquo;s work and decisions, in one place
        </p>
        {/* PLAY-2 — the policy has to be reachable BEFORE anyone signs up, and
            this is the only screen everybody sees first. A plain link, not a
            banner: nothing here is asking for consent. */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground" data-testid="login-privacy-link">
            Privacy
          </Link>
          {" · "}
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground" data-testid="login-terms-link">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
