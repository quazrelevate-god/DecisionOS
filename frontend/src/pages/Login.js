import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { INDUSTRIES, COMPANY_SIZES, CURRENCIES, slugify } from "../lib/format";
import {
  Microphone, Sparkle, X, Plus, ArrowRight, ArrowLeft, Buildings, ChartLineUp,
  Stack, UploadSimple, DeviceMobile, Check, CircleNotch, Table as TableIcon,
  Brain, CheckCircle, Files, Gauge, WhatsappLogo,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const DEMO = [
  { role: "Owner", email: "owner@sharma.com" },
  { role: "Sales", email: "sales@sharma.com" },
  { role: "Production", email: "production@sharma.com" },
  { role: "Finance", email: "finance@sharma.com" },
];

const inputCls = "w-full border border-black bg-white px-4 py-3 text-sm font-mono focus:outline-none focus:shadow-brutal-sm transition-shadow";
const labelCls = "label-mono text-muted-foreground";

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
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [loginTab, setLoginTab] = useState("password");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
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
  const [customIndustry, setCustomIndustry] = useState("");
  const [phones, setPhones] = useState([]);
  const [phoneInput, setPhoneInput] = useState("");
  const [importSummary, setImportSummary] = useState(null);
  const [roles, setRoles] = useState([]);
  const [roleInput, setRoleInput] = useState("");
  const [products, setProducts] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

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
        if (start.data.dev_otp) { setOtpCode(start.data.dev_otp); toast.info(`Dev OTP: ${start.data.dev_otp} (auto-filled)`); }
        else toast.success("We texted a login code to your mobile");
      } catch (err) {
        setError(formatApiError(err.response?.data?.detail) || "This invite link is invalid or expired");
      }
    })();
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

  // Step 4 — fetch AI-suggested team roles & products/services for the chosen industry
  const fetchSuggestions = async () => {
    const eff = form.industry === "Other" ? customIndustry.trim() : form.industry;
    setSuggesting(true);
    try {
      const { data } = await api.post("/onboarding/suggest", { industry: eff, company_size: form.company_size });
      setRoles(data.roles || []);
      setProducts((data.products || []).map((p) => ({ name: p.name, description: p.description || "", _key: Math.random().toString(36).slice(2, 9) })));
    } catch {
      toast.error("Couldn't fetch AI suggestions — add your team & products manually");
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
  const addProduct = () => setProducts([...products, { name: "", description: "", _key: Math.random().toString(36).slice(2, 9) }]);
  const updateProduct = (i, k, v) => setProducts(products.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const removeProduct = (i) => setProducts(products.filter((_, idx) => idx !== i));

  // Step 4 → create the workspace with reviewed team & products, then continue authenticated
  const createWorkspace = async () => {
    setError(""); setBusy(true);
    const eff = form.industry === "Other" ? customIndustry.trim() : form.industry;
    try {
      const sw = software.includes("Others") && otherSoftware.trim()
        ? [...software.filter((x) => x !== "Others"), otherSoftware.trim()] : software;
      await register({
        company_name: form.company_name, name: form.name, email: form.email, password: form.password, phone: form.phone,
        industry: eff || "General", gst: form.gst, branches: form.branches,
        company_size: form.company_size, region: form.region, currency: form.currency,
        current_software: sw,
        business_scale: {
          employees: form.company_size, monthly_sales: form.monthly_sales,
          monthly_purchases: form.monthly_purchases, customers: form.num_customers, suppliers: form.num_suppliers,
        },
        roles, products: products.filter((p) => p.name.trim()).map(({ _key, ...r }) => r),
      });
      setStep(5);
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
    catch (err) { console.error("invite send failed (non-blocking):", err); }
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
    (form.industry !== "Other" || customIndustry.trim());

  const TOTAL = 7;

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-brand-paper text-brand-ink">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-brand-ink text-white p-12 border-r border-black">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-red flex items-center justify-center"><span className="font-heading font-black text-xl">D</span></div>
          <span className="font-heading font-black text-2xl tracking-tighter uppercase">DecisionOS</span>
        </div>
        <div>
          <p className="label-mono text-brand-red mb-4">The operational brain for founder-led SMEs</p>
          <h1 className="font-heading text-5xl xl:text-6xl font-black uppercase tracking-tighter leading-[0.95]">
            {mode === "register" ? <>Set up your<br /><span className="text-brand-red">executive office.</span></> : <>Speak the decision.<br /><span className="text-brand-red">We run</span> the company.</>}
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
            <div className="w-8 h-8 bg-brand-red flex items-center justify-center"><span className="font-heading font-black text-white">D</span></div>
            <span className="font-heading font-black text-xl tracking-tighter uppercase">DecisionOS</span>
          </div>

          {mode === "login" && (
            <>
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
                  <div className="flex gap-2">
                    <input data-testid="otp-phone-input" type="tel" className={inputCls} placeholder="Registered mobile number" value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)} disabled={otpSent} required />
                    {otpSent && (
                      <button type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); }} data-testid="otp-change-number"
                        className="border border-black px-3 text-xs font-semibold uppercase hover:bg-black/5 whitespace-nowrap">Change</button>
                    )}
                  </div>
                  {otpSent && (
                    <input data-testid="otp-code-input" inputMode="numeric" maxLength={6} className={`${inputCls} tracking-[0.5em] text-center text-lg`} placeholder="Enter 6-digit OTP" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))} required />
                  )}
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <button type="submit" disabled={busy} data-testid="otp-submit-button" className="w-full bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                    {busy ? "…" : otpSent ? "Verify & sign in" : "Send OTP"}
                  </button>
                  {otpSent && (
                    <button type="button" onClick={requestOtp} disabled={busy} data-testid="otp-resend" className="w-full text-sm text-brand-blue font-semibold hover:underline">Resend OTP</button>
                  )}
                </form>
              )}

              <button onClick={goToRegister} data-testid="toggle-auth-mode" className="mt-4 text-sm text-brand-blue font-semibold hover:underline">Need a workspace? Register →</button>
              <div className="mt-8 border-t border-black/20 pt-6">
                <p className="label-mono text-muted-foreground mb-3">Try the Sharma demo</p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO.map((d) => (
                    <button key={d.email} onClick={() => demoLogin(d.email)} data-testid={`demo-login-${d.role.toLowerCase()}`} className="border border-black px-3 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">{d.role}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "register" && (
            <>
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-heading text-2xl font-black uppercase tracking-tighter">Digital Executive Office</h2>
                <span className="label-mono text-muted-foreground" data-testid="onboarding-step">Step {step}/{TOTAL}</span>
              </div>
              <div className="flex gap-1 mb-6">
                {Array.from({ length: TOTAL }).map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 border border-black ${i + 1 <= step ? "bg-brand-red" : "bg-white"}`} />
                ))}
              </div>

              {/* STEP 1 — About company */}
              {step === 1 && (
                <div className="space-y-4" data-testid="onboarding-step-1">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Buildings size={16} weight="bold" className="text-brand-red" /> About your company</p>
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
                  {form.industry === "Other" && (
                    <textarea data-testid="custom-industry-input" className={`${inputCls} resize-none`} rows={2} placeholder="Describe your business in one line" value={customIndustry} onChange={(e) => setCustomIndustry(e.target.value)} />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <input data-testid="register-gst-input" className={inputCls} placeholder="GST (optional)" value={form.gst} onChange={set("gst")} />
                    <input data-testid="register-branches-input" className={inputCls} placeholder="Branches (e.g. 2)" value={form.branches} onChange={set("branches")} />
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <button disabled={!stepValid1} data-testid="onboarding-next-1" onClick={() => { setError(""); setStep(2); }} className="w-full flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-40">Next <ArrowRight size={16} weight="bold" /></button>
                </div>
              )}

              {/* STEP 2 — Business scale */}
              {step === 2 && (
                <div className="space-y-4" data-testid="onboarding-step-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><ChartLineUp size={16} weight="bold" className="text-brand-red" /> Business scale</p>
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
                    <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5"><ArrowLeft size={16} weight="bold" /></button>
                    <button data-testid="onboarding-next-2" onClick={() => setStep(3)} className="flex-1 flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all">Next <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 3 — Current software */}
              {step === 3 && (
                <div className="space-y-4" data-testid="onboarding-step-3">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Stack size={16} weight="bold" className="text-brand-red" /> What do you use today?</p>
                  <div className="grid grid-cols-2 gap-3">
                    {SOFTWARE.map((s) => {
                      const on = software.includes(s.key);
                      return (
                        <button key={s.key} data-testid={`software-${s.key.toLowerCase()}`} onClick={() => toggleSoftware(s.key)}
                          className={`flex items-center justify-between gap-2 border border-black px-4 py-3 text-sm font-semibold transition-colors ${on ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                          <span>{s.key}</span>
                          <span className={`w-5 h-5 flex items-center justify-center border border-current ${on ? "bg-brand-red text-white border-black" : ""}`}>{on && <Check size={12} weight="bold" />}</span>
                        </button>
                      );
                    })}
                  </div>
                  {software.includes("Others") && (
                    <input data-testid="software-other-input" className={inputCls} placeholder="Which software?" value={otherSoftware} onChange={(e) => setOtherSoftware(e.target.value)} />
                  )}
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5"><ArrowLeft size={16} weight="bold" /></button>
                    <button data-testid="onboarding-next-3" onClick={goToTeamStep} className="flex-1 flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all">Next <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 4 — AI-suggested team & products */}
              {step === 4 && (
                <div className="space-y-5" data-testid="onboarding-step-4">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Sparkle size={16} weight="fill" className="text-brand-red" /> AI-suggested team & offerings for <strong>{(form.industry === "Other" ? customIndustry : form.industry) || "your business"}</strong>. Edit freely.
                  </p>
                  {suggesting ? (
                    <div className="flex items-center gap-2 border border-black p-6 justify-center" data-testid="suggest-loading">
                      <CircleNotch size={18} className="animate-spin" /> <span className="text-sm font-semibold uppercase tracking-wider">AI is building your team…</span>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className={labelCls}>Team roles (besides Owner)</label>
                        <div className="flex flex-wrap gap-2 mt-2" data-testid="roles-list">
                          {roles.map((r) => (
                            <span key={r.key} data-testid={`role-chip-${r.key}`} className="inline-flex items-center gap-1.5 border border-black bg-white px-2.5 py-1 text-xs uppercase tracking-wider font-semibold">
                              {r.label}<button onClick={() => removeRole(r.key)} data-testid={`remove-role-${r.key}`} className="hover:text-brand-red"><X size={12} weight="bold" /></button>
                            </span>
                          ))}
                          {roles.length === 0 && <span className="text-xs text-muted-foreground">No roles yet — add some below.</span>}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <input data-testid="role-input" className={inputCls} placeholder="Add a role (e.g. Marketing)" value={roleInput} onChange={(e) => setRoleInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }} />
                          <button onClick={addRole} data-testid="add-role-button" className="px-4 border border-black bg-brand-ink text-white hover:shadow-brutal-sm transition-all"><Plus size={16} weight="bold" /></button>
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Products / Services</label>
                        <div className="space-y-2 mt-2" data-testid="products-list">
                          {products.map((p, i) => (
                            <div key={i} data-testid={`product-row-${i}`} className="border border-black p-2">
                              <div className="flex gap-2">
                                <input data-testid={`product-name-${i}`} className="flex-1 border border-black/40 px-2 py-1.5 text-sm font-mono focus:outline-none" placeholder="Name" value={p.name} onChange={(e) => updateProduct(i, "name", e.target.value)} />
                                <button onClick={() => removeProduct(i)} data-testid={`remove-product-${i}`} className="px-2 border border-black hover:bg-brand-red hover:text-white transition-colors"><X size={14} weight="bold" /></button>
                              </div>
                              <input data-testid={`product-desc-${i}`} className="w-full border border-black/40 px-2 py-1.5 text-xs font-mono mt-2 focus:outline-none" placeholder="Short description" value={p.description} onChange={(e) => updateProduct(i, "description", e.target.value)} />
                            </div>
                          ))}
                        </div>
                        <button onClick={addProduct} data-testid="add-product-button" className="mt-2 flex items-center gap-1.5 text-sm text-brand-blue font-semibold hover:underline"><Plus size={14} weight="bold" /> Add product / service</button>
                      </div>
                    </>
                  )}
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setStep(3)} className="flex items-center gap-2 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5"><ArrowLeft size={16} weight="bold" /></button>
                    <button disabled={busy || suggesting} data-testid="onboarding-create-button" onClick={createWorkspace} className="flex-1 flex items-center justify-center gap-2 bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                      {busy ? <><CircleNotch size={16} className="animate-spin" /> Creating…</> : <>Create workspace <ArrowRight size={16} weight="bold" /></>}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 5 — Connect business */}
              {step === 5 && (
                <div className="space-y-4" data-testid="onboarding-step-5">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><UploadSimple size={16} weight="bold" className="text-brand-red" /> Connect your business data</p>
                  <label data-testid="connect-excel" className={`border border-black p-5 flex flex-col items-center text-center cursor-pointer hover:shadow-brutal-sm transition-all ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
                    <TableIcon size={30} weight="bold" className="text-brand-blue mb-2" />
                    <span className="font-heading font-bold uppercase tracking-tight">{uploading ? "Importing…" : "Upload Excel / CSV"}</span>
                    <span className="text-xs text-muted-foreground mt-1">Customers, suppliers, sales or payment list</span>
                    <input type="file" data-testid="connect-excel-input" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { uploadExcel(e.target.files); e.target.value = ""; }} />
                  </label>
                  {importSummary && (
                    <p data-testid="import-summary" className="text-sm text-brand-ink border border-black bg-brand-yellow/40 p-2">Imported {importSummary.contacts} contacts · {importSummary.invoices} invoices · {importSummary.payments} payments</p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {[{ k: "Tally" }, { k: "Zoho" }].map((c) => (
                      <div key={c.k} data-testid={`connect-${c.k.toLowerCase()}`} className="border border-dashed border-black/40 p-4 flex flex-col items-center text-center opacity-70">
                        <span className="font-heading font-bold uppercase tracking-tight">{c.k}</span>
                        <span className="label-mono text-muted-foreground mt-1">Coming soon</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button data-testid="onboarding-skip-5" onClick={() => setStep(6)} className="flex-1 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5">Skip</button>
                    <button data-testid="onboarding-next-5" onClick={() => setStep(6)} className="flex-1 flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all">Continue <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 6 — Invite employees */}
              {step === 6 && (
                <div className="space-y-4" data-testid="onboarding-step-6">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><DeviceMobile size={16} weight="bold" className="text-brand-red" /> Invite your team by mobile number</p>
                  <div className="flex gap-2">
                    <input data-testid="invite-phone-input" className={inputCls} placeholder="e.g. +91 98765 43210" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhone(); } }} />
                    <button onClick={addPhone} data-testid="add-phone-button" className="px-4 border border-black bg-brand-ink text-white hover:shadow-brutal-sm transition-all"><Plus size={16} weight="bold" /></button>
                  </div>
                  <div className="flex flex-wrap gap-2" data-testid="invite-list">
                    {phones.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1.5 border border-black bg-white px-2.5 py-1 text-xs font-mono">
                        {p}<button onClick={() => setPhones(phones.filter((x) => x !== p))} className="hover:text-brand-red"><X size={12} weight="bold" /></button>
                      </span>
                    ))}
                    {phones.length === 0 && <span className="text-xs text-muted-foreground">No numbers yet — DecisionOS will text them an invite.</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">SMS invites are queued and sent once your SMS provider is connected.</p>
                  <div className="flex gap-2">
                    <button data-testid="onboarding-skip-6" onClick={() => setStep(7)} className="flex-1 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5">Skip</button>
                    <button disabled={busy} data-testid="onboarding-invite-button" onClick={sendInvites} className="flex-1 flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">Continue <ArrowRight size={16} weight="bold" /></button>
                  </div>
                </div>
              )}

              {/* STEP 7 — AI learns business */}
              {step === 7 && (
                <div className="space-y-5" data-testid="onboarding-step-7">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Sparkle size={16} weight="fill" className="text-brand-red" /> DecisionOS is learning your business</p>
                  <div className="space-y-2">
                    {AI_STEPS.map((s, i) => {
                      const done = aiProgress > i;
                      const active = aiProgress === i;
                      const Icon = s.icon;
                      return (
                        <div key={s.label} data-testid={`ai-step-${i}`} className={`flex items-center gap-3 border border-black px-4 py-3 transition-colors ${done ? "bg-brand-ink text-white" : "bg-white"}`}>
                          <span className="w-6 h-6 flex items-center justify-center">
                            {done ? <CheckCircle size={20} weight="fill" /> : active ? <CircleNotch size={18} className="animate-spin" /> : <Icon size={18} weight="bold" />}
                          </span>
                          <span className="text-sm font-semibold">{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button disabled={aiProgress < AI_STEPS.length} data-testid="onboarding-enter-button" onClick={() => navigate("/")} className="w-full flex items-center justify-center gap-2 bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-40">
                    {aiProgress < AI_STEPS.length ? "Setting up…" : <>Enter DecisionOS <ArrowRight size={16} weight="bold" /></>}
                  </button>
                </div>
              )}

              {step <= 3 && (
                <button onClick={backToLogin} data-testid="toggle-auth-mode" className="mt-4 text-sm text-brand-blue font-semibold hover:underline">← Already have an account? Sign in</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
