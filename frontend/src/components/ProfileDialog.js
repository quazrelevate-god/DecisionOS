import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import api from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { UserCircle, FloppyDisk } from "@phosphor-icons/react";

export function ProfileDialog({ open, onClose }) {
  const { user, refreshMe } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user?.name || "");
      setPhone(user?.phone || "");
    }
  }, [open, user]);

  const save = async () => {
    if (!name.trim()) { toast.error("Name can't be empty"); return; }
    setSaving(true);
    try {
      await api.patch("/auth/profile", { name: name.trim(), phone: phone.trim() });
      await refreshMe();
      toast.success("Profile updated");
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border border-black" data-testid="profile-dialog">
        <DialogHeader>
          <DialogTitle className="text-left flex items-center gap-2"><UserCircle size={22} weight="bold" /> Edit profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="label-mono text-muted-foreground">Full name</label>
            <input data-testid="profile-name-input" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-black px-3 py-2 text-sm mt-1 focus:outline-none" placeholder="Your name" />
          </div>
          <div>
            <label className="label-mono text-muted-foreground">Mobile number</label>
            <input data-testid="profile-phone-input" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-black px-3 py-2 text-sm mt-1 focus:outline-none" placeholder="+91 98765 43210" />
            <p className="label-mono text-muted-foreground mt-1">Used for OTP login and to route your WhatsApp messages to this workspace.</p>
          </div>
          <div>
            <label className="label-mono text-muted-foreground">Email</label>
            <input value={user?.email || ""} disabled data-testid="profile-email-input"
              className="w-full border border-black/30 bg-black/5 px-3 py-2 text-sm mt-1 text-muted-foreground" />
            <p className="label-mono text-muted-foreground mt-1">Email is your sign-in ID and can't be changed here.</p>
          </div>
          <button onClick={save} disabled={saving} data-testid="profile-save"
            className="w-full flex items-center justify-center gap-2 bg-brand-ink text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-red transition-colors disabled:opacity-50">
            <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
