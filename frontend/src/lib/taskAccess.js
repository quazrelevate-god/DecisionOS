// ASK-28 TK-08 (plan 6.5) — ONE list of task access rules for the screens,
// mirroring backend services/tasks.py (can_see_all_tasks, can_assign_person,
// can_assign_team). The server enforces them; the screens only offer what the
// server will accept, so nobody picks a person and then gets refused.
import { userPerms } from "./perms";

const isOwner = (user) => user?.role === "owner";

// All Tasks: the owner, or anyone given "See all tasks".
export const canSeeAllTasks = (user) => isOwner(user) || userPerms(user).includes("tasks_view_all");

// "Assign tasks to anyone" (the owner always).
export const canAssignAny = (user) => isOwner(user) || userPerms(user).includes("tasks_assign_any");

// A doer or helper: anyone with the above; otherwise yourself, your own team
// (role), or someone who reports to you.
export function canAssignPerson(user, member) {
  if (!user || !member) return false;
  if (canAssignAny(user)) return true;
  if (member.id === user.id) return true;
  if (member.role && member.role === user.role) return true;
  return member.reporting_manager_id === user.id;
}

// Routing a task to a whole team: your own team only, unless assigning to anyone.
export const canAssignTeam = (user, roleKey) => canAssignAny(user) || (!!roleKey && roleKey === user?.role);

// ASK-28 item 7 (plan 6.7) — who may CHANGE a task, mirroring backend
// services/tasks.task_edit_rights:
//   work     stage, progress, Waiting on: doer, helpers, asker, manager, owner
//   finish   done / cancel / reopen: the same minus helpers
//   people   doer and helpers: asker, manager, Manage Team, owner
//   priority asker, manager, owner
//   wording  rename / rewrite the description: asker, manager, owner
//            (PILOT-1 B — the same people as priority; not the doer)
//   proof    asker and owner only
// "See all tasks", the approver and a colleague waited on leave notes.
// `members` carries reporting_manager_id, which decides "manager".
export function taskEditRights(user, t, members = []) {
  const none = { work: false, finish: false, people: false, priority: false, wording: false, proof: false };
  if (!user?.id || !t) return none;
  const owner = isOwner(user);
  const doer = t.assignee_id ? t.assignee_id === user.id : (!!t.assignee_role && t.assignee_role === user.role);
  const helper = (t.co_assignee_ids || []).includes(user.id);
  const creator = !!t.created_by && t.created_by === user.id;
  const manager = [t.assignee_id, ...(t.co_assignee_ids || [])]
    .some((id) => id && members.find((m) => m.id === id)?.reporting_manager_id === user.id);
  const runs = owner || creator || manager;
  return {
    work: runs || doer || helper,
    finish: runs || doer,
    people: runs || userPerms(user).includes("team_manage"),
    priority: runs,
    wording: runs,
    proof: owner || creator,
  };
}
