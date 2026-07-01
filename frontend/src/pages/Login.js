import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { formatApiError } from "../lib/api";
import { Microphone } from "@phosphor-icons/react";

const DEMO = [
  { role: "Owner", email: "owner@sharma.com" },
  { role: "Sales", email: "sales@sharma.com" },
  { role: "Production", email: "production@sharma.com" },
  { role: "Finance", email: "finance@sharma.com" },
];

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ company_name: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form);
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

  const inputCls =
    "w-full border border-black bg-white px-4 py-3 text-sm font-mono focus:outline-none focus:shadow-brutal-sm transition-shadow";

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
            Capture spoken directives, auto-structure them into tasks, owners and workflows, and give your whole team one shared brain.
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

          <h2 className="font-heading text-3xl font-black uppercase tracking-tighter mb-1">
            {mode === "login" ? "Sign in" : "Create workspace"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "login" ? "Access your company brain." : "Start your company's operating system."}
          </p>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <>
                <input data-testid="register-company-input" className={inputCls} placeholder="Company name" value={form.company_name} onChange={set("company_name")} required />
                <input data-testid="register-name-input" className={inputCls} placeholder="Your name" value={form.name} onChange={set("name")} required />
              </>
            )}
            <input data-testid="login-email-input" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={set("email")} required />
            <input data-testid="login-password-input" type="password" className={inputCls} placeholder="Password" value={form.password} onChange={set("password")} required />

            {error && <p data-testid="auth-error" className="text-sm text-brand-red font-semibold">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              data-testid="auth-submit-button"
              className="w-full bg-brand-red text-white font-semibold uppercase tracking-wider py-3 border border-black hover:shadow-brutal transition-all disabled:opacity-50"
            >
              {busy ? "…" : mode === "login" ? "Sign in" : "Create workspace"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            data-testid="toggle-auth-mode"
            className="mt-4 text-sm text-brand-blue font-semibold hover:underline"
          >
            {mode === "login" ? "Need a workspace? Register →" : "← Already have an account? Sign in"}
          </button>

          <div className="mt-8 border-t border-black/20 pt-6">
            <p className="label-mono text-muted-foreground mb-3">Try the Sharma demo</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => demoLogin(d.email)}
                  data-testid={`demo-login-${d.role.toLowerCase()}`}
                  className="border border-black px-3 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors"
                >
                  {d.role}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
