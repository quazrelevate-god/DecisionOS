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

const inputCls = "w-full border border-black bg-white px-4 py-3 text-sm font-mono focus:outline-none focus:shadow-brutal-sm transition-shadow";
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
          className="w-full aspect-square min-w-0 border border-black bg-white text-center text-xl font-heading font-black focus:outline-none focus:shadow-brutal-sm focus:border-brand-red transition-all disabled:opacity-50"
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
    <div className="min-h-screen grid lg:grid-cols-2 bg-brand-paper text-brand-ink">
      <button
        onClick={toggleTheme}
        data-testid="login-theme-toggle"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle dark mode"
        className="fixed top-4 right-4 z-50 w-10 h-10 flex items-center justify-center border border-black bg-white text-brand-ink hover:bg-brand-ink hover:text-white transition-colors"
      >
        {isDark ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
      </button>
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-brand-ink text-white p-12 border-r border-black">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-red rounded-lg flex items-center justify-center"><span className="font-logo font-black text-white text-xl">D</span></div>
          <span className="font-logo font-black text-2xl tracking-tight uppercase leading-none"><span className="text-white">Decision</span><span className="text-brand-red">OS</span></span>
        </div>
        <div>
          <p className="label-mono text-brand-red mb-4">The operational brain for founder-led SMEs</p>
          <h1 className="font-heading text-5xl xl:text-6xl font-black uppercase tracking-tighter leading-[0.95]">
            Speak the decision.<br /><span className="text-brand-red">We run</span> the company.
          </h1>
          <p className="mt-6 text-white/70 text-sm max-w-md leading-relaxed">
            Tailored to your industry — DecisionOS turns spoken directives into structured tasks, workflows and a shared operational brain.
          </p>
        </div>
        <div className="flex items-center gap-2 text-white/50 text-xs"><Microphone size={16} weight="bold" /> Voice-first · AI-structured · Multi-tenant</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-brand-red rounded-lg flex items-center justify-center"><span className="font-logo font-black text-white">D</span></div>
            <span className="font-logo font-black text-xl tracking-tight uppercase leading-none"><span className="text-foreground">Decision</span><span className="text-brand-red">OS</span></span>
          </div>

          <h2 className="font-heading text-3xl font-black uppercase tracking-tighter mb-1">Sign in</h2>
          <p className="text-sm text-muted-foreground mb-6">Access your company brain.</p>

          <div className="flex border border-black mb-5" data-testid="login-tabs">
            <button onClick={() => { setLoginTab("password"); setError(""); }} data-testid="login-tab-password"
              className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider border-r border-black transition-colors ${loginTab === "password" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              Email &amp; Password
            </button>
            <button onClick={() => { setLoginTab("otp"); setError(""); }} data-testid="login-tab-otp"
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${loginTab === "otp" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              <DeviceMobile size={14} weight="bold" /> Mobile OTP
            </button>
          </div>

          {loginTab === "password" && (
            <form onSubmit={doLogin} className="space-y-4">
              <input data-testid="login-email-input" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
              <input data-testid="login-password-input" type="password" className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />
              {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
              <button type="submit" disabled={busy} data-testid="auth-submit-button" className="w-full bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">{busy ? "…" : "Sign in"}</button>
            </form>
          )}

          {loginTab === "otp" && (
            <form onSubmit={otpSent ? submitOtp : requestOtp} className="space-y-4" data-testid="otp-form">
              {invite && (
                <div className="border border-black bg-brand-yellow/40 p-3" data-testid="invite-welcome">
                  <p className="font-heading font-bold uppercase tracking-tight text-sm">Welcome, {invite.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You've been invited to <strong>{invite.company}</strong>. Enter the code we sent to {invite.phone_masked} to sign in — no password needed.</p>
                </div>
              )}
              {!otpSent ? (
                <>
                  <div>
                    <label className={labelCls}>Mobile number</label>
                    <input data-testid="otp-phone-input" type="tel" className={`${inputCls} mt-1`} placeholder="Registered mobile number" value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)} required />
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <button type="submit" disabled={busy} data-testid="otp-submit-button" className="w-full bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                    {busy ? "Sending…" : "Send OTP"}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between border border-black bg-white px-3 py-2.5" data-testid="otp-phone-confirm">
                    <div className="flex items-center gap-2 min-w-0">
                      <DeviceMobile size={16} weight="bold" className="text-brand-red shrink-0" />
                      <span className="text-sm font-mono truncate">Code sent to <strong>{invite?.phone_masked || maskPhone(otpPhone)}</strong></span>
                    </div>
                    <button type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); setResendIn(0); }} data-testid="otp-change-number"
                      className="text-xs font-semibold uppercase text-brand-blue hover:underline whitespace-nowrap ml-2 shrink-0">Change</button>
                  </div>
                  <div>
                    <label className={labelCls}>Enter 6-digit code</label>
                    <div className="mt-2">
                      <OtpBoxes value={otpCode} onChange={setOtpCode} disabled={busy} />
                    </div>
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <button type="submit" disabled={busy || otpCode.length !== 6} data-testid="otp-submit-button" className="w-full bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                    {busy ? "Verifying…" : "Verify & sign in"}
                  </button>
                  <div className="text-center text-sm" data-testid="otp-resend-row">
                    {resendIn > 0 ? (
                      <span className="text-muted-foreground">Resend code in <span className="font-semibold tabular-nums">{resendIn}s</span></span>
                    ) : (
                      <button type="button" onClick={requestOtp} disabled={busy} data-testid="otp-resend" className="text-brand-blue font-semibold hover:underline">Didn't get it? Resend OTP</button>
                    )}
                  </div>
                </>
              )}
            </form>
          )}

          <Link to="/signup" data-testid="toggle-auth-mode" className="mt-4 inline-block text-sm text-brand-blue font-semibold hover:underline">Need a workspace? Register →</Link>
          <div className="mt-8 border-t border-black/20 pt-6">
            <p className="label-mono text-muted-foreground mb-3">Try the Sharma demo</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => demoLogin(d.email)} data-testid={`demo-login-${d.role.toLowerCase()}`} className="border border-black px-3 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">{d.role}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
