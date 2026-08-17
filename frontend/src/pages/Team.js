import { useMemo, useState } from "react";
import { formatPhone } from "../lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import TeamMobile from "./mobile/TeamMobile";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS, defaultPermsForRole, hasPerm, userPerms } from "../lib/perms";
import { toast } from "sonner";
import { UserPlus, PencilSimple, ShieldCheck, Check, LinkSimple, Copy, WhatsappLogo, Eye, MagnifyingGlass, User, EnvelopeSimple, Phone, X } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const inp = "w-full border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/30";

function InviteLinkModal({ info, onClose }) {
  const link = info ? `${window.location.origin}/login?invite=${info.token}` : "";
  const msg = info ? `You're invited to DecisionOS. Tap to sign in — we'll text you a login code: ${link}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Invite link copied"); }
    catch { toast.error("Couldn't copy — select and copy manually"); }
  };
  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border border-border rounded-xl" data-testid="invite-link-modal">
        <DialogHeader><DialogTitle className="font-display text-xl">Invite {info?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Share this one-tap link. {info?.name} opens it and gets a login code texted to <strong>{info?.phone_masked}</strong> — no password needed.</p>
          <div className="flex gap-2">
            <input readOnly value={link} data-testid="invite-link-input" className={inp} onFocus={(e) => e.target.select()} />
            <button onClick={copy} data-testid="copy-invite-link" className="flex items-center gap-1.5 border border-border px-3 text-xs font-medium bg-primary text-primary-foreground transition-all"><Copy size={14} weight="bold" /> Copy</button>
          </div>
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" data-testid="invite-whatsapp-share"
            className="flex items-center justify-center gap-2 border border-border px-4 py-2.5 text-sm font-medium hover:bg-green-600 hover:text-white transition-colors">
            <WhatsappLogo size={16} weight="bold" /> Share on WhatsApp
          </a>
          <p className="text-[11px] text-muted-foreground italic">Auto-SMS delivery starts once your SMS provider is connected — until then, share this link directly. Link expires in 7 days.</p>
        </div>
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

function MemberDialog({ trigger, initial, roleOptions, onSaved, onInvite, members = [], isOwner = false }) {
  const [open, setOpen] = useState(false);
  const blank = { name: "", email: "", password: "", phone: "", passwordless: false, role: roleOptions[0]?.key || "", permissions: defaultPermsForRole(roleOptions[0]?.key), reporting_manager_id: "" };
  const [form, setForm] = useState(blank);
  const editing = !!initial;

  const openChange = (o) => {
    setOpen(o);
    if (o) {
      if (initial) {
        setForm({
          name: initial.name, email: initial.email, password: "", phone: initial.phone || "", passwordless: false, role: initial.role,
          permissions: Array.isArray(initial.permissions) && initial.permissions.length ? [...initial.permissions] : defaultPermsForRole(initial.role),
          reporting_manager_id: initial.reporting_manager_id || "",
        });
      } else setForm(blank);
    }
  };

  const setRole = (role) => setForm((f) => ({
    ...f, role,
    permissions: role === "owner" ? PERMISSIONS.map((p) => p.key)
      : (editing && f.role !== "owner") ? f.permissions
      : defaultPermsForRole(role),
  }));
  const togglePerm = (key) => setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key] }));

  const save = async () => {
    try {
      const promotingToOwner = form.role === "owner" && (!editing || initial.role !== "owner");
      if (promotingToOwner && !window.confirm("This makes them a co-owner with FULL control of the company account — including managing team, finances and all data. Continue?")) return;
      const demotingOwner = editing && initial.role === "owner" && form.role !== "owner";
      if (demotingOwner && !window.confirm(`Remove Owner access from ${initial.name}? They will lose full control. At least one owner must remain.`)) return;
      if (editing) {
        await api.patch(`/users/${initial.id}`, { role: form.role, permissions: form.permissions, phone: form.phone, reporting_manager_id: form.reporting_manager_id });
        toast.success(`${initial.name}'s access updated`);
      } else {
        if (!form.name.trim() || !form.email.trim()) return toast.error("Name and email are required");
        let res;
        const base = { name: form.name, email: form.email, role: form.role, permissions: form.permissions, phone: form.phone, reporting_manager_id: form.reporting_manager_id || null };
        if (form.passwordless) {
          if (form.phone.replace(/\D/g, "").length < 10) return toast.error("A valid mobile number is required for OTP login");
          res = await api.post("/users", base);
        } else {
          if (form.password.length < 6) return toast.error("Set a 6+ char password, or switch to mobile OTP login");
          res = await api.post("/users", { ...base, password: form.password });
        }
        toast.success(`${form.name} added`);
        setOpen(false); onSaved();
        if (res?.data?.invite_token && onInvite) {
          const d = form.phone.replace(/\D/g, "");
          onInvite({ token: res.data.invite_token, name: form.name, phone_masked: d.length >= 4 ? "•••• " + d.slice(-4) : "••••" });
        }
        return;
      }
      setOpen(false); onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border border-border rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">{editing ? `Edit access — ${initial.name}` : "Add team member"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!editing && <>
            <input data-testid="member-name-input" className={inp} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input data-testid="member-email-input" className={inp} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="flex border border-border" data-testid="login-method-toggle">
              <button type="button" data-testid="login-method-password" onClick={() => setForm({ ...form, passwordless: false })}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${!form.passwordless ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>Password login</button>
              <button type="button" data-testid="login-method-otp" onClick={() => setForm({ ...form, passwordless: true })}
                className={`flex-1 px-3 py-2 text-xs font-medium border-l border-border transition-colors ${form.passwordless ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>Mobile OTP</button>
            </div>
            {!form.passwordless && (
              <input data-testid="member-password-input" className={inp} type="password" placeholder="Temp password (min 6)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            )}
          </>}
          <input data-testid="member-phone-input" className={inp} type="tel" placeholder={form.passwordless ? "Mobile number (required for OTP login)" : "Mobile number (for OTP login)"} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          {!editing && form.passwordless && (
            <p className="text-[11px] text-muted-foreground -mt-1 italic" data-testid="passwordless-hint">No password needed — this member signs in with a one-time code sent to their mobile.</p>
          )}
          <div>
            <label className="label-mono text-muted-foreground">Role</label>
            <select data-testid="member-role-select" className={`${inp} mt-1`} value={form.role} onChange={(e) => setRole(e.target.value)}>
              {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label-mono text-muted-foreground">Reporting Manager (for leave approvals)</label>
            <select data-testid="member-manager-select" className={`${inp} mt-1`} value={form.reporting_manager_id} onChange={(e) => setForm({ ...form, reporting_manager_id: e.target.value })}>
              <option value="">None (use department approver)</option>
              {members.filter((m) => m.id !== initial?.id).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-2 mt-1">
              <ShieldCheck size={16} weight="bold" className="text-brand-600" />
              <label className="label-mono text-muted-foreground">Access — pick what this member can open & use</label>
            </div>
            {form.role === "owner" ? (
              <div className="border border-brand-600 bg-brand-600/5 px-3 py-3 text-sm" data-testid="owner-access-note">
                <p className="font-semibold flex items-center gap-1.5"><ShieldCheck size={15} weight="bold" className="text-brand-600" /> Full company access</p>
                <p className="text-xs text-muted-foreground mt-1">Owners can open and manage everything — team, finances, workflows and all data. Individual permissions don't apply.</p>
              </div>
            ) : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="permission-list">
              {PERMISSIONS.map((p) => {
                const on = form.permissions.includes(p.key);
                return (
                  <button key={p.key} type="button" data-testid={`perm-${p.key}`} aria-pressed={on} onClick={() => togglePerm(p.key)}
                    className={`flex items-center justify-between gap-2 border border-border px-3 py-2 text-xs font-semibold text-left transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
                    <span>{p.label}</span>
                    <span className={`w-4 h-4 shrink-0 flex items-center justify-center border border-current ${on ? "bg-brand-600 text-white border-border" : ""}`}>{on && <Check size={10} weight="bold" />}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-border pt-3" data-testid="menu-preview">
              <p className="label-mono text-muted-foreground mb-2">This member will see these menus</p>
              <div className="flex flex-wrap gap-1.5">
                {MENU_PREVIEW.map((m) => {
                  const visible = !m.perm || form.permissions.includes(m.perm);
                  return (
                    <span key={m.label} data-testid={`preview-${m.label}`}
                      className={`px-2 py-1 text-xs font-semibold border border-border ${visible ? "bg-green-600 text-white" : "bg-white text-muted-foreground line-through opacity-60"}`}>
                      {m.label}
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 italic">CEO Brief shows their personal brief. Everyone always has CEO Brief, My Work & Meeting Notes.</p>
            </div>
            </>
            )}
          </div>
        </div>
        <DialogFooter>
          <button data-testid="member-save-submit" onClick={save} className="bg-brand-600 text-white px-5 py-2 text-sm font-medium border border-border transition-all">{editing ? "Save access" : "Add"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Epic 2 Sprint A — E2-01: /team route wraps TeamPanel with a page header.
// The old People > Employees tab is retired; owner + team_manage users
// reach the same table via the Ops-adjacent /team page.
import { PageHeader } from "../components/common";

export default function TeamPage() {
  // MPWA-10: rebuilt below lg (§8); desktop tree untouched.
  const isMobile = useIsMobile();
  if (isMobile) return <TeamMobile />;

  return (
    <div>
      <PageHeader
        eyebrow="Employees · access · reporting lines"
        title="Team"
      />
      <TeamPanel />
    </div>
  );
}

export function TeamPanel({ readOnly = false } = {}) {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  const roleOptions = [...(tenant?.roles || []), ...(isOwner ? [{ key: "owner", label: "Owner" }] : [])];
  const [invite, setInvite] = useState(null);
  // U7-09.TEAM v2 (2026-08-17): the click-through profile dialog target.
  // Every card opens the same dialog, gated internally on canManageTeam.
  const [profileUser, setProfileUser] = useState(null);
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  // U7-09.TEAM v2: readOnly prop lets People page render this as view-only.
  const canManageTeam = !readOnly && hasPerm(user, "team_manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  // U7-09.TEAM v2: attendance ("Mark absent / present") removed from Team.
  // Founder ask 2026-08-17: 'where there is present and absent, this is
  // not attendance portal right. team section should contains the details,
  // active or inactive'. Attendance moved to Leave/HR-only surfaces;
  // Team now shows employment status (invite_status: pending | active |
  // suspended) which is the correct "is this person on the roster" signal.

  const getInviteLink = async (u) => {
    try {
      const { data } = await api.post(`/users/${u.id}/invite`);
      setInvite({ token: data.invite_token, name: data.name, phone_masked: data.phone_masked });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't create invite link");
    }
  };

  // U7-09.TEAM v2: search across name/email/role/status. Small feature but
  // pays for itself the moment a team crosses ~15 people.
  const [query, setQuery] = useState("");
  const members = data || [];

  // U7-09.TEAM v2: group members by role -- owner first, then tenant roles
  // in declared order. A flat grid mixes seniorities; grouped sections make
  // scanning by function immediate.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? members.filter((u) => (u.name || "").toLowerCase().includes(q)
          || (u.email || "").toLowerCase().includes(q)
          || (u.role || "").toLowerCase().includes(q)
          || (u.invite_status || "").toLowerCase().includes(q))
      : members;
    const groups = new Map();
    filtered.forEach((u) => {
      const key = u.role || "unassigned";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(u);
    });
    // Order: owner first, then tenant.roles order, then anything else alphabetical.
    const order = ["owner", ...(tenant?.roles || []).map((r) => r.key)];
    const seen = new Set();
    const out = [];
    order.forEach((k) => {
      if (groups.has(k) && !seen.has(k)) {
        out.push([k, groups.get(k)]);
        seen.add(k);
      }
    });
    [...groups.entries()]
      .filter(([k]) => !seen.has(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach((entry) => out.push(entry));
    return out;
  }, [members, query, tenant]);

  const roleLabel = (key) =>
    key === "owner" ? "Owner"
    : (tenant?.roles || []).find((r) => r.key === key)?.label || key;

  const totalFiltered = grouped.reduce((n, [, us]) => n + us.length, 0);

  return (
    <div>
      <InviteLinkModal info={invite} onClose={() => setInvite(null)} />

      {/* U7-09.TEAM v2: view-only banner. Non-perm users see the roster but
          can't edit; we tell them why + who to ask, so it doesn't look
          like a broken page. Owner + team_manage users skip this. */}
      {!canManageTeam && !readOnly && (
        <div className="border border-border bg-caution-50 px-5 py-4 mb-8 flex items-start gap-3 rounded-xl" data-testid="team-view-only-banner">
          <Eye size={16} weight="bold" className="text-brand-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Read-only view</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              You can see who's on the team and open any card for details. To add members or manage access, ask the owner to grant you the <strong>team_manage</strong> permission.
            </p>
          </div>
        </div>
      )}

      {/* Header row: title, search, primary action. HRM-minimalism -- one
          quiet header, not a busy toolbar. */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-baseline gap-3">
          <h2 className="font-heading text-2xl font-extrabold tracking-tight">Members</h2>
          <span className="label-mono text-muted-foreground">
            {query ? `${totalFiltered} of ${members.length}` : `${members.length}`}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {members.length >= 4 && (
            <div className="relative">
              <MagnifyingGlass size={14} weight="bold" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                data-testid="team-search"
                className="border border-border pl-9 pr-3 py-2 text-sm w-52 focus:outline-none focus:border-brand-400"
              />
            </div>
          )}
          {canManageTeam && (
            <MemberDialog roleOptions={roleOptions} members={members} isOwner={isOwner} onSaved={refresh} onInvite={setInvite}
              trigger={<button data-testid="add-user-button" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-border transition-all"><UserPlus size={16} weight="bold" /> Add member</button>} />
          )}
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="border border-border p-10 text-center" data-testid="team-empty">
          <p className="text-sm text-muted-foreground">
            {query ? `Nobody matches "${query}".` : "No team members yet."}
          </p>
        </div>
      )}

      {/* U7-09.TEAM v2 -- HRM-minimalism card grid. Each card = one person.
          Click card to open the full profile dialog (view-only for
          non-managers, edit-mode for managers). Attendance/absent chip
          removed -- Team is not an attendance portal (founder ask). */}
      <div className="space-y-10" data-testid="team-groups">
        {grouped.map(([roleKey, roleMembers]) => (
          <section key={roleKey} data-testid={`team-role-${roleKey}`}>
            <div className="flex items-baseline gap-3 mb-3">
              <p className="font-heading font-medium text-sm tracking-tight">
                {roleLabel(roleKey)}
              </p>
              <span className="label-mono text-muted-foreground">{roleMembers.length}</span>
              <div className="flex-1 border-b border-border" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid={`team-cards-${roleKey}`}>
              {roleMembers.map((u) => (
                <MemberCard
                  key={u.id}
                  u={u}
                  isMe={u.id === user?.id}
                  onOpen={() => setProfileUser(u)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Profile dialog opened from any card. All member details + actions
          live here -- Access, Invite, Deactivate. Owner + team_manage
          users see the edit affordances; everyone else sees view-only. */}
      <MemberProfileDialog
        u={profileUser}
        onClose={() => setProfileUser(null)}
        onSaved={() => { refresh(); setProfileUser(null); }}
        onInvite={(info) => { setInvite(info); setProfileUser(null); }}
        onInviteLink={getInviteLink}
        members={members}
        roleOptions={roleOptions}
        canManageTeam={canManageTeam}
        isOwner={isOwner}
        currentUserId={user?.id}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemberCard -- HRM-minimalism card. Avatar, name, role, status dot,
// access summary. Click opens the profile dialog. All actions live in
// the dialog, not on the card face -- keeps the grid scannable.
// ---------------------------------------------------------------------------
function MemberCard({ u, isMe, onOpen }) {
  const status = u.invite_status || "active";
  const statusMeta = {
    active: { dot: "bg-green-600", label: "Active", tone: "text-muted-foreground" },
    pending: { dot: "bg-amber-500", label: "Pending invite", tone: "text-amber-700" },
    suspended: { dot: "bg-black/40", label: "Inactive", tone: "text-muted-foreground line-through" },
  }[status] || { dot: "bg-green-600", label: "Active", tone: "text-muted-foreground" };
  const accessLabel = u.role === "owner" ? "Full access" : `${userPerms(u).length} permissions`;
  const initial = u.name?.[0]?.toUpperCase() || "?";
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`team-member-${u.id}`}
      className={`text-left border border-border p-4 hover:border-hairline-strong transition-all bg-white ${isMe ? "ring-2 ring-brand-400 ring-offset-1" : ""}`}
      aria-label={`Open profile for ${u.name}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 shrink-0 flex items-center justify-center font-medium text-lg ${u.role === "owner" ? "bg-brand-600 text-white" : "bg-primary text-primary-foreground"}`}>
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate flex items-center gap-2">
            <span className="truncate">{u.name}</span>
            {isMe && <span className="label-mono text-brand-600 shrink-0" data-testid={`is-you-${u.id}`}>YOU</span>}
          </p>
          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <span className={`inline-flex items-center gap-1.5 text-xs ${statusMeta.tone}`} data-testid={`status-${u.id}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
          {statusMeta.label}
        </span>
        <span className="label-mono text-muted-foreground" data-testid={`member-access-count-${u.id}`}>
          {accessLabel}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MemberProfileDialog -- click-through card. Shows all member details in
// a clean minimalist layout. Managers get inline Access edit + Invite
// actions; viewers get a read-only version. Kills the old "Mark absent"
// pattern (Team isn't an attendance portal).
// ---------------------------------------------------------------------------
function MemberProfileDialog({
  u, onClose, onSaved, onInvite, onInviteLink,
  members, roleOptions, canManageTeam, isOwner, currentUserId,
}) {
  const [editAccess, setEditAccess] = useState(false);
  // Close swings edit-mode back off so a re-open starts read-only.
  const openChange = (o) => { if (!o) { setEditAccess(false); onClose(); } };
  if (!u) return null;
  const isMe = u.id === currentUserId;
  const status = u.invite_status || "active";
  const statusMeta = {
    active: { dot: "bg-green-600", label: "Active" },
    pending: { dot: "bg-amber-500", label: "Pending invite" },
    suspended: { dot: "bg-black/40", label: "Inactive" },
  }[status] || { dot: "bg-green-600", label: "Active" };
  const perms = u.role === "owner" ? PERMISSIONS.map((p) => p.key) : userPerms(u);
  const manager = (members || []).find((m) => m.id === u.reporting_manager_id);

  return (
    <Dialog open={!!u} onOpenChange={openChange}>
      <DialogContent className="border border-border rounded-xl max-w-2xl max-h-[85vh] overflow-y-auto p-0" data-testid={`profile-dialog-${u.id}`}>
        <DialogHeader className="sr-only"><DialogTitle>{u.name}</DialogTitle></DialogHeader>

        {/* Hero -- avatar + name + role + status dot. Minimalist, no
            competing chrome. */}
        <div className="p-6 border-b border-border flex items-start gap-4">
          <div className={`w-16 h-16 shrink-0 flex items-center justify-center font-medium text-2xl ${u.role === "owner" ? "bg-brand-600 text-white" : "bg-primary text-primary-foreground"}`}>
            {u.name?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading text-2xl font-black tracking-tight truncate">
              {u.name}{isMe && <span className="label-mono text-brand-600 ml-2">YOU</span>}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5 capitalize">{u.role || "unassigned"}</p>
            <span className="inline-flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
              {statusMeta.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-accent shrink-0"
            aria-label="Close"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Contact block */}
        <div className="px-6 py-4 border-b border-border space-y-2 text-sm">
          <ContactRow icon={EnvelopeSimple} label="Email" value={u.email} />
          {u.phone && <ContactRow icon={Phone} label="Phone" value={formatPhone(u.phone)} />}
          {manager && <ContactRow icon={User} label="Reports to" value={manager.name} />}
        </div>

        {/* Access block. Read-only summary by default; edit unlocks the
            full permission grid for managers. */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} weight="bold" className="text-brand-600" />
              <p className="font-semibold text-sm">Access</p>
            </div>
            {canManageTeam && (u.role !== "owner" || isOwner) && !editAccess && (
              <button
                type="button"
                onClick={() => setEditAccess(true)}
                data-testid={`edit-access-${u.id}`}
                className="flex items-center gap-1 text-xs font-medium border border-border px-3 py-1 hover:bg-accent transition-colors"
              >
                <PencilSimple size={12} weight="bold" /> Edit
              </button>
            )}
          </div>
          {u.role === "owner" ? (
            <p className="text-sm text-muted-foreground">Owner has full access to every part of the app.</p>
          ) : editAccess ? (
            // Inline access editor -- opens the existing MemberDialog on
            // top so we reuse the tested edit flow (permission toggles +
            // reporting manager + role switch).
            <div className="border border-border p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Opening the full editor...</p>
              <MemberDialog
                roleOptions={roleOptions}
                initial={u}
                members={members}
                isOwner={isOwner}
                onSaved={() => { setEditAccess(false); onSaved(); }}
                trigger={<button className="w-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-border transition-all">Open access editor</button>}
              />
            </div>
          ) : (
            <div>
              <p className="text-sm mb-2">{perms.length} permission{perms.length === 1 ? "" : "s"} granted</p>
              <div className="flex flex-wrap gap-1.5">
                {PERMISSIONS.map((p) => {
                  const on = perms.includes(p.key);
                  return (
                    <span
                      key={p.key}
                      className={`text-xs border px-2 py-0.5 ${on ? "border-brand-ink bg-primary text-primary-foreground" : "border-border text-muted-foreground line-through opacity-60"}`}
                    >
                      {p.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Actions block. Only shown when there's actually an action
            available to this viewer. */}
        {canManageTeam && u.role !== "owner" && (
          <div className="px-6 py-4 flex items-center gap-2 flex-wrap">
            {u.phone && (
              <button
                onClick={() => onInviteLink(u)}
                data-testid={`invite-link-${u.id}`}
                className="flex items-center gap-1.5 text-xs font-medium border border-border px-3 py-2 hover:bg-brand-600 hover:text-white transition-colors"
              >
                <LinkSimple size={14} weight="bold" /> Get invite link
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContactRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={14} weight="bold" className="text-muted-foreground shrink-0" />
      <span className="label-mono text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}
