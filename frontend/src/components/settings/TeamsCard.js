/* Teams, and what each one can open (2026-10-05, founder: "Teams and their
 * access are hard to find").
 *
 * They lived at the bottom of Business › Company Details, under the company's
 * GST number and its product list — the last place anyone setting up access
 * looks. They are their own card now, first on Settings › Team & access, beside
 * who approves leave and what owners can open.
 *
 * Same server rules as before: anyone with Manage Team adds, renames and
 * removes teams; only an owner changes what a team can open (a team's access
 * reaches its own members, the editor's included).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash, UsersThree, ArrowRight } from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm, PERMISSION_GROUPS, defaultPermsForRole } from "../../lib/perms";
import { DRAWER_FIELD, GLASS_PILL, INK_PILL } from "../karma/glass";
import { AccessSwitch } from "./AccessSwitch";

const SUB_LABEL = "mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500";

export function TeamsCard() {
  const { tenant, user, refreshTenant } = useAuth();
  const canManage = hasPerm(user, "team_manage");
  const isOwner = user?.role === "owner";
  const [roles, setRoles] = useState([]);
  const [roleInput, setRoleInput] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [openRole, setOpenRole] = useState(null);
  const [members, setMembers] = useState([]);
  const loadMembers = () => api.get("/users").then((r) => setMembers(r.data || [])).catch(() => {});
  useEffect(() => { loadMembers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRoles((tenant?.roles || []).map((r) => ({ ...r }))); }, [tenant]);

  const setRoleLabel = (key, label) => setRoles((rs) => rs.map((r) => (r.key === key ? { ...r, label } : r)));

  const addRole = async () => {
    const label = roleInput.trim();
    if (!label) return;
    setRoleBusy(true);
    try {
      const { data } = await api.post("/tenant/roles", { label });
      setRoles((data.roles || []).map((r) => ({ ...r })));
      setRoleInput("");
      await refreshTenant();
      /* 2026-10-03 — a team named for its work starts with that work's access
         (server: shared/roles.starting_perms). Say what it was given, so the
         owner never discovers it later. */
      const BASE = defaultPermsForRole("__custom__");
      const added = (data.roles || []).find((r) => r.label === label);
      const extra = (added?.permissions || []).filter((k) => !BASE.includes(k))
        .map((k) => PERMISSION_GROUPS.flatMap((g) => g.items).find((p) => p.key === k)?.label).filter(Boolean);
      toast.success(`Team "${label}" added`, extra.length ? {
        description: `It starts with ${extra.join(", ")} as well as everyday work. Change it under Access.`,
      } : undefined);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't add the team");
    } finally { setRoleBusy(false); }
  };

  const renameRole = async (key, label) => {
    const l = (label || "").trim();
    const orig = (tenant?.roles || []).find((r) => r.key === key);
    if (!l || l === orig?.label) { setRoles((tenant?.roles || []).map((r) => ({ ...r }))); return; }
    try {
      const { data } = await api.patch(`/tenant/roles/${key}`, { label: l });
      setRoles((data.roles || []).map((r) => ({ ...r })));
      await refreshTenant();
      toast.success("Team renamed");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't rename the team");
      setRoles((tenant?.roles || []).map((r) => ({ ...r })));
    }
  };

  const deleteRole = async (key) => {
    setRoleBusy(true);
    try {
      const { data } = await api.delete(`/tenant/roles/${key}`);
      setRoles((data.roles || []).map((r) => ({ ...r })));
      await refreshTenant();
      toast.success("Team deleted");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't delete the team");
    } finally { setRoleBusy(false); }
  };

  const countIn = (key) => members.filter((m) => m.role === key).length;

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-teams-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <UsersThree size={18} weight="bold" className="text-muted-foreground" aria-hidden="true" /> Teams
          </h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            The departments people belong to. {isOwner ? "Access sets what everyone in a team can open; a person can also be given their own. " : ""}
            A team can&rsquo;t be deleted while people are in it &mdash; move them first.
          </p>
        </div>
        <Link to="/team" data-testid="settings-teams-people-link"
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-slate-700 hover:bg-white ${GLASS_PILL}`}>
          Add or move people <ArrowRight size={13} weight="bold" aria-hidden="true" />
        </Link>
      </div>

      <ul className="mt-4 space-y-2" data-testid="roles-manage-list">
        {roles.map((r) => {
          const n = countIn(r.key);
          const open = openRole === r.key;
          return (
            <li key={r.key} data-testid={`role-row-${r.key}`}
              className="rounded-2xl bg-white/60 p-2 ring-1 ring-inset ring-slate-900/[0.06]">
              <div className="flex items-center gap-2">
                <input data-testid={`role-label-${r.key}`} aria-label="Team name" className={`${DRAWER_FIELD} py-2`}
                  value={r.label} disabled={!canManage || roleBusy}
                  onChange={(e) => setRoleLabel(r.key, e.target.value)}
                  onBlur={(e) => canManage && renameRole(r.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }} />
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline" data-testid={`role-count-${r.key}`}>
                  {n} {n === 1 ? "person" : "people"}
                </span>
                {isOwner && (
                  <button type="button" onClick={() => setOpenRole(open ? null : r.key)} aria-expanded={open}
                    data-testid={`role-access-toggle-${r.key}`}
                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium ${open ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" : `text-slate-700 hover:bg-white ${GLASS_PILL}`}`}>
                    <ShieldCheck size={13} weight="bold" aria-hidden="true" /> Access
                  </button>
                )}
                {canManage && (
                  <button type="button" onClick={() => deleteRole(r.key)} disabled={roleBusy || n > 0}
                    data-testid={`role-delete-${r.key}`}
                    title={n > 0 ? "Move its people to another team first" : "Delete team"}
                    aria-label={`Delete ${r.label}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500">
                    <Trash size={15} weight="bold" aria-hidden="true" />
                  </button>
                )}
              </div>
              {isOwner && open && (() => {
                const saved = (tenant?.roles || []).find((x) => x.key === r.key) || r;
                return <RoleAccessEditor key={JSON.stringify(saved.permissions || [])} role={saved} members={members} onSaved={loadMembers} />;
              })()}
            </li>
          );
        })}
        {roles.length === 0 && <li className="text-sm text-muted-foreground">No teams yet &mdash; add one below.</li>}
      </ul>

      {canManage && (
        <div className="mt-3 flex gap-2">
          <input data-testid="role-add-input" aria-label="New team name" className={DRAWER_FIELD} value={roleInput} disabled={roleBusy}
            onChange={(e) => setRoleInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }}
            placeholder="Add a team (e.g. Marketing)" />
          <button type="button" onClick={addRole} disabled={roleBusy || !roleInput.trim()} data-testid="role-add-button"
            className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            <Plus size={14} weight="bold" aria-hidden="true" /> Add
          </button>
        </div>
      )}
    </div>
  );
}

/* 2026-09-15 — what a role can open. People in the role get this unless they
   have their own access list (Team › Edit access, "Use the role's access"
   unticked); the owner can make those people follow the role too. */
function RoleAccessEditor({ role, members, onSaved }) {
  const { refreshTenant } = useAuth();
  const custom = Array.isArray(role.permissions) && role.permissions.length > 0;
  const [draft, setDraft] = useState(custom ? role.permissions : defaultPermsForRole(role.key));
  const [applyAll, setApplyAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const inRole = members.filter((m) => m.role === role.key);
  const ownAccess = inRole.filter((m) => m.permissions_custom || (Array.isArray(m.permissions) && m.permissions.length > 0));
  const toggle = (k) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));

  const save = async (perms) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/tenant/roles/${role.key}/permissions`, { permissions: perms, apply_to_members: applyAll });
      await refreshTenant();
      const n = data?.members_updated || 0;
      toast.success(`Access for ${role.label} saved${n ? ` — ${n} ${n === 1 ? "person now follows" : "people now follow"} it` : ""}`);
      setApplyAll(false);
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't save access");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.06]" data-testid={`role-access-${role.key}`}>
      <p className="text-xs text-muted-foreground">
        {inRole.length} {inRole.length === 1 ? "person" : "people"} in this team · {custom ? "set for this team" : "built-in default"} · owners have everything not switched off for owners below
      </p>
      <div className="mt-2 space-y-3">
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.title} data-testid={`role-perm-group-${role.key}-${g.title}`}>
            <p className={SUB_LABEL}>{g.title}</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {g.items.map((p) => (
                <AccessSwitch key={p.key} label={p.label} on={draft.includes(p.key)} onToggle={() => toggle(p.key)}
                  disabled={busy} testid={`role-perm-${role.key}-${p.key}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {ownAccess.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="mt-0.5 accent-neutral-900"
            data-testid={`role-apply-all-${role.key}`} />
          <span>
            Also make {ownAccess.length === 1 ? `${ownAccess[0].name}, who has their own access,` : `the ${ownAccess.length} people who have their own access`} follow this team
          </span>
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => save(draft)} disabled={busy} data-testid={`role-access-save-${role.key}`}
          className={`inline-flex h-10 items-center rounded-pill px-4 text-xs font-medium disabled:opacity-50 ${INK_PILL}`}>
          {busy ? "Saving…" : "Save access"}
        </button>
        {custom && (
          <button type="button" onClick={() => save([])} disabled={busy} data-testid={`role-access-default-${role.key}`}
            className={`inline-flex h-10 items-center rounded-pill px-4 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
            Use the built-in default
          </button>
        )}
      </div>
    </div>
  );
}

export default TeamsCard;
