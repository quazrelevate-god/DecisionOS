import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import api, { formatApiError } from "../lib/api";
import { Microphone, DeviceMobile, Sun, MoonStars } from "@phosphor-icons/react";
import { toast } from "sonner";

const DEMO = [
  { role: "Owner", email: "owner@sharma.com" },
  { role: "Sales", email: "sales@sharma.com" },
  { role: "Production", email: "production@sharma.com" },
  { role: "Finance", email: "finance@sharma.com" },
];

const inputCls =
  "w-full rounded-lg border border-input bg-card px-4 py-3 text-sm shadow-xs transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/25";
const labelCls = "label-mono text-muted-foreground";
const primaryBtnCls =
  "w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:bg-primary-emphasis hover:shadow-sm active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

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
          className="aspect-square w-full min-w-0 rounded-lg border border-input bg-card text-center text-xl font-semibold tabular-nums shadow-xs transition-[border-color,box-shadow] duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:opacity-50"
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
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <button
        onClick={toggleTheme}
        data-testid="login-theme-toggle"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle dark mode"
        className="fixed right-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs transition-[background-color,color,transform] duration-200 hover:bg-accent hover:text-foreground active:scale-[0.96]"
      >
        {isDark ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
      </button>
      {/* Left brand panel — a deep Klein field, not a black box. */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[hsl(226_100%_14%)] p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(70% 50% at 15% 0%, rgba(255,255,255,0.5), transparent 60%), radial-gradient(rgba(255,255,255,0.35) 0.7px, transparent 0.7px)",
            backgroundSize: "100% 100%, 28px 28px",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
            <span className="text-[17px] font-semibold leading-none">D</span>
          </div>
          <span className="text-[19px] font-semibold leading-none tracking-tight">
            Decision<span className="text-white/60">OS</span>
          </span>
        </div>
        <div className="relative">
          <p className="label-mono mb-5 text-white/55">The operating brain for founder-led SMEs</p>
          <h1 className="max-w-lg text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.035em] xl:text-[3.25rem]">
            Speak the decision.<br />
            <span className="text-white/60">We run the company.</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-white/60">
            Tailored to your industry — DecisionOS turns spoken directives into structured tasks,
            workflows and a shared operational brain.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-white/45">
          <Microphone size={15} weight="bold" /> Voice-first · AI-structured · Multi-tenant
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-[15px] font-semibold leading-none">D</span>
            </div>
            <span className="text-[17px] font-semibold leading-none tracking-tight">
              Decision<span className="text-primary">OS</span>
            </span>
          </div>

          <h2 className="text-title">Sign in</h2>
          <p className="mb-6 mt-1.5 text-sm text-muted-foreground">Access your company brain.</p>

          <div className="mb-5 inline-flex w-full items-center gap-1 rounded-lg border border-border bg-muted/60 p-1" data-testid="login-tabs">
            <button onClick={() => { setLoginTab("password"); setError(""); }} data-testid="login-tab-password"
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] ${loginTab === "password" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>
              Email &amp; Password
            </button>
            <button onClick={() => { setLoginTab("otp"); setError(""); }} data-testid="login-tab-otp"
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] ${loginTab === "otp" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>
              <DeviceMobile size={15} weight="bold" /> Mobile OTP
            </button>
          </div>

          {loginTab === "password" && (
            <form onSubmit={doLogin} className="space-y-4">
              <input data-testid="login-email-input" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
              <input data-testid="login-password-input" type="password" className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />
              {error && <p data-testid="auth-error" className="text-sm font-medium text-destructive">{error}</p>}
              <button type="submit" disabled={busy} data-testid="auth-submit-button" className={primaryBtnCls}>{busy ? "…" : "Sign in"}</button>
            </form>
          )}

          {loginTab === "otp" && (
            <form onSubmit={otpSent ? submitOtp : requestOtp} className="space-y-4" data-testid="otp-form">
              {invite && (
                <div className="rounded-lg border border-warning/25 bg-warning-subtle p-4" data-testid="invite-welcome">
                  <p className="text-sm font-semibold">Welcome, {invite.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You've been invited to <strong>{invite.company}</strong>. Enter the code we sent to {invite.phone_masked} to sign in — no password needed.</p>
                </div>
              )}
              {!otpSent ? (
                <>
                  <div>
                    <label className={labelCls}>Mobile number</label>
                    <input data-testid="otp-phone-input" type="tel" className={`${inputCls} mt-1`} placeholder="Registered mobile number" value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)} required />
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm font-medium text-destructive">{error}</p>}
                  <button type="submit" disabled={busy} data-testid="otp-submit-button" className={primaryBtnCls}>
                    {busy ? "Sending…" : "Send OTP"}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5" data-testid="otp-phone-confirm">
                    <div className="flex items-center gap-2 min-w-0">
                      <DeviceMobile size={16} weight="bold" className="shrink-0 text-primary" />
                      <span className="text-sm font-mono truncate">Code sent to <strong>{invite?.phone_masked || maskPhone(otpPhone)}</strong></span>
                    </div>
                    <button type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); setResendIn(0); }} data-testid="otp-change-number"
                      className="ml-2 shrink-0 whitespace-nowrap text-xs font-medium text-primary hover:underline">Change</button>
                  </div>
                  <div>
                    <label className={labelCls}>Enter 6-digit code</label>
                    <div className="mt-2">
                      <OtpBoxes value={otpCode} onChange={setOtpCode} disabled={busy} />
                    </div>
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm font-medium text-destructive">{error}</p>}
                  <button type="submit" disabled={busy || otpCode.length !== 6} data-testid="otp-submit-button" className={primaryBtnCls}>
                    {busy ? "Verifying…" : "Verify & sign in"}
                  </button>
                  <div className="text-center text-sm" data-testid="otp-resend-row">
                    {resendIn > 0 ? (
                      <span className="text-muted-foreground">Resend code in <span className="font-semibold tabular-nums">{resendIn}s</span></span>
                    ) : (
                      <button type="button" onClick={requestOtp} disabled={busy} data-testid="otp-resend" className="font-medium text-primary hover:underline">Didn't get it? Resend OTP</button>
                    )}
                  </div>
                </>
              )}
            </form>
          )}

          <Link to="/signup" data-testid="toggle-auth-mode" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Need a workspace? Register →</Link>
          <div className="mt-8 border-t border-border pt-6">
            <p className="label-mono text-muted-foreground mb-3">Try the Sharma demo</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => demoLogin(d.email)} data-testid={`demo-login-${d.role.toLowerCase()}`} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-xs transition-[background-color,border-color,color,transform] duration-200 hover:border-border-strong hover:bg-accent hover:text-foreground active:scale-[0.98]">{d.role}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
