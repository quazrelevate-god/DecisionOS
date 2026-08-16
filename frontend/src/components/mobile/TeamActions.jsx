/**
 * Team management for touch — the three things the desktop Team page can do,
 * rebuilt as sheets, in one module so they exist exactly once.
 *
 * WHY THIS EXISTS. The mobile Team screen had been shipping a read-only view of
 * a management page. Comparing the two:
 *
 *   Add member          desktop: full form      mobile: absent entirely — the
 *                                               empty state told the owner to
 *                                               go and find a computer.
 *   Edit access         desktop: role, perms,   mobile: permissions rendered as
 *                       manager, phone          decorative chips. Not editable.
 *   Invite              desktop: modal with     mobile: fired the POST and
 *                       the link, copy button,  toasted "invite ready" — the
 *                       WhatsApp share          link itself was never shown, so
 *                                               nothing could be sent.
 *   Mark absent         desktop: POST           mobile: POST /leaves/absence,
 *                       /attendance, toggles    a DIFFERENT feature (emergency
 *                       absent<->present        absence report). One-way, and
 *                                               it never moved the attendance
 *                                               record the desktop reads back.
 *
 * The last one is the one to notice: it wasn't missing, it was wired to the
 * wrong endpoint, so it appeared to work and silently did something else.
 *
 * Both callers — the Team screen and the Ops grid — take their behaviour from
 * here, so the two can't drift apart again.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShieldCheck, Check, Copy, WhatsappLogo, PaperPlaneTilt, LinkSimple,
} from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { PERMISSIONS, defaultPermsForRole, hasPerm } from "../../lib/perms";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./BottomSheet";
import { SheetSelect } from "./SheetSelect";

// Kept in step with Team.js — what a member will see once permissions are set.
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

const field =
  "w-full rounded-xl border border-hairline bg-card px-3.5 text-[16px] " +
  // 16px, not 14: below 16 iOS Safari zooms the viewport on focus and the user
  // is left scrolled sideways on a form they cannot see the edges of.
  "placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40";
const FIELD_H = { minHeight: "var(--control-h-md)" };

/** Everything both callers need: the roster, who's absent, and the two writes. */
export function useTeamData() {
  const qc = useQueryClient();
  const { user, tenant } = useAuth();
  const isOwner = user?.role === "owner";
  const canManageTeam = hasPerm(user, "team_manage");

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
  });
  const { data: attendance } = useQuery({
    queryKey: ["attendance"],
    queryFn: () => api.get("/attendance").then((r) => r.data),
  });

  const members = Array.isArray(data) ? data : data?.users || [];
  const absentIds = new Set(
    (Array.isArray(attendance) ? attendance : [])
      .filter((a) => a.status === "absent")
      .map((a) => a.user_id)
  );
  const roleOptions = [
    ...(tenant?.roles || []),
    ...(isOwner ? [{ key: "owner", label: "Owner" }] : []),
  ];

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  // POST /attendance, the same endpoint and the same toggle as the desktop —
  // NOT /leaves/absence, which files an emergency absence report instead.
  const toggleAbsent = async (u) => {
    const nowAbsent = absentIds.has(u.id);
    try {
      await api.post("/attendance", { user_id: u.id, status: nowAbsent ? "present" : "absent" });
      toast.success(`${u.name} marked ${nowAbsent ? "present" : "absent"}`);
      qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save that");
    }
  };

  const getInviteLink = async (u) => {
    try {
      const { data: d } = await api.post(`/users/${u.id}/invite`);
      return { token: d.invite_token, name: d.name, phone_masked: d.phone_masked };
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't create invite link");
      return null;
    }
  };

  return { members, isLoading, absentIds, isOwner, canManageTeam, roleOptions, refresh, toggleAbsent, getInviteLink };
}

/** The invite link itself — copyable and shareable, which was the missing half. */
export function InviteSheet({ info, onClose }) {
  const link = info ? `${window.location.origin}/login?invite=${info.token}` : "";
  const msg = info
    ? `You're invited to DecisionOS. Tap to sign in — we'll text you a login code: ${link}`
    : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy — press and hold the link to copy it");
    }
  };

  return (
    <BottomSheet
      open={!!info}
      onClose={onClose}
      title={`Invite ${info?.name || ""}`}
      description={`They open the link and get a code texted to ${info?.phone_masked || "their mobile"} — no password needed.`}
      data-testid="invite-link-sheet"
    >
      <div className="space-y-touch-gap">
        <input
          readOnly
          value={link}
          data-testid="invite-link-input"
          onFocus={(e) => e.target.select()}
          className={cn(field, "font-mono text-[13px]")}
          style={FIELD_H}
        />
        <button
          type="button"
          onClick={copy}
          data-testid="copy-invite-link"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
          style={FIELD_H}
        >
          <Copy size={18} weight="bold" /> Copy link
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(msg)}`}
          target="_blank"
          rel="noreferrer"
          data-testid="invite-whatsapp-share"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-card text-base font-semibold"
          style={FIELD_H}
        >
          <WhatsappLogo size={18} weight="bold" className="text-success-600" /> Share on WhatsApp
        </a>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Auto-SMS starts once your SMS provider is connected — until then send this link yourself.
          It expires in 7 days.
        </p>
      </div>
    </BottomSheet>
  );
}

/**
 * Add a member, or edit an existing one's access.
 *
 * Same two modes, same validation, same owner-promotion confirmations and same
 * requests as the desktop dialog — `initial` absent means add, present means
 * edit. The layout is the part that differs: one column, 48px controls, and the
 * role and manager pickers are sheets rather than <select>s.
 */
export function AccessSheet({ open, onClose, initial, roleOptions = [], members = [], onSaved, onInvite }) {
  const editing = !!initial;
  const blank = {
    name: "", email: "", password: "", phone: "", passwordless: false,
    role: roleOptions[0]?.key || "",
    permissions: defaultPermsForRole(roleOptions[0]?.key),
    reporting_manager_id: "",
  };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  // Re-seed whenever the sheet is opened for a different member.
  const [seeded, setSeeded] = useState(null);
  if (open && seeded !== (initial?.id || "__new__")) {
    setSeeded(initial?.id || "__new__");
    setForm(
      initial
        ? {
            name: initial.name, email: initial.email, password: "",
            phone: initial.phone || "", passwordless: false, role: initial.role,
            permissions: Array.isArray(initial.permissions) && initial.permissions.length
              ? [...initial.permissions]
              : defaultPermsForRole(initial.role),
            reporting_manager_id: initial.reporting_manager_id || "",
          }
        : blank
    );
  }
  if (!open && seeded !== null) setSeeded(null);

  const setRole = (role) =>
    setForm((f) => ({
      ...f,
      role,
      permissions:
        role === "owner" ? PERMISSIONS.map((p) => p.key)
        : editing && f.role !== "owner" ? f.permissions
        : defaultPermsForRole(role),
    }));

  const togglePerm = (key) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((k) => k !== key)
        : [...f.permissions, key],
    }));

  const save = async () => {
    setBusy(true);
    try {
      const promotingToOwner = form.role === "owner" && (!editing || initial.role !== "owner");
      if (promotingToOwner && !window.confirm("This makes them a co-owner with FULL control of the company account — including managing team, finances and all data. Continue?")) return;
      const demotingOwner = editing && initial.role === "owner" && form.role !== "owner";
      if (demotingOwner && !window.confirm(`Remove Owner access from ${initial.name}? They will lose full control. At least one owner must remain.`)) return;

      if (editing) {
        await api.patch(`/users/${initial.id}`, {
          role: form.role, permissions: form.permissions,
          phone: form.phone, reporting_manager_id: form.reporting_manager_id,
        });
        toast.success(`${initial.name}'s access updated`);
        onClose?.(); onSaved?.();
        return;
      }

      if (!form.name.trim() || !form.email.trim()) return toast.error("Name and email are required");
      const base = {
        name: form.name, email: form.email, role: form.role, permissions: form.permissions,
        phone: form.phone, reporting_manager_id: form.reporting_manager_id || null,
      };
      let res;
      if (form.passwordless) {
        if (form.phone.replace(/\D/g, "").length < 10) return toast.error("A valid mobile number is required for OTP login");
        res = await api.post("/users", base);
      } else {
        if (form.password.length < 6) return toast.error("Set a 6+ character password, or switch to mobile OTP");
        res = await api.post("/users", { ...base, password: form.password });
      }
      toast.success(`${form.name} added`);
      onClose?.(); onSaved?.();
      if (res?.data?.invite_token && onInvite) {
        const d = form.phone.replace(/\D/g, "");
        onInvite({
          token: res.data.invite_token, name: form.name,
          phone_masked: d.length >= 4 ? "•••• " + d.slice(-4) : "••••",
        });
      }
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const isOwnerRole = form.role === "owner";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={editing ? `Edit access — ${initial.name}` : "Add team member"}
      size="tall"
      data-testid="access-sheet"
      footer={
        <button
          type="button"
          onClick={save}
          disabled={busy}
          data-testid="member-save-submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          style={FIELD_H}
        >
          {busy ? "Saving…" : editing ? "Save access" : "Add member"}
        </button>
      }
    >
      <div className="space-y-4">
        {!editing && (
          <>
            <input
              data-testid="member-name-input" className={field} style={FIELD_H} placeholder="Name"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              data-testid="member-email-input" className={field} style={FIELD_H} type="email"
              inputMode="email" autoCapitalize="none" placeholder="Email"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-hairline p-1" data-testid="login-method-toggle">
              {[
                { on: !form.passwordless, testid: "login-method-password", label: "Password", set: false },
                { on: form.passwordless, testid: "login-method-otp", label: "Mobile OTP", set: true },
              ].map((o) => (
                <button
                  key={o.testid} type="button" data-testid={o.testid} aria-pressed={o.on}
                  onClick={() => setForm({ ...form, passwordless: o.set })}
                  className={cn(
                    "rounded-lg text-sm font-semibold transition-colors",
                    o.on ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  )}
                  style={{ minHeight: "var(--control-h-sm)" }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {!form.passwordless && (
              <input
                data-testid="member-password-input" className={field} style={FIELD_H} type="password"
                placeholder="Temporary password (min 6)"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </>
        )}

        <input
          data-testid="member-phone-input" className={field} style={FIELD_H} type="tel" inputMode="tel"
          placeholder={form.passwordless ? "Mobile number (required for OTP)" : "Mobile number (for OTP login)"}
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        {!editing && form.passwordless && (
          <p className="-mt-2 text-[13px] text-muted-foreground" data-testid="passwordless-hint">
            No password needed — they sign in with a one-time code sent to their mobile.
          </p>
        )}

        {/* SheetSelect's `label` is the sheet heading and the accessible name,
            not a visible field label — the trigger renders only the value. The
            desktop form labels both selects, and without these two the pickers
            read as an unexplained "Sales" above an unexplained "None".
            Its onChange emits a synthetic { target: { value } } for drop-in
            <select> compatibility, so both handlers unwrap it. */}
        <div>
          <label className="mb-1.5 block text-[length:var(--text-label)] font-semibold text-muted-foreground">Role</label>
          <SheetSelect
            label="Role" value={form.role}
            onChange={(e) => setRole(e.target.value)}
            data-testid="member-role-select"
            options={roleOptions.map((r) => ({ value: r.key, label: r.label }))}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[length:var(--text-label)] font-semibold text-muted-foreground">
            Reporting manager (for leave approvals)
          </label>
          <SheetSelect
            label="Reporting manager"
            value={form.reporting_manager_id}
            onChange={(e) => setForm((f) => ({ ...f, reporting_manager_id: e.target.value }))}
            placeholder="None (use department approver)"
            data-testid="member-manager-select"
            options={[
              { value: "", label: "None (use department approver)" },
              ...members.filter((m) => m.id !== initial?.id).map((m) => ({ value: m.id, label: `${m.name} · ${m.role}` })),
            ]}
          />
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold text-muted-foreground">
            <ShieldCheck size={16} weight="bold" className="text-brand-600" />
            Access — what they can open and use
          </p>

          {isOwnerRole ? (
            <div className="rounded-xl border border-brand-600 bg-brand-tint px-4 py-3.5" data-testid="owner-access-note">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck size={15} weight="bold" className="text-brand-600" /> Full company access
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Owners manage everything — team, finances, workflows and all data. Individual
                permissions don't apply.
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-2" data-testid="permission-list">
                {PERMISSIONS.map((p) => {
                  const on = form.permissions.includes(p.key);
                  return (
                    <li key={p.key}>
                      <button
                        type="button" data-testid={`perm-${p.key}`} aria-pressed={on}
                        onClick={() => togglePerm(p.key)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-left text-sm font-semibold transition-colors",
                          on ? "border-primary bg-brand-tint" : "border-hairline bg-card"
                        )}
                        style={FIELD_H}
                      >
                        <span>{p.label}</span>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                            on ? "border-primary bg-primary text-primary-foreground" : "border-hairline"
                          )}
                        >
                          {on && <Check size={12} weight="bold" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-hairline pt-3" data-testid="menu-preview">
                <p className="mb-2 text-[length:var(--text-label)] font-semibold text-muted-foreground">
                  They will see these menus
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {MENU_PREVIEW.map((m) => {
                    const visible = !m.perm || form.permissions.includes(m.perm);
                    return (
                      <li key={m.label}>
                        <span
                          data-testid={`preview-${m.label}`}
                          className={cn(
                            "inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold",
                            visible
                              ? "border-success-600/30 bg-success-600/10 text-success-700"
                              : "border-hairline text-muted-foreground line-through opacity-60"
                          )}
                        >
                          {m.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  Everyone always has CEO Brief, My Work and Meeting Notes.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

/** The Invite button's two states, shared so both callers behave identically. */
export function inviteAffordance(u) {
  // Desktop only offers Invite when a phone exists — the link texts a code, so
  // without a number there is nothing to send it to.
  return { enabled: !!u?.phone, icon: u?.phone ? LinkSimple : PaperPlaneTilt };
}
