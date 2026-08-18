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

const inp = "w-full nm-field px-3 py-2 text-sm font-mono";

function InviteLinkModal({ info, onClose }) {
  const link = info ? `${window.location.origin}/login?invite=${info.token}` : "";
  const msg = info ? `You're invited to DecisionOS. Tap to sign in — we'll text you a login code: ${link}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Invite link copied"); }
    catch { toast.error("Couldn't copy — select and copy manually"); }
  };
  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="rounded-cardlg border border-nm-edge/40" data-testid="invite-link-modal">
        <DialogHeader><DialogTitle className="font-display text-xl">Invite {info?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Share this one-tap link. {info?.name} opens it and gets a login code texted to <strong>{info?.phone_masked}</strong> — no password needed.</p>
          <div className="flex gap-2">
            <input readOnly value={link} data-testid="invite-link-input" className={inp} onFocus={(e) => e.target.select()} />
            <button onClick={copy} data-testid="copy-invite-link" className="flex items-center gap-1.5 nm-tile px-3 text-xs font-medium bg-primary text-primary-foreground transition-all"><Copy size={14} weight="bold" /> Copy</button>
          </div>
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" data-testid="invite-whatsapp-share"
            className="flex items-center justify-center gap-2 nm-tile px-4 py-2.5 text-sm font-medium hover:bg-success-600 hover:text-white transition-colors">
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
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">{editing ? `Edit access — ${initial.name}` : "Add team member"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!editing && <>
            <input data-testid="member-name-input" className={inp} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input data-testid="member-email-input" className={inp} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="flex nm-tile" data-testid="login-method-toggle">
              <button type="button" data-testid="login-method-password" onClick={() => setForm({ ...form, passwordless: false })}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${!form.passwordless ? "bg-primary text-primary-foreground" : "bg-nm hover:bg-accent"}`}>Password login</button>
              <button type="button" data-testid="login-method-otp" onClick={() => setForm({ ...form, passwordless: true })}
                className={`flex-1 px-3 py-2 text-xs font-medium border-l border-nm-edge/40 transition-colors ${form.passwordless ? "bg-primary text-primary-foreground" : "bg-nm hover:bg-accent"}`}>Mobile OTP</button>
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
                    className={`flex items-center justify-between gap-2 nm-tile px-3 py-2 text-xs font-semibold text-left transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-nm hover:bg-accent"}`}>
                    <span>{p.label}</span>
                    <span className={`w-4 h-4 shrink-0 flex items-center justify-center border border-current ${on ? "bg-brand-600 text-white border-nm-edge/40" : ""}`}>{on && <Check size={10} weight="bold" />}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-nm-edge/40 pt-3" data-testid="menu-preview">
              <p className="label-mono text-muted-foreground mb-2">This member will see these menus</p>
              <div className="flex flex-wrap gap-1.5">
                {MENU_PREVIEW.map((m) => {
                  const visible = !m.perm || form.permissions.includes(m.perm);
                  return (
                    <span key={m.label} data-testid={`preview-${m.label}`}
                      className={`px-2 py-1 text-xs font-semibold nm-tile ${visible ? "bg-success-600 text-white" : "bg-nm text-muted-foreground line-through opacity-60"}`}>
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
          <button data-testid="member-save-submit" onClick={save} className="bg-brand-600 text-white px-5 py-2 text-sm font-medium nm-tile transition-all">{editing ? "Save access" : "Add"}</button>
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
        <div className="nm-tile bg-caution-50 px-5 py-4 mb-8 flex items-start gap-3 rounded-xl" data-testid="team-view-only-banner">
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
                className="nm-tile pl-9 pr-3 py-2 text-sm w-52 focus:outline-none focus:border-brand-400"
              />
            </div>
          )}
          {canManageTeam && (
            <MemberDialog roleOptions={roleOptions} members={members} isOwner={isOwner} onSaved={refresh} onInvite={setInvite}
              trigger={<button data-testid="add-user-button" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold nm-tile transition-all"><UserPlus size={16} weight="bold" /> Add member</button>} />
          )}
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="nm-tile p-10 text-center" data-testid="team-empty">
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
              <div className="flex-1 border-b border-nm-edge/40" aria-hidden="true" />
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
    active: { dot: "bg-success-600", label: "Active", tone: "text-muted-foreground" },
    pending: { dot: "bg-caution-500", label: "Pending invite", tone: "text-amber-700" },
    suspended: { dot: "bg-neutral-400", label: "Inactive", tone: "text-muted-foreground line-through" },
  }[status] || { dot: "bg-success-600", label: "Active", tone: "text-muted-foreground" };
  const accessLabel = u.role === "owner" ? "Full access" : `${userPerms(u).length} permissions`;
  const initial = u.name?.[0]?.toUpperCase() || "?";
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`team-member-${u.id}`}
      className={`text-left nm-tile p-4 transition-shadow duration-150 hover:shadow-nm active:shadow-nm-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${isMe ? "ring-2 ring-primary/40" : ""}`}
      aria-label={`Open profile for ${u.name}`}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-control nm-inset text-lg font-medium text-primary">
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
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-nm-edge/40">
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
  // NM-16: `editAccess` is gone. It gated an intermediate card reading
  // "Opening the full editor..." with a button under it — a two-step where
  // the first step was a placeholder. The Edit control IS the editor's
  // trigger now.
  const openChange = (o) => { if (!o) onClose(); };
  if (!u) return null;
  const isMe = u.id === currentUserId;
  const status = u.invite_status || "active";
  const statusMeta = {
    active: { dot: "bg-success-600", label: "Active" },
    pending: { dot: "bg-caution-500", label: "Pending invite" },
    suspended: { dot: "bg-neutral-400", label: "Inactive" },
  }[status] || { dot: "bg-success-600", label: "Active" };
  const perms = u.role === "owner" ? PERMISSIONS.map((p) => p.key) : userPerms(u);
  const granted = PERMISSIONS.filter((pp) => perms.includes(pp.key));
  const denied = PERMISSIONS.filter((pp) => !perms.includes(pp.key));
  const manager = (members || []).find((m) => m.id === u.reporting_manager_id);
  const canEdit = canManageTeam && (u.role !== "owner" || isOwner);

  return (
    /* NM-16 — the expanded card, rebuilt.
       WHAT WAS WRONG. Four blocks with three different paddings (p-6, px-6
       py-4, px-6 py-4 again), a hard-cornered avatar tile, a heading in
       font-black/tracking-tighter while every other page opens in the display
       serif, and — the part that actually cost comprehension — an access
       block that printed all nine permissions and struck through the ones the
       member does NOT have. Reading "what can this person do" meant scanning
       nine chips and mentally discarding five. Granted is the answer; denied
       is the remainder, and it is now one line of text.

       Everything sits on one 24px gutter and a 20px vertical rhythm, and each
       block says what it is in a label above it, so no section depends on the
       reader inferring its purpose from its contents. */
    <Dialog open={!!u} onOpenChange={openChange}>
      <DialogContent
        className="max-w-xl max-h-[85vh] overflow-y-auto rounded-cardlg border-nm-edge/40 bg-nm p-0 [&>button.absolute]:hidden"
        data-testid={`profile-dialog-${u.id}`}
      >
        <DialogHeader className="sr-only"><DialogTitle>{u.name}</DialogTitle></DialogHeader>

        {/* Identity. The avatar is a raised tile, so the person reads as the
            one object on the card and everything below is information about
            them. Close is a real 36px control, aligned to the avatar's top
            edge rather than floating in the corner. */}
        <div className="flex items-start gap-4 px-6 pt-6 pb-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-tile nm-raised text-2xl font-medium text-primary">
            {u.name?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="flex items-center gap-2 font-display text-2xl leading-tight">
              <span className="truncate">{u.name}</span>
              {isMe && (
                <span className="shrink-0 rounded-pill bg-nm-sunken px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                  YOU
                </span>
              )}
            </p>
            {/* Role and status on ONE line: they are both "who this person is
                here", and stacking them made the header three rows tall for
                four words. */}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="capitalize">{u.role || "unassigned"}</span>
              <span aria-hidden="true" className="text-muted-foreground/50">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
                {statusMeta.label}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-muted-foreground transition-shadow hover:text-foreground hover:shadow-nm-sm active:shadow-nm-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Contact. A well, because these are facts to read, not controls.
            Two columns on anything wider than a phone so email and phone sit
            side by side instead of stacking into a list of near-empty rows. */}
        <div className="px-6 pb-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Contact
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-control nm-inset px-4 py-4 sm:grid-cols-2">
            <ContactRow icon={EnvelopeSimple} label="Email" value={u.email} />
            {u.phone && <ContactRow icon={Phone} label="Phone" value={formatPhone(u.phone)} />}
            {manager && <ContactRow icon={User} label="Reports to" value={manager.name} />}
          </div>
        </div>

        {/* Access. */}
        <div className="px-6 pb-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck size={13} weight="bold" /> Access
            </p>
            {canEdit && u.role !== "owner" && (
              <MemberDialog
                roleOptions={roleOptions}
                initial={u}
                members={members}
                isOwner={isOwner}
                onSaved={onSaved}
                // A save here can mint an invite token (phone added, or the
                // member re-invited). Without this it was created and dropped.
                onInvite={onInvite}
                trigger={
                  <button
                    type="button"
                    data-testid={`edit-access-${u.id}`}
                    className="inline-flex items-center gap-1.5 rounded-pill nm-btn px-3 py-1.5 text-xs font-medium"
                  >
                    <PencilSimple size={12} weight="bold" /> Edit access
                  </button>
                }
              />
            )}
          </div>

          {u.role === "owner" ? (
            <p className="rounded-control nm-inset px-4 py-3 text-sm text-muted-foreground">
              Owner has full access to every part of the app.
            </p>
          ) : (
            <div className="rounded-control nm-inset px-4 py-4">
              <p className="text-sm">
                <span className="font-medium tabular-nums">{granted.length}</span>
                <span className="text-muted-foreground"> of {PERMISSIONS.length} areas</span>
              </p>
              {granted.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`granted-perms-${u.id}`}>
                  {granted.map((pp) => (
                    <span key={pp.key} className="rounded-pill nm-tile px-2.5 py-1 text-xs">
                      {pp.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No areas granted yet.</p>
              )}
              {denied.length > 0 && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  No access to {denied.map((pp) => pp.label).join(", ")}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions. Its own footer on the sunken ground so it reads as the
            bottom of the card rather than a fifth information block. */}
        {canManageTeam && u.role !== "owner" && u.phone && (
          <div className="flex flex-wrap items-center gap-2 border-t border-nm-edge/40 bg-nm-sunken/60 px-6 py-4">
            <button
              onClick={() => onInviteLink(u)}
              data-testid={`invite-link-${u.id}`}
              className="inline-flex items-center gap-1.5 rounded-control nm-btn px-3.5 py-2 text-xs font-medium"
            >
              <LinkSimple size={14} weight="bold" /> Get invite link
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// NM-16: label ABOVE value, not a fixed 80px column beside it. The old row
// spent a fifth of its width on a mono label and then truncated the email —
// the one field on the card someone actually needs to copy.
function ContactRow({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon size={12} weight="bold" aria-hidden="true" /> {label}
      </p>
      <p className="mt-1 break-words text-sm">{value}</p>
    </div>
  );
}
