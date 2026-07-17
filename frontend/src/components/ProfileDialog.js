import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import api from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { UserCircle, FloppyDisk } from "@phosphor-icons/react";

const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm mt-1 bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";

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
        <label className="label-mono text-muted-foreground">Full name</label>
        <input data-testid="profile-name-input" value={name} onChange={(e) => setName(e.target.value)}
          className={inp} placeholder="Your name" />
      </div>
      <div>
        <label className="label-mono text-muted-foreground">Mobile number</label>
        <input data-testid="profile-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)}
          className={inp} placeholder="+91 98765 43210" />
        <p className="label-mono text-muted-foreground mt-1">Used for OTP login and to route your WhatsApp messages to this workspace.</p>
      </div>
      <div>
        <label className="label-mono text-muted-foreground">Email</label>
        <input value={user?.email || ""} disabled data-testid="profile-email-input"
          className="w-full border border-border rounded-lg bg-muted px-3 py-2 text-sm mt-1 text-muted-foreground" />
        <p className="label-mono text-muted-foreground mt-1">Email is your sign-in ID and can't be changed here.</p>
      </div>
      <button onClick={save} disabled={saving} data-testid="profile-save"
        className="flex items-center justify-center gap-2 bg-brand-ink text-white px-5 py-2.5 text-sm font-semibold uppercase tracking-wider rounded-lg hover:bg-brand-red transition-colors disabled:opacity-50">
        <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save changes"}
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
