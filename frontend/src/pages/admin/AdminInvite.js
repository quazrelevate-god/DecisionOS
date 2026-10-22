import { useEffect, useState } from "react";
import api, { formatApiError } from "../../lib/api";
import { ShieldStar, Spinner, CheckCircle, LinkBreak } from "@phosphor-icons/react";
import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
import { DRAWER_FIELD, INK_PILL } from "../../components/neuglass/glass";
import { adminRoleLabel } from "./adminLabels";

/* Accepting an admin invite (2026-10-22, admin redesign). A super admin
 * invites by email and sends the link; the new admin opens it here and sets
 * their own password. The link works once and expires after 7 days
 * (routers/admin_invites). */
const PAGE = "min-h-[calc(100vh/var(--ui-scale,1))] flex items-center justify-center bg-[linear-gradient(180deg,hsl(220_20%_97%),hsl(220_14%_91%))] px-4";

export default function AdminInvite({ token, onDone }) {
  const [invite, setInvite] = useState(undefined);   // undefined = checking
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setInvite({ valid: false }); return; }
    api.get(`/invites/admin/${encodeURIComponent(token)}`)
      .then((r) => setInvite(r.data))
      .catch(() => setInvite({ valid: false, failed: true }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (pw.length < 10) { setErr("Use at least 10 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    try {
      await api.post(`/invites/admin/${encodeURIComponent(token)}/accept`, { password: pw });
      setDone(true);
    } catch (e2) {
      setErr(formatApiError(e2.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const brand = (
    <div className="mb-8 flex items-center gap-3">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#cf222e] text-white"><ShieldStar size={26} weight="fill" /></div>
      <div>
        <h1 className="font-display text-2xl leading-none text-slate-900">DecisionOS</h1>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#b91c1c]">Admin console</p>
      </div>
    </div>
  );

  if (invite === undefined)
    return <div className={`${PAGE} gap-2 text-sm text-slate-600`}><Spinner size={16} className="animate-spin" /> Checking your invite…</div>;

  return (
    <div className={PAGE} data-testid="admin-invite-screen">
      <div className="w-full max-w-md">
        {brand}
        <div className={`${CARD_BASE} p-7`}>
          {done ? (
            <div className="text-center">
              <CheckCircle size={40} weight="fill" className="mx-auto text-[#116329]" />
              <h2 className="mt-3 font-display text-xl text-slate-900">You&apos;re set up</h2>
              <p className="mt-1 text-sm text-slate-600">Sign in with {invite.email} and the password you just chose. Then turn on two-step sign-in under Admins.</p>
              <button type="button" onClick={onDone} className={`mt-6 flex h-12 w-full items-center justify-center rounded-pill text-sm font-medium ${INK_PILL}`}>Go to sign in</button>
            </div>
          ) : !invite.valid ? (
            <div className="text-center" data-testid="admin-invite-invalid">
              <LinkBreak size={36} className="mx-auto text-slate-400" />
              <h2 className="mt-3 font-display text-xl text-slate-900">{invite.failed ? "Couldn't check this link" : "This link no longer works"}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {invite.failed ? "The server didn't answer. Try again in a moment." : "It was already used, or it's more than 7 days old. Ask the admin who invited you for a new one."}
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h2 className="font-display text-xl text-slate-900">Set your password</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {invite.name && invite.name !== invite.email ? `${invite.name}, you've` : "You've"} been invited as <strong className="font-semibold text-slate-900">{adminRoleLabel(invite.role)}</strong> for {invite.email}.
                </p>
              </div>
              <input type="email" value={invite.email} autoComplete="username" readOnly hidden />
              <div>
                <label htmlFor="invite-pw" className={ADMIN_H3 + " block"}>New password</label>
                <input id="invite-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus
                  autoComplete="new-password" placeholder="At least 10 characters" className={DRAWER_FIELD} data-testid="admin-invite-password" />
              </div>
              <div>
                <label htmlFor="invite-pw2" className={ADMIN_H3 + " block"}>Again</label>
                <input id="invite-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required
                  autoComplete="new-password" placeholder="Type it once more" className={DRAWER_FIELD} data-testid="admin-invite-password2" />
              </div>
              {err && <p role="alert" className="text-sm text-[#b91c1c]">{err}</p>}
              <button type="submit" disabled={busy} data-testid="admin-invite-submit"
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-pill text-sm font-medium disabled:opacity-60 ${INK_PILL}`}>
                {busy && <Spinner size={16} className="animate-spin" />}{busy ? "Saving…" : "Set password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
