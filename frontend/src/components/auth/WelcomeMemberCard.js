/* A member's first screen: welcome, and check your details (2026-09-19).
 *
 * A manager added them on Team — name, department, mobile — and sent the
 * invite link. Opening it and reading back the texted code is their whole
 * sign-in, and it just proved the mobile is theirs. What the manager typed
 * may still be wrong or thin, so this asks them once to check their name and
 * say what they do. It can be put off: nothing here is needed to work, and
 * Settings › Your Profile holds the same fields any time.
 *
 * Shown while the server says `welcome_pending` (set when the invite is
 * accepted); Save or Later clears it on every device.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { needsOwnerCredentials } from "./OwnerCredentialsGate";

const FIELD = "w-full rounded-2xl border-0 bg-white/70 px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20";
const LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500";

export default function WelcomeMemberCard() {
  const { user, tenant, refreshMe } = useAuth();
  const [form, setForm] = useState({ name: "", title: "", about: "", email: "" });
  const [busy, setBusy] = useState(false);
  const show = !!user?.welcome_pending && !needsOwnerCredentials(user);

  useEffect(() => {
    if (!show) return;
    setForm({ name: user.name || "", title: user.title || "", about: user.about || "", email: user.email || "" });
    // Filled once when it opens; later refreshes must not wipe what they typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;
  const first = (user.name || "").trim().split(/\s+/)[0];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const done = async () => {
    await api.post("/auth/welcome/done");
    await refreshMe();
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Your name can't be empty"); return; }
    const email = form.email.trim().toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { toast.error("That email doesn't look right — or leave it empty"); return; }
    setBusy(true);
    try {
      // One request: the server clears the card with the save.
      await api.patch("/auth/profile", {
        name: form.name.trim(), title: form.title.trim(), about: form.about.trim(),
        ...(email && email !== (user.email || "").toLowerCase() ? { email } : {}),
      });
      await refreshMe();
      toast.success("Saved — you're all set");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Couldn't save that");
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    setBusy(true);
    try { await done(); } catch { /* it will ask again next time; nothing lost */ } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) later(); }}>
      <DialogContent
        className="max-w-md gap-5 rounded-[1.75rem] border-0 bg-[hsl(226_24%_92%)] p-6 shadow-[0_30px_80px_-20px_hsl(226_30%_20%/0.5)] sm:rounded-[1.75rem] [&>button.absolute]:hidden"
        data-testid="welcome-member-card">
        <div>
          <DialogTitle className="text-xl font-semibold text-slate-900">
            Welcome to {tenant?.name || "the team"}{first ? `, ${first}` : ""}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">
            Check the details your team added, and say what you look after — it's what they'll see on the Team page.
          </DialogDescription>
        </div>
        <p className="flex items-start gap-2 rounded-2xl bg-white/60 p-3 text-sm text-slate-700" data-testid="welcome-mobile-confirmed">
          <CheckCircle size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-success-600" />
          <span>
            <strong className="text-slate-900">{user.phone}</strong> is confirmed. It's how you sign in —
            we text a code each time, no password needed.
          </span>
        </p>
        <div className="space-y-3">
          <div>
            <label className={LABEL} htmlFor="wm-name">Your name</label>
            <input id="wm-name" data-testid="welcome-name" className={`${FIELD} mt-1`} value={form.name} onChange={set("name")} maxLength={80} />
          </div>
          <div>
            <label className={LABEL} htmlFor="wm-title">Job title</label>
            <input id="wm-title" data-testid="welcome-title" className={`${FIELD} mt-1`} placeholder="e.g. Sales Lead"
              value={form.title} onChange={set("title")} maxLength={80} />
          </div>
          <div>
            <label className={LABEL} htmlFor="wm-about">What you handle</label>
            <input id="wm-about" data-testid="welcome-about" className={`${FIELD} mt-1`}
              placeholder="e.g. South India dealers, and every quote over ₹2 lakh"
              value={form.about} onChange={set("about")} maxLength={280} />
          </div>
          <div>
            <label className={LABEL} htmlFor="wm-email">Email (optional)</label>
            <input id="wm-email" data-testid="welcome-email" type="email" className={`${FIELD} mt-1`} placeholder="name@company.com"
              value={form.email} onChange={set("email")} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy} data-testid="welcome-save"
            className="flex h-12 flex-1 items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={later} disabled={busy} data-testid="welcome-later"
            className="h-12 px-4 text-sm font-semibold text-slate-600 underline underline-offset-2 disabled:opacity-50">
            Later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
