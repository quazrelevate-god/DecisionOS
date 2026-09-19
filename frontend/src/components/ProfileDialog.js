import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { normIndianMobile, displayIndianMobile } from "../lib/phone";
import OtpBoxes from "./auth/OtpBoxes";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { UserCircle, FloppyDisk, Lock, CheckCircle, Envelope } from "@phosphor-icons/react";

const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm mt-1 bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";

export function ProfileForm({ onSaved }) {
  const { user, refreshMe } = useAuth();
  const [form, setForm] = useState({ name: "", title: "", about: "", phone: "", email: "" });
  const [confirmWith, setConfirmWith] = useState("");   // password, or the texted code
  const [codeSent, setCodeSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifySent, setVerifySent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // 2026-09-19 (U7-24.14) — a new mobile is saved only with the code texted to
  // it. phoneCodeFor is the number that code went to; if they then type a
  // different one, it is a different number and needs its own code.
  const [phoneCodeFor, setPhoneCodeFor] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneResendIn, setPhoneResendIn] = useState(0);
  const [sendingPhone, setSendingPhone] = useState(false);
  // 2026-09-16 — your own details are yours to keep current: name, job title,
  // what you handle, mobile, email. Role, access and reporting line are NOT
  // here: those are a manager's call about you, on the Team page.
  const passwordless = !!user?.passwordless;
  const emailChanged = form.email.trim().toLowerCase() !== (user?.email || "").toLowerCase();
  // The whole form comes back on every save; the same number written another
  // way ("+91 98200 10003" for "9820010003") is not a change, so compare the
  // last ten digits — the key sign-in and WhatsApp use.
  const last10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);
  const storedPhone = user?.phone_norm || last10(user?.phone);
  const typedPhone = form.phone.trim();
  const phoneRemoved = !typedPhone && !!storedPhone;
  const phoneChanged = !!typedPhone && last10(typedPhone) !== storedPhone;
  const newPhone = phoneChanged ? normIndianMobile(typedPhone) : "";
  const phoneCodeReady = !!newPhone && phoneCodeFor === newPhone && phoneCode.length === 6;

  useEffect(() => {
    if (phoneResendIn <= 0) return;
    const t = setTimeout(() => setPhoneResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phoneResendIn]);

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
      const { data } = await api.post("/auth/otp/request", { phone: user?.phone });
      setCodeSent(true);
      if (data.dev_otp) { setConfirmWith(data.dev_otp); toast.info(`Dev OTP: ${data.dev_otp}`); }
      else toast.success("We texted a code to your mobile");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send the code");
    }
  };

  /* 2026-09-17 (U7-24.10) — POST /auth/email/send-verification shipped with
     FIX-003-D and had no caller anywhere, and nothing in the app read
     email_verified_at, so someone whose welcome email was lost was never told
     the address was unconfirmed and had no way to ask for another link. */
  const sendVerification = async () => {
    setVerifying(true);
    try {
      const { data } = await api.post("/auth/email/send-verification");
      if (data?.already_verified) { await refreshMe(); toast.success("That address is already confirmed"); }
      else { setVerifySent(true); toast.success("Link sent — check your inbox"); }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send the link");
    } finally {
      setVerifying(false);
    }
  };

  const sendPhoneCode = async () => {
    if (!newPhone || sendingPhone) return;
    setSendingPhone(true);
    try {
      const { data } = await api.post("/auth/phone/send-code", { phone: newPhone });
      setPhoneCodeFor(newPhone);
      setPhoneCode(data.dev_otp || "");
      setPhoneResendIn(30);
      if (data.dev_otp) toast.info(`Dev OTP: ${data.dev_otp} (auto-filled)`);
      else toast.success(`We texted a code to ${displayIndianMobile(newPhone)}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not send the code");
    } finally {
      setSendingPhone(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name can't be empty"); return; }
    if (phoneChanged && !newPhone) { toast.error("Enter a 10-digit Indian mobile number"); return; }
    if (phoneChanged && !phoneCodeReady) {
      toast.error(phoneCodeFor === newPhone
        ? "Enter the code we texted to your new number"
        : "Text a code to your new number first, then save");
      return;
    }
    if (phoneRemoved && passwordless) {
      toast.error("You sign in with this number, so it can be changed but not removed.");
      return;
    }
    if (emailChanged && !confirmWith.trim()) {
      toast.error(passwordless ? "Enter the code we texted you" : "Enter your current password to change your email");
      return;
    }
    setSaving(true);
    try {
      await api.patch("/auth/profile", {
        name: form.name.trim(), title: form.title.trim(), about: form.about.trim(), phone: form.phone.trim(),
        ...(phoneChanged ? { phone_code: phoneCode } : {}),
        ...(emailChanged ? {
          email: form.email.trim().toLowerCase(),
          ...(passwordless ? { otp_code: confirmWith.trim() } : { current_password: confirmWith }),
        } : {}),
      });
      await refreshMe();
      setConfirmWith(""); setCodeSent(false);
      if (phoneChanged) setForm((f) => ({ ...f, phone: displayIndianMobile(newPhone) }));
      setPhoneCodeFor(""); setPhoneCode(""); setPhoneResendIn(0);
      toast.success(emailChanged ? "Saved — check your new address for the link that confirms it" : "Profile updated");
      onSaved?.();
    } catch (e) {
      // formatApiError: the phone refusals carry {code, message}, and handing
      // an object to a toast prints nothing useful.
      toast.error(formatApiError(e.response?.data?.detail) || "Could not update profile");
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
        {phoneChanged && !newPhone && (
          <p className="label-mono mt-2 text-danger-600" data-testid="profile-phone-invalid">
            Enter a 10-digit Indian mobile number
          </p>
        )}
        {newPhone && (
          <div className="mt-3 space-y-3 rounded-lg border border-border p-3" data-testid="profile-phone-confirm">
            <p className="text-xs text-muted-foreground">
              A new number signs you in, so we check it&apos;s yours: we&apos;ll text a code to{" "}
              <strong className="text-foreground">{displayIndianMobile(newPhone)}</strong>. Your old number keeps
              working until you save.
            </p>
            {phoneCodeFor === newPhone ? (
              <>
                <div className="max-w-xs">
                  <OtpBoxes value={phoneCode} onChange={setPhoneCode} disabled={saving} testid="profile-phone-code-boxes" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter it, then Save changes.{" "}
                  {phoneResendIn > 0 ? (
                    <span data-testid="profile-phone-resend-wait">Text it again in {phoneResendIn}s</span>
                  ) : (
                    <button type="button" onClick={sendPhoneCode} disabled={sendingPhone} data-testid="profile-phone-resend"
                      className="font-semibold text-foreground underline underline-offset-2 disabled:opacity-50">
                      Text it again
                    </button>
                  )}
                </p>
              </>
            ) : (
              <button type="button" onClick={sendPhoneCode} disabled={sendingPhone} data-testid="profile-phone-send-code"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50">
                {sendingPhone ? "Sending…" : `Text a code to ${displayIndianMobile(newPhone)}`}
              </button>
            )}
          </div>
        )}
      </div>
      <div>
        <label className="label-mono text-muted-foreground" htmlFor="profile-email">Email</label>
        <input id="profile-email" data-testid="profile-email-input" type="email" value={form.email} onChange={set("email")}
          className={inp} placeholder="name@company.com" />
        <p className="label-mono text-muted-foreground mt-1">
          Your sign-in ID. Change it and we'll email the new address a link to confirm it.
        </p>
        {/* Whether the address on file is confirmed, and the way to fix it if
            not. Hidden while the field is mid-edit: this is about the saved
            address, not the one being typed. */}
        {!emailChanged && (user?.email_verified_at ? (
          <p className="label-mono mt-2 flex items-center gap-1.5 text-success-600" data-testid="profile-email-verified">
            <CheckCircle size={13} weight="fill" aria-hidden="true" /> Confirmed
          </p>
        ) : verifySent ? (
          <p className="label-mono mt-2 flex items-center gap-1.5 text-muted-foreground" data-testid="profile-email-verify-sent">
            <Envelope size={13} weight="bold" aria-hidden="true" /> Link sent — it lasts three days.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="profile-email-unverified">
            <span className="label-mono text-caution-600">Not confirmed yet</span>
            {/* An underlined text button, the way the reset screens ask for
                another link: a bordered chip on this near-white card reads as
                a label, not something to press. */}
            <button type="button" onClick={sendVerification} disabled={verifying} data-testid="profile-email-verify-send"
              className="text-xs font-semibold text-foreground underline underline-offset-2 hover:opacity-70 disabled:opacity-50">
              {verifying ? "Sending…" : "Send the link"}
            </button>
          </div>
        ))}
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
