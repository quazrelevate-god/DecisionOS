/* An owner who came in by mobile adds an email and a password (2026-09-19).
 *
 * Members sign in with their mobile and a texted code. Owners have an email
 * and a password as well, because the owner is who recovers everyone else —
 * and whose account the forgot-password email is for. Someone added on Team
 * as an owner, or promoted to one, arrives with only a mobile; this is where
 * they finish, before anything else in the app. It cannot be dismissed: an
 * owner without it would be the one account nobody can recover by email.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { passwordProblem, PASSWORD_RULE } from "../../lib/password";

const FIELD = "w-full rounded-2xl border-0 bg-white/70 px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20";
const LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500";

/** True for an owner who has no way back in at all.
 *
 * This screen exists because the owner is who recovers everyone else, and an
 * owner locked out locks out the workspace. It is NOT about passwords.
 *
 * 2026-09-20 (Yokesh) — "let them log in by mobile itself, that's fine." Signup
 * asks for no password from anyone now: the confirmed mobile is the sign-in,
 * for the founder exactly as for every member. So an owner whose number is
 * confirmed is never stopped here, and neither is one who already has an email
 * and a password on another of their own companies (`credentials_elsewhere`,
 * answered by the server). What remains is the case this was written for: an
 * owner with no confirmed number AND no password — someone added or promoted
 * on the Team page — who has nothing to sign in with next time.
 *
 * Adding an email and a password stays available to any owner in Settings.
 */
export function needsOwnerCredentials(user) {
  if (!user || user.role !== "owner") return false;
  if (user.credentials_elsewhere) return false;
  const signsInByMobile = !!user.phone_verified_at;
  const signsInByPassword = !user.passwordless && !!user.email;
  return !signsInByMobile && !signsInByPassword;
}

export default function OwnerCredentialsGate() {
  const { user, refreshMe, logout } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!needsOwnerCredentials(user)) return null;

  const save = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid email"); return; }
    const problem = passwordProblem(pw);
    if (problem) { setError(problem); return; }
    if (pw !== confirm) { setError("Those two passwords don't match"); return; }
    setError(""); setBusy(true);
    try {
      await api.post("/auth/owner-credentials", { email: email.trim().toLowerCase(), password: pw });
      await refreshMe();
      toast.success("Done — you can sign in with your email and password too");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md gap-5 rounded-[1.75rem] border-0 bg-[hsl(226_24%_92%)] p-6 shadow-[0_30px_80px_-20px_hsl(226_30%_20%/0.5)] sm:rounded-[1.75rem] [&>button.absolute]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}
        data-testid="owner-credentials-gate">
        <div>
          <DialogTitle className="text-xl font-semibold text-slate-900">One more step as an owner</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">
            Members sign in with their mobile. Owners also have an email and a password — that's how an
            owner gets back in if a phone is lost, and how the team's access is recovered.
          </DialogDescription>
        </div>
        <form onSubmit={save} noValidate className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="oc-email">Email</label>
            <input id="oc-email" data-testid="owner-credentials-email" type="email" autoComplete="email"
              className={`${FIELD} mt-1`} placeholder="you@company.com"
              value={email} onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }} />
          </div>
          <div>
            <label className={LABEL} htmlFor="oc-pw">Password</label>
            <input id="oc-pw" data-testid="owner-credentials-password" type="password" autoComplete="new-password"
              className={`${FIELD} mt-1`} placeholder="8+ characters, a letter and a number"
              value={pw} onChange={(e) => { setPw(e.target.value); if (error) setError(""); }} />
            <p className="mt-1 text-xs text-slate-500">{PASSWORD_RULE}</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="oc-pw2">Again, to be sure</label>
            <input id="oc-pw2" data-testid="owner-credentials-confirm" type="password" autoComplete="new-password"
              className={`${FIELD} mt-1`}
              value={confirm} onChange={(e) => { setConfirm(e.target.value); if (error) setError(""); }} />
          </div>
          {error && <p className="text-sm font-semibold text-danger-600" data-testid="owner-credentials-error">{error}</p>}
          <button type="submit" disabled={busy} data-testid="owner-credentials-save"
            className="flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
        <button type="button" onClick={logout} data-testid="owner-credentials-signout"
          className="text-center text-xs font-semibold text-slate-600 underline underline-offset-2">
          Sign out and do this later
        </button>
      </DialogContent>
    </Dialog>
  );
}
