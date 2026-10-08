/* PLAY-1 (2026-09-29) · The public account-deletion page.
 *
 * Google Play requires TWO routes to deletion: one inside the app (Settings →
 * Account → Delete your account) and one on the WEB, reachable by somebody who
 * has uninstalled the app or never installed it. This is the second. Its URL
 * goes in the Play Console listing, so it must keep working and must keep this
 * path.
 *
 * It is deliberately a PUBLIC route. A person who has deleted the app still
 * has an account, and telling them "sign in first" at a URL that 404s for the
 * signed-out is how this requirement gets failed while looking implemented.
 * Signed out, it explains and offers the way in; signed in, it does the thing.
 *
 * It says what deletion MEANS before asking anything, because the answer
 * differs per workspace and the wrong assumption here is unrecoverable.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function DeleteAccount() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  /* Owned workspaces with other people in them that the owner chose to delete
     too (Play audit C3: there must be a way through, not just a refusal). */
  const [alsoDelete, setAlsoDelete] = useState([]);
  const toggleAlso = (id) => setAlsoDelete((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api.get("/account/deletion")
      .then(({ data }) => { if (alive) setPlan(data); })
      .catch(() => { if (alive) setPlan({ error: true }); });
    return () => { alive = false; };
  }, [user]);

  const phrase = plan?.confirm_phrase || "DELETE";
  const blocked = (plan?.blocked || []).some((w) => !alsoDelete.includes(w.tenant_id));

  const doIt = async () => {
    setBusy(true);
    try {
      await api.post("/account/delete", { confirm: typed.trim(), delete_workspaces: alsoDelete });
      try { await logout(); } catch (e) { /* the session is already gone */ }
      toast.success("Your account is gone.");
      navigate("/login", { replace: true });
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "object" && d?.message ? d.message
        : formatApiError(d) || "Couldn't delete the account.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh/var(--ui-scale,1))] w-full max-w-xl flex-col justify-center px-6 py-12"
      data-testid="delete-account-page">
      <h1 className="font-display text-3xl text-foreground">Delete your DecisionOS account</h1>

      <div className="mt-5 space-y-3 text-sm text-muted-foreground">
        <p>
          This removes you from DecisionOS for good and frees your mobile number
          so it can be used again. It cannot be undone.
        </p>
        <p>
          What happens to a workspace depends on your place in it. If you are
          the only person in one, the whole workspace goes — every record and
          every uploaded file. If other people work there, you leave and the
          work you did stays in the company&rsquo;s history, because a company
          that loses its records when somebody leaves is worse off than one
          carrying a note that they were there.
        </p>
        <p>
          If you <strong className="text-foreground">own</strong> a workspace
          that other people are in, we will not leave it without an owner. You
          can choose to delete that workspace too &mdash; everyone in it loses
          access &mdash; or remove them from it first.
        </p>
        <p>
          Payment records for a paid plan are kept for as long as tax law
          requires; everything else about you goes.{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</a>.
        </p>
      </div>

      {loading && <p className="mt-8 text-sm text-muted-foreground">Checking&hellip;</p>}

      {!loading && !user && (
        <div className="mt-8">
          <p className="text-sm text-muted-foreground">
            Sign in with the mobile number on the account, and you will come
            back here.
          </p>
          <button type="button" data-testid="delete-account-signin"
            onClick={() => navigate(`/login?next=${encodeURIComponent("/delete-account")}`)}
            className="kr-pop mt-4 flex h-11 items-center rounded-pill px-6 text-sm font-medium text-foreground">
            Sign in to continue
          </button>
          <p className="mt-6 text-xs text-muted-foreground">
            Can&rsquo;t sign in? Write to support from the number on the account
            and we will do it for you.
          </p>
        </div>
      )}

      {!loading && user && plan?.error && (
        <p className="mt-8 text-sm text-muted-foreground">
          We couldn&rsquo;t check your account just now. Try again in a moment.
        </p>
      )}

      {!loading && user && plan && !plan.error && (
        <div className="mt-8" data-testid="delete-account-plan">
          <h2 className="text-sm font-semibold text-foreground">What will happen</h2>
          <ul className="mt-3 space-y-3">
            {(plan.workspaces || []).map((w) => (
              <li key={w.tenant_id} className="text-sm">
                <span className="font-medium text-foreground">{w.tenant_name || "Your workspace"}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {w.outcome === "workspace_deleted"
                    && "You're the only one here, so the whole workspace and everything in it is deleted."}
                  {w.outcome === "you_leave"
                    && "You leave and your account here goes. The work you did stays in the company's history."}
                  {w.outcome === "blocked" && w.reason}
                </p>
                {w.outcome === "blocked" && w.can_delete_workspace && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-foreground">
                    <input type="checkbox" className="mt-0.5"
                      data-testid={`delete-account-also-${w.tenant_id}`}
                      checked={alsoDelete.includes(w.tenant_id)} onChange={() => toggleAlso(w.tenant_id)} />
                    <span>Delete {w.tenant_name || "this workspace"} too — every record and file, and {w.other_people} {w.other_people === 1 ? "person loses" : "people lose"} access.</span>
                  </label>
                )}
              </li>
            ))}
          </ul>

          {!blocked && (
            <>
              <label htmlFor="confirm" className="mt-6 block text-xs text-muted-foreground">
                Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to confirm.
              </label>
              <input id="confirm" value={typed} onChange={(e) => setTyped(e.target.value)}
                data-testid="delete-account-confirm" autoComplete="off" autoCapitalize="characters"
                className="mt-2 w-full rounded-2xl bg-white/80 px-4 py-2.5 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
                placeholder={phrase} />
              <button type="button" onClick={doIt} disabled={busy || typed.trim() !== phrase}
                data-testid="delete-account-confirm-button"
                className="mt-4 flex h-11 w-full items-center justify-center rounded-pill bg-kr-accent px-6 text-sm font-medium text-white disabled:opacity-40">
                {busy ? "Deleting…" : "Delete my account for good"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
