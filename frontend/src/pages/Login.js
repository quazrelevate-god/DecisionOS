import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import api, { formatApiError } from "../lib/api";
import { INDUSTRIES, COMPANY_SIZES, CURRENCIES, slugify } from "../lib/format";
import { OsEditor } from "./onboarding/OsEditor";
import { OsReady } from "./onboarding/OsReady";
import {
  Microphone, Sparkle, X, Plus, ArrowRight, ArrowLeft, Buildings, ChartLineUp,
  Stack, UploadSimple, DeviceMobile, Check, CircleNotch, Table as TableIcon,
  Brain, CheckCircle, Files, Gauge, WhatsappLogo, Sun, MoonStars,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const DEMO = [
  { role: "Owner", email: "owner@sharma.com" },
  { role: "Sales", email: "sales@sharma.com" },
  { role: "Production", email: "production@sharma.com" },
  { role: "Finance", email: "finance@sharma.com" },
];

const inputCls = "w-full border border-hairline bg-surface px-4 py-3 text-sm font-mono focus:outline-none focus:shadow-xs transition-shadow";
const labelCls = "text-label text-text-secondary";

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
          className="w-full aspect-square min-w-0 border border-hairline bg-surface text-center text-xl font-black focus:outline-none focus:shadow-xs focus:border-primary transition-all disabled:opacity-50 rounded-md"
        />
      ))}
    </div>
  );
};

const SOFTWARE = [
  { key: "Excel", live: true },
  { key: "Tally", live: false },
  { key: "Zoho", live: false },
  { key: "Others", live: true },
];

const AI_STEPS = [
  { label: "Creating Company Brain", icon: Brain },
  { label: "Importing your data", icon: Files },
  { label: "Indexing documents", icon: Stack },
  { label: "Generating dashboard", icon: Gauge },
];

export default function Login() {
  const { login, register, loginWithOtp } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [loginTab, setLoginTab] = useState("password");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [invite, setInvite] = useState(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    company_name: "", name: "", email: "", password: "", phone: "",
    industry: "", gst: "", branches: "",
    company_size: "", region: "", currency: "INR",
    monthly_sales: "", monthly_purchases: "", num_customers: "", num_suppliers: "",
  });
  const [software, setSoftware] = useState([]);
  const [otherSoftware, setOtherSoftware] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [phones, setPhones] = useState([]);
  const [phoneInput, setPhoneInput] = useState("");
  const [importSummary, setImportSummary] = useState(null);
  const [roles, setRoles] = useState([]);
  const [roleInput, setRoleInput] = useState("");
  const [products, setProducts] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [opTasks, setOpTasks] = useState([]);
  const [approvalRules, setApprovalRules] = useState([]);
  const [wfInput, setWfInput] = useState("");
  const [osReady, setOsReady] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const uid = () => Math.random().toString(36).slice(2, 9);

  // OTP resend cooldown ticker (30s, matches backend cooldown)
  const startResendTimer = () => setResendIn(30);
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Signup deep-link: /?signup=1 or /login?signup=1 opens the registration flow.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("signup") === "1" || sp.get("mode") === "signup") {
      setMode("register");
      setStep(1);
    }
  }, []);

  // Invite deep-link: /?invite=<token> — auto-switch to OTP and text the code.
  const inviteStarted = useRef(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token || inviteStarted.current) return;
    inviteStarted.current = true;
    setMode("login"); setLoginTab("otp");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const toggleSoftware = (k) => setSoftware((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  // Step 4 — generate the full Industry Operating System (departments, workflows, tasks, approvals) + products
  const fetchSuggestions = async () => {
    const eff = form.industry === "Other" ? businessDescription.trim() : form.industry;
    setSuggesting(true);
    try {
      const [sug, bp] = await Promise.all([
        api.post("/onboarding/suggest", { industry: eff, company_size: form.company_size, description: businessDescription.trim() }),
        api.post("/onboarding/os-blueprint", { industry: eff, company_size: form.company_size, description: businessDescription.trim() }),
      ]);
      setProducts((sug.data.products || []).map((p) => ({ name: p.name, description: p.description || "", _key: uid() })));
      const d = bp.data || {};
      setRoles((d.departments && d.departments.length) ? d.departments : (sug.data.roles || []));
      setWorkflows((d.workflows || []).map((w) => ({ ...w, _key: uid() })));
      setOpTasks((d.operational_tasks || []).map((t) => ({ ...t, _key: uid() })));
      setApprovalRules((d.approval_rules || []).map((r) => ({ ...r, _key: uid() })));
    } catch {
      toast.error("Couldn't generate your operating system — you can add items manually");
    } finally {
      setSuggesting(false);
      setSuggested(true);
    }
  };
  const goToTeamStep = () => { setStep(4); if (!suggested) fetchSuggestions(); };

  const addRole = () => {
    const label = roleInput.trim();
    const key = slugify(label);
    if (!key || key === "owner" || roles.some((r) => r.key === key)) { setRoleInput(""); return; }
    setRoles([...roles, { key, label }]); setRoleInput("");
  };
  const removeRole = (key) => setRoles(roles.filter((r) => r.key !== key));
  const addProduct = () => setProducts([...products, { name: "", description: "", _key: uid() }]);
  const updateProduct = (i, k, v) => setProducts(products.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const removeProduct = (i) => setProducts(products.filter((_, idx) => idx !== i));

  const addWorkflow = () => {
    const name = wfInput.trim();
    if (!name || workflows.some((w) => w.name.toLowerCase() === name.toLowerCase())) { setWfInput(""); return; }
    setWorkflows([...workflows, { name, _key: uid() }]); setWfInput("");
  };
  const removeWorkflow = (i) => setWorkflows(workflows.filter((_, idx) => idx !== i));
  const addOpTask = () => setOpTasks([...opTasks, { title: "", category: "Other", _key: uid() }]);
  const updateOpTask = (i, k, v) => setOpTasks(opTasks.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  const removeOpTask = (i) => setOpTasks(opTasks.filter((_, idx) => idx !== i));
  const addRule = () => setApprovalRules([...approvalRules, { name: "", description: "", _key: uid() }]);
  const updateRule = (i, k, v) => setApprovalRules(approvalRules.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const removeRule = (i) => setApprovalRules(approvalRules.filter((_, idx) => idx !== i));

  // Step 4 → create the workspace + provision the Operating System, then show the "Ready" summary
  const createWorkspace = async () => {
    setError(""); setBusy(true);
    const eff = form.industry === "Other" ? businessDescription.trim() : form.industry;
    try {
      const sw = software.includes("Others") && otherSoftware.trim()
        ? [...software.filter((x) => x !== "Others"), otherSoftware.trim()] : software;
      const data = await register({
        company_name: form.company_name, name: form.name, email: form.email, password: form.password, phone: form.phone,
        industry: eff || "General", gst: form.gst, branches: form.branches,
        description: businessDescription.trim(),
        company_size: form.company_size, region: form.region, currency: form.currency,
        current_software: sw,
        business_scale: {
          employees: form.company_size, monthly_sales: form.monthly_sales,
          monthly_purchases: form.monthly_purchases, customers: form.num_customers, suppliers: form.num_suppliers,
        },
        roles, products: products.filter((p) => p.name.trim()).map(({ _key, ...r }) => r),
        os_blueprint: {
          departments: roles,
          workflows: workflows.filter((w) => w.name.trim()),
          operational_tasks: opTasks.filter((t) => t.title.trim()),
          approval_rules: approvalRules.filter((r) => r.name.trim()),
        },
      });
      setOsReady(data.os_summary || {
        departments: roles.length, workflows: workflows.length,
        operational_tasks: opTasks.length, approval_rules: approvalRules.length,
      });
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Could not create workspace");
    } finally { setBusy(false); }
  };

  const uploadExcel = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/ingest/csv", fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.status === "failed") { toast.error("Couldn't read that file"); }
      else {
        const commit = await api.post(`/ingest/${data.id}/commit`, { records: data.records });
        const c = commit.data.created;
        setImportSummary(c);
        toast.success(`Imported ${c.contacts} contacts · ${c.invoices} invoices · ${c.payments} payments`);
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Upload failed"); }
    finally { setUploading(false); }
  };

  const addPhone = () => {
    const p = phoneInput.trim();
    if (!p || phones.includes(p)) { setPhoneInput(""); return; }
    setPhones([...phones, p]); setPhoneInput("");
  };
  const sendInvites = async () => {
    if (phones.length === 0) { setStep(7); return; }
    setBusy(true);
    try { await api.post("/invites", { phones }); toast.success(`${phones.length} invite(s) queued`); }
    catch (e) { console.debug("invite send failed (non-blocking, continuing onboarding)", e); }
    finally { setBusy(false); setStep(7); }
  };

  // Step 7 animated progress
  useEffect(() => {
    if (step !== 7) return;
    setAiProgress(0);
    const timers = AI_STEPS.map((_, i) => setTimeout(() => setAiProgress(i + 1), (i + 1) * 850));
    return () => timers.forEach(clearTimeout);
  }, [step]);

  const goToRegister = () => { setMode("register"); setStep(1); setError(""); };
  const backToLogin = () => { setMode("login"); setError(""); };
  const stepValid1 = form.company_name && form.name && form.email && form.password.length >= 6 && form.industry &&
    (form.industry !== "Other" || businessDescription.trim());

  const TOTAL = 7;

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background text-text">
      <button
        onClick={toggleTheme}
        data-testid="login-theme-toggle"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle dark mode"
        className="fixed top-4 right-4 z-50 w-10 h-10 flex items-center justify-center border border-hairline bg-surface text-text hover:bg-primary hover:text-white transition-colors rounded-md"
      >
        {isDark ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
      </button>
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-neutral-900 text-text-inverse p-12 border-r-hairline">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center"><span className="font-logo font-black text-white text-xl">D</span></div>
          <span className="font-logo font-black text-2xl tracking-tight leading-none"><span className="text-white">Decision</span><span className="text-brand-400">OS</span></span>
        </div>
        <div>
          <p className="text-label text-brand-400 mb-4">The operational brain for founder-led SMEs</p>
          <h1 className="text-5xl xl:text-6xl font-black tracking-tighter leading-[0.95]">
            {mode === "register" ? <>Set up your<br /><span className="text-brand-400">executive office.</span></> : <>Speak the decision.<br /><span className="text-brand-400">We run</span> the company.</>}
          </h1>
          <p className="mt-6 text-white/70 text-sm max-w-md leading-relaxed">
            {mode === "register"
              ? "Six quick steps: tell us about your company, connect your data, invite your team — and DecisionOS builds your Company Brain."
              : "Tailored to your industry — DecisionOS turns spoken directives into structured tasks, workflows and a shared operational brain."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-white/50 text-xs"><Microphone size={16} weight="bold" /> Voice-first · AI-structured · Multi-tenant</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center"><span className="font-logo font-black text-white">D</span></div>
            <span className="font-logo font-black text-xl tracking-tight leading-none"><span className="text-text">Decision</span><span className="text-brand-400">OS</span></span>
          </div>

          {mode === "login" && (
            <>
              <h2 className="text-3xl font-black tracking-tighter mb-1">Sign in</h2>
              <p className="text-sm text-text-secondary mb-6">Access your company brain.</p>

              <div className="flex border border-hairline mb-5 rounded-md" data-testid="login-tabs">
                <button onClick={() => { setLoginTab("password"); setError(""); }} data-testid="login-tab-password"
                  className={`flex-1 px-3 py-2 text-xs font-semibold  border-r-hairline transition-colors ${loginTab === "password" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
                  Email &amp; Password
                </button>
                <button onClick={() => { setLoginTab("otp"); setError(""); }} data-testid="login-tab-otp"
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold  transition-colors ${loginTab === "otp" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
                  <DeviceMobile size={14} weight="bold" /> Mobile OTP
                </button>
              </div>

              {loginTab === "password" && (
                <form onSubmit={doLogin} className="space-y-4">
                  <input data-testid="login-email-input" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
                  <input data-testid="login-password-input" type="password" className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />
                  {error && <p data-testid="auth-error" className="text-sm text-destructive-text font-semibold">{error}</p>}
                  <button type="submit" disabled={busy} data-testid="auth-submit-button" className="w-full bg-primary text-white font-semibold py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-50 rounded-md">{busy ? "…" : "Sign in"}</button>
                </form>
              )}

              {loginTab === "otp" && (
                <form onSubmit={otpSent ? submitOtp : requestOtp} className="space-y-4" data-testid="otp-form">
                  {invite && (
                    <div className="border border-hairline bg-status-pending-bg/40 p-3 rounded-md" data-testid="invite-welcome">
                      <p className="font-bold tracking-tight text-sm">Welcome, {invite.name}</p>
                      <p className="text-xs text-text-secondary mt-0.5">You've been invited to <strong>{invite.company}</strong>. Enter the code we sent to {invite.phone_masked} to sign in — no password needed.</p>
                    </div>
                  )}
                  {!otpSent ? (
                    <>
                      <div>
                        <label className={labelCls}>Mobile number</label>
                        <input data-testid="otp-phone-input" type="tel" className={`${inputCls} mt-1`} placeholder="Registered mobile number" value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)} required />
                      </div>
                      {error && <p data-testid="auth-error" className="text-sm text-destructive-text font-semibold">{error}</p>}
                      <button type="submit" disabled={busy} data-testid="otp-submit-button" className="w-full bg-primary text-white font-semibold py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-50 rounded-md">
                        {busy ? "Sending…" : "Send OTP"}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between border border-hairline bg-surface px-3 py-2.5 rounded-md" data-testid="otp-phone-confirm">
                        <div className="flex items-center gap-2 min-w-0">
                          <DeviceMobile size={16} weight="bold" className="text-primary-text shrink-0" />
                          <span className="text-sm font-mono truncate">Code sent to <strong>{invite?.phone_masked || maskPhone(otpPhone)}</strong></span>
                        </div>
                        <button type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); setResendIn(0); }} data-testid="otp-change-number"
                          className="text-xs font-semibold text-primary-text hover:underline whitespace-nowrap ml-2 shrink-0">Change</button>
                      </div>
                      <div>
                        <label className={labelCls}>Enter 6-digit code</label>
                        <div className="mt-2">
                          <OtpBoxes value={otpCode} onChange={setOtpCode} disabled={busy} />
                        </div>
                      </div>
                      {error && <p data-testid="auth-error" className="text-sm text-destructive-text font-semibold">{error}</p>}
                      <button type="submit" disabled={busy || otpCode.length !== 6} data-testid="otp-submit-button" className="w-full bg-primary text-white font-semibold py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-50 rounded-md">
                        {busy ? "Verifying…" : "Verify & sign in"}
                      </button>
                      <div className="text-center text-sm" data-testid="otp-resend-row">
                        {resendIn > 0 ? (
                          <span className="text-text-secondary">Resend code in <span className="font-semibold tabular-nums">{resendIn}s</span></span>
                        ) : (
                          <button type="button" onClick={requestOtp} disabled={busy} data-testid="otp-resend" className="text-primary-text font-semibold hover:underline">Didn't get it? Resend OTP</button>
                        )}
                      </div>
                    </>
                  )}
                </form>
              )}

              <button onClick={goToRegister} data-testid="toggle-auth-mode" className="mt-4 text-sm text-primary-text font-semibold hover:underline">Need a workspace? Register →</button>
              <div className="mt-8 border-t-hairline pt-6">
                <p className="text-label text-text-secondary mb-3">Try the Sharma demo</p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO.map((d) => (
                    <button key={d.email} onClick={() => demoLogin(d.email)} data-testid={`demo-login-${d.role.toLowerCase()}`} className="border border-hairline px-3 py-2 text-xs font-semibold hover:bg-primary hover:text-white transition-colors rounded-md">{d.role}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "register" && (
            <>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-2xl font-black tracking-tighter">Digital Executive Office</h2>
                <span className="text-label text-text-secondary" data-testid="onboarding-step">Step {step}/{TOTAL}</span>
              </div>
              <div className="flex gap-1 mb-6">
                {Array.from({ length: TOTAL }).map((_, i) => (
                  <div key={`step-seg-${i}`} className={`h-1.5 flex-1 border border-hairline ${i + 1 <= step ? "bg-primary" : "bg-surface"} rounded-md`} />
                ))}
              </div>

              {/* STEP 1 — About company */}
              {step === 1 && (
                <div className="space-y-4" data-testid="onboarding-step-1">
                  <p className="text-sm text-text-secondary flex items-center gap-1.5"><Buildings size={16} weight="bold" className="text-text-tertiary" />  About your company</p>
                  <input data-testid="register-company-input" className={inputCls} placeholder="Company name" value={form.company_name} onChange={set("company_name")} />
                  <div className="grid grid-cols-2 gap-3">
                    <input data-testid="register-name-input" className={inputCls} placeholder="Your name" value={form.name} onChange={set("name")} />
                    <input data-testid="register-email-input" type="email" className={inputCls} placeholder="Work email" value={form.email} onChange={set("email")} />
                  </div>
                  <input data-testid="register-password-input" type="password" className={inputCls} placeholder="Password (min 6)" value={form.password} onChange={set("password")} />
                  <input data-testid="register-phone-input" type="tel" className={inputCls} placeholder="Mobile number (for OTP login)" value={form.phone} onChange={set("phone")} />
                  <div>
                    <label className={labelCls}>Industry</label>
                    <select data-testid="industry-select" className={`${inputCls} mt-1`} value={form.industry} onChange={set("industry")}>
                      <option value="">Select industry…</option>
                      {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>
                      {form.industry === "Other" ? "Describe your business" : "What exactly does your business do?"}
                      {form.industry && form.industry !== "Other" && <span className="text-text-secondary font-normal normal-case"> — optional, but sharpens your AI setup</span>}
                    </label>
                    <textarea
                      data-testid="business-description-input"
                      className={`${inputCls} resize-none mt-1`}
                      rows={2}
                      placeholder={
                        form.industry && form.industry !== "Other"
                          ? `e.g. within ${form.industry}, we specifically... (the more detail, the more tailored your workflows & tasks)`
                          : "e.g. We run performance ad campaigns for D2C brands — strategy, creative and media buying"
                      }
                      value={businessDescription}
                      onChange={(e) => setBusinessDescription(e.target.value)}
                    />
                    <p className="text-xs text-text-secondary mt-1">Our AI uses this to build your pipelines, task categories and terminology — be specific.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input data-testid="register-gst-input" className={inputCls} placeholder="GST (optional)" value={form.gst} onChange={set("gst")} />
                    <input data-testid="register-branches-input" className={inputCls} placeholder="Branches (e.g. 2)" value={form.branches} onChange={set("branches")} />
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-destructive-text font-semibold">{error}</p>}
                  <button disabled={!stepValid1} data-testid="onboarding-next-1" onClick={() => { setError(""); setStep(2); }} className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-40 rounded-md">Next <ArrowRight size={16} weight="bold" /></button>
                </div>
              )}

              {/* STEP 2 — Business scale */}
              {step === 2 && (
                <div className="space-y-4" data-testid="onboarding-step-2">
                  <p className="text-sm text-text-secondary flex items-center gap-1.5"><ChartLineUp size={16} weight="bold" className="text-text-tertiary" />  Business scale</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Employees</label>
                      <select data-testid="company-size-select" className={`${inputCls} mt-1`} value={form.company_size} onChange={set("company_size")}>
                        <option value="">Team size…</option>
                        {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Currency</label>
                      <select data-testid="currency-select" className={`${inputCls} mt-1`} value={form.currency} onChange={set("currency")}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input data-testid="scale-sales-input" className={inputCls} placeholder="Monthly sales" value={form.monthly_sales} onChange={set("monthly_sales")} />
                    <input data-testid="scale-purchases-input" className={inputCls} placeholder="Monthly purchases" value={form.monthly_purchases} onChange={set("monthly_purchases")} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input data-testid="scale-customers-input" className={inputCls} placeholder="# Customers" value={form.num_customers} onChange={set("num_customers")} />
                    <input data-testid="scale-suppliers-input" className={inputCls} placeholder="# Suppliers" value={form.num_suppliers} onChange={set("num_suppliers")} />
                  </div>
                  <input data-testid="region-input" className={inputCls} placeholder="Region / Country" value={form.region} onChange={set("region")} />
                  <div className="flex gap-2">
                    <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-3 border border-hairline text-sm font-semibold hover:bg-surface-hover rounded-md"><ArrowLeft size={16} weight="bold" /></button>
                    <button data-testid="onboarding-next-2" onClick={() => setStep(3)} className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 border border-hairline hover:shadow-sm transition-all rounded-md">Next <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 3 — Current software */}
              {step === 3 && (
                <div className="space-y-4" data-testid="onboarding-step-3">
                  <p className="text-sm text-text-secondary flex items-center gap-1.5"><Stack size={16} weight="bold" className="text-text-tertiary" />  What do you use today?</p>
                  <div className="grid grid-cols-2 gap-3">
                    {SOFTWARE.map((s) => {
                      const on = software.includes(s.key);
                      return (
                        <button key={s.key} data-testid={`software-${s.key.toLowerCase()}`} onClick={() => toggleSoftware(s.key)}
                          className={`flex items-center justify-between gap-2 border border-hairline px-4 py-3 text-sm font-semibold transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"} rounded-md`}>
                          <span>{s.key}</span>
                          <span className={`w-5 h-5 flex items-center justify-center border border-current ${on ? "bg-primary text-primary-foreground border-hairline" : ""} rounded-md`}>{on && <Check size={12} weight="bold" />}</span>
                        </button>
                      );
                    })}
                  </div>
                  {software.includes("Others") && (
                    <input data-testid="software-other-input" className={inputCls} placeholder="Which software?" value={otherSoftware} onChange={(e) => setOtherSoftware(e.target.value)} />
                  )}
                  {error && <p data-testid="auth-error" className="text-sm text-destructive-text font-semibold">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-3 border border-hairline text-sm font-semibold hover:bg-surface-hover rounded-md"><ArrowLeft size={16} weight="bold" /></button>
                    <button data-testid="onboarding-next-3" onClick={goToTeamStep} className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 border border-hairline hover:shadow-sm transition-all rounded-md">Next <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 4 — Industry Operating System (AI-generated, editable) */}
              {step === 4 && osReady && (
                <OsReady
                  industryLabel={(form.industry === "Other" ? businessDescription : form.industry) || "Business"}
                  summary={osReady}
                  onContinue={() => setStep(5)}
                />
              )}

              {step === 4 && !osReady && (
                <OsEditor
                  industryLabel={(form.industry === "Other" ? businessDescription : form.industry) || "your business"}
                  suggesting={suggesting}
                  roles={roles} removeRole={removeRole} roleInput={roleInput} setRoleInput={setRoleInput} addRole={addRole}
                  workflows={workflows} removeWorkflow={removeWorkflow} wfInput={wfInput} setWfInput={setWfInput} addWorkflow={addWorkflow}
                  opTasks={opTasks} updateOpTask={updateOpTask} removeOpTask={removeOpTask} addOpTask={addOpTask}
                  approvalRules={approvalRules} updateRule={updateRule} removeRule={removeRule} addRule={addRule}
                  products={products} updateProduct={updateProduct} removeProduct={removeProduct} addProduct={addProduct}
                  error={error} busy={busy} onBack={() => setStep(3)} onProvision={createWorkspace}
                />
              )}

              {/* STEP 5 — Connect business */}
              {step === 5 && (
                <div className="space-y-4" data-testid="onboarding-step-5">
                  <p className="text-sm text-text-secondary flex items-center gap-1.5"><UploadSimple size={16} weight="bold" className="text-text-tertiary" />  Connect your business data</p>
                  <label data-testid="connect-excel" className={`border border-hairline p-5 flex flex-col items-center text-center cursor-pointer hover:shadow-xs transition-all ${uploading ? "opacity-60 pointer-events-none" : ""} rounded-md`}>
                    <TableIcon size={30} weight="bold" className="text-primary-text mb-2" />
                    <span className="font-bold tracking-tight">{uploading ? "Importing…" : "Upload Excel / CSV"}</span>
                    <span className="text-xs text-text-secondary mt-1">Customers, suppliers, sales or payment list</span>
                    <input type="file" data-testid="connect-excel-input" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { uploadExcel(e.target.files); e.target.value = ""; }} />
                  </label>
                  {importSummary && (
                    <p data-testid="import-summary" className="text-sm text-text border border-hairline bg-status-pending-bg/40 p-2 rounded-md">Imported {importSummary.contacts} contacts · {importSummary.invoices} invoices · {importSummary.payments} payments</p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {[{ k: "Tally" }, { k: "Zoho" }].map((c) => (
                      <div key={c.k} data-testid={`connect-${c.k.toLowerCase()}`} className="border border-dashed border-hairline p-4 flex flex-col items-center text-center opacity-70 rounded-md">
                        <span className="font-bold tracking-tight">{c.k}</span>
                        <span className="text-label text-text-secondary mt-1">Coming soon</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button data-testid="onboarding-skip-5" onClick={() => setStep(6)} className="flex-1 px-4 py-3 border border-hairline text-sm font-semibold hover:bg-surface-hover rounded-md">Skip</button>
                    <button data-testid="onboarding-next-5" onClick={() => setStep(6)} className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 border border-hairline hover:shadow-sm transition-all rounded-md">Continue <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 6 — Invite employees */}
              {step === 6 && (
                <div className="space-y-4" data-testid="onboarding-step-6">
                  <p className="text-sm text-text-secondary flex items-center gap-1.5"><DeviceMobile size={16} weight="bold" className="text-text-tertiary" />  Invite your team by mobile number</p>
                  <div className="flex gap-2">
                    <input data-testid="invite-phone-input" className={inputCls} placeholder="e.g. +91 98765 43210" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhone(); } }} />
                    <button onClick={addPhone} data-testid="add-phone-button" className="px-4 border border-hairline bg-primary text-primary-foreground hover:shadow-xs transition-all rounded-md"><Plus size={16} weight="bold" /></button>
                  </div>
                  <div className="flex flex-wrap gap-2" data-testid="invite-list">
                    {phones.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1.5 border border-hairline bg-surface px-2.5 py-1 text-xs font-mono rounded-md">
                        {p}<button onClick={() => setPhones(phones.filter((x) => x !== p))} className="hover:text-destructive-text"><X size={12} weight="bold" /></button>
                      </span>
                    ))}
                    {phones.length === 0 && <span className="text-xs text-text-secondary">No numbers yet — DecisionOS will text them an invite.</span>}
                  </div>
                  <p className="text-xs text-text-secondary">SMS invites are queued and sent once your SMS provider is connected.</p>
                  <div className="flex gap-2">
                    <button data-testid="onboarding-skip-6" onClick={() => setStep(7)} className="flex-1 px-4 py-3 border border-hairline text-sm font-semibold hover:bg-surface-hover rounded-md">Skip</button>
                    <button disabled={busy} data-testid="onboarding-invite-button" onClick={sendInvites} className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-50 rounded-md">Continue <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 7 — AI learns business */}
              {step === 7 && (
                <div className="space-y-5" data-testid="onboarding-step-7">
                  <p className="text-sm text-text-secondary flex items-center gap-1.5"><Sparkle size={16} weight="fill" className="text-primary-text" /> DecisionOS is learning your business</p>
                  <div className="space-y-2">
                    {AI_STEPS.map((s, i) => {
                      const done = aiProgress > i;
                      const active = aiProgress === i;
                      const Icon = s.icon;
                      return (
                        <div key={s.label} data-testid={`ai-step-${i}`} className={`flex items-center gap-3 border border-hairline px-4 py-3 transition-colors ${done ? "bg-primary text-primary-foreground" : "bg-surface"} rounded-md`}>
                          <span className="w-6 h-6 flex items-center justify-center">
                            {done ? <CheckCircle size={20} weight="fill" /> : active ? <CircleNotch size={18} className="animate-spin" /> : <Icon size={18} weight="bold" />}
                          </span>
                          <span className="text-sm font-semibold">{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button disabled={aiProgress < AI_STEPS.length} data-testid="onboarding-enter-button" onClick={() => navigate("/")} className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 border border-hairline hover:shadow-sm transition-all disabled:opacity-40 rounded-md">
                    {aiProgress < AI_STEPS.length ? "Setting up…" : <>Enter DecisionOS <ArrowRight size={16} weight="bold" /></>}
                  </button>
                </div>
              )}

              {step <= 3 && (
                <button onClick={backToLogin} data-testid="toggle-auth-mode" className="mt-4 text-sm text-primary-text font-semibold hover:underline">← Already have an account? Sign in</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
