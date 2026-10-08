/* Agreeing to the Terms of Service, for everyone who has not (2026-10-08).
 *
 * Play audit C2: Google Play's User Generated Content policy requires people
 * to accept the terms before they create content others see. A founder agrees
 * at signup; a member arrives by invite and never sees signup, and everyone
 * who joined before the terms existed has agreed to nothing. So this asks,
 * once per person per TERMS_VERSION, in front of everything else in the app.
 * It cannot be dismissed — the only other way out is signing out.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { TERMS_VERSION, termsAccepted } from "../lib/legal";

export default function TermsGate() {
  const { user, refreshMe, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (!user || termsAccepted(user)) return null;

  /* 2026-10-08 — Sign out here ended the session and stayed put: the page
     under this screen went blank and nothing on it could be clicked until a
     reload. Every other Sign out in the app goes to the sign-in page. */
  const signOut = async () => { await logout(); navigate("/login", { replace: true }); };

  const agree = async () => {
    setBusy(true);
    try {
      await api.post("/account/terms", { version: TERMS_VERSION });
      await refreshMe();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md gap-5 rounded-[1.75rem] border-0 bg-[hsl(226_24%_92%)] p-6 shadow-[0_30px_80px_-20px_hsl(226_30%_20%/0.5)] sm:rounded-[1.75rem] [&>button.absolute]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}
        data-testid="terms-gate">
        <div>
          <DialogTitle className="text-xl font-semibold text-slate-900">Before you carry on</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">
            Your team sees what you post here, so we all keep to the same rules: no harassment, hate,
            sexual or violent content, illegal activity, or other people&rsquo;s private data shared
            without a right to. Anything that breaks them can be reported from inside the app, and we act on reports.
          </DialogDescription>
        </div>
        <p className="text-sm text-slate-600">
          Read the{" "}
          <Link to="/terms" className="font-medium text-slate-900 underline underline-offset-2">Terms of Service</Link>
          {" "}and the{" "}
          <Link to="/privacy" className="font-medium text-slate-900 underline underline-offset-2">Privacy Policy</Link>.
        </p>
        <button type="button" onClick={agree} disabled={busy} data-testid="terms-gate-agree"
          className="flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : "I agree"}
        </button>
        <button type="button" onClick={signOut} data-testid="terms-gate-signout"
          className="text-center text-xs font-semibold text-slate-600 underline underline-offset-2">
          Sign out
        </button>
      </DialogContent>
    </Dialog>
  );
}
