/* Needs a person (Epic 11 Sprint 11, founder 2026-10-30): "from the decision
 * it is creating a task — the task is mostly getting unassigned … let at least
 * owners know that this is an unassigned task, kindly assign it."
 *
 * Every open task nobody has, oldest first: the company's for an owner, their
 * own team's for its managers (by Team › Reports to). Each row
 * says where it is waiting and for how long, and is assigned right here — to
 * someone in its team first — or taken by whoever opened the list, when it is
 * theirs to take. The rule behind it is backend/services/task_pickup.py.
 *
 * Opened from the Desk's "Needs a person" card and from the "Assign it to
 * someone" notifications (/inbox?needs=person).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CaretRight, UserCirclePlus, X } from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { canAssignPerson } from "../../lib/taskAccess";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { GLASS_SHEET, INK_PILL } from "../../components/neuglass/glass";
import { cn } from "../../lib/utils";

export const NEEDS_PERSON_KEY = ["tasks", "needs-person"];

export function useNeedsPerson() {
  return useQuery({
    queryKey: NEEDS_PERSON_KEY,
    queryFn: () => api.get("/tasks/needs-person").then((r) => r.data),
    refetchInterval: 60000,
  });
}

const daysWord = (n) => (n <= 0 ? "since today" : n === 1 ? "1 day" : `${n} days`);

function Row({ r, people, busy, onAssign, onTake, onOpen }) {
  /* The team's own people first — the head gives it to someone in the team;
     an owner can give it to anyone. */
  const options = useMemo(() => {
    const inTeam = people.filter((p) => r.assignee_role && p.role === r.assignee_role);
    const others = people.filter((p) => !inTeam.includes(p));
    const opt = (p) => ({ value: p.id, label: p.name });
    if (!inTeam.length) return others.map(opt);
    return [
      { label: `In ${r.department}`, options: inTeam.map(opt) },
      ...(others.length ? [{ label: "Everyone else", options: others.map(opt) }] : []),
    ];
  }, [people, r.assignee_role, r.department]);
  return (
    <li className="rounded-2xl px-2.5 py-2.5 hover:bg-white/70" data-testid={`needs-person-row-${r.id}`}>
      <button type="button" onClick={() => onOpen(r.id)}
        className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-slate-900">{r.title}</span>
          <span className="block truncate text-[12px] text-slate-500" data-testid={`needs-person-line-${r.id}`}>
            {r.line} · waiting {daysWord(r.days)}
            {r.priority === "high" && <span className="font-semibold text-[hsl(18_80%_38%)]"> · high priority</span>}
          </span>
          {r.decision_title && (
            <span className="block truncate text-[12px] text-slate-400">From {r.decision_title}</span>
          )}
        </span>
        <CaretRight size={14} weight="bold" aria-hidden="true" className="mt-1 shrink-0 text-slate-400" />
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="min-w-[11rem] flex-1">
          <GlassSelect value="" disabled={busy} icon={UserCirclePlus}
            placeholder={r.department ? `Assign to someone in ${r.department}` : "Assign to someone"}
            ariaLabel={`Who does ${r.title}`} testid={`needs-person-assign-${r.id}`}
            onChange={(v) => v && onAssign(r, v)} options={options} variant="field"
            triggerClassName="h-10 rounded-pill px-3 text-[13px]" />
        </div>
        {r.can_take && (
          <button type="button" onClick={() => onTake(r)} disabled={busy} data-testid={`needs-person-take-${r.id}`}
            className={cn("h-10 shrink-0 rounded-pill px-4 text-[13px] font-medium disabled:opacity-60", INK_PILL)}>
            Take it
          </button>
        )}
      </div>
    </li>
  );
}

export function NeedsPersonSheet({ open, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listQ = useNeedsPerson();
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
    enabled: open,
  });
  const [busyId, setBusyId] = useState(null);
  const rows = listQ.data?.rows || [];
  // People who are here and whom this person may give work to.
  const people = (Array.isArray(usersQ.data) ? usersQ.data : [])
    .filter((p) => p.role !== "owner" || p.id === user?.id)
    .filter((p) => !p.invite_status || p.invite_status === "active")
    .filter((p) => canAssignPerson(user, p))
    .map((p) => ({ ...p, name: p.id === user?.id ? `${p.name} (you)` : p.name }));

  const settle = (doneId) => {
    // The row leaves at once; the refetch that follows confirms it.
    if (doneId) {
      qc.setQueryData(NEEDS_PERSON_KEY, (prev) => (prev?.rows
        ? { ...prev, rows: prev.rows.filter((x) => x.id !== doneId), count: Math.max(0, (prev.count || 1) - 1) }
        : prev));
    }
    qc.invalidateQueries({ queryKey: NEEDS_PERSON_KEY });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const assign = async (r, uid) => {
    setBusyId(r.id);
    try {
      await api.post(`/tasks/${r.id}/reassign`, { assignee_id: uid });
      const who = people.find((p) => p.id === uid)?.name?.replace(" (you)", "") || "them";
      toast.success(`Given to ${who}`);
      settle(r.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't assign it");
    } finally { setBusyId(null); }
  };
  const take = async (r) => {
    setBusyId(r.id);
    try {
      await api.post(`/tasks/${r.id}/take`);
      toast.success("It's yours — it's on My Work");
      settle(r.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't take it");
      settle();
    } finally { setBusyId(null); }
  };
  const openTask = (id) => {
    onClose();
    navigate(`/my-work?task=${encodeURIComponent(id)}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent overlayClassName="bg-slate-900/30 backdrop-blur-md"
        className={cn(GLASS_SHEET, "flex max-h-[calc(82dvh/var(--ui-scale,1))] flex-col gap-0 overflow-hidden rounded-[1.75rem] p-0 [&>button.absolute]:hidden sm:max-w-lg")}
        data-testid="needs-person-sheet">
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,hsl(24_85%_58%),hsl(18_80%_42%))] text-white">
            <UserCirclePlus size={22} weight="fill" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-left text-[19px] font-semibold leading-tight tracking-tight text-slate-900">
              {rows.length === 1 ? "1 task needs a person" : `${rows.length} tasks need a person`}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-left text-[13px] text-slate-500">
              {listQ.data?.scope === "team"
                ? "Your team's work that nobody has taken yet. Give each one to someone."
                : "Work nobody has yet, oldest first. Give each one to someone."}
            </DialogDescription>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="needs-person-close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-white">
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <ul className="ng-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3" data-testid="needs-person-list">
          {listQ.isLoading && <li className="ds-skeleton mx-2 h-16 rounded-2xl" aria-hidden="true" />}
          {listQ.isError && (
            <li className="px-2.5 py-3 text-sm text-slate-500">Couldn&rsquo;t load the list. Close it and try again.</li>
          )}
          {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
            <li className="px-2.5 py-3 text-sm text-slate-500" data-testid="needs-person-empty">
              Every task has someone. Nothing is waiting.
            </li>
          )}
          {rows.map((r) => (
            <Row key={r.id} r={r} people={people} busy={busyId === r.id}
              onAssign={assign} onTake={take} onOpen={openTask} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default NeedsPersonSheet;
