/* Confirming your email (2026-09-17) — U7-24.10.
 *
 * The other half of the forgot-password find. Registration has emailed
 * {APP_BASE_URL}/verify-email?token=… since FIX-003-D and App.js had no such
 * route, so the link in every welcome email this product has ever sent landed
 * on a 404. The endpoint behind it is GET /auth/email/verify/{token} — built,
 * single-use, three days — so this page reads the query parameter the email
 * carries and spends it there.
 *
 * Nobody is signed in when they click a link in their inbox, necessarily, and
 * plenty of people are. Both have to end somewhere sensible: signed in, the way
 * home; signed out, the sign-in door.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle, Envelope } from "@phosphor-icons/react";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import Shell, { primaryCls } from "../components/auth/AuthShell";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { user, loading, refreshMe } = useAuth();
  const [state, setState] = useState(token ? "working" : "dead");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  /* The token is single-use, and StrictMode runs an effect twice in
     development. Without this guard the first run spends the link and the
     second reports it invalid — a perfectly good link, condemned by our own
     dev server. */
  const spent = useRef(false);

  useEffect(() => {
    if (!token || spent.current) return;
    spent.current = true;
    (async () => {
      try {
        const { data } = await api.get(`/auth/email/verify/${encodeURIComponent(token)}`);
        setEmail(data?.email || "");
        setState("done");
        // The account this page is about may be the one watching it: pick up
        // the new email_verified_at so Settings stops asking.
        refreshMe?.().catch(() => {});
      } catch (err) {
        // Only the API's own words, if it gave any: formatApiError invents a
        // generic line for a null detail, and this screen has a better one.
        const detail = err.response?.data?.detail;
        setError(detail ? formatApiError(detail) : "");
        setState("dead");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* Asking for another one needs the account, because the endpoint sends to
     the address on file rather than to whatever someone types — an unauthenticated
     "send a link to this address" would be a way to spray mail from us. */
  const resend = async () => {
    setBusy(true);
    try {
      await api.post("/auth/email/send-verification");
      setResent(true);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail ? formatApiError(detail) : "Couldn't send another link. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const home = user ? { to: "/app", label: "Back to DecisionOS" } : undefined;

  /* Wait for /auth/me before deciding anything the answer changes. The dead
     card's heading turns on whether this account's email is already confirmed,
     and rendering it a beat early flashed "This link won't work" at someone
     whose email was fine. */
  if (state === "working" || loading) {
    return (
      <Shell testid="verify-email-working" back={home}>
        <h1 className="font-display text-2xl">Confirming your email…</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">One moment.</p>
      </Shell>
    );
  }

  if (state === "done") {
    return (
      <Shell testid="verify-email-done" back={home}>
        <CheckCircle size={26} weight="fill" aria-hidden="true" className="mb-3 text-foreground/70" />
        <h1 className="font-display text-2xl">Email confirmed</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground" data-testid="verify-email-done-note">
          {email ? <><strong className="text-foreground">{email}</strong> is confirmed.</> : "Your email is confirmed."}{" "}
          That's the address we'll use to reach you, and the one you sign in with.
        </p>
        {!loading && (
          user
            ? <Link to="/app" className={`${primaryCls} mt-7`} data-testid="verify-email-continue">Back to DecisionOS</Link>
            : <Link to="/login" className={`${primaryCls} mt-7`} data-testid="verify-email-continue">Sign in</Link>
        )}
      </Shell>
    );
  }

  /* Dead: no token, a link already spent, or one older than three days. None of
     those is fixable by clicking again, so offer the thing that does work. */
  const alreadyDone = !!user?.email_verified_at;
  return (
    <Shell testid="verify-email-dead" back={home}>
      <h1 className="font-display text-2xl">
        {alreadyDone ? "Already confirmed" : "This link won't work"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground" data-testid="verify-email-dead-note">
        {alreadyDone
          ? "This email is confirmed already — the link was probably used once before."
          : (error || (token
            ? "It may have been used already, or it expired — a confirmation link lasts three days."
            : "The link is incomplete. Confirmation links only work in full, straight from the email."))}
      </p>
      {alreadyDone ? (
        <Link to="/app" className={`${primaryCls} mt-7`} data-testid="verify-email-continue">Back to DecisionOS</Link>
      ) : !loading && user ? (
        resent ? (
          <div className="kr-pressed mt-6 flex items-start gap-3 rounded-cardlg p-3" data-testid="verify-email-resent">
            <Envelope size={17} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              A new link is on its way to <strong className="text-foreground">{user.email}</strong>. It lasts three days.
            </p>
          </div>
        ) : (
          <button type="button" onClick={resend} disabled={busy} data-testid="verify-email-resend"
            className={`${primaryCls} mt-7`}>
            {busy ? "Sending…" : "Send me a new link"}
          </button>
        )
      ) : !loading && (
        /* Signed out, we cannot send anything: the endpoint emails the address
           on the account, and we will not take one on trust from a page. */
        <div className="kr-pressed mt-6 flex items-start gap-3 rounded-cardlg p-3" data-testid="verify-email-signin-first">
          <Envelope size={17} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sign in and you can send yourself a fresh link from{" "}
            <strong className="text-foreground">Settings &rsaquo; Your Profile</strong>.
          </p>
        </div>
      )}
      <Link to={user ? "/app" : "/login"}
        className="mt-3 block text-center text-sm font-semibold text-foreground underline underline-offset-2">
        {user ? "Back to DecisionOS" : "Back to sign in"}
      </Link>
    </Shell>
  );
}
