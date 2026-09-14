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
