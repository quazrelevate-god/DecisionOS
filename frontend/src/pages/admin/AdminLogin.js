import { useState } from "react";
import api, { formatApiError } from "../../lib/api";
import { ShieldStar, Spinner, ArrowLeft } from "@phosphor-icons/react";
import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
import { DRAWER_FIELD, INK_PILL } from "../../components/neuglass/glass";

/* 2026-10-22 (admin redesign):
 *  - An admin with two-step sign-in on got {requires_2fa: true} back and the
 *    page handed that to the console as if it were the admin, so it sat on
 *    "Loading console…" for ever. It asks for the code now.
 *  - The email placeholder was a real-looking admin address, which told
 *    anyone at the door what to try. */
export default function AdminLogin({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { data } = await api.post("/admin/login", { email, password, ...(needCode ? { code: code.trim() } : {}) });
      if (data.requires_2fa) {
        setNeedCode(true);
        setCode("");
        return;
      }
      // The sign-in answer carries no role and no two-step flag; the console
      // needs both to decide what to show, so it asks who is signed in.
      try { onSuccess((await api.get("/admin/me")).data); }
      catch { onSuccess({ ...data.admin, role: "read_only" }); }
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
          {!needCode ? (
            <>
              <div>
                <label htmlFor="admin-email" className={ADMIN_H3 + " block"}>Email</label>
                <input id="admin-email" data-testid="admin-email-input" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} required autoComplete="username" autoFocus
                  className={DRAWER_FIELD} placeholder="you@company.com" />
              </div>
              <div>
                <label htmlFor="admin-password" className={ADMIN_H3 + " block"}>Password</label>
                <input id="admin-password" data-testid="admin-password-input" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                  className={DRAWER_FIELD} placeholder="Your password" />
              </div>
            </>
          ) : (
            <div>
              <button type="button" onClick={() => { setNeedCode(false); setErr(""); }}
                className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
                <ArrowLeft size={14} /> {email}
              </button>
              <label htmlFor="admin-code" className={ADMIN_H3 + " block"}>Code from your authenticator app</label>
              <input id="admin-code" data-testid="admin-code-input" value={code} autoFocus required
                onChange={(e) => setCode(e.target.value.replace(/\s/g, "").slice(0, 12))}
                inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                className={`${DRAWER_FIELD} text-center font-mono tracking-[0.3em]`} />
              <p className="mt-2 text-xs text-slate-500">Lost your phone? Enter one of your backup codes instead.</p>
            </div>
          )}
          {err && (
            <p data-testid="admin-login-error" role="alert" className="text-sm text-[#b91c1c]">{err}</p>
          )}
          <button data-testid="admin-login-submit" type="submit" disabled={busy}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-pill text-sm font-medium disabled:opacity-60 ${INK_PILL}`}>
            {busy && <Spinner size={16} className="animate-spin" />}
            {busy ? (needCode ? "Checking…" : "Signing in…") : needCode ? "Verify and enter" : "Enter console"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-600">Platform operators only</p>
      </div>
    </div>
  );
}
