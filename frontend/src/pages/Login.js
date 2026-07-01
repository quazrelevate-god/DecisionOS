import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { INDUSTRIES, COMPANY_SIZES, CURRENCIES, slugify } from "../lib/format";
import { Microphone, Sparkle, X, Plus, ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";

const DEMO = [
  { role: "Owner", email: "owner@sharma.com" },
  { role: "Sales", email: "sales@sharma.com" },
  { role: "Production", email: "production@sharma.com" },
  { role: "Finance", email: "finance@sharma.com" },
];

const inputCls =
  "w-full border border-black bg-white px-4 py-3 text-sm font-mono focus:outline-none focus:shadow-brutal-sm transition-shadow";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    company_name: "", name: "", email: "", password: "",
    industry: "", company_size: "", region: "", currency: "INR",
  });
  const [roles, setRoles] = useState([]);
  const [roleInput, setRoleInput] = useState("");
  const [products, setProducts] = useState([]);
  const [customIndustry, setCustomIndustry] = useState("");
  const [resolvedIndustry, setResolvedIndustry] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const doLogin = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(form.email, form.password);
      navigate("/");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async (email) => {
    setError("");
    setBusy(true);
    try {
      await login(email, "demo1234");
      navigate("/");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  // Step 2 -> fetch AI suggestions, then go to step 3
  const fetchSuggestions = async () => {
    if (!form.industry) { setError("Please choose your industry"); return; }
    const eff = form.industry === "Other" ? customIndustry.trim() : form.industry;
    if (form.industry === "Other" && !eff) { setError("Please describe your industry in a short sentence"); return; }
    setError("");
    setResolvedIndustry(eff);
    setSuggesting(true);
    try {
      const { data } = await api.post("/onboarding/suggest", {
        industry: eff, company_size: form.company_size,
      });
      setRoles(data.roles || []);
      setProducts((data.products || []).map((p) => ({ name: p.name, description: p.description || "" })));
      setStep(3);
    } catch (err) {
      toast.error("Couldn't fetch AI suggestions — you can add roles & products manually");
      setStep(3);
    } finally {
      setSuggesting(false);
    }
  };

  const addRole = () => {
    const label = roleInput.trim();
    if (!label) return;
    const key = slugify(label);
    if (!key || key === "owner" || roles.some((r) => r.key === key)) { setRoleInput(""); return; }
    setRoles([...roles, { key, label }]);
    setRoleInput("");
  };
  const removeRole = (key) => setRoles(roles.filter((r) => r.key !== key));

  const addProduct = () => setProducts([...products, { name: "", description: "" }]);
  const updateProduct = (i, k, v) => setProducts(products.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const removeProduct = (i) => setProducts(products.filter((_, idx) => idx !== i));

  const submitRegister = async () => {
    setError("");
    setBusy(true);
    try {
      await register({
        ...form,
        industry: resolvedIndustry || form.industry,
        roles,
        products: products.filter((p) => p.name.trim()),
      });
      navigate("/");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const goToRegister = () => { setMode("register"); setStep(1); setError(""); };
  const backToLogin = () => { setMode("login"); setError(""); };

  const stepValid1 = form.company_name && form.name && form.email && form.password.length >= 6;

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-brand-paper text-brand-ink">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-brand-ink text-white p-12 border-r border-black">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-red flex items-center justify-center">
            <span className="font-heading font-black text-xl">D</span>
          </div>
          <span className="font-heading font-black text-2xl tracking-tighter uppercase">DecisionOS</span>
        </div>
        <div>
          <p className="label-mono text-brand-red mb-4">The operational brain for founder-led SMEs</p>
          <h1 className="font-heading text-5xl xl:text-6xl font-black uppercase tracking-tighter leading-[0.95]">
            Speak the decision.<br />
            <span className="text-brand-red">We run</span> the company.
          </h1>
          <p className="mt-6 text-white/70 text-sm max-w-md leading-relaxed">
            Tailored to your industry — DecisionOS suggests your team roles and products at sign-up, then turns spoken
            directives into structured tasks and workflows.
          </p>
        </div>
        <div className="flex items-center gap-2 text-white/50 text-xs">
          <Microphone size={16} weight="bold" /> Voice-first · AI-structured · Multi-tenant
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-brand-red flex items-center justify-center">
              <span className="font-heading font-black text-white">D</span>
            </div>
            <span className="font-heading font-black text-xl tracking-tighter uppercase">DecisionOS</span>
          </div>

          {mode === "login" && (
            <>
              <h2 className="font-heading text-3xl font-black uppercase tracking-tighter mb-1">Sign in</h2>
              <p className="text-sm text-muted-foreground mb-6">Access your company brain.</p>
              <form onSubmit={doLogin} className="space-y-4">
                <input data-testid="login-email-input" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
                <input data-testid="login-password-input" type="password" className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />
                {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                <button type="submit" disabled={busy} data-testid="auth-submit-button"
                  className="w-full bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                  {busy ? "…" : "Sign in"}
                </button>
              </form>
              <button onClick={goToRegister} data-testid="toggle-auth-mode" className="mt-4 text-sm text-brand-blue font-semibold hover:underline">
                Need a workspace? Register →
              </button>
              <div className="mt-8 border-t border-black/20 pt-6">
                <p className="label-mono text-muted-foreground mb-3">Try the Sharma demo</p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO.map((d) => (
                    <button key={d.email} onClick={() => demoLogin(d.email)} data-testid={`demo-login-${d.role.toLowerCase()}`}
                      className="border border-black px-3 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
                      {d.role}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "register" && (
            <>
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-heading text-3xl font-black uppercase tracking-tighter">Set up</h2>
                <span className="label-mono text-muted-foreground" data-testid="onboarding-step">Step {step}/3</span>
              </div>
              {/* progress */}
              <div className="flex gap-1 mb-6">
                {[1, 2, 3].map((s) => (
                  <div key={s} className={`h-1.5 flex-1 border border-black ${s <= step ? "bg-brand-red" : "bg-white"}`} />
                ))}
              </div>

              {step === 1 && (
                <div className="space-y-4" data-testid="onboarding-step-1">
                  <p className="text-sm text-muted-foreground">Create your owner account & company.</p>
                  <input data-testid="register-company-input" className={inputCls} placeholder="Company name" value={form.company_name} onChange={set("company_name")} />
                  <input data-testid="register-name-input" className={inputCls} placeholder="Your name" value={form.name} onChange={set("name")} />
                  <input data-testid="register-email-input" type="email" className={inputCls} placeholder="Work email" value={form.email} onChange={set("email")} />
                  <input data-testid="register-password-input" type="password" className={inputCls} placeholder="Password (min 6)" value={form.password} onChange={set("password")} />
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <button disabled={!stepValid1} data-testid="onboarding-next-1" onClick={() => { setError(""); setStep(2); }}
                    className="w-full flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-40">
                    Next <ArrowRight size={16} weight="bold" />
                  </button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4" data-testid="onboarding-step-2">
                  <p className="text-sm text-muted-foreground">Tell us about your business — AI tailors your roles & products.</p>
                  <div>
                    <label className="label-mono text-muted-foreground">Industry</label>
                    <select data-testid="industry-select" className={`${inputCls} mt-1`} value={form.industry} onChange={set("industry")}>
                      <option value="">Select industry…</option>
                      {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  {form.industry === "Other" && (
                    <div data-testid="custom-industry-wrap">
                      <label className="label-mono text-muted-foreground">Describe your industry</label>
                      <textarea
                        data-testid="custom-industry-input"
                        className={`${inputCls} mt-1 resize-none`}
                        rows={2}
                        placeholder="e.g. We run a mobile pet-grooming service across the city"
                        value={customIndustry}
                        onChange={(e) => setCustomIndustry(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">AI will read this to suggest your roles & products.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label-mono text-muted-foreground">Company size</label>
                      <select data-testid="company-size-select" className={`${inputCls} mt-1`} value={form.company_size} onChange={set("company_size")}>
                        <option value="">Employees…</option>
                        {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-mono text-muted-foreground">Currency</label>
                      <select data-testid="currency-select" className={`${inputCls} mt-1`} value={form.currency} onChange={set("currency")}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label-mono text-muted-foreground">Region / Country</label>
                    <input data-testid="region-input" className={`${inputCls} mt-1`} placeholder="e.g. India, USA" value={form.region} onChange={set("region")} />
                  </div>
                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
                      <ArrowLeft size={16} weight="bold" />
                    </button>
                    <button disabled={suggesting} data-testid="onboarding-suggest-button" onClick={fetchSuggestions}
                      className="flex-1 flex items-center justify-center gap-2 bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                      <Sparkle size={16} weight="fill" /> {suggesting ? "Thinking…" : "Get AI suggestions"}
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5" data-testid="onboarding-step-3">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Sparkle size={14} weight="fill" className="text-brand-red" /> AI-suggested for <strong>{resolvedIndustry || form.industry}</strong>. Edit freely.
                  </p>

                  {/* Roles */}
                  <div>
                    <label className="label-mono text-muted-foreground">Team roles (besides Owner)</label>
                    <div className="flex flex-wrap gap-2 mt-2" data-testid="roles-list">
                      {roles.map((r) => (
                        <span key={r.key} data-testid={`role-chip-${r.key}`} className="inline-flex items-center gap-1.5 border border-black bg-white px-2.5 py-1 text-xs uppercase tracking-wider font-semibold">
                          {r.label}
                          <button onClick={() => removeRole(r.key)} data-testid={`remove-role-${r.key}`} className="hover:text-brand-red"><X size={12} weight="bold" /></button>
                        </span>
                      ))}
                      {roles.length === 0 && <span className="text-xs text-muted-foreground">No roles yet — add some below.</span>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input data-testid="role-input" className={inputCls} placeholder="Add a role (e.g. Marketing)" value={roleInput}
                        onChange={(e) => setRoleInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }} />
                      <button onClick={addRole} data-testid="add-role-button" className="px-4 border border-black bg-brand-ink text-white hover:shadow-brutal-sm transition-all"><Plus size={16} weight="bold" /></button>
                    </div>
                  </div>

                  {/* Products */}
                  <div>
                    <label className="label-mono text-muted-foreground">Products / Services</label>
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
                    <button onClick={addProduct} data-testid="add-product-button" className="mt-2 flex items-center gap-1.5 text-sm text-brand-blue font-semibold hover:underline">
                      <Plus size={14} weight="bold" /> Add product / service
                    </button>
                  </div>

                  {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-3 border border-black text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
                      <ArrowLeft size={16} weight="bold" />
                    </button>
                    <button disabled={busy} data-testid="onboarding-create-button" onClick={submitRegister}
                      className="flex-1 bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50">
                      {busy ? "Creating…" : "Create workspace"}
                    </button>
                  </div>
                </div>
              )}

              <button onClick={backToLogin} data-testid="toggle-auth-mode" className="mt-4 text-sm text-brand-blue font-semibold hover:underline">
                ← Already have an account? Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
