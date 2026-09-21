/* 2026-09-14, founder — /team is an org tree (pages/team/OrgTree.jsx): the
   owner at the root, a branch per team, each team's people under it, a search
   across members, teams and roles (⌘K), and "Add member" both in the header
   and at the end of every branch, pre-set to that team. The dialogs — add /
   edit access, profile, invite link — moved onto the glass design system:
   GlassSelect for role and reporting manager, and a job title, which the
   tree shows under each name. */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPhone, timeAgo } from "../lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { normIndianMobile, displayIndianMobile } from "../lib/phone";
import OtpBoxes from "../components/auth/OtpBoxes";
import { PERMISSIONS, hasPerm, roleDefaultPerms, userPerms } from "../lib/perms";
import { toast } from "sonner";
import {
  AirplaneTakeoff, Briefcase, Camera, ChatText, Check, Copy, EnvelopeSimple, Eye, LinkSimple, MagnifyingGlass,
  PencilSimple, Phone, Plus, Pulse, ShieldCheck, Trash, User, WhatsappLogo, X,
} from "@phosphor-icons/react";
import { PersonAvatar } from "../components/karma/PersonAvatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { StickyHeader } from "../components/common";
import {
  CHIP, QUIET_CHIP, DRAWER_CARD, DRAWER_FIELD, DRAWER_LABEL, DRAWER_TRACK,
  GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL,
} from "../components/karma/glass";
import { GlassSelect } from "../components/karma/GlassSelect";
import { AddMemberTile, MEMBER_STATUS, MemberNode, OrgTree, orderByReportingLine } from "./team/OrgTree";
// 2026-09-16, founder: at lg and up the tree is the reference's left-to-right
// org chart (OrgCanvas); below lg the vertical OrgTree stays.
import { AddNode, OrgCanvas } from "./team/OrgCanvas";
import { useIsMobile } from "../hooks/useIsMobile";
// ASK-6 (2026-09-12): a member's leave lands in their profile. Since
// 2026-09-16 it is a timeline there rather than cards, so only Leave.js's
// status and leave-type labels are shared.
import { RequestLeaveDialog, STATUS_META, typeLabel } from "./Leave";

const SHEET = `gap-5 rounded-[1.75rem] p-6 sm:rounded-[1.75rem] [&>button.absolute]:hidden ${GLASS_SHEET}`;
/* 2026-09-16, founder: the profile pop-up is frosted glass like the Team tree's
   cards, not the grey sheet. A near-opaque white wash (it sits on the dialog's
   dark backdrop, where a thin .kr-frost would read grey), a blur, a white rim
   with a top-lip highlight and a long soft shadow. Its tiles and chips are the
   quieter glass (.kr-frost-min's idea): drawn by a white rim over the card's
   own blur, with no second backdrop-filter. */
// The profile pop-up is see-through glass (founder, 2026-09-16): a thin white
// wash and a heavy blur over a barely dimmed page, so the tree reads through
// it. Tiles and chips inside carry no blur of their own, only a lighter wash
// and a white hairline, so the alphas do not stack back to opaque.
// Text on the glass reads a step darker than on solid white (founder,
// 2026-09-16: "the text in the popup is blur"): every grey inside the card is
// lifted one shade, including the shared labels it borrows.
const PROFILE_INK = "antialiased [&_.text-slate-500]:text-slate-700 [&_.text-slate-600]:text-slate-800 [&_.text-slate-700]:text-slate-900 [&_.text-slate-800]:text-slate-900 [&_.text-neutral-600]:text-neutral-800";
const PROFILE_GLASS = "bg-[linear-gradient(160deg,hsl(0_0%_100%/0.62),hsl(0_0%_100%/0.42))] backdrop-blur-[28px] backdrop-saturate-150 border border-white/60 shadow-[0_40px_90px_-30px_hsl(245_35%_15%/0.45),inset_0_1px_0_hsl(0_0%_100%/0.8)]";
const PROFILE_TILE = "rounded-2xl bg-white/30 border border-white/55 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.7)]";
const PROFILE_CHIP = "inline-flex items-center gap-1 rounded-full bg-white/45 border border-white/60 px-2.5 py-1 text-[12px] font-medium text-slate-700";
/* The add / edit member form sits on the app's glass sheet with glass fields,
   selects, panels and access options, like every other dialog here. Only its
   action BUTTONS (close, Cancel, Text a code) stay neumorphic (founder,
   2026-09-20): pushed out with a light and a dark shadow. */
const NM_RAISED = "bg-[hsl(226_24%_92%)] shadow-[6px_6px_14px_hsl(226_18%_74%),-6px_-6px_14px_hsl(0_0%_100%/0.95)]";
// A glass field that also looks locked when it is (someone else's mobile, an
// owner's sign-in email, or your own contact details from here).
const MEMBER_FIELD = `${DRAWER_FIELD} disabled:cursor-not-allowed disabled:bg-white/40 disabled:text-slate-500`;
// The access areas are options, not actions, so they are glass like the rest
// of the form (founder, 2026-09-20).
const PERM_ON = "bg-white font-semibold text-slate-900 ring-1 ring-inset ring-neutral-900/15 shadow-[0_6px_16px_-10px_hsl(216_30%_25%/0.45),inset_0_1px_0_hsl(0_0%_100%/0.9)]";
const PERM_OFF = "bg-white/45 font-medium text-slate-600 ring-1 ring-inset ring-slate-900/[0.05] hover:bg-white/75 hover:text-slate-900";
const NM_ICON_BTN = `grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-700 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 active:shadow-[inset_3px_3px_7px_hsl(226_18%_76%),inset_-3px_-3px_7px_hsl(0_0%_100%/0.95)] ${NM_RAISED}`;
const COLLAPSE_KEY = "team.folded-branches";

const humanize = (key) => String(key).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const roleNameFor = (roles, key) =>
  key === "owner" ? "Owner" : roles.find((r) => r.key === key)?.label || (key ? humanize(key) : "Unassigned");
const statusOf = (u) => MEMBER_STATUS[u.invite_status] || MEMBER_STATUS.active;
// Search reads a member's name, email, job title, phone, team and status.
const memberMatches = (u, q, roles) =>
  [u.name, u.email, u.title, u.phone, roleNameFor(roles, u.role), statusOf(u).label]
    .some((v) => String(v || "").toLowerCase().includes(q));

/* A glass dialog's header: title, a line under it, and the round glass close. */
function SheetHead({ title, children, onClose, closeTestid, closeClassName = GLASS_ICON_BTN }) {
  return (
    <div className="flex items-start gap-3">
      <DialogHeader className="min-w-0 flex-1 space-y-1.5 text-left">
        <DialogTitle className="text-lg font-semibold text-neutral-900">{title}</DialogTitle>
        {children && <DialogDescription className="text-sm text-neutral-600">{children}</DialogDescription>}
      </DialogHeader>
      <button type="button" onClick={onClose} aria-label="Close" data-testid={closeTestid} className={closeClassName}>
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

function Field({ label, htmlFor, children }) {
  return (
    <div className="min-w-0">
      {htmlFor
        ? <label htmlFor={htmlFor} className={`${DRAWER_LABEL} block`}>{label}</label>
        : <p className={DRAWER_LABEL}>{label}</p>}
      {children}
    </div>
  );
}

function InviteLinkModal({ info, onClose }) {
  const link = info ? `${window.location.origin}/login?invite=${info.token}` : "";
  const msg = info ? `You're invited to DecisionOS. Tap to sign in — we'll text you a login code: ${link}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Invite link copied"); }
    catch { toast.error("Couldn't copy — select and copy manually"); }
  };
  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={`max-w-md ${SHEET}`} data-testid="invite-link-modal">
        <SheetHead title={`Invite ${info?.name || ""}`} onClose={onClose} closeTestid="invite-link-close">
          Share this one-tap link. {info?.name} opens it and gets a login code texted to{" "}
          <strong className="font-semibold text-neutral-800">{info?.phone_masked}</strong> — no password needed.
        </SheetHead>
        <div className="flex gap-2">
          <input readOnly value={link} data-testid="invite-link-input" aria-label="Invite link"
            className={`${DRAWER_FIELD} min-w-0 text-sm`} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copy} data-testid="copy-invite-link"
            className={`flex h-12 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-medium ${INK_PILL}`}>
            <Copy size={15} weight="bold" aria-hidden="true" /> Copy
          </button>
        </div>
        <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" data-testid="invite-whatsapp-share"
          className={`flex h-11 items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
          <WhatsappLogo size={16} weight="bold" aria-hidden="true" /> Share on WhatsApp
        </a>
        <p className="text-xs text-neutral-500">Auto-SMS delivery starts once your SMS provider is connected — until then, share this link directly. Link expires in 7 days.</p>
      </DialogContent>
    </Dialog>
  );
}

const MENU_PREVIEW = [
  { label: "Decision Desk", perm: "inbox" },
  { label: "CEO Brief", perm: null },
  { label: "My Work", perm: null },
  { label: "People", perm: "people" },
  { label: "Company Brain", perm: "brain" },
  { label: "Capture", perm: "data_input" },
  { label: "Workflows", perm: "workflows" },
  { label: "Meeting Notes", perm: null },
];

/* Add a member, or edit one (`initial`). `defaultRole` pre-sets the team when
   the dialog opens from that team's branch; `defaultManagerId` pre-sets
   "Reports to" when it opens from a node in the desktop tree. */
function MemberDialog({ trigger, initial, defaultRole, defaultManagerId, roleOptions, onSaved, onInvite, members = [], inviteAfterSave = false, basicOnly = false }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user: me, refreshMe } = useAuth();
  const editing = !!initial;
  const startRole = defaultRole && roleOptions.some((r) => r.key === defaultRole) ? defaultRole : roleOptions[0]?.key || "";
  const startManager = defaultManagerId && members.some((m) => m.id === defaultManagerId) ? defaultManagerId : "";
  const blankForm = () => ({
    name: "", email: "", title: "", phone: "",
    role: startRole, permissions: roleDefaultPerms(startRole, roleOptions), reporting_manager_id: startManager,
    // 2026-09-15 — a new member follows their role's access unless unticked.
    follow_role: true,
  });
  const [form, setForm] = useState(blankForm);
  const roleName = (key) => roleOptions.find((r) => r.key === key)?.label || key;
  // 2026-09-19 — an email is a sign-in only for someone with a password (an
  // owner). For a member who signs in by mobile it is contact detail, so
  // whoever manages the team may add, fix or clear it; the server holds the
  // same line.
  const emailSignsIn = editing && !initial?.passwordless;
  // Your own email is yours to change (basicOnly) — with your password when it
  // is how you sign in, as Settings asks.
  const emailLocked = emailSignsIn && me?.role !== "owner" && !basicOnly;
  // 2026-09-20 (Settings audit) — the manager/owner form saves through
  // PATCH /users, which asks for no code and no password, so your own mobile
  // and email are not changed from it (the server refuses that too). The
  // details-only form on your own card is the other path: it saves through
  // PATCH /auth/profile WITH the code or password, so it stays open.
  const ownContact = editing && initial?.id === me?.id && !basicOnly;
  const emailTyped = form.email.trim();
  const emailBad = !!emailTyped && !/^\S+@\S+\.\S+$/.test(emailTyped);
  // A number already on file changes only by an owner's hand — it is the sign-in.
  const phoneLocked = editing && me?.role !== "owner" && me?.id !== initial?.id
    && (initial?.phone || "").replace(/\D/g, "").length >= 10;
  const rolePerms = roleDefaultPerms(form.role, roleOptions);
  const shownPerms = form.follow_role ? rolePerms : form.permissions;

  /* basicOnly — YOUR OWN mobile and email, changed here rather than in Settings
     (founder, 2026-09-20: a member without Settings still has to be able to
     fix them). The same rules PATCH /auth/profile holds and Settings › Your
     Profile follows (U7-24.14): a new mobile is saved only with the code
     texted to it, and an email that is your sign-in needs your password.
     `me` is the signed-in record, which carries passwordless and phone_norm. */
  const last10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);
  const myPhone = me?.phone_norm || last10(me?.phone);
  const typedPhone = form.phone.trim();
  const ownPhoneChanged = basicOnly && !!typedPhone && last10(typedPhone) !== myPhone;
  const ownNewPhone = ownPhoneChanged ? normIndianMobile(typedPhone) : "";
  const ownPhoneRemoved = basicOnly && !typedPhone && !!myPhone;
  const ownEmailChanged = basicOnly && emailTyped.toLowerCase() !== (me?.email || "").toLowerCase();
  const ownEmailNeedsPassword = ownEmailChanged && !me?.passwordless;
  // phoneCodeFor is the number the code went to; a different number needs its own.
  const [phoneCodeFor, setPhoneCodeFor] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneResendIn, setPhoneResendIn] = useState(0);
  const [sendingPhone, setSendingPhone] = useState(false);
  const [emailPassword, setEmailPassword] = useState("");
  const phoneCodeReady = !!ownNewPhone && phoneCodeFor === ownNewPhone && phoneCode.length === 6;
  useEffect(() => {
    if (phoneResendIn <= 0) return undefined;
    const t = setTimeout(() => setPhoneResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phoneResendIn]);

  const sendPhoneCode = async () => {
    if (!ownNewPhone || sendingPhone) return;
    setSendingPhone(true);
    try {
      const { data } = await api.post("/auth/phone/send-code", { phone: ownNewPhone });
      setPhoneCodeFor(ownNewPhone);
      setPhoneCode(data?.dev_otp || "");
      setPhoneResendIn(30);
      if (data?.dev_otp) toast.info(`Dev OTP: ${data.dev_otp} (auto-filled)`);
      else toast.success(`We texted a code to ${displayIndianMobile(ownNewPhone)}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not send the code");
    } finally {
      setSendingPhone(false);
    }
  };

  // A member editing their OWN profile without Manage Team goes through PATCH
  // /auth/profile, which by design never touches department, reporting line or
  // access (PATCH /users needs team_manage and would refuse it).
  const saveOwn = async () => {
    if (!form.name.trim()) { toast.error("Enter your name"); return; }
    if (emailBad) { toast.error("That email doesn't look right — fix it or leave it empty"); return; }
    if (ownEmailChanged && !me?.passwordless && !emailTyped) {
      toast.error("You sign in with this email, so it can be changed but not removed"); return;
    }
    if (ownEmailNeedsPassword && !emailPassword) { toast.error("Enter your current password to change your email"); return; }
    if (ownPhoneRemoved && me?.passwordless) {
      toast.error("You sign in with this number, so it can be changed but not removed."); return;
    }
    if (ownPhoneChanged && !ownNewPhone) { toast.error("Enter a 10-digit Indian mobile number"); return; }
    if (ownPhoneChanged && !phoneCodeReady) {
      toast.error(phoneCodeFor === ownNewPhone
        ? "Enter the code we texted to your new number"
        : "Text a code to your new number first, then save");
      return;
    }
    setBusy(true);
    try {
      await api.patch("/auth/profile", {
        name: form.name.trim(), title: form.title.trim(), phone: typedPhone,
        ...(ownPhoneChanged ? { phone_code: phoneCode } : {}),
        ...(ownEmailChanged ? {
          email: emailTyped.toLowerCase(),
          ...(me?.passwordless ? {} : { current_password: emailPassword }),
        } : {}),
      });
      await refreshMe();
      toast.success(ownEmailChanged && emailTyped
        ? "Saved — check your new address for the link that confirms it"
        : "Details updated");
      setOpen(false);
      onSaved();
    } catch (e) {
      // The phone refusals carry {code, message}; formatApiError reads both.
      toast.error(formatApiError(e.response?.data?.detail) || "Could not update your details");
    } finally {
      setBusy(false);
    }
  };

  const openChange = (o) => {
    setOpen(o);
    if (!o) return;
    setPhoneCodeFor(""); setPhoneCode(""); setPhoneResendIn(0); setEmailPassword("");
    if (initial) {
      setForm({
        name: initial.name, email: initial.email || "", title: initial.title || "",
        phone: initial.phone || "", role: initial.role,
        permissions: initial.permissions_custom || (Array.isArray(initial.permissions) && initial.permissions.length)
          ? [...(initial.permissions || [])] : roleDefaultPerms(initial.role, roleOptions),
        follow_role: !initial.permissions_custom && !(Array.isArray(initial.permissions) && initial.permissions.length),
        reporting_manager_id: initial.reporting_manager_id || "",
      });
    } else {
      setForm(blankForm());
    }
  };

  const setRole = (role) => setForm((f) => ({
    ...f, role,
    permissions: role === "owner" ? PERMISSIONS.map((p) => p.key)
      : f.follow_role ? roleDefaultPerms(role, roleOptions)
      : (editing && f.role !== "owner") ? f.permissions
      : roleDefaultPerms(role, roleOptions),
  }));
  const togglePerm = (key) => setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key] }));

  const [ownerConfirm, setOwnerConfirm] = useState(null);
  /* 2026-09-21 — THE SEAT LIMIT, SAID WHERE IT BITES. Adding a member past the
     plan's seats used to come back as a toast that was gone in seconds, while
     this dialog stayed open with everything typed in and nothing on it — it
     read as "the button does nothing". The refusal now sits on the dialog, with
     the way out; and a dialog opened when every seat is taken says so before
     anyone fills it in. */
  const [seatWall, setSeatWall] = useState(null);
  useEffect(() => { if (!open) setSeatWall(null); }, [open]);
  const wallRef = useRef(null);
  useEffect(() => { if (seatWall) wallRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [seatWall]);
  const planQ = useQuery({
    queryKey: ["tenant-plan"],
    queryFn: () => api.get("/tenant/plan").then((r) => r.data),
    enabled: open && !editing,
  });
  const seatsFull = !editing && planQ.data?.seat_limit != null
    && planQ.data.seats_used >= planQ.data.seat_limit;
  const wall = seatWall || (seatsFull
    ? { seats_used: planQ.data.seats_used, seat_limit: planQ.data.seat_limit } : null);
  const save = async (confirmed = false) => {
    const promotingToOwner = form.role === "owner" && (!editing || initial.role !== "owner");
    const demotingOwner = editing && initial.role === "owner" && form.role !== "owner";
    // RBAC P2 (2026-09-16): the app's own dialog, not the browser's confirm box.
    if ((promotingToOwner || demotingOwner) && confirmed !== true) {
      setOwnerConfirm(promotingToOwner
        ? { title: `Make ${form.name || "them"} an owner?`,
            body: "They get full control of the company account — the team, finances and all data. Owners also sign in with an email and password, so they'll be asked to set theirs the next time they sign in.",
            action: "Make owner" }
        : { title: `Remove owner access from ${initial.name}?`, body: "They lose full control. At least one owner must remain.", action: "Remove owner access" });
      return;
    }
    if (basicOnly) { await saveOwn(); return; }
    // 2026-09-19 — members sign in with their mobile and a texted code, so the
    // number is required and has to be a real one: a typo hands their account
    // to whoever owns it. (The server holds the same rules.)
    const phoneTyped = form.phone.trim();
    if (emailBad && !emailLocked) { toast.error("That email doesn't look right — fix it or leave it empty"); return; }
    if (editing && emailSignsIn && !emailTyped && (initial.email || "")) {
      toast.error("They sign in with this email, so it can be changed but not removed"); return;
    }
    if (!editing) {
      if (!form.name.trim()) { toast.error("Enter their name"); return; }
      if (!normIndianMobile(phoneTyped)) { toast.error("Enter their 10-digit Indian mobile number — it's how they sign in"); return; }
    } else if (!phoneLocked && phoneTyped && phoneTyped !== (initial.phone || "") && !normIndianMobile(phoneTyped)) {
      toast.error("Enter a 10-digit Indian mobile number"); return;
    }
    setBusy(true);
    try {
      if (editing) {
        if (!form.name.trim()) { toast.error("Enter a name"); setBusy(false); return; }
        await api.patch(`/users/${initial.id}`, {
          // RBAC P1 (2026-09-15): name can be corrected. The email goes when
          // this person may change it (see emailLocked).
          name: form.name.trim(), ...(emailLocked || ownContact ? {} : { email: emailTyped }),
          follow_role: !!form.follow_role,
          role: form.role, permissions: form.follow_role ? [] : form.permissions,
          // Left out when it is locked, so a save of the other fields still goes through.
          ...(phoneLocked || ownContact ? {} : { phone: form.phone }),
          reporting_manager_id: form.reporting_manager_id, title: form.title.trim(),
        });
        toast.success(`${initial.name}'s access updated`);
        setOpen(false);
        onSaved();
        // Opened from the invite icon of someone with no mobile: once the
        // number is saved, hand over their invite link straight away.
        if (inviteAfterSave && onInvite && form.phone.replace(/\D/g, "").length >= 10) {
          try {
            const { data } = await api.post(`/users/${initial.id}/invite`);
            onInvite({ token: data.invite_token, name: data.name, phone_masked: data.phone_masked });
          } catch (e) {
            toast.error(formatApiError(e.response?.data?.detail) || "Couldn't create invite link");
          }
        }
        return;
      }
      const base = {
        name: form.name, email: form.email, title: form.title.trim() || null, role: form.role,
        // An empty list means "the role's access" on the server.
        follow_role: !!form.follow_role,
        permissions: form.follow_role ? [] : form.permissions, phone: form.phone, reporting_manager_id: form.reporting_manager_id || null,
      };
      if (!form.email.trim()) delete base.email;
      const res = await api.post("/users", base);
      toast.success(`${form.name} added`);
      setOpen(false);
      onSaved();
      if (res?.data?.invite_token && onInvite) {
        const d = form.phone.replace(/\D/g, "");
        onInvite({ token: res.data.invite_token, name: form.name, phone_masked: d.length >= 4 ? "•••• " + d.slice(-4) : "••••" });
      }
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail?.code === "seat_limit_reached") setSeatWall(detail);
      else toast.error(formatApiError(detail) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={`max-h-[calc(90dvh/var(--ui-scale,1))] max-w-xl overflow-y-auto ${SHEET}`}
        overlayClassName="bg-slate-900/30" data-testid="member-dialog">
        <SheetHead title={editing ? `Edit ${basicOnly || initial.role === "owner" ? "details" : "access"} — ${initial.name}` : "Add team member"}
          onClose={() => setOpen(false)} closeTestid="member-dialog-close" closeClassName={NM_ICON_BTN}>
          {basicOnly ? "Your name, job title, email and mobile number."
            : editing ? "Job title, department, reporting line and what they can open."
            : "Who they are, where they sit in the team, and what they can open."}
        </SheetHead>

        {/* At the TOP — found in the browser: at the foot of this long form the
            owner filled everything in before ever seeing it. */}
        {wall && (
          <div role="alert" ref={wallRef} data-testid="member-seat-wall"
            className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <p className="font-semibold">All {wall.seat_limit} seats on your plan are in use.</p>
            <p className="mt-0.5 text-[13px]">
              Remove someone who has left (their seat frees up at once), or ask us to add seats — then add{" "}
              {form.name || "them"}. What you've typed here is kept.
            </p>
          </div>
        )}

        <div className="space-y-5">
          <section className="space-y-3">
            {/* RBAC P1 (2026-09-15): name and email show when editing too.
                2026-09-19 — members sign in by mobile, so their email is contact
                detail anyone managing the team may fix; an owner's email is a
                sign-in, and only an owner changes it. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="member-name">
                <input id="member-name" data-testid="member-name-input" className={MEMBER_FIELD} placeholder="e.g. Priya Nair"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Email (optional)" htmlFor="member-email">
                <input id="member-email" data-testid="member-email-input" className={MEMBER_FIELD} type="email" placeholder="name@company.com"
                  disabled={emailLocked || ownContact} title={emailLocked ? "They sign in with this email — only an owner can change it" : undefined}
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {emailBad && !emailLocked && !ownContact ? (
                  <p className="mt-1.5 text-xs text-danger-600" data-testid="member-email-invalid">
                    That email doesn't look right — fix it or leave it empty
                  </p>
                ) : ownEmailChanged && emailTyped && (
                  <p className="mt-1.5 text-xs text-neutral-500" data-testid="member-email-confirm-hint">
                    We'll email the new address a link to confirm it.
                  </p>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title" htmlFor="member-title">
                <input id="member-title" data-testid="member-title-input" className={MEMBER_FIELD} placeholder="e.g. Sales Lead" maxLength={80}
                  value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Mobile number" htmlFor="member-phone">
                {/* 2026-09-16 — the number is a sign-in: a code goes to it and
                    whoever reads that code is in. So Manage team can fill in a
                    number for someone who has none, but changing one that is
                    already set is the owner's call (the server holds the same
                    rule). Their own number is theirs to change, here or in
                    Settings, confirmed by a code texted to it. */}
                <input id="member-phone" data-testid="member-phone-input" className={MEMBER_FIELD} type="tel"
                  disabled={phoneLocked || ownContact}
                  placeholder="+91 98765 43210"
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                {ownContact ? (
                  <p className="mt-1.5 text-xs text-neutral-500" data-testid="member-contact-in-settings">
                    Change your own mobile or email in Settings › Your Profile — a new one is confirmed with a code.
                  </p>
                ) : phoneLocked ? (
                  <p className="mt-1.5 text-xs text-neutral-500" data-testid="member-phone-locked">
                    Only an owner can change someone's mobile number — it's how they sign in.
                  </p>
                ) : form.phone.trim() && !normIndianMobile(form.phone) ? (
                  <p className="mt-1.5 text-xs text-danger-600" data-testid="member-phone-invalid">
                    Enter a 10-digit Indian mobile number
                  </p>
                ) : !editing && (
                  <p className="mt-1.5 text-xs text-neutral-500" data-testid="member-phone-hint">
                    It's how they sign in — we text them a code. Check it twice.
                  </p>
                )}
              </Field>
            </div>

            {/* Your new mobile signs you in, so it is saved only with the code
                texted to it; the old one keeps working until then. */}
            {ownNewPhone && (
              <div className={`space-y-3 px-4 py-3.5 ${DRAWER_CARD}`} data-testid="member-own-phone-confirm">
                <p className="text-xs leading-relaxed text-neutral-600">
                  A new number signs you in, so we check it&apos;s yours: we&apos;ll text a code to{" "}
                  <strong className="font-semibold text-neutral-900">{displayIndianMobile(ownNewPhone)}</strong>.
                  Your old number keeps working until you save.
                </p>
                {phoneCodeFor === ownNewPhone ? (
                  <>
                    <div className="max-w-xs">
                      <OtpBoxes value={phoneCode} onChange={setPhoneCode} disabled={busy} testid="member-own-phone-code" />
                    </div>
                    <p className="text-xs text-neutral-600">
                      Enter it, then Save.{" "}
                      {phoneResendIn > 0 ? (
                        <span data-testid="member-own-phone-resend-wait">Text it again in {phoneResendIn}s</span>
                      ) : (
                        <button type="button" onClick={sendPhoneCode} disabled={sendingPhone} data-testid="member-own-phone-resend"
                          className="font-semibold text-neutral-900 underline underline-offset-2 disabled:opacity-50">
                          Text it again
                        </button>
                      )}
                    </p>
                  </>
                ) : (
                  <button type="button" onClick={sendPhoneCode} disabled={sendingPhone} data-testid="member-own-phone-send-code"
                    className={`h-10 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-shadow active:shadow-[inset_3px_3px_7px_hsl(226_18%_76%),inset_-3px_-3px_7px_hsl(0_0%_100%/0.95)] disabled:opacity-50 ${NM_RAISED}`}>
                    {sendingPhone ? "Sending…" : `Text a code to ${displayIndianMobile(ownNewPhone)}`}
                  </button>
                )}
              </div>
            )}

            {/* Your email is your sign-in when you have a password: prove it is
                you at the keyboard. Signing in by mobile, it is contact detail. */}
            {ownEmailNeedsPassword && (
              <Field label="Your current password" htmlFor="member-own-password">
                <input id="member-own-password" data-testid="member-own-password-input" className={MEMBER_FIELD} type="password"
                  autoComplete="current-password" placeholder="••••••••"
                  value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
              </Field>
            )}
          </section>

          {/* Department, reporting line and access are a manager's to set —
              hidden when a member edits their own basic details. */}
          {!basicOnly && (<>
          <section className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* 2026-09-19, founder — "Department", not "Team". The value has
                  always been the tenant's role key, and the tree groups people
                  by it into the departments drawn on /team; "Team" read as the
                  whole company beside "Reports to". Label only — the field, the
                  value and every consumer are untouched. */}
              <Field label="Department">
                <GlassSelect testid="member-role-select" ariaLabel="Department" value={form.role} onChange={setRole}
                  options={roleOptions.map((r) => ({ value: r.key, label: r.label }))} />
              </Field>
              <Field label="Reports to">
                <GlassSelect testid="member-manager-select" ariaLabel="Reporting manager" value={form.reporting_manager_id}
                  onChange={(v) => setForm({ ...form, reporting_manager_id: v })}
                  options={[
                    { value: "", label: "No one (team approver)" },
                    ...members.filter((m) => m.id !== initial?.id).map((m) => ({ value: m.id, label: `${m.name} · ${roleName(m.role)}` })),
                  ]} />
              </Field>
            </div>
            <p className="text-xs text-neutral-500">The reporting manager approves their leave, and their tasks and decisions when nobody else is picked; overdue work reaches them first. The tree lines them up under that person.</p>
          </section>

          <section>
            <p className={`${DRAWER_LABEL} flex items-center gap-1.5`}>
              <ShieldCheck size={13} weight="bold" aria-hidden="true" /> Access
            </p>
            {form.role === "owner" ? (
              <div className={`px-4 py-3.5 text-sm ${DRAWER_CARD}`} data-testid="owner-access-note">
                <p className="flex items-center gap-1.5 font-semibold text-neutral-900"><ShieldCheck size={15} weight="bold" aria-hidden="true" /> Full company access</p>
                <p className="mt-1 text-xs text-neutral-600">Owners can open and manage everything — team, finances, workflows and all data. Individual permissions don't apply.</p>
              </div>
            ) : (
              <>
                <label className={`mb-3 flex cursor-pointer items-start gap-3 px-4 py-3 ${DRAWER_CARD}`} data-testid="member-follow-role">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-900" checked={!!form.follow_role}
                    data-testid="member-follow-role-toggle"
                    onChange={(e) => {
                      const follow = e.target.checked;
                      setForm((f) => ({ ...f, follow_role: follow, permissions: follow ? f.permissions : [...roleDefaultPerms(f.role, roleOptions)] }));
                    }} />
                  <span className="min-w-0 text-sm text-neutral-800">
                    <span className="font-semibold">Use the {roleName(form.role)} team's access</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      {form.follow_role
                        ? "When the owner changes this team's access in Settings › Teams, it reaches them too."
                        : form.permissions.length
                          ? "Their own access, chosen below. Changes to the team won't reach them."
                          : "No access: they can sign in but can't open anything until you tick something."}
                    </span>
                  </span>
                </label>
                {/* An area that is on is a solid white glass card with the black tick; one that is off is a faint one. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="permission-list">
                  {PERMISSIONS.map((p) => {
                    const on = shownPerms.includes(p.key);
                    // RBAC P0 (2026-09-15) — same rule as the server: someone who isn't
                    // an owner gives only access they hold, the person already has, or
                    // their role's defaults (not to themselves).
                    const selfEdit = editing && initial?.id === me?.id;
                    const locked = me?.role !== "owner" && !on && !userPerms(me).includes(p.key)
                      && !(initial?.permissions || []).includes(p.key)
                      && (selfEdit || !rolePerms.includes(p.key));
                    return (
                      <button key={p.key} type="button" data-testid={`perm-${p.key}`} aria-pressed={on} disabled={locked || form.follow_role}
                        title={form.follow_role ? "Set by the team — untick “Use the team’s access” to choose" : locked ? "Only an owner can give access you don't have" : undefined}
                        onClick={() => togglePerm(p.key)}
                        className={`flex min-h-11 items-center justify-between gap-2 rounded-2xl px-3.5 py-2 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-45 ${on ? PERM_ON : PERM_OFF}`}>
                        <span>{p.label}</span>
                        <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${on ? "bg-neutral-900 text-white" : "ring-1 ring-inset ring-slate-900/20"}`}>
                          {on && <Check size={11} weight="bold" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4" data-testid="menu-preview">
                  <p className={DRAWER_LABEL}>They will see these menus</p>
                  <div className="flex flex-wrap gap-1.5">
                    {MENU_PREVIEW.map((m) => {
                      const visible = !m.perm || shownPerms.includes(m.perm);
                      return (
                        <span key={m.label} data-testid={`preview-${m.label}`}
                          className={`${CHIP} ${visible ? "bg-neutral-900 text-white ring-transparent" : `${QUIET_CHIP} line-through opacity-60`}`}>
                          {m.label}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">CEO Brief shows their own brief. Everyone always has CEO Brief, My Work and Meeting Notes.</p>
                </div>
              </>
            )}
          </section>
          </>)}
        </div>

        {/* RBAC P2 (2026-09-16): the owner change is confirmed right here, above
            the buttons — a second dialog stacked under this one. */}
        {ownerConfirm && (
          <div role="alertdialog" aria-labelledby="owner-confirm-title" aria-describedby="owner-confirm-body"
            data-testid="owner-confirm" className={`space-y-3 px-4 py-4 ${DRAWER_CARD}`}>
            <p id="owner-confirm-title" className="text-sm font-semibold text-neutral-900">{ownerConfirm.title}</p>
            <p id="owner-confirm-body" className="text-xs leading-relaxed text-neutral-600">{ownerConfirm.body}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" data-testid="owner-confirm-cancel" onClick={() => setOwnerConfirm(null)}
                className={`h-10 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>Keep as is</button>
              <button type="button" data-testid="owner-confirm-go" onClick={() => { setOwnerConfirm(null); save(true); }}
                className={`h-10 rounded-pill px-4 text-sm font-medium ${INK_PILL}`}>{ownerConfirm.action}</button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} disabled={busy} data-testid="member-cancel"
            className={`h-11 rounded-pill px-5 text-sm font-medium text-neutral-800 transition-shadow active:shadow-[inset_3px_3px_7px_hsl(226_18%_76%),inset_-3px_-3px_7px_hsl(0_0%_100%/0.95)] disabled:opacity-40 ${NM_RAISED}`}>
            Cancel
          </button>
          <button type="button" data-testid="member-save-submit" onClick={() => save()} disabled={busy || !!ownerConfirm}
            className={`h-11 rounded-pill px-6 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            {busy ? "Saving…" : editing ? "Save" : "Add member"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Epic 2 Sprint A — E2-01: /team route wraps TeamPanel with a page header.
// The old People > Employees tab is retired; owner + team_manage users
// reach the same table via the Ops-adjacent /team page.
export default function TeamPage() {
  return <TeamPanel title="Team" subtitle="Organize people, roles and reporting lines" />;
}

/* ASK-6 (2026-09-12): who is out today, at the top of Team, from GET
   /api/leaves/on-leave. Hidden when nobody is out. The same list marks each
   person's card "Out today". */
function CurrentlyOutStrip({ people }) {
  return (
    <section className={`mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${DRAWER_CARD}`} data-testid="team-currently-out">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        <AirplaneTakeoff size={14} weight="bold" aria-hidden="true" className="text-orange-500" /> Currently out
      </span>
      <ul className="flex flex-wrap items-center gap-1.5">
        {people.map((p, i) => (
          <li key={p.user_id || p.id || i} className={`${CHIP} ${QUIET_CHIP}`}>
            <span className="font-medium text-slate-700">{p.user_name || p.name}</span>
            {p.until_date && (
              <span className="text-slate-500">
                · back {new Date(p.until_date).toLocaleString(undefined, { day: "numeric", month: "short" })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ASK-6 → 2026-09-16, founder: a member's leave inside their profile, as a
   timeline rather than cards — newest first, a dot per request in its status
   colour on one line. GET /leaves?scope=all is gated to team_manage users and
   the list is small, so it is filtered by user here. */
const LEAVE_DOT = {
  pending: "bg-amber-400",
  approved: "bg-emerald-500",
  rejected: "bg-rose-500",
  info_requested: "bg-violet-500",
  cancelled: "bg-slate-300",   // withdrawn by the person who asked (2026-09-19)
};
const leaveDay = (d, withYear) =>
  new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
  });
function leaveRange(lv) {
  const from = String(lv.from_date || "").slice(0, 10);
  const to = String(lv.to_date || from).slice(0, 10);
  if (!from) return "";
  if (from === to) return leaveDay(from, true);
  return `${leaveDay(from, from.slice(0, 4) !== to.slice(0, 4))} – ${leaveDay(to, true)}`;
}
function leaveLength(lv) {
  if (lv.day_portion === "half") return "Half day";
  const n = typeof lv.days === "number"
    ? lv.days
    : Math.round((new Date(`${String(lv.to_date).slice(0, 10)}T00:00:00`) - new Date(`${String(lv.from_date).slice(0, 10)}T00:00:00`)) / 86400000) + 1;
  return Number.isFinite(n) && n > 0 ? `${n} ${n === 1 ? "day" : "days"}` : "";
}

function MemberLeaveTimeline({ userId }) {
  const q = useQuery({
    queryKey: ["leaves", "all"],
    queryFn: () => api.get("/leaves?scope=all").then((r) => r.data),
  });
  const mine = (q.data || [])
    .filter((l) => l.user_id === userId)
    .sort((a, b) => String(b.from_date || "").localeCompare(String(a.from_date || ""))
      || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return (
    <section data-testid={`member-leave-history-${userId}`}>
      <p className={`${DRAWER_LABEL} flex items-center gap-1.5`}>
        <AirplaneTakeoff size={13} weight="bold" aria-hidden="true" /> Leave
      </p>
      {q.isLoading ? (
        <p className="py-1 text-sm text-slate-500">Loading leave…</p>
      ) : mine.length === 0 ? (
        <p className="py-1 text-sm text-slate-500">No leave on record.</p>
      ) : (
        /* The guided path (founder, 2026-09-16): one sunken glass channel runs
           the length of the list and every request's dot sits in it, so the eye
           follows a single track from the newest leave down to the oldest. The
           entries stay plain text beside it: a timeline, not a stack of cards. */
        <ol className="relative pl-10 pt-1">
          <span aria-hidden="true"
            className="absolute bottom-2 left-[13.5px] top-3 w-px bg-slate-900/15" />
          {mine.map((lv, i) => {
            const st = STATUS_META[lv.status] || STATUS_META.pending;
            const last = i === mine.length - 1;
            const facts = [typeLabel(lv.leave_type), leaveLength(lv), lv.is_emergency ? "Emergency" : null].filter(Boolean);
            return (
              <li key={lv.id} data-testid={`leave-entry-${lv.id}`} className={`relative ${last ? "" : "pb-6"}`}>
                {/* The dot rides in the channel: centred on it (channel centre 14px,
                    list padding 40px), level with the date line. */}
                <span aria-hidden="true"
                  className={`absolute left-[-33px] top-[5px] h-3.5 w-3.5 rounded-full ring-[3px] ring-white shadow-[0_2px_6px_-1px_hsl(245_30%_25%/0.45)] ${LEAVE_DOT[lv.status] || LEAVE_DOT.pending}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-[15px] font-semibold tabular-nums text-neutral-900" data-testid={`leave-range-${lv.id}`}>{leaveRange(lv)}</p>
                    <span className={`${CHIP} ${st.tone}`} data-testid={`leave-status-${lv.id}`}>{st.label}</span>
                  </div>
                  {facts.length > 0 && <p className="mt-0.5 text-[13px] text-slate-600">{facts.join(" · ")}</p>}
                  {lv.reason && <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{lv.reason}</p>}
                  {lv.status === "info_requested" && lv.info_note && (
                    <p className="mt-1.5 text-[13px] text-violet-700">Asked: {lv.info_note}</p>
                  )}
                  <p className="mt-1.5 text-xs text-slate-500">
                    Requested {timeAgo(lv.created_at)}{lv.approver_name ? ` · Approver: ${lv.approver_name}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * The team, as a tree. /team renders it with a title; People › Employees
 * embeds it without one (and read-only for anyone without team_manage).
 */
export function TeamPanel({ readOnly = false, title, subtitle } = {}) {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  const tenantRoles = useMemo(() => tenant?.roles || [], [tenant]);
  const roleOptions = useMemo(
    () => [...tenantRoles, ...(isOwner ? [{ key: "owner", label: "Owner" }] : [])],
    [tenantRoles, isOwner],
  );
  const [invite, setInvite] = useState(null);
  // U7-09.TEAM v2 (2026-08-17): the profile dialog every card opens.
  const [profileUser, setProfileUser] = useState(null);
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const { data: seatPlan } = useQuery({
    queryKey: ["tenant-plan"],
    queryFn: () => api.get("/tenant/plan").then((r) => r.data),
  });
  const outQ = useQuery({
    queryKey: ["leaves", "on-leave-today"],
    queryFn: () => api.get("/leaves/on-leave").then((r) => r.data),
    // The answer changes slowly.
    refetchInterval: 15 * 60 * 1000,
  });
  // U7-09.TEAM v2: readOnly lets People render this view-only.
  const canManageTeam = !readOnly && hasPerm(user, "team_manage");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["tenant-plan"] });   // the seat count moves with the team
  };
  const members = useMemo(() => usersQ.data || [], [usersQ.data]);
  const out = useMemo(() => outQ.data || [], [outQ.data]);
  const outIds = useMemo(() => new Set(out.map((p) => p.user_id).filter(Boolean)), [out]);

  const getInviteLink = async (u) => {
    try {
      const { data } = await api.post(`/users/${u.id}/invite`);
      setInvite({ token: data.invite_token, name: data.name, phone_masked: data.phone_masked });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't create invite link");
    }
  };

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searchRef = useRef(null);

  /* ⌘K / Ctrl+K puts the cursor in the search, as the reference shows. The
     app's own ⌘K (the global search) still answers a second press made from
     inside the box, and anywhere this page is not the standalone /team. The
     listener runs in the capture phase so it is heard before Layout's. */
  const standalone = !!title;
  useEffect(() => {
    if (!standalone) return undefined;
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const box = searchRef.current;
      if (!box || document.activeElement === box || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      box.focus();
      box.select();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [standalone]);

  // Folded teams are a per-viewer convenience, remembered in this browser.
  const [folded, setFolded] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { return new Set(); }
  });
  const toggleBranch = (key) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ }
    return next;
  });
  // A search opens every team, so a match is never hidden in a folded one.
  const isOpen = (key) => !!q || !folded.has(key);

  /* The tree. Owners are the root. Every other member hangs off their team
     (role), in the tenant's team order, then any team the tenant no longer
     lists. A search keeps a team whole when its name matches, and otherwise
     keeps only the people who match; teams with nothing left drop out. */
  const isMobile = useIsMobile();
  const { owners, branches, teams, shownCount } = useMemo(() => {
    const ownersAll = members.filter((u) => u.role === "owner");
    const byTeam = new Map();
    members.filter((u) => u.role !== "owner").forEach((u) => {
      const key = u.role || "unassigned";
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(u);
    });
    const order = tenantRoles.map((r) => r.key);
    const keys = [...order, ...[...byTeam.keys()].filter((k) => !order.includes(k)).sort()];
    const list = keys
      .map((key) => {
        const all = orderByReportingLine(byTeam.get(key) || []);
        const label = roleNameFor(tenantRoles, key);
        const teamHit = !!q && label.toLowerCase().includes(q);
        return { key, label, total: all.length, teamHit, members: !q || teamHit ? all : all.filter((u) => memberMatches(u, q, tenantRoles)) };
      })
      .filter((b) => !q || b.teamHit || b.members.length > 0);
    const ownerHits = q ? ownersAll.filter((u) => memberMatches(u, q, tenantRoles)).length : ownersAll.length;
    return {
      owners: ownersAll,
      branches: list,
      // The desktop canvas filters itself, so it takes every team whole.
      teams: keys.map((key) => ({ key, label: roleNameFor(tenantRoles, key), members: byTeam.get(key) || [] })),
      shownCount: ownerHits + list.reduce((n, b) => n + b.members.length, 0),
    };
  }, [members, q, tenantRoles]);

  const renderMember = (u, { root }) => (
    <MemberNode
      u={u}
      root={root}
      isMe={u.id === user?.id}
      title={u.title || roleNameFor(tenantRoles, u.role)}
      /* ASK-51 — AND THE CHIP FOLLOWS THE SAME RULE as the profile's Access
         section (showAccess, below): what somebody else may open is a
         manager's to see. Without Manage team the card carries no chip —
         except your own, where it is your own access. */
      access={canManageTeam || u.id === user?.id
        ? (u.role === "owner" ? "Full access" : `${userPerms(u).length} permissions`)
        : null}
      outToday={outIds.has(u.id)}
      // The root stays as the tree's anchor during a search, faded when it is not a match.
      dimmed={root && !!q && !memberMatches(u, q, tenantRoles)}
      onOpen={() => setProfileUser(u)}
    />
  );
  const renderAdd = canManageTeam
    ? (b) => (tenantRoles.some((r) => r.key === b.key) ? (
      <MemberDialog roleOptions={roleOptions} members={members} defaultRole={b.key} onSaved={refresh} onInvite={setInvite}
        trigger={<AddMemberTile data-testid={`team-add-${b.key}`} aria-label={`Add member to ${b.label}`} />} />
    ) : null)
    : null;

  /* The desktop tree's "Add member" node, at the top of each open column: the
     Add member dialog with "Reports to" (and, below the heads, the team) set. */
  const canvasAdd = canManageTeam
    ? ({ managerId, role, hint, testid, width, height }) => (
      <MemberDialog roleOptions={roleOptions} members={members} defaultRole={role} defaultManagerId={managerId}
        onSaved={refresh} onInvite={setInvite}
        trigger={
          <AddNode data-testid={testid} hint={hint} width={width} height={height}
            aria-label={hint ? `Add a member who ${hint.charAt(0).toLowerCase()}${hint.slice(1)}` : "Add a member"} />
        } />
    )
    : null;

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

  /* U7-09.TEAM v2: without team_manage the roster is read-only, and the page
     says why rather than looking broken.
     2026-09-19, founder — it moves UP INTO THE HEADER ROW, between the heading
     and the search, because that row is mostly empty on a wide screen while
     the notice was spending a full band of its own below it and pushing the
     tree down. Declared once here and placed twice: the header slot only
     exists from lg, where there is room beside a 22rem search field; below
     that it stays where it was, full width under the row. */
  const readOnlyNotice = !canManageTeam && !readOnly ? (
    <div className={`flex items-start gap-3 px-5 py-4 ${DRAWER_CARD}`} data-testid="team-view-only-banner">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 ${GLASS_PILL}`}>
        <Eye size={16} weight="bold" aria-hidden="true" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-neutral-900">Read-only view</p>
        <p className="mt-0.5 text-xs text-slate-600">
          You can see who's on the team and open any card for details. To add members or manage access, ask the owner for the <strong className="font-semibold">Manage Team</strong> permission.
        </p>
      </div>
    </div>
  ) : null;

  return (
    <div data-testid="team-panel">
      <InviteLinkModal info={invite} onClose={() => setInvite(null)} />

      <div className="mb-6 flex flex-col gap-6 lg:mb-8 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
        {title ? (
          <StickyHeader className="min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{subtitle}</p>}
          </StickyHeader>
        ) : (
          <p className="self-center text-sm text-muted-foreground" data-testid="team-count">
            {q ? `${shownCount} of ${members.length} members` : `${members.length} members`}
          </p>
        )}
        {readOnlyNotice && (
          <div className="hidden min-w-0 flex-1 lg:block lg:max-w-2xl">{readOnlyNotice}</div>
        )}
        <div className="flex items-center gap-2.5 lg:shrink-0">
          <div className={`relative flex h-12 min-w-0 flex-1 items-center rounded-pill lg:w-[22rem] lg:flex-none ${GLASS_PILL}`}>
            <MagnifyingGlass size={17} weight="bold" aria-hidden="true" className="pointer-events-none absolute left-4 text-slate-500" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}
              placeholder="Search members, teams or roles…"
              aria-label="Search members, teams or roles"
              data-testid="team-search"
              className="h-full w-full min-w-0 rounded-pill bg-transparent pl-11 pr-16 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"
                data-testid="team-search-clear"
                className="absolute right-2 grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900">
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            ) : standalone && (
              <kbd aria-hidden="true" className="pointer-events-none absolute right-3 hidden rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-500 sm:block">
                {isMac ? "⌘ K" : "Ctrl K"}
              </kbd>
            )}
          </div>
          {/* 2026-09-21 — Mark Leave lives here now, beside Add member. Anyone
              can mark their own time off, so it is NOT behind Manage team; the
              glass pill keeps Add member as the header's main (ink) action. */}
          <RequestLeaveDialog
            onDone={() => qc.invalidateQueries({ queryKey: ["leaves"] })}
            triggerClassName={`flex h-12 shrink-0 items-center gap-2 rounded-pill px-5 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`} />
          {/* Seats in use, before the limit bites — only for the people who
              add members. */}
          {canManageTeam && seatPlan?.seat_limit != null && (
            <span data-testid="team-seats"
              title="People on the team, including invites not yet accepted"
              className={`hidden h-12 shrink-0 items-center rounded-pill px-4 text-xs font-medium sm:flex ${
                seatPlan.seats_used >= seatPlan.seat_limit ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200"
                  : `text-slate-600 ${GLASS_PILL}`}`}>
              {seatPlan.seats_used} of {seatPlan.seat_limit} seats
            </span>
          )}
          {canManageTeam && (
            <MemberDialog roleOptions={roleOptions} members={members} onSaved={refresh} onInvite={setInvite}
              trigger={
                <button type="button" data-testid="add-user-button"
                  className={`flex h-12 shrink-0 items-center gap-2 rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
                  <Plus size={16} weight="bold" aria-hidden="true" />
                  <span className="hidden sm:inline">Add member</span>
                  <span className="sm:hidden">Add</span>
                </button>
              } />
          )}
        </div>
      </div>

      {readOnlyNotice && <div className="mb-6 lg:hidden">{readOnlyNotice}</div>}

      {out.length > 0 && <CurrentlyOutStrip people={out} />}

      {usersQ.isLoading ? (
        <TreeSkeleton mobile={isMobile} />
      ) :members.length === 0 || (q && shownCount === 0) ? (
        <div className={`px-6 py-10 text-center text-sm text-slate-600 ${DRAWER_CARD}`} data-testid="team-empty">
          {q ? `Nobody matches “${query.trim()}”.` : "No team members yet."}
        </div>
      ) : isMobile ? (
        <OrgTree
          owners={owners}
          branches={branches}
          isOpen={isOpen}
          onToggle={toggleBranch}
          searching={!!q}
          renderMember={renderMember}
          renderAdd={renderAdd}
        />
      ) : (
        <OrgCanvas
          owners={owners}
          teams={teams}
          query={q}
          matches={(u) => memberMatches(u, q, tenantRoles)}
          teamMatches={(t) => t.label.toLowerCase().includes(q)}
          titleOf={(u) => u.title || roleNameFor(tenantRoles, u.role)}
          meId={user?.id}
          outIds={outIds}
          onOpen={setProfileUser}
          renderAdd={canvasAdd}
        />
      )}

      <MemberProfileDialog
        u={profileUser}
        onClose={() => setProfileUser(null)}
        onSaved={() => { refresh(); setProfileUser(null); }}
        onInvite={(info) => { setInvite(info); setProfileUser(null); }}
        onInviteLink={getInviteLink}
        /* The dialog holds a snapshot of the member taken on click, so the new
           photo is written into it as well as refetched into the roster.
           avatar_url is set explicitly: a removal returns a record WITHOUT
           the field, and a plain spread would keep the old photo. */
        onAvatarChanged={(updated) => {
          if (updated) setProfileUser((p) => (p ? { ...p, ...updated, avatar_url: updated.avatar_url } : p));
          refresh();
        }}
        members={members}
        roleOptions={roleOptions}
        roleName={(key) => roleNameFor(tenantRoles, key)}
        canManageTeam={canManageTeam}
        isOwner={isOwner}
        currentUserId={user?.id}
      />
    </div>
  );
}

/* While the roster loads, the outline of the tree it is about to draw (founder,
   2026-09-16): on desktop the owner's circle, a connector and a column of
   cards; on a phone the owner and a stack of rows. Not a grid of four cards. */
function TreeSkeleton({ mobile }) {
  if (mobile) {
    return (
      <div className="flex flex-col items-center gap-4" aria-hidden="true" data-testid="team-skeleton">
        <div className="ds-skeleton h-24 w-24 rounded-full" />
        <div className="ds-skeleton h-4 w-32 rounded-full" />
        <div className="mt-2 w-full space-y-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="ds-skeleton h-16 w-full rounded-full" />)}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-[min(560px,calc(100dvh/var(--ui-scale,1)-16rem))] min-h-[420px] items-center" aria-hidden="true" data-testid="team-skeleton">
      <div className="flex w-[240px] shrink-0 flex-col items-center gap-4">
        <div className="ds-skeleton h-[156px] w-[156px] rounded-full" />
        <div className="ds-skeleton h-4 w-36 rounded-full" />
        <div className="ds-skeleton h-9 w-32 rounded-full" />
      </div>
      <div className="h-px w-[120px] shrink-0 bg-slate-900/10" />
      <div className="flex h-full flex-col justify-center gap-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="ds-skeleton flex h-[78px] w-[320px] items-center gap-3 rounded-full" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemberProfileDialog — everything about one person, opened from their card:
// who they are, how to reach them, their reporting line, what they can open,
// and their leave. Managers edit from here; everyone else reads.
// ---------------------------------------------------------------------------
function MemberProfileDialog({
  u, onClose, onSaved, onInvite, onInviteLink, onAvatarChanged,
  members, roleOptions, roleName, canManageTeam, isOwner, currentUserId,
}) {
  const openChange = (o) => { if (!o) onClose(); };
  if (!u) return null;
  const isMe = u.id === currentUserId;
  const status = statusOf(u);
  const perms = u.role === "owner" ? PERMISSIONS.map((p) => p.key) : userPerms(u);
  const granted = PERMISSIONS.filter((pp) => perms.includes(pp.key));
  const denied = PERMISSIONS.filter((pp) => !perms.includes(pp.key));
  const manager = (members || []).find((m) => m.id === u.reporting_manager_id);
  // Only an owner edits another owner — the rule PATCH /users holds too.
  const canManageMember = canManageTeam && (u.role !== "owner" || isOwner);
  // Without Manage Team a member still edits their OWN basic details here
  // (name, job title) — never their department, reporting line or access.
  const canEdit = canManageMember || isMe;
  const basicOnly = !canManageMember;
  // Someone's access is a team manager's to see; everyone else sees only their own.
  const showAccess = canManageTeam || isMe;
  // ASK-6: leave is for team managers and for the person themselves.
  const showLeave = canManageTeam || isMe;
  // Every member but an owner gets the invite-link icon from a team manager
  // (founder, 2026-09-16). The link logs in by a code texted to their mobile,
  // so for someone with no number the icon opens their form to add one, and
  // the link follows the save.
  const canInvite = canManageTeam && u.role !== "owner";

  return (
    <Dialog open={!!u} onOpenChange={openChange}>
      {/* 2026-09-16, founder: the photo sits on the card's top edge, so the
          dialog itself is an unclipped, transparent frame and the card inside
          it carries the surface; only the card's body scrolls. */}
      <DialogContent
        className="top-[calc(50%+2.5rem)] max-h-none w-[calc(100%-1.5rem)] max-w-4xl gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none lg:p-0 [&>button.absolute]:hidden"
        overlayClassName="bg-slate-900/15"
        data-testid={`profile-dialog-${u.id}`}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{u.name}</DialogTitle>
          <DialogDescription>Profile, reporting line, access and leave for {u.name}</DialogDescription>
        </DialogHeader>

        {/* max-h leaves room for the photo's 66px above the card, the dialog's
            2.5rem shift down, and a visible margin of the page below it. dvh is
            divided by --ui-scale: the body is CSS-zoomed (hooks/useUiScale) and
            viewport units are not, so an undivided 100dvh ran off the bottom of
            the screen by the scale factor. */}
        <div className={`relative mt-[66px] flex max-h-[calc(100dvh/var(--ui-scale,1)-12rem)] flex-col rounded-[1.75rem] ${PROFILE_GLASS} ${PROFILE_INK}`}>
          {/* ASK-25 — the member themselves, or anyone who could edit their
              access, can set the photo. The server holds the same rule. About
              55% of the circle rises above the card. */}
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[55%]">
            <AvatarEditor u={u} canChange={isMe || canEdit} onChanged={onAvatarChanged} size={120} />
          </div>
          {/* 2026-09-19, founder — Edit sits beside Close, not down in the Access
              section, and is called "Edit" rather than "Edit access": from up
              here it opens the whole member form (details AND access), so the
              old label named only half of what the button does. One cluster so
              the two controls share a baseline and the card has a single
              top-right corner rather than a button floating mid-panel. */}
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            {canEdit && (
              <MemberDialog
                roleOptions={roleOptions}
                initial={u}
                members={members}
                onSaved={onSaved}
                // A save here can mint an invite token (phone added, or the
                // member re-invited). Without this it was created and dropped.
                onInvite={onInvite}
                basicOnly={basicOnly}
                trigger={
                  <button type="button" data-testid={`edit-access-${u.id}`}
                    aria-label={`Edit ${u.name}`}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
                    <PencilSimple size={13} weight="bold" aria-hidden="true" /> Edit
                  </button>
                }
              />
            )}
            <button type="button" onClick={onClose} aria-label="Close" data-testid={`profile-close-${u.id}`}
              className={GLASS_ICON_BTN}>
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {/* Under the photo: their name and their role. Nothing else. */}
          <div className="px-16 pb-5 pt-[4.5rem] text-center">
            <p className="flex items-center justify-center gap-1.5">
              <span className="truncate text-2xl font-semibold leading-tight text-neutral-900">{u.name}</span>
              {/* The invite link sits beside the name as a bare icon (founder,
                  2026-09-16): no pill behind it, a pointer and a tooltip on hover. */}
              {canInvite && (u.phone ? (
                <button type="button" onClick={() => onInviteLink(u)} data-testid={`invite-link-${u.id}`}
                  aria-label={`Get ${u.name}'s invite link`} title="Get invite link"
                  className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-slate-500 transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30">
                  <LinkSimple size={18} weight="bold" aria-hidden="true" />
                </button>
              ) : (
                <MemberDialog roleOptions={roleOptions} initial={u} members={members} onSaved={onSaved} onInvite={onInvite} inviteAfterSave
                  trigger={
                    <button type="button" data-testid={`invite-link-${u.id}`}
                      aria-label={`Add a mobile number to get ${u.name}'s invite link`} title="Add a mobile number to get an invite link"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-slate-500 transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30">
                      <LinkSimple size={18} weight="bold" aria-hidden="true" />
                    </button>
                  } />
              ))}
            </p>
            <p className="mt-1 truncate text-sm text-neutral-600" data-testid={`profile-title-${u.id}`}>{u.title || roleName(u.role)}</p>
          </div>

          {/* Body. On a phone the columns stack and the body scrolls as one. From md
              up each column is its own scroll area (founder, 2026-09-16): a long
              leave history scrolls on the right without moving the details on
              the left, and the left scrolls only if its own content is too tall. */}
          <div className={`grid min-h-0 flex-1 gap-6 overflow-y-auto border-t border-slate-900/[0.06] px-6 pt-5 [scrollbar-width:thin] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden ${showLeave ? "md:grid-cols-2" : ""}`}>
            {/* Left: personal details and access. */}
            <div className="min-w-0 space-y-5 pb-6 md:min-h-0 md:overflow-y-auto md:[scrollbar-width:thin]">
          <section>
            <p className={DRAWER_LABEL}>Personal details</p>
            {/* Each fact is its own glass tile; email spans the row, since it
                is the long value people copy. */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {/* Optional since members sign in by mobile (2026-09-19): say so
                  rather than show an empty box. */}
              <ContactRow icon={EnvelopeSimple} label="Email" value={u.email || "Not added"} muted={!u.email} wide />
              {u.phone && <ContactRow icon={Phone} label="Phone" value={formatPhone(u.phone)} />}
              <ContactRow icon={Briefcase} label="Department" value={roleName(u.role)} />
              <ContactRow icon={Pulse} label="Status" value={
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
                  {status.label}
                </span>
              } />
              {/* No "Direct reports" here (founder, 2026-09-16): the tree already shows them. */}
              <ContactRow icon={User} label="Reports to" value={manager ? manager.name : "No one"} />
              {/* 2026-09-16 — in their own words, from Settings > Your Profile:
                  what to bring them. Only shown once they have written it. */}
              {u.about && <ContactRow icon={ChatText} label="Handles" value={u.about} wide />}
            </div>
          </section>

          {showAccess && (
          <section data-testid={`profile-access-${u.id}`}>
            {/* The edit button used to sit here; it is up beside Close now. */}
            <div className="mb-2.5 flex items-center gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <ShieldCheck size={13} weight="bold" aria-hidden="true" /> Access
              </p>
            </div>
            {u.role === "owner" ? (
              <p className={`px-4 py-3 text-sm text-slate-600 ${PROFILE_TILE}`}>Owner has full access to every part of the app.</p>
            ) : (
              <div className={`px-4 py-4 ${PROFILE_TILE}`}>
                <p className="text-sm text-slate-800">
                  <span className="font-semibold tabular-nums">{granted.length}</span>
                  <span className="text-slate-500"> of {PERMISSIONS.length} areas</span>
                </p>
                {granted.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`granted-perms-${u.id}`}>
                    {granted.map((pp) => <span key={pp.key} className={PROFILE_CHIP}>{pp.label}</span>)}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No areas granted yet.</p>
                )}
                {denied.length > 0 && (
                  <p className="mt-3 text-xs leading-relaxed text-slate-500">No access to {denied.map((pp) => pp.label).join(", ")}.</p>
                )}
              </div>
            )}
          </section>
          )}

            </div>

            {/* Right: their leave, as a timeline (team managers and the person themselves). */}
            {showLeave && (
              <div className="min-w-0 pb-6 md:min-h-0 md:overflow-y-auto md:border-l md:border-slate-900/[0.06] md:pl-6 md:pr-1 md:[scrollbar-width:thin]" data-testid="profile-leave-scroll">
                <MemberLeaveTimeline userId={u.id} />
              </div>
            )}
          </div>

          {/* 2026-09-15 — off-boarding: the owner removes someone (or cancels a
              pending invite) and picks who takes over their work. It sits under
              both columns, out of the way until it is needed. */}
          {isOwner && !isMe && (
            <div className="shrink-0 border-t border-slate-900/[0.06] px-6 py-4">
              <RemoveMemberSection u={u} members={members} onDone={onSaved} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* 2026-09-15 — remove someone from the company, or cancel their pending invite.
   Shows what they hold, asks who takes it over, then POST /deprovision: their
   sign-in ends, open work / contacts / reports go to that person, and approvals
   and decisions go to them when allowed, else to the owner. History stays. */
function RemoveMemberSection({ u, members, onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState(null);
  const pending = u.invite_status === "pending";
  const summaryQ = useQuery({
    queryKey: ["offboarding", u.id],
    queryFn: () => api.get(`/users/${u.id}/offboarding`).then((r) => r.data),
    enabled: open && !pending,
  });
  const s = summaryQ.data;
  const chosen = to ?? (s?.suggested_replacement_id || "");
  const others = (members || []).filter((m) => m.id !== u.id && m.invite_status !== "pending");
  const first = u.name.split(" ")[0];

  const cancelInvite = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${u.id}/uninvite`);
      toast.success(`Invite for ${u.name} cancelled`);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't cancel the invite");
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${u.id}/deprovision`, { reassign_to_user_id: chosen || null });
      const who = others.find((m) => m.id === chosen)?.name;
      const moved = (data.tasks_reassigned || 0) + (data.approvals_moved || 0) + (data.decisions_moved || 0);
      toast.success(`${u.name} removed${who && moved ? ` — ${moved} item${moved === 1 ? "" : "s"} handed to ${who}` : ""}`);
      onDone();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't remove them");
    } finally { setBusy(false); }
  };

  if (pending) {
    return (
      <div className="border-t border-slate-900/[0.06] pt-4">
        <button type="button" onClick={cancelInvite} disabled={busy} data-testid={`cancel-invite-${u.id}`}
          className={`inline-flex h-10 items-center rounded-pill px-4 text-sm font-medium text-rose-700 transition-colors hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
          {busy ? "Cancelling…" : "Cancel invite"}
        </button>
      </div>
    );
  }
  const rows = s ? [
    ["Open tasks they do", s.tasks_doing],
    ["Open tasks they help on (they come off)", s.tasks_helping],
    ["Tasks waiting for their approval", s.tasks_approving],
    ["Decisions waiting on them", s.decisions_waiting],
    ["People who report to them", s.reports],
    ["Contacts assigned to them", s.contacts],
  ] : [];
  return (
    <div className="border-t border-slate-900/[0.06] pt-4" data-testid={`remove-member-${u.id}`}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} data-testid={`remove-member-open-${u.id}`}
          className={`inline-flex h-10 items-center rounded-pill px-4 text-sm font-medium text-rose-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
          Remove from company
        </button>
      ) : (
        <div className={`space-y-3 px-4 py-4 ${DRAWER_CARD}`}>
          <p className="text-sm font-semibold text-neutral-900">Remove {u.name}?</p>
          <p className="text-xs leading-relaxed text-neutral-600">
            {first} can no longer sign in. Their history stays. Nothing is deleted.
          </p>
          {summaryQ.isLoading ? (
            <div className="ds-skeleton h-24 rounded-xl" aria-hidden="true" />
          ) : summaryQ.isError ? (
            <p className="text-xs text-rose-700">Couldn't load what they hold. Close and try again.</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid={`offboarding-summary-${u.id}`}>
              {rows.map(([label, n]) => (
                <div key={label} className="contents">
                  <dt className="text-neutral-600">{label}</dt>
                  <dd className="text-right font-semibold tabular-nums text-neutral-900">{n}</dd>
                </div>
              ))}
            </dl>
          )}
          <Field label="Hand their work to">
            <GlassSelect testid={`remove-member-to-${u.id}`} ariaLabel="Who takes over" value={chosen} onChange={setTo}
              options={[{ value: "", label: "Nobody (tasks left unassigned)" }, ...others.map((m) => ({ value: m.id, label: m.name }))]} />
          </Field>
          <p className="text-xs leading-relaxed text-neutral-500">
            Open tasks, contacts and the people who report to {first} go to the person you pick. Approvals and decisions go to them
            when they're allowed to approve, otherwise to the owner.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={busy || summaryQ.isLoading} data-testid={`remove-member-confirm-${u.id}`}
              className="inline-flex h-10 items-center rounded-pill bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50">
              {busy ? "Removing…" : `Remove ${first}`}
            </button>
            <button type="button" onClick={() => { setOpen(false); setTo(null); }} disabled={busy}
              className={`inline-flex h-10 items-center rounded-pill px-4 text-sm font-medium text-neutral-800 hover:bg-white ${GLASS_PILL}`}>
              Keep them
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ASK-25 — squares and shrinks a photo in the browser before it is sent.
   A phone photo is 3–12MB and a My Work grid draws the same faces on every
   card; 256px covers the largest (64px) at 4x. JPEG over a white fill, so a
   transparent PNG does not come back with a black background. */
async function squareImage(file, size) {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.88));
  } finally {
    URL.revokeObjectURL(src);
  }
}

function AvatarEditor({ u, canChange, onChanged, size = 120 }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const run = async (request, done) => {
    setBusy(true);
    try {
      const { data } = await request();
      onChanged?.(data);
      toast.success(done);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't update the photo");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";   // picking the same file again should still fire
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      toast.error("Use a JPG, PNG or WebP image");
      return;
    }
    let blob;
    try { blob = await squareImage(f, 256); }
    catch { toast.error("Couldn't read that image"); return; }
    const fd = new FormData();
    fd.append("file", blob, "avatar.jpg");
    run(() => api.post(`/users/${u.id}/avatar`, fd, { headers: { "Content-Type": "multipart/form-data" } }), "Photo updated");
  };

  /* 2026-09-16, founder: hovering the photo shows a dark overlay with a camera
     to change it; with a photo on file, a small remove button joins it. On a
     touch screen (no hover) a small camera badge stays visible instead. */
  const label = u.avatar_url ? "Change photo" : "Add photo";
  return (
    <div className="group relative shrink-0 rounded-full" style={{ width: size, height: size }}>
      <PersonAvatar name={u.name} src={u.avatar_url} size={size} ring={false}
        className={`ring-4 ring-white shadow-[0_18px_40px_-18px_hsl(245_30%_25%/0.55)] ${busy ? "opacity-60" : ""}`} />
      {canChange && (
        <>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            data-testid={`avatar-change-${u.id}`} aria-label={label} title={label}
            className="absolute inset-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 focus-visible:ring-offset-2 disabled:cursor-wait [&:focus-visible>span:first-child]:opacity-100">
            {/* Hover or keyboard focus only: the dialog focuses this button when
                it opens, and plain focus would show the overlay on every open. */}
            <span aria-hidden="true"
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-neutral-950/55 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:hidden">
              <Camera size={24} weight="bold" />
              <span className="text-[12px] font-medium">{label}</span>
            </span>
            <span aria-hidden="true"
              className="absolute bottom-1 right-1 hidden h-8 w-8 place-items-center rounded-full bg-white text-slate-700 ring-1 ring-slate-900/10 shadow-[0_2px_8px_-2px_hsl(216_28%_18%/0.35)] [@media(hover:none)]:grid">
              <Camera size={15} weight="bold" />
            </span>
          </button>
          {u.avatar_url && (
            <button type="button" disabled={busy}
              onClick={() => run(() => api.delete(`/users/${u.id}/avatar`), "Photo removed")}
              data-testid={`avatar-remove-${u.id}`} aria-label="Remove photo" title="Remove photo"
              className="absolute -right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-white text-slate-600 opacity-0 ring-1 ring-slate-900/10 shadow-[0_2px_8px_-2px_hsl(216_28%_18%/0.35)] transition-opacity hover:text-rose-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 group-hover:opacity-100 disabled:opacity-50 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
              <Trash size={14} weight="bold" aria-hidden="true" />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
            className="hidden" onChange={onFile} data-testid={`avatar-input-${u.id}`} />
        </>
      )}
    </div>
  );
}

// NM-16: label ABOVE value, not a fixed column beside it — the email is the
// field someone actually needs to copy, so it is never truncated.
// 2026-09-16, founder: each fact is a glass tile with its icon in a glass chip.
function ContactRow({ icon: Icon, label, value, wide = false, muted = false }) {
  return (
    <div className={`flex min-w-0 items-start gap-3 px-3.5 py-3 ${PROFILE_TILE} ${wide ? "sm:col-span-2" : ""}`}>
      <span aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/60 text-slate-600 border border-white/70">
        <Icon size={15} weight="bold" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-0.5 break-words text-sm ${muted ? "text-slate-400" : "text-slate-800"}`}
          data-testid={muted ? "contact-row-empty" : undefined}>{value}</p>
      </div>
    </div>
  );
}
