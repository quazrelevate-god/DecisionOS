import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import api from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { UserCircle, FloppyDisk, Lock } from "@phosphor-icons/react";

const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm mt-1 bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";

export function ProfileForm({ onSaved }) {
  const { user, refreshMe } = useAuth();
  const [form, setForm] = useState({ name: "", title: "", about: "", phone: "", email: "" });
  const [confirmWith, setConfirmWith] = useState("");   // password, or the texted code
  const [codeSent, setCodeSent] = useState(false);
  const [saving, setSaving] = useState(false);
  // 2026-09-16 — your own details are yours to keep current: name, job title,
  // what you handle, mobile, email. Role, access and reporting line are NOT
  // here: those are a manager's call about you, on the Team page.
  const passwordless = !!user?.passwordless;
  const emailChanged = form.email.trim().toLowerCase() !== (user?.email || "").toLowerCase();

  // Fill the form from the account ONCE (and again only if a different person
  // signs in). The auth context hands back a new `user` object on every refresh
  // — including the one right after saving — and re-filling on each of those
  // wiped whatever was half-typed at that moment.
  const filledFor = useRef(null);
  useEffect(() => {
    if (!user?.id || filledFor.current === user.id) return;
    filledFor.current = user.id;
    setForm({
      name: user.name || "", title: user.title || "", about: user.about || "",
      phone: user.phone || "", email: user.email || "",
    });
  }, [user]);

  const sendCode = async () => {
    try {
      const { data } = await api.post("/auth/otp/request", { phone: form.phone.trim() || user?.phone });
      setCodeSent(true);
      if (data.dev_otp) { setConfirmWith(data.dev_otp); toast.info(`Dev OTP: ${data.dev_otp}`); }
      else toast.success("We texted a code to your mobile");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send the code");
    }
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name can't be empty"); return; }
    if (emailChanged && !confirmWith.trim()) {
      toast.error(passwordless ? "Enter the code we texted you" : "Enter your current password to change your email");
      return;
    }
    setSaving(true);
    try {
      await api.patch("/auth/profile", {
        name: form.name.trim(), title: form.title.trim(), about: form.about.trim(), phone: form.phone.trim(),
        ...(emailChanged ? {
          email: form.email.trim().toLowerCase(),
          ...(passwordless ? { otp_code: confirmWith.trim() } : { current_password: confirmWith }),
        } : {}),
      });
      await refreshMe();
      setConfirmWith(""); setCodeSent(false);
      toast.success(emailChanged ? "Saved — check your new address for the link that confirms it" : "Profile updated");
      onSaved?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <div>
        <label className="label-mono text-muted-foreground" htmlFor="profile-name">Full name</label>
        <input id="profile-name" data-testid="profile-name-input" value={form.name} onChange={set("name")}
          className={inp} placeholder="Your name" maxLength={80} />
      </div>
      <div>
        <label className="label-mono text-muted-foreground" htmlFor="profile-title">Job title</label>
        <input id="profile-title" data-testid="profile-title-input" value={form.title} onChange={set("title")}
          className={inp} placeholder="e.g. Sales Lead" maxLength={80} />
        <p className="label-mono text-muted-foreground mt-1">The line under your name on the Team page.</p>
      </div>
      <div>
        <label className="label-mono text-muted-foreground" htmlFor="profile-about">What you handle</label>
        <textarea id="profile-about" data-testid="profile-about-input" value={form.about} onChange={set("about")}
          rows={2} maxLength={280} className={inp} placeholder="e.g. South India dealers, and every quote over ₹2 lakh" />
        <p className="label-mono text-muted-foreground mt-1">One line, so the team knows what to bring you. {280 - form.about.length} left.</p>
      </div>
      <div>
        <label className="label-mono text-muted-foreground" htmlFor="profile-phone">Mobile number</label>
        <input id="profile-phone" data-testid="profile-phone-input" value={form.phone} onChange={set("phone")}
          className={inp} placeholder="+91 98765 43210" />
        <p className="label-mono text-muted-foreground mt-1">Used for OTP login and to route your WhatsApp messages to this workspace.</p>
      </div>
      <div>
        <label className="label-mono text-muted-foreground" htmlFor="profile-email">Email</label>
        <input id="profile-email" data-testid="profile-email-input" type="email" value={form.email} onChange={set("email")}
          className={inp} placeholder="name@company.com" />
        <p className="label-mono text-muted-foreground mt-1">
          Your sign-in ID. Change it and we'll email the new address a link to confirm it.
        </p>
      </div>
      {/* The email is the sign-in, so prove it is you at the keyboard — the same
          question the sign-in door asks: your password, or a code to your mobile
          when that is how you sign in. */}
      {emailChanged && (
        <div data-testid="profile-email-confirm">
          <label className="label-mono text-muted-foreground" htmlFor="profile-confirm">
            {passwordless ? "Code texted to your mobile" : "Your current password"}
          </label>
          <div className="flex gap-2">
            <input id="profile-confirm" data-testid="profile-confirm-input"
              type={passwordless ? "text" : "password"} inputMode={passwordless ? "numeric" : undefined}
              value={confirmWith} onChange={(e) => setConfirmWith(e.target.value)}
              className={inp} placeholder={passwordless ? "6-digit code" : "••••••••"}
              autoComplete={passwordless ? "one-time-code" : "current-password"} />
            {passwordless && (
              <button type="button" onClick={sendCode} data-testid="profile-send-code"
                className="mt-1 shrink-0 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
                {codeSent ? "Resend" : "Send code"}
              </button>
            )}
          </div>
        </div>
      )}
      <button onClick={save} disabled={saving} data-testid="profile-save"
        className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50">
        <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

export function ChangePasswordForm() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  if (user?.passwordless) {
    return (
      <p className="text-xs text-muted-foreground">
        Your account signs in with mobile OTP, so there's no password to change here.
      </p>
    );
  }

  const submit = async () => {
    if (!current) { toast.error("Enter your current password"); return; }
    if (next.length < 6) { toast.error("New password must be at least 6 characters"); return; }
    if (next !== confirm) { toast.error("New passwords don't match"); return; }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.success("Password changed");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label-mono text-muted-foreground">Current password</label>
        <input data-testid="password-current-input" type="password" value={current}
          onChange={(e) => setCurrent(e.target.value)} className={inp} placeholder="••••••••" autoComplete="current-password" />
      </div>
      <div>
        <label className="label-mono text-muted-foreground">New password</label>
        <input data-testid="password-new-input" type="password" value={next}
          onChange={(e) => setNext(e.target.value)} className={inp} placeholder="At least 6 characters" autoComplete="new-password" />
      </div>
      <div>
        <label className="label-mono text-muted-foreground">Confirm new password</label>
        <input data-testid="password-confirm-input" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} className={inp} placeholder="Re-enter new password" autoComplete="new-password" />
      </div>
      <button onClick={submit} disabled={saving} data-testid="password-change-submit"
        className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50">
        <Lock size={16} weight="bold" /> {saving ? "Updating…" : "Update password"}
      </button>
    </div>
  );
}

export function ProfileDialog({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="profile-dialog">
        <DialogHeader>
          <DialogTitle className="text-left flex items-center gap-2"><UserCircle size={22} weight="bold" /> Edit profile</DialogTitle>
        </DialogHeader>
        <div className="mt-2"><ProfileForm onSaved={onClose} /></div>
      </DialogContent>
    </Dialog>
  );
}
