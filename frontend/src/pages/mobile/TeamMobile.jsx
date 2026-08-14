// MPWA-10 · /team — mobile.
//
// §8: "one member per MobileCard. Collapse the ragged Access / Invite /
// Mark-Absent button row into the member sheet — today those buttons wrap
// differently on every row. Replace `10 ACCESS` with 'Can see 10 areas'."
//
// The ragged row is the real defect: three buttons of different widths wrapping
// at different points meant no two rows had the same shape, so the list could
// not be scanned at all.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UsersThree, ShieldCheck, UserMinus, PaperPlaneTilt, Phone } from "@phosphor-icons/react";
import api from "../../lib/api";
import { userPerms, PERMISSIONS } from "../../lib/perms";
import { BottomSheet, EmptyState, ListSkeleton, MobileCard, StatusChip } from "../../components/mobile";

const roleLabel = (r) => (r ? String(r).replace(/^./, (c) => c.toUpperCase()) : "");

export default function TeamMobile() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

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

  const markAbsent = async (u) => {
    setBusy(true);
    try {
      await api.post("/leaves/absence", { user_id: u.id });
      toast.success(`${u.name} marked absent today`);
      qc.invalidateQueries({ queryKey: ["attendance"] });
      setOpen(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  const invite = async (u) => {
    setBusy(true);
    try {
      const { data: res } = await api.post(`/users/${u.id}/invite`);
      toast.success(res?.invite_token ? `Invite ready for ${u.name}` : `Invite sent to ${u.name}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send that invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="team-mobile">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Team</h1>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {members.length} {members.length === 1 ? "person" : "people"}
        {absentIds.size ? ` · ${absentIds.size} absent today` : ""}
      </p>

      <div className="mt-3 space-y-3" data-testid="team-list">
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && members.length === 0 && (
          <EmptyState icon={UsersThree} title="No one on the team yet." />
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

      {/* All three actions live here instead of on the row, so every row is the
          same shape and the list can actually be scanned. */}
      <BottomSheet
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name || ""}
        description={[roleLabel(open?.role), open?.department].filter(Boolean).join(" · ")}
        size="tall"
        data-testid="team-sheet"
        footer={
          <div className="space-y-touch-gap">
            <button
              type="button"
              onClick={() => invite(open)}
              disabled={busy}
              data-testid="team-invite"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              <PaperPlaneTilt size={18} weight="bold" /> Send a login link
            </button>
            {/* §5.1: a consequential action is never within 8px of a routine
                one — this sits on its own row, not beside the invite. */}
            <button
              type="button"
              onClick={() => markAbsent(open)}
              disabled={busy || absentIds.has(open?.id)}
              data-testid="team-mark-absent"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border text-base font-semibold disabled:opacity-50"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              <UserMinus size={18} weight="bold" />
              {absentIds.has(open?.id) ? "Already marked absent" : "Mark absent today"}
            </button>
          </div>
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
    </div>
  );
}
