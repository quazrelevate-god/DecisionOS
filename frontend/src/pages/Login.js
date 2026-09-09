import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import api, { formatApiError } from "../lib/api";
import { KarmaLogo } from "../components/karma/Logo";
import { DeviceMobile, Sun, MoonStars } from "@phosphor-icons/react";
import { toast } from "sonner";

const DEMO = [
  { role: "Owner", email: "owner@sharma.com" },
  { role: "Sales", email: "sales@sharma.com" },
  { role: "Production", email: "production@sharma.com" },
  { role: "Finance", email: "finance@sharma.com" },
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

// Polished 6-box OTP input with paste + keyboard navigation.
const OtpBoxes = ({ value, onChange, disabled }) => {
  const refs = useRef([]);
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);

  const setAt = (i, d) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join("").replace(/\D/g, "").slice(0, 6));
  };

  const handleChange = (i) => (e) => {
    const d = e.target.value.replace(/\D/g, "");
    if (!d) return;
    if (d.length > 1) {
      // pasted / multi-char: fill from current box
      const chars = d.slice(0, 6 - i).split("");
      const next = digits.slice();
      chars.forEach((c, k) => { next[i + k] = c; });
      onChange(next.join("").replace(/\D/g, "").slice(0, 6));
      const focusIdx = Math.min(i + chars.length, 5);
      refs.current[focusIdx]?.focus();
      return;
    }
    setAt(i, d);
    if (i < 5) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i) => (e) => {
    if (e.key === "Backspace") {
      if (digits[i]) setAt(i, "");
      else if (i > 0) { setAt(i - 1, ""); refs.current[i - 1]?.focus(); }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <div className="flex gap-2 justify-between" data-testid="otp-boxes">
      {digits.map((d, i) => (
        <input
          key={`otp-${i}`}
          ref={(el) => (refs.current[i] = el)}
          data-testid={`otp-box-${i}`}
          inputMode="numeric"
          maxLength={6}
          autoFocus={i === 0}
          disabled={disabled}
          value={d}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onFocus={(e) => e.target.select()}
          className="kr-pressed aspect-square w-full min-w-0 rounded-cardlg bg-transparent text-center text-xl font-medium focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        />
      ))}
    </div>
  );
};

export default function Login() {
  const { login, loginWithOtp } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [loginTab, setLoginTab] = useState("password");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    // Runs once on mount to handle the deep-link.
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
        setOtpPhone(start.data.phone);
        setOtpSent(true);
        startResendTimer();
        if (start.data.dev_otp) { setOtpCode(start.data.dev_otp); toast.info(`Dev OTP: ${start.data.dev_otp} (auto-filled)`); }
        else toast.success("We texted a login code to your mobile");
      } catch (err) {
        setError(formatApiError(err.response?.data?.detail) || "This invite link is invalid or expired");
      }
    })();
    // Runs once on mount to handle the ?invite= deep-link; deps intentionally empty.
  }, []);

  const doLogin = async (e) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await login(form.email, form.password); navigate("/"); }
    catch (err) { setError(formatApiError(err.response?.data?.detail) || "Failed"); }
    finally { setBusy(false); }
  };
  const demoLogin = async (email) => {
    setError(""); setBusy(true);
    try { await login(email, "demo1234"); navigate("/"); }
    catch (err) { setError(formatApiError(err.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const requestOtp = async (e) => {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/request", { phone: otpPhone });
      setOtpSent(true);
      startResendTimer();
      if (data.dev_otp) toast.info(`Dev OTP: ${data.dev_otp} (auto-filled)`);
      else toast.success("OTP sent to your mobile");
      if (data.dev_otp) setOtpCode(data.dev_otp);
    } catch (err) { setError(formatApiError(err.response?.data?.detail) || "Failed"); }
    finally { setBusy(false); }
  };
  const submitOtp = async (e) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await loginWithOtp(otpPhone, otpCode); navigate("/"); }
    catch (err) { setError(formatApiError(err.response?.data?.detail) || "Failed"); }
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
    <div className="login-stage relative isolate flex min-h-screen flex-col bg-white text-foreground">
      {/* The artwork. It reuses .app-sky__art--aside wholesale — that layer
          carries two pictures, two fits, the phone radial mask and the desktop
          full-bleed, all measured against the DOM in KM-41/KM-42 — and only
          the two image URLs are re-pointed, in index.css under .login-stage.
          Duplicating the geometry would have meant maintaining that arithmetic
          twice. */}
      <div className="app-sky__art app-sky__art--aside" aria-hidden="true" />

      <button
        onClick={toggleTheme}
        data-testid="login-theme-toggle"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle dark mode"
        className="kr-pop fixed right-4 top-4 z-50 grid h-10 w-10 place-items-center rounded-full"
      >
        {isDark ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
      </button>

      {/* Header — signup's exact header: on a phone the wordmark alone,
          centred; on desktop a floating glass pill with the way out on the
          right. KarmaLogo replaces the PNG Wordmark, which is the founder's
          "replace the old DecisionOS logo with our current one": the app shell
          has worn the text mark since KR-14 and this was the last screen still
          showing the old lockup. */}
      <header className="px-4 pt-4 lg:px-8 lg:pt-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-4 rounded-pill px-4 py-2.5 lg:kr-frost lg:justify-between lg:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" data-testid="login-logo">
            <KarmaLogo size="md" />
          </Link>
          <Link
            to="/signup"
            data-testid="login-register-link"
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
      <main className="flex flex-1 items-center justify-center px-4 py-8 lg:px-8 lg:py-12">
        <div className="kr-well w-full max-w-md" data-testid="login-card">
          <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-8">
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
              <DeviceMobile size={14} weight="bold" /> Mobile OTP
            </button>
          </div>

          {loginTab === "password" && (
            <form onSubmit={doLogin} className="space-y-4">
              <input data-testid="login-email-input" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
              <input data-testid="login-password-input" type="password" className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />
              {error && <p data-testid="auth-error" className="text-sm text-danger-600 font-semibold">{error}</p>}
              <button type="submit" disabled={busy} data-testid="auth-submit-button" className="kr-lift flex h-12 w-full items-center justify-center rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50">{busy ? "…" : "Sign in"}</button>
            </form>
          )}

          {loginTab === "otp" && (
            <form onSubmit={otpSent ? submitOtp : requestOtp} className="space-y-4" data-testid="otp-form">
              {invite && (
                <div className="kr-pressed rounded-cardlg p-3" data-testid="invite-welcome">
                  <p className="font-medium uppercase tracking-tight text-sm">Welcome, {invite.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You've been invited to <strong>{invite.company}</strong>. Enter the code we sent to {invite.phone_masked} to sign in — no password needed.</p>
                </div>
              )}
              {!otpSent ? (
                <>
                  <div>
                    <label className={labelCls}>Mobile number</label>
                    <input data-testid="otp-phone-input" type="tel" className={`${inputCls} mt-1`} placeholder="Registered mobile number" value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)} required />
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-danger-600 font-semibold">{error}</p>}
                  <button type="submit" disabled={busy} data-testid="otp-submit-button" className="kr-lift flex h-12 w-full items-center justify-center rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50">
                    {busy ? "Sending…" : "Send OTP"}
                  </button>
                </>
              ) : (
                <>
                  <div className="kr-pressed flex items-center justify-between rounded-pill px-3 py-2.5" data-testid="otp-phone-confirm">
                    <div className="flex items-center gap-2 min-w-0">
                      <DeviceMobile size={16} weight="bold" className="shrink-0 text-foreground/70" />
                      <span className="text-sm font-mono truncate">Code sent to <strong>{invite?.phone_masked || maskPhone(otpPhone)}</strong></span>
                    </div>
                    <button type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); setResendIn(0); }} data-testid="otp-change-number"
                      className="text-xs font-semibold uppercase text-foreground/70 underline-offset-2 hover:text-foreground hover:underline whitespace-nowrap ml-2 shrink-0">Change</button>
                  </div>
                  <div>
                    <label className={labelCls}>Enter 6-digit code</label>
                    <div className="mt-2">
                      <OtpBoxes value={otpCode} onChange={setOtpCode} disabled={busy} />
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
                      <button type="button" onClick={requestOtp} disabled={busy} data-testid="otp-resend" className="font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">Didn't get it? Resend OTP</button>
                    )}
                  </div>
                </>
              )}
            </form>
          )}

          <Link to="/signup" data-testid="toggle-auth-mode" className="mt-4 inline-block text-sm font-semibold text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">Need a workspace? Register →</Link>
          <div className="mt-8 border-t border-white/45 pt-6">
            <p className="label-mono text-muted-foreground mb-3">Try the Sharma demo</p>
            {/* MPWA-11 (§8): demo-role buttons WRAP rather than clip. */}
            <div className="flex flex-wrap gap-touch-gap">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => demoLogin(d.email)} data-testid={`demo-login-${d.role.toLowerCase()}`} className="kr-pop min-h-touch lg:min-h-0 flex-1 min-w-[7rem] rounded-pill px-3 py-2 text-sm lg:text-xs font-semibold tracking-wider lg:uppercase">{d.role}</button>
              ))}
            </div>
          </div>
          </div>
        </div>
      </main>

      {/* The same glass chip signup uses, and for the same measured reason:
          11px muted type printed straight onto a photograph failed contrast
          there, and a ground fixes it without changing the colour. */}
      <footer className="flex justify-center px-4 pb-5 lg:px-8">
        <p className="kr-frost w-fit max-w-full rounded-pill px-4 py-1.5 text-center text-[11px] text-muted-foreground">
          Voice-first · AI-structured · Multi-tenant
        </p>
      </footer>
    </div>
  );
}
