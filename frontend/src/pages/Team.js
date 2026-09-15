/* 2026-09-14, founder — /team is an org tree (pages/team/OrgTree.jsx): the
   owner at the root, a branch per team, each team's people under it, a search
   across members, teams and roles (⌘K), and "Add member" both in the header
   and at the end of every branch, pre-set to that team. The dialogs — add /
   edit access, profile, invite link — moved onto the glass design system:
   GlassSelect for role and reporting manager, and a job title, which the
   tree shows under each name. */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPhone } from "../lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS, hasPerm, roleDefaultPerms, userPerms } from "../lib/perms";
import { toast } from "sonner";
import {
  AirplaneTakeoff, Camera, Check, Copy, EnvelopeSimple, Eye, LinkSimple, MagnifyingGlass,
  PencilSimple, Phone, Plus, ShieldCheck, User, UsersThree, WhatsappLogo, X,
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
// ASK-6 (2026-09-12): Leave register + personal history land here.
// LeaveCard is reused as the shared card primitive; the register uses
// the same /leaves endpoints that pages/Leave.js consumed.
import { LeaveCard } from "./Leave";

const SHEET = `gap-5 rounded-[1.75rem] p-6 sm:rounded-[1.75rem] [&>button.absolute]:hidden ${GLASS_SHEET}`;
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
function SheetHead({ title, children, onClose, closeTestid }) {
  return (
    <div className="flex items-start gap-3">
      <DialogHeader className="min-w-0 flex-1 space-y-1.5 text-left">
        <DialogTitle className="text-lg font-semibold text-neutral-900">{title}</DialogTitle>
        {children && <DialogDescription className="text-sm text-neutral-600">{children}</DialogDescription>}
      </DialogHeader>
      <button type="button" onClick={onClose} aria-label="Close" data-testid={closeTestid} className={GLASS_ICON_BTN}>
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
   the dialog opens from that team's branch. */
function MemberDialog({ trigger, initial, defaultRole, roleOptions, onSaved, onInvite, members = [] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user: me } = useAuth();
  const editing = !!initial;
  const startRole = defaultRole && roleOptions.some((r) => r.key === defaultRole) ? defaultRole : roleOptions[0]?.key || "";
  const blankForm = () => ({
    name: "", email: "", title: "", password: "", phone: "", passwordless: false,
    role: startRole, permissions: roleDefaultPerms(startRole, roleOptions), reporting_manager_id: "",
    // 2026-09-15 — a new member follows their role's access unless unticked.
    follow_role: true,
  });
  const [form, setForm] = useState(blankForm);
  const roleName = (key) => roleOptions.find((r) => r.key === key)?.label || key;
  const rolePerms = roleDefaultPerms(form.role, roleOptions);
  const shownPerms = form.follow_role ? rolePerms : form.permissions;

  const openChange = (o) => {
    setOpen(o);
    if (!o) return;
    if (initial) {
      setForm({
        name: initial.name, email: initial.email, title: initial.title || "", password: "",
        phone: initial.phone || "", passwordless: false, role: initial.role,
        permissions: Array.isArray(initial.permissions) && initial.permissions.length ? [...initial.permissions] : roleDefaultPerms(initial.role, roleOptions),
        follow_role: !(Array.isArray(initial.permissions) && initial.permissions.length),
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

  const save = async () => {
    const promotingToOwner = form.role === "owner" && (!editing || initial.role !== "owner");
    if (promotingToOwner && !window.confirm("This makes them a co-owner with FULL control of the company account — including managing team, finances and all data. Continue?")) return;
    const demotingOwner = editing && initial.role === "owner" && form.role !== "owner";
    if (demotingOwner && !window.confirm(`Remove Owner access from ${initial.name}? They will lose full control. At least one owner must remain.`)) return;
    if (!editing) {
      if (!form.name.trim() || !form.email.trim()) { toast.error("Name and email are required"); return; }
      if (form.passwordless && form.phone.replace(/\D/g, "").length < 10) { toast.error("A valid mobile number is required for OTP login"); return; }
      if (!form.passwordless && form.password.length < 6) { toast.error("Set a 6+ char password, or switch to mobile OTP login"); return; }
    }
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/users/${initial.id}`, {
          role: form.role, permissions: form.follow_role ? [] : form.permissions, phone: form.phone,
          reporting_manager_id: form.reporting_manager_id, title: form.title.trim(),
        });
        toast.success(`${initial.name}'s access updated`);
        setOpen(false);
        onSaved();
        return;
      }
      const base = {
        name: form.name, email: form.email, title: form.title.trim() || null, role: form.role,
        // An empty list means "the role's access" on the server.
        permissions: form.follow_role ? [] : form.permissions, phone: form.phone, reporting_manager_id: form.reporting_manager_id || null,
      };
      const res = await api.post("/users", form.passwordless ? base : { ...base, password: form.password });
      toast.success(`${form.name} added`);
      setOpen(false);
      onSaved();
      if (res?.data?.invite_token && onInvite) {
        const d = form.phone.replace(/\D/g, "");
        onInvite({ token: res.data.invite_token, name: form.name, phone_masked: d.length >= 4 ? "•••• " + d.slice(-4) : "••••" });
      }
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={`max-h-[calc(90dvh/var(--ui-scale,1))] max-w-xl overflow-y-auto ${SHEET}`} data-testid="member-dialog">
        <SheetHead title={editing ? `Edit ${initial.role === "owner" ? "details" : "access"} — ${initial.name}` : "Add team member"}
          onClose={() => setOpen(false)} closeTestid="member-dialog-close">
          {editing ? "Job title, team, reporting line and what they can open." : "Who they are, where they sit in the team, and what they can open."}
        </SheetHead>

        <div className="space-y-5">
          <section className="space-y-3">
            {!editing && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" htmlFor="member-name">
                  <input id="member-name" data-testid="member-name-input" className={DRAWER_FIELD} placeholder="e.g. Priya Nair"
                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="Email" htmlFor="member-email">
                  <input id="member-email" data-testid="member-email-input" className={DRAWER_FIELD} type="email" placeholder="name@company.com"
                    value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title" htmlFor="member-title">
                <input id="member-title" data-testid="member-title-input" className={DRAWER_FIELD} placeholder="e.g. Sales Lead" maxLength={80}
                  value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Mobile number" htmlFor="member-phone">
                <input id="member-phone" data-testid="member-phone-input" className={DRAWER_FIELD} type="tel"
                  placeholder={form.passwordless ? "Required for OTP login" : "For OTP login"}
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            {!editing && (
              <div>
                <p className={DRAWER_LABEL}>Sign-in</p>
                <div className={`flex gap-1 rounded-pill p-1 ${DRAWER_TRACK}`} data-testid="login-method-toggle" role="group" aria-label="Sign-in method">
                  {[["password", "Password", false], ["otp", "Mobile OTP", true]].map(([key, label, passwordless]) => {
                    const on = form.passwordless === passwordless;
                    return (
                      <button key={key} type="button" aria-pressed={on} data-testid={`login-method-${key}`}
                        onClick={() => setForm({ ...form, passwordless })}
                        className={`flex h-10 flex-1 items-center justify-center rounded-pill text-sm font-medium ${on ? `${GLASS_PILL} text-slate-900` : "text-slate-500 hover:text-slate-800"}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {form.passwordless ? (
                  <p className="mt-2 text-xs text-neutral-500" data-testid="passwordless-hint">No password needed — they sign in with a one-time code sent to their mobile.</p>
                ) : (
                  <input data-testid="member-password-input" className={`${DRAWER_FIELD} mt-2`} type="password" aria-label="Temporary password"
                    placeholder="Temporary password (min 6)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Team">
                <GlassSelect testid="member-role-select" ariaLabel="Team (role)" value={form.role} onChange={setRole}
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
                    <span className="font-semibold">Use the {roleName(form.role)} role's access</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      {form.follow_role
                        ? "When the owner changes this role's access in Settings › Team roles, it reaches them too."
                        : "Their own access, chosen below. Changes to the role won't reach them."}
                    </span>
                  </span>
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="permission-list">
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
                        title={form.follow_role ? "Set by the role — untick “Use the role's access” to choose" : locked ? "Only an owner can give access you don't have" : undefined}
                        onClick={() => togglePerm(p.key)}
                        className={`flex min-h-11 items-center justify-between gap-2 rounded-2xl px-3.5 py-2 text-left text-[13px] font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${on ? "bg-neutral-900 text-white ring-transparent" : "bg-white/70 text-slate-700 ring-slate-900/[0.06] hover:bg-white"}`}>
                        <span>{p.label}</span>
                        <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${on ? "bg-white text-neutral-900" : "ring-1 ring-inset ring-slate-900/20"}`}>
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
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} disabled={busy} data-testid="member-cancel"
            className={`h-11 rounded-pill px-5 text-sm font-medium text-neutral-800 transition-colors hover:bg-white disabled:opacity-40 ${GLASS_PILL}`}>
            Cancel
          </button>
          <button type="button" data-testid="member-save-submit" onClick={save} disabled={busy}
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

/* ASK-6: per-member leave history inside the profile dialog. GET
   /leaves?scope=all is gated to team_manage users and the list is small, so
   it is filtered by user here. */
function MemberLeaveHistory({ userId }) {
  const q = useQuery({
    queryKey: ["leaves", "all"],
    queryFn: () => api.get("/leaves?scope=all").then((r) => r.data),
  });
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["leaves"] });
  const mine = (q.data || []).filter((l) => l.user_id === userId);
  return (
    <section data-testid={`member-leave-history-${userId}`}>
      <p className={`${DRAWER_LABEL} flex items-center gap-1.5`}>
        <AirplaneTakeoff size={13} weight="bold" aria-hidden="true" /> Leave history
      </p>
      {mine.length === 0 ? (
        <p className={`px-4 py-3 text-sm text-slate-500 ${DRAWER_CARD}`}>No leave on record.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {mine.slice(0, 6).map((lv) => (
            <LeaveCard key={lv.id} lv={lv} canAct={false} onRefresh={refresh} />
          ))}
        </div>
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
  const outQ = useQuery({
    queryKey: ["leaves", "on-leave-today"],
    queryFn: () => api.get("/leaves/on-leave").then((r) => r.data),
    // The answer changes slowly.
    refetchInterval: 15 * 60 * 1000,
  });
  // U7-09.TEAM v2: readOnly lets People render this view-only.
  const canManageTeam = !readOnly && hasPerm(user, "team_manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
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
  const { owners, branches, shownCount } = useMemo(() => {
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
      shownCount: ownerHits + list.reduce((n, b) => n + b.members.length, 0),
    };
  }, [members, q, tenantRoles]);

  const renderMember = (u, { root }) => (
    <MemberNode
      u={u}
      root={root}
      isMe={u.id === user?.id}
      title={u.title || roleNameFor(tenantRoles, u.role)}
      access={u.role === "owner" ? "Full access" : `${userPerms(u).length} permissions`}
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

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

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

      {/* U7-09.TEAM v2: without team_manage the roster is read-only, and the
          page says why rather than looking broken. */}
      {!canManageTeam && !readOnly && (
        <div className={`mb-6 flex items-start gap-3 px-5 py-4 ${DRAWER_CARD}`} data-testid="team-view-only-banner">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 ${GLASS_PILL}`}>
            <Eye size={16} weight="bold" aria-hidden="true" />
          </span>
          <div className="text-sm">
            <p className="font-semibold text-neutral-900">Read-only view</p>
            <p className="mt-0.5 text-xs text-slate-600">
              You can see who's on the team and open any card for details. To add members or manage access, ask the owner for the <strong className="font-semibold">Manage Team</strong> permission.
            </p>
          </div>
        </div>
      )}

      {out.length > 0 && <CurrentlyOutStrip people={out} />}

      {usersQ.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="ds-skeleton h-40 rounded-[1.4rem]" />)}
        </div>
      ) : members.length === 0 || (q && shownCount === 0) ? (
        <div className={`px-6 py-10 text-center text-sm text-slate-600 ${DRAWER_CARD}`} data-testid="team-empty">
          {q ? `Nobody matches “${query.trim()}”.` : "No team members yet."}
        </div>
      ) : (
        <OrgTree
          owners={owners}
          branches={branches}
          isOpen={isOpen}
          onToggle={toggleBranch}
          searching={!!q}
          renderMember={renderMember}
          renderAdd={renderAdd}
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
  const reports = (members || []).filter((m) => m.reporting_manager_id === u.id && m.id !== u.id);
  // Only an owner edits another owner — the rule PATCH /users holds too.
  const canEdit = canManageTeam && (u.role !== "owner" || isOwner);

  return (
    <Dialog open={!!u} onOpenChange={openChange}>
      <DialogContent
        className={`max-h-[calc(88dvh/var(--ui-scale,1))] max-w-xl gap-0 overflow-y-auto rounded-[1.75rem] p-0 sm:rounded-[1.75rem] [&>button.absolute]:hidden ${GLASS_SHEET}`}
        data-testid={`profile-dialog-${u.id}`}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{u.name}</DialogTitle>
          <DialogDescription>Profile, reporting line, access and leave for {u.name}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-4 px-6 pb-5 pt-6">
          {/* ASK-25 — the member themselves, or anyone who could edit their
              access, can set the photo. The server holds the same rule. */}
          <AvatarEditor u={u} canChange={isMe || canEdit} onChanged={onAvatarChanged} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="flex items-center gap-2 text-2xl font-semibold leading-tight text-neutral-900">
              <span className="truncate">{u.name}</span>
              {isMe && (
                <span className="shrink-0 rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">YOU</span>
              )}
            </p>
            <p className="mt-1 text-sm text-neutral-700" data-testid={`profile-title-${u.id}`}>{u.title || roleName(u.role)}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
              <span>{roleName(u.role)}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
                {status.label}
              </span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid={`profile-close-${u.id}`} className={GLASS_ICON_BTN}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-6 pb-6">
          <section>
            <p className={DRAWER_LABEL}>Contact and reporting line</p>
            <div className={`grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 ${DRAWER_CARD}`}>
              <ContactRow icon={EnvelopeSimple} label="Email" value={u.email} />
              {u.phone && <ContactRow icon={Phone} label="Phone" value={formatPhone(u.phone)} />}
              <ContactRow icon={User} label="Reports to" value={manager ? manager.name : "No one"} />
              {reports.length > 0 && (
                <ContactRow icon={UsersThree} label={`Direct reports (${reports.length})`} value={reports.map((r) => r.name).join(", ")} />
              )}
            </div>
          </section>

          <section>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <ShieldCheck size={13} weight="bold" aria-hidden="true" /> Access
              </p>
              {canEdit && (
                <MemberDialog
                  roleOptions={roleOptions}
                  initial={u}
                  members={members}
                  onSaved={onSaved}
                  // A save here can mint an invite token (phone added, or the
                  // member re-invited). Without this it was created and dropped.
                  onInvite={onInvite}
                  trigger={
                    <button type="button" data-testid={`edit-access-${u.id}`}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
                      <PencilSimple size={13} weight="bold" aria-hidden="true" /> {u.role === "owner" ? "Edit details" : "Edit access"}
                    </button>
                  }
                />
              )}
            </div>
            {u.role === "owner" ? (
              <p className={`px-4 py-3 text-sm text-slate-600 ${DRAWER_CARD}`}>Owner has full access to every part of the app.</p>
            ) : (
              <div className={`px-4 py-4 ${DRAWER_CARD}`}>
                <p className="text-sm text-slate-800">
                  <span className="font-semibold tabular-nums">{granted.length}</span>
                  <span className="text-slate-500"> of {PERMISSIONS.length} areas</span>
                </p>
                {granted.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`granted-perms-${u.id}`}>
                    {granted.map((pp) => <span key={pp.key} className={`${CHIP} ${QUIET_CHIP}`}>{pp.label}</span>)}
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

          {/* ASK-6: leave history, for team managers and for the person themselves. */}
          {(canManageTeam || isMe) && <MemberLeaveHistory userId={u.id} />}

          {canManageTeam && u.role !== "owner" && u.phone && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-900/[0.06] pt-4">
              <button type="button" onClick={() => onInviteLink(u)} data-testid={`invite-link-${u.id}`}
                className={`inline-flex h-10 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
                <LinkSimple size={15} weight="bold" aria-hidden="true" /> Get invite link
              </button>
            </div>
          )}

          {/* 2026-09-15 — off-boarding: the owner removes someone (or cancels a
              pending invite) and picks who takes over their work. */}
          {isOwner && !isMe && <RemoveMemberSection u={u} members={members} onDone={onSaved} />}
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

function AvatarEditor({ u, canChange, onChanged }) {
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

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="relative">
        <PersonAvatar name={u.name} src={u.avatar_url} size={64} ring={false}
          className={busy ? "opacity-60" : ""} />
        {canChange && (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              data-testid={`avatar-change-${u.id}`}
              aria-label={u.avatar_url ? "Change photo" : "Add photo"}
              title={u.avatar_url ? "Change photo" : "Add photo"}
              className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 ring-1 ring-slate-900/10 shadow-[0_2px_8px_-2px_hsl(216_28%_18%/0.35)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:opacity-50">
              <Camera size={14} weight="bold" aria-hidden="true" />
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={onFile} data-testid={`avatar-input-${u.id}`} />
          </>
        )}
      </div>
      {canChange && u.avatar_url && (
        <button type="button" disabled={busy}
          onClick={() => run(() => api.delete(`/users/${u.id}/avatar`), "Photo removed")}
          data-testid={`avatar-remove-${u.id}`}
          className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline disabled:opacity-50">
          Remove
        </button>
      )}
    </div>
  );
}

// NM-16: label ABOVE value, not a fixed column beside it — the email is the
// field someone actually needs to copy, so it is never truncated.
function ContactRow({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        <Icon size={12} weight="bold" aria-hidden="true" /> {label}
      </p>
      <p className="mt-1 break-words text-sm text-slate-800">{value}</p>
    </div>
  );
}
