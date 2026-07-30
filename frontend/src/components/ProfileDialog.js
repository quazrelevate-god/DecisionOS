import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import api from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { UserCircle, FloppyDisk, Lock } from "@phosphor-icons/react";

const inp = "w-full border border-hairline rounded-lg px-3 py-2 text-sm mt-1 bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40";

export function ProfileForm({ onSaved }) {
  const { user, refreshMe } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
  }, [user]);

  const save = async () => {
    if (!name.trim()) { toast.error("Name can't be empty"); return; }
    setSaving(true);
    try {
      await api.patch("/auth/profile", { name: name.trim(), phone: phone.trim() });
      await refreshMe();
      toast.success("Profile updated");
      onSaved?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-label uppercase text-text-secondary">Full name</label>
        <input data-testid="profile-name-input" value={name} onChange={(e) => setName(e.target.value)}
          className={inp} placeholder="Your name" />
      </div>
      <div>
        <label className="text-label uppercase text-text-secondary">Mobile number</label>
        <input data-testid="profile-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)}
          className={inp} placeholder="+91 98765 43210" />
        <p className="text-label uppercase text-text-secondary mt-1">Used for OTP login and to route your WhatsApp messages to this workspace.</p>
      </div>
      <div>
        <label className="text-label uppercase text-text-secondary">Email</label>
        <input value={user?.email || ""} disabled data-testid="profile-email-input"
          className="w-full border border-hairline rounded-lg bg-muted px-3 py-2 text-sm mt-1 text-text-secondary" />
        <p className="text-label uppercase text-text-secondary mt-1">Email is your sign-in ID and can't be changed here.</p>
      </div>
      <button onClick={save} disabled={saving} data-testid="profile-save"
        className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold uppercase tracking-wider rounded-lg hover:bg-brand-red transition-colors disabled:opacity-50">
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
      <p className="text-xs text-text-secondary">
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
        <label className="text-label uppercase text-text-secondary">Current password</label>
        <input data-testid="password-current-input" type="password" value={current}
          onChange={(e) => setCurrent(e.target.value)} className={inp} placeholder="••••••••" autoComplete="current-password" />
      </div>
      <div>
        <label className="text-label uppercase text-text-secondary">New password</label>
        <input data-testid="password-new-input" type="password" value={next}
          onChange={(e) => setNext(e.target.value)} className={inp} placeholder="At least 6 characters" autoComplete="new-password" />
      </div>
      <div>
        <label className="text-label uppercase text-text-secondary">Confirm new password</label>
        <input data-testid="password-confirm-input" type="password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} className={inp} placeholder="Re-enter new password" autoComplete="new-password" />
      </div>
      <button onClick={submit} disabled={saving} data-testid="password-change-submit"
        className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold uppercase tracking-wider rounded-lg hover:bg-brand-red transition-colors disabled:opacity-50">
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
