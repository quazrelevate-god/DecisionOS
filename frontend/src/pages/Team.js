import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import TeamMobile from "./mobile/TeamMobile";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";
import { PERMISSIONS, defaultPermsForRole, hasPerm, userPerms } from "../lib/perms";
import { toast } from "sonner";
import { UserPlus, PencilSimple, ShieldCheck, Check, LinkSimple, Copy, WhatsappLogo, Eye, MagnifyingGlass, User } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";

function InviteLinkModal({ info, onClose }) {
  const link = info ? `${window.location.origin}/login?invite=${info.token}` : "";
  const msg = info ? `You're invited to DecisionOS. Tap to sign in — we'll text you a login code: ${link}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Invite link copied"); }
    catch { toast.error("Couldn't copy — select and copy manually"); }
  };
  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border border-black rounded-none" data-testid="invite-link-modal">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">Invite {info?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Share this one-tap link. {info?.name} opens it and gets a login code texted to <strong>{info?.phone_masked}</strong> — no password needed.</p>
          <div className="flex gap-2">
            <input readOnly value={link} data-testid="invite-link-input" className={inp} onFocus={(e) => e.target.select()} />
            <button onClick={copy} data-testid="copy-invite-link" className="flex items-center gap-1.5 border border-black px-3 text-xs font-semibold uppercase tracking-wider bg-brand-ink text-white hover:shadow-brutal-sm transition-all"><Copy size={14} weight="bold" /> Copy</button>
          </div>
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" data-testid="invite-whatsapp-share"
            className="flex items-center justify-center gap-2 border border-black px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:bg-green-600 hover:text-white transition-colors">
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
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{editing ? `Edit access — ${initial.name}` : "Add team member"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!editing && <>
            <input data-testid="member-name-input" className={inp} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input data-testid="member-email-input" className={inp} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="flex border border-black" data-testid="login-method-toggle">
              <button type="button" data-testid="login-method-password" onClick={() => setForm({ ...form, passwordless: false })}
                className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${!form.passwordless ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>Password login</button>
              <button type="button" data-testid="login-method-otp" onClick={() => setForm({ ...form, passwordless: true })}
                className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider border-l border-black transition-colors ${form.passwordless ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>Mobile OTP</button>
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
                    className={`flex items-center justify-between gap-2 border border-black px-3 py-2 text-xs font-semibold text-left transition-colors ${on ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                    <span>{p.label}</span>
                    <span className={`w-4 h-4 shrink-0 flex items-center justify-center border border-current ${on ? "bg-brand-600 text-white border-black" : ""}`}>{on && <Check size={10} weight="bold" />}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-black/15 pt-3" data-testid="menu-preview">
              <p className="label-mono text-muted-foreground mb-2">This member will see these menus</p>
              <div className="flex flex-wrap gap-1.5">
                {MENU_PREVIEW.map((m) => {
                  const visible = !m.perm || form.permissions.includes(m.perm);
                  return (
                    <span key={m.label} data-testid={`preview-${m.label}`}
                      className={`px-2 py-1 text-xs font-semibold border border-black ${visible ? "bg-green-600 text-white" : "bg-white text-muted-foreground line-through opacity-60"}`}>
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
          <button data-testid="member-save-submit" onClick={save} className="bg-brand-600 text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">{editing ? "Save access" : "Add"}</button>
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
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const { data: attendance } = useQuery({ queryKey: ["attendance"], queryFn: () => api.get("/attendance").then((r) => r.data) });
  // U7-09.PEOPLE (2026-08-17): readOnly prop lets People page render this
  // as view-only for users without team_manage permission. Founder ask:
  // 'people section can be show to all the people but as view and owner
  // and given access to people only has the edit section, other will have
  // the view section'.
  const canManageTeam = !readOnly && hasPerm(user, "team_manage");
  const absentIds = new Set((attendance || []).filter((a) => a.status === "absent").map((a) => a.user_id));
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const toggleAbsent = async (u) => {
    const nowAbsent = absentIds.has(u.id);
    await api.post("/attendance", { user_id: u.id, status: nowAbsent ? "present" : "absent" });
    toast.success(`${u.name} marked ${nowAbsent ? "present" : "absent"}`);
    qc.invalidateQueries({ queryKey: ["attendance"] });
  };

  const getInviteLink = async (u) => {
    try {
      const { data } = await api.post(`/users/${u.id}/invite`);
      setInvite({ token: data.invite_token, name: data.name, phone_masked: data.phone_masked });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't create invite link");
    }
  };

  // U7-09.TEAM: search across name/email/role. Small feature but pays for
  // itself the moment a team crosses ~15 people.
  const [query, setQuery] = useState("");
  const members = data || [];

  // U7-09.TEAM: group members by role -- owner first, then tenant roles in
  // declared order. A flat list of 30 people mixes owners and ICs; grouping
  // makes "who's who" scannable in one pass.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? members.filter((u) => (u.name || "").toLowerCase().includes(q)
          || (u.email || "").toLowerCase().includes(q)
          || (u.role || "").toLowerCase().includes(q))
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

  return (
    <div>
      <InviteLinkModal info={invite} onClose={() => setInvite(null)} />

      {/* U7-09.TEAM: view-only banner. Non-perm users see the roster but
          can't edit; we tell them why + who to ask, so it doesn't look
          like a broken page. Owner + team_manage users skip this. */}
      {!canManageTeam && !readOnly && (
        <div className="border-2 border-black bg-brand-yellow/40 px-4 py-3 mb-6 flex items-start gap-3" data-testid="team-view-only-banner">
          <Eye size={18} weight="bold" className="text-brand-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold uppercase tracking-tight">Read-only view</p>
            <p className="text-muted-foreground mt-0.5">
              You can see who's on the team and their roles. To add members, edit access, or manage attendance, ask the owner to grant you the <strong>team_manage</strong> permission.
            </p>
          </div>
        </div>
      )}

      {/* Actions + search row. Owners/managers see Add Member; everyone
          sees the search box once the team grows. */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        {members.length >= 5 ? (
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlass size={14} weight="bold" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, role..."
              data-testid="team-search"
              className="w-full border border-black pl-9 pr-3 py-2 text-sm focus:outline-none focus:shadow-brutal-sm"
            />
          </div>
        ) : <div />}
        {canManageTeam && (
          <MemberDialog roleOptions={roleOptions} members={members} isOwner={isOwner} onSaved={refresh} onInvite={setInvite}
            trigger={<button data-testid="add-user-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all"><UserPlus size={16} weight="bold" /> Add Member</button>} />
        )}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight">Members</h2>
        <span className="label-mono text-muted-foreground">
          {query ? `${grouped.reduce((n, [, us]) => n + us.length, 0)} of ${members.length}` : `${members.length} total`}
        </span>
      </div>

      {grouped.length === 0 && (
        <div className="card-brutal p-8 text-center" data-testid="team-empty">
          <p className="text-sm text-muted-foreground">
            {query ? `Nobody matches "${query}"` : "No team members yet."}
          </p>
        </div>
      )}

      {/* U7-09.TEAM: grouped-by-role sections. Each section carries the
          role label + count so an owner scanning "how many sales do I
          have" answers in a second. */}
      <div className="space-y-6" data-testid="team-groups">
        {grouped.map(([roleKey, roleMembers]) => (
          <section key={roleKey} data-testid={`team-role-${roleKey}`}>
            <div className="flex items-center gap-2 mb-2">
              <p className="font-heading font-extrabold uppercase tracking-tight text-sm">
                {roleLabel(roleKey)}
              </p>
              <span className="label-mono text-muted-foreground">{roleMembers.length}</span>
            </div>
            <div className="card-brutal divide-y divide-black/10">
              {roleMembers.map((u) => {
                const isMe = u.id === user?.id;
                const accessCount = u.role === "owner" ? PERMISSIONS.length : userPerms(u).length;
                return (
                  <div
                    key={u.id}
                    data-testid={`team-member-${u.id}`}
                    className={`p-4 flex items-center justify-between gap-4 flex-wrap ${isMe ? "bg-brand-yellow/20" : ""}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-10 h-10 shrink-0 flex items-center justify-center font-heading font-black ${u.role === "owner" ? "bg-brand-600 text-white" : "bg-brand-ink text-white"}`}>
                        {u.name?.[0]?.toUpperCase() || <User size={16} weight="bold" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                          <span className="truncate">{u.name}</span>
                          {isMe && (
                            <span className="label-mono text-brand-600 font-bold shrink-0" data-testid={`is-you-${u.id}`}>
                              — you
                            </span>
                          )}
                          {absentIds.has(u.id) && <Chip value="absent" className="bg-black text-white" data-testid={`absent-badge-${u.id}`} />}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span
                        className="label-mono text-muted-foreground"
                        data-testid={`member-access-count-${u.id}`}
                        title={u.role === "owner" ? "Owner has all permissions" : "Number of permissions granted"}
                      >
                        {u.role === "owner" ? "full access" : `${accessCount} access`}
                      </span>
                      {canManageTeam && (u.role !== "owner" || isOwner) && (
                        <MemberDialog roleOptions={roleOptions} initial={u} members={members} isOwner={isOwner} onSaved={refresh}
                          trigger={<button data-testid={`edit-access-${u.id}`} className="flex items-center gap-1 text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-blue hover:text-white transition-colors"><PencilSimple size={12} weight="bold" /> Access</button>} />
                      )}
                      {canManageTeam && u.role !== "owner" && (
                        <>
                          {u.phone && (
                            <button onClick={() => getInviteLink(u)} data-testid={`invite-link-${u.id}`} className="flex items-center gap-1 text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-600 hover:text-white transition-colors"><LinkSimple size={12} weight="bold" /> Invite</button>
                          )}
                          <button onClick={() => toggleAbsent(u)} data-testid={`toggle-absent-${u.id}`} className="text-xs uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">
                            {absentIds.has(u.id) ? "Mark present" : "Mark absent"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
