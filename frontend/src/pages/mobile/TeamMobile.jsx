// MPWA-10 · /team — mobile.
//
// §8 asked for "one member per MobileCard, with the ragged Access / Invite /
// Mark-Absent row collapsed into the member sheet". That was done, and the
// scanning problem it describes is genuinely fixed — but collapsing the row
// turned into dropping what was in it. The screen ended up read-only: no way to
// add anyone, permissions rendered as decorative chips, an invite that never
// showed you the link, and a Mark-absent wired to a different endpoint.
//
// The card-per-member layout stays. The management comes back, from
// components/mobile/TeamActions, which is also what the Ops grid uses — so the
// two surfaces cannot drift apart the way this one drifted from the desktop.
import { useState } from "react";
import { UsersThree, ShieldCheck, UserMinus, UserPlus, LinkSimple, PencilSimple, Phone } from "@phosphor-icons/react";
import { userPerms, PERMISSIONS } from "../../lib/perms";
import {
  AccessSheet, BottomSheet, EmptyState, InviteSheet, ListSkeleton, MobileCard,
  StatusChip, useTeamData,
} from "../../components/mobile";

const roleLabel = (r) => (r ? String(r).replace(/^./, (c) => c.toUpperCase()) : "");

export default function TeamMobile() {
  const {
    members, isLoading, absentIds, isOwner, canManageTeam, roleOptions,
    refresh, toggleAbsent, getInviteLink,
  } = useTeamData();

  const [open, setOpen] = useState(null);      // member whose detail sheet is up
  const [access, setAccess] = useState(null);  // { member } | { member: null } for add
  const [invite, setInvite] = useState(null);  // invite link payload
  const [busy, setBusy] = useState(false);

  // Desktop's guard, kept exactly: an owner row is only editable by an owner.
  const canEdit = (u) => canManageTeam && (u.role !== "owner" || isOwner);
  const canInviteOrMark = (u) => canManageTeam && u.role !== "owner";

  const doInvite = async (u) => {
    setBusy(true);
    const info = await getInviteLink(u);
    setBusy(false);
    if (info) { setOpen(null); setInvite(info); }
  };

  const doAbsent = async (u) => {
    setBusy(true);
    await toggleAbsent(u);
    setBusy(false);
    setOpen(null);
  };

  return (
    <div data-testid="team-mobile">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Team</h1>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            {members.length} {members.length === 1 ? "person" : "people"}
            {absentIds.size ? ` · ${absentIds.size} absent today` : ""}
          </p>
        </div>
        {canManageTeam && (
          <button
            type="button"
            onClick={() => setAccess({ member: null })}
            data-testid="add-user-button"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <UserPlus size={16} weight="bold" /> Add
          </button>
        )}
      </div>

      <div className="mt-3 space-y-3" data-testid="team-list">
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && members.length === 0 && (
          <EmptyState
            icon={UsersThree}
            title="No one on the team yet."
            // This used to send the owner to a desktop. It no longer has to.
            hint="Add your first teammate and Dex can hand work straight to them."
            actionLabel={canManageTeam ? "Add a teammate" : undefined}
            onAction={canManageTeam ? () => setAccess({ member: null }) : undefined}
            data-testid="team-empty"
          />
        )}
        {members.map((u) => {
          const n = userPerms(u).length;
          return (
            <MobileCard
              key={u.id}
              data-testid={`team-card-${u.id}`}
              title={u.name}
              status={absentIds.has(u.id) ? "overdue" : "completed"}
              statusLabel={absentIds.has(u.id) ? "Absent today" : roleLabel(u.role)}
              person={u.name}
              // §5.4: "10 ACCESS" is a permission count in schema voice.
              context={[u.department || roleLabel(u.role), `Can see ${n} area${n === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" · ")}
              onOpen={() => setOpen(u)}
            />
          );
        })}
      </div>

      <BottomSheet
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name || ""}
        description={[roleLabel(open?.role), open?.department].filter(Boolean).join(" · ")}
        size="tall"
        data-testid="team-sheet"
        footer={
          open && (canEdit(open) || canInviteOrMark(open)) ? (
            <div className="space-y-touch-gap">
              {canEdit(open) && (
                <button
                  type="button"
                  onClick={() => { setAccess({ member: open }); setOpen(null); }}
                  data-testid="team-edit-access"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
                  style={{ minHeight: "var(--control-h-md)" }}
                >
                  <PencilSimple size={18} weight="bold" /> Edit access
                </button>
              )}
              {canInviteOrMark(open) && open.phone && (
                <button
                  type="button"
                  onClick={() => doInvite(open)}
                  disabled={busy}
                  data-testid="team-invite"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-card text-base font-semibold disabled:opacity-50"
                  style={{ minHeight: "var(--control-h-md)" }}
                >
                  <LinkSimple size={18} weight="bold" /> Get login link
                </button>
              )}
              {/* §5.1: a consequential action is never within 8px of a routine
                  one — this sits on its own row. */}
              {canInviteOrMark(open) && (
                <button
                  type="button"
                  onClick={() => doAbsent(open)}
                  disabled={busy}
                  data-testid="team-mark-absent"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-card text-base font-semibold disabled:opacity-50"
                  style={{ minHeight: "var(--control-h-md)" }}
                >
                  <UserMinus size={18} weight="bold" />
                  {absentIds.has(open.id) ? "Mark present" : "Mark absent today"}
                </button>
              )}
            </div>
          ) : null
        }
      >
        {open?.phone && (
          <a
            href={`tel:${open.phone}`}
            data-testid="team-call"
            className="flex items-center gap-2 text-sm font-semibold text-primary"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <Phone size={18} weight="bold" /> {open.phone}
          </a>
        )}
        {open?.email && <p className="text-sm text-muted-foreground">{open.email}</p>}

        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            <ShieldCheck size={16} weight="bold" aria-hidden="true" />
            Can see {userPerms(open || {}).length} area
            {userPerms(open || {}).length === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 flex flex-wrap gap-touch-gap">
            {userPerms(open || {}).map((k) => {
              const p = PERMISSIONS.find((x) => x.key === k);
              return (
                <li key={k}>
                  {/* The permission's human label, never its key (§5.4). */}
                  <StatusChip status="rejected" label={p?.label || k} />
                </li>
              );
            })}
          </ul>
        </div>
      </BottomSheet>

      <AccessSheet
        open={!!access}
        onClose={() => setAccess(null)}
        initial={access?.member || null}
        roleOptions={roleOptions}
        members={members}
        onSaved={refresh}
        onInvite={setInvite}
      />
      <InviteSheet info={invite} onClose={() => setInvite(null)} />
    </div>
  );
}
