import { useState } from "react";
import api, { formatApiError } from "../../lib/api";
import { ShieldStar, Spinner } from "@phosphor-icons/react";
import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
import { DRAWER_FIELD, INK_PILL } from "../../components/karma/glass";

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
    <div className="min-h-[calc(100vh/var(--ui-scale,1))] flex items-center justify-center bg-[linear-gradient(180deg,hsl(220_20%_97%),hsl(220_14%_91%))] px-4" data-testid="admin-login-screen">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#cf222e] text-white">
            <ShieldStar size={26} weight="fill" />
          </div>
          <div>
            <h1 className="font-display text-2xl leading-none text-slate-900">DecisionOS</h1>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#b91c1c]">Admin console</p>
          </div>
        </div>

        <form onSubmit={submit} className={`${CARD_BASE} space-y-5 p-7`}>
          <div>
            <label htmlFor="admin-email" className={ADMIN_H3 + " block"}>Email</label>
            <input
              id="admin-email"
              data-testid="admin-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className={DRAWER_FIELD}
              placeholder="admin@decisionos.biz"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className={ADMIN_H3 + " block"}>Password</label>
            <input
              id="admin-password"
              data-testid="admin-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={DRAWER_FIELD}
              placeholder="••••••••"
            />
          </div>
          {err && (
            <p data-testid="admin-login-error" role="alert" className="text-sm text-[#b91c1c]">{err}</p>
          )}
          <button
            data-testid="admin-login-submit"
            type="submit"
            disabled={busy}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-pill text-sm font-medium disabled:opacity-60 ${INK_PILL}`}
          >
            {busy && <Spinner size={16} className="animate-spin" />}
            {busy ? "Signing in…" : "Enter console"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-600">Platform operators only</p>
      </div>
    </div>
  );
}
