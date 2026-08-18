import { useState } from "react";
import api, { formatApiError } from "../../lib/api";
import { ShieldStar, Spinner } from "@phosphor-icons/react";

export default function AdminLogin({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { data } = await api.post("/admin/login", { email, password });
      onSuccess(data.admin);
    } catch (e2) {
      setErr(formatApiError(e2.response?.data?.detail) || e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b] px-4" data-testid="admin-login-screen">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 flex items-center justify-center bg-[#e5484d] border-2 border-white/10">
            <ShieldStar size={26} weight="fill" className="text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-black tracking-tighter uppercase text-white leading-none">
              DecisionOS
            </h1>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#e5484d]">Admin Console</p>
          </div>
        </div>

        <form onSubmit={submit} className="border-2 border-white/10 bg-[#141418] p-7 space-y-5">
          <div>
            <label className="font-mono text-xs uppercase tracking-widest text-white/50 block mb-2">Email</label>
            <input
              data-testid="admin-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full bg-[#0a0a0b] border border-white/15 text-white px-4 py-3 font-mono text-sm focus:border-[#e5484d] focus:outline-none"
              placeholder="admin@decisionos.biz"
            />
          </div>
          <div>
            <label className="font-mono text-xs uppercase tracking-widest text-white/50 block mb-2">Password</label>
            <input
              data-testid="admin-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-[#0a0a0b] border border-white/15 text-white px-4 py-3 font-mono text-sm focus:border-[#e5484d] focus:outline-none"
              placeholder="••••••••"
            />
          </div>
          {err && (
            <p data-testid="admin-login-error" className="text-[#e5484d] text-sm font-mono">{err}</p>
          )}
          <button
            data-testid="admin-login-submit"
            type="submit"
            disabled={busy}
            className="w-full bg-[#e5484d] text-white py-3 font-heading font-black uppercase tracking-wider text-sm hover:bg-[#d13940] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && <Spinner size={16} className="animate-spin" />}
            {busy ? "Signing in…" : "Enter Console"}
          </button>
        </form>
        <p className="text-white/30 font-mono text-xs text-center mt-6 uppercase tracking-widest">
          Platform operators only
        </p>
      </div>
    </div>
  );
}
