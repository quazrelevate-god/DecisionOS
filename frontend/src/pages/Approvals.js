/* ASK-42 B · /approvals — the approvals room.
   It is pages/MyWork.js in `only="approvals"` mode, not a copy of it. What this
   page shows is the approvals hub that has lived inside My Work since ASK-25,
   and everything that hub needs is already wired there: the /tasks?view=
   approvals feed and the leave register, the task grid and its drawer, the
   people and role lists the drawer's Reassign reads, the focus-task deep link,
   and the rule (mirrored from tasks.py's _can_approve_task) that decides which
   of them this person may sign off. Rebuilding that here would be a second
   copy of five queries and one permission rule to keep in step by hand.
   What the mode changes is the chrome: My Work's own title, eyebrow, lens
   group, filters and [+] are controls for a task list this screen does not
   show, so they stand down, and the hub draws the page's heading itself with
   the All/Mine lens on its line. */
import MyWork from "./MyWork";

export default function Approvals() {
  return <MyWork only="approvals" />;
}
