/* Forgetting your password (2026-09-17).
 *
 * The backend has had both halves since FIX-003-D: POST /auth/password/forgot
 * issues a one-hour, single-outstanding token and emails
 * {APP_BASE_URL}/reset-password?token=…, and POST /auth/password/reset spends
 * it. Neither screen existed — the sign-in page had no link, and the link in
 * every reset email we have ever sent landed on a 404. Someone who forgot their
 * password and had no mobile number on file could not get back in at all.
 *
 * Two screens, one file, because they are two halves of one errand:
 *   /forgot-password   ask for the link
 *   /reset-password    spend it
 *
 * The request screen always answers the same way whether or not the address is
 * registered — that is the API's contract (no "does this email have an
 * account?" oracle), and the copy has to keep the promise rather than leak the
 * answer by being more helpful for a real address.
 */
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DeviceMobile, CheckCircle } from "@phosphor-icons/react";
import api, { formatApiError } from "../lib/api";
import Shell, { inputCls, labelCls, primaryCls } from "../components/auth/AuthShell";
import { passwordProblem } from "../lib/password";

/* ------------------------------------------------------------------ */
/* /forgot-password — ask for the link                                 */
/* ------------------------------------------------------------------ */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) { setError("That email doesn't look right"); return; }
    setError(""); setBusy(true);
    try {
      await api.post("/auth/password/forgot", { email: value });
      setSent(true);
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Couldn't send the link. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell testid="forgot-password-sent">
        <CheckCircle size={26} weight="fill" aria-hidden="true" className="mb-3 text-foreground/70" />
        <h1 className="font-display text-2xl">Check your email</h1>
        {/* The API answers identically for an address it knows and one it does
            not, on purpose. This sentence has to be true either way. */}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground" data-testid="forgot-password-sent-note">
          If an account exists for <strong className="text-foreground">{email.trim()}</strong>, a reset link is on
          its way. It works once, and for one hour.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Nothing arrived? Check spam, or{" "}
          <button type="button" onClick={() => setSent(false)} data-testid="forgot-password-again"
            className="font-semibold text-foreground underline underline-offset-2">try another address</button>.
        </p>
        <Link to="/login" className={`${primaryCls} mt-7`} data-testid="forgot-password-done">Back to sign in</Link>
      </Shell>
    );
  }

  return (
    <Shell testid="forgot-password">
      <h1 className="font-display text-2xl">Forgot your password?</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Tell us the email you sign in with and we'll send a link to set a new one.
      </p>
      {/* noValidate on purpose: the browser's own bubble would pre-empt the
          submit and say it in Chrome's words, in Chrome's place. Every other
          step of this app writes its own line under the field. */}
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div>
          <label className={labelCls} htmlFor="forgot-email">Email</label>
          <input id="forgot-email" data-testid="forgot-password-email" type="email" autoFocus
            className={`${inputCls} mt-1`} placeholder="you@company.com"
            value={email} onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }} />
        </div>
        {error && <p data-testid="forgot-password-error" className="text-sm font-semibold text-danger-600">{error}</p>}
        <button type="submit" disabled={busy} data-testid="forgot-password-submit" className={primaryCls}>
          {busy ? "Sending…" : "Send the link"}
        </button>
      </form>
      {/* A member who signs in by mobile has no password to reset — the API
          refuses those, so point them at the door that does open. */}
      <div className="kr-pressed mt-6 flex items-start gap-3 rounded-cardlg p-3" data-testid="forgot-password-otp-hint">
        <DeviceMobile size={17} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sign in with a code instead? If your workspace set you up with mobile OTP you have no password —{" "}
          <Link to="/login" className="font-semibold text-foreground underline underline-offset-2">
            use Mobile OTP on the sign-in page</Link>.
        </p>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* /reset-password?token=… — spend it                                  */
/* ------------------------------------------------------------------ */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dead, setDead] = useState(!token);   // no token, or the API refused it

  const submit = async (e) => {
    e.preventDefault();
    const problem = passwordProblem(pw);   // 8+, a letter and a number
    if (problem) { setError(problem); return; }
    if (pw !== confirm) { setError("Those two don't match"); return; }
    setError(""); setBusy(true);
    try {
      await api.post("/auth/password/reset", { token, new_password: pw });
      toast.success("Password changed — sign in with your new one");
      navigate("/login", { replace: true });
    } catch (err) {
      const detail = formatApiError(err.response?.data?.detail) || "Couldn't set that password. Try again.";
      setError(detail);
      // A link that is spent, expired, or for a mobile-only account cannot be
      // rescued by retyping: offer the way out instead of a form that will
      // keep failing.
      if (/invalid|expired|mobile OTP/i.test(detail)) setDead(true);
    } finally {
      setBusy(false);
    }
  };

  if (dead) {
    return (
      <Shell testid="reset-password-dead">
        <h1 className="font-display text-2xl">This link won't work</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground" data-testid="reset-password-dead-note">
          {error || (token
            ? "It may have been used already, or it expired — a reset link lasts an hour."
            : "The link is incomplete. Reset links only work in full, straight from the email.")}
        </p>
        <Link to="/forgot-password" className={`${primaryCls} mt-7`} data-testid="reset-password-new-link">
          Send me a new link
        </Link>
        <Link to="/login" className="mt-3 block text-center text-sm font-semibold text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell testid="reset-password">
      <h1 className="font-display text-2xl">Set a new password</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Pick something you'll remember. You'll sign in with it straight after.
      </p>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div>
          <label className={labelCls} htmlFor="reset-pw">New password</label>
          <input id="reset-pw" data-testid="reset-password-input" type="password" autoFocus
            autoComplete="new-password" className={`${inputCls} mt-1`} placeholder="8+ characters, a letter and a number"
            value={pw} onChange={(e) => { setPw(e.target.value); if (error) setError(""); }} />
        </div>
        <div>
          <label className={labelCls} htmlFor="reset-pw2">Again, to be sure</label>
          <input id="reset-pw2" data-testid="reset-password-confirm" type="password"
            autoComplete="new-password" className={`${inputCls} mt-1`} placeholder="Re-enter it"
            value={confirm} onChange={(e) => { setConfirm(e.target.value); if (error) setError(""); }} />
        </div>
        {error && <p data-testid="reset-password-error" className="text-sm font-semibold text-danger-600">{error}</p>}
        <button type="submit" disabled={busy} data-testid="reset-password-submit" className={primaryCls}>
          {busy ? "Saving…" : "Save and sign in"}
        </button>
      </form>
    </Shell>
  );
}
