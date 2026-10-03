/* 2026-10-03 RBAC audit — a workflow's name is a link only for someone who can
 * open Workflows. Task cards, the task drawer and an approved decision all name
 * the workflow a piece of work belongs to; for a member without Workflows
 * access the link led straight to "This page isn't open to you". The name
 * still shows — it says where the work sits — it just isn't a door.
 */
import { useAuth } from "../../context/AuthContext";
import { hasPerm, canSeePipeline } from "../../lib/perms";

export function WorkflowLink({ href, onClick, children, type, ...rest }) {
  const { user } = useAuth();
  // 2026-10-03 — and only into a pipeline their team works in.
  if (hasPerm(user, "workflows") && canSeePipeline(user, type)) {
    return <a href={href} onClick={onClick} {...rest}>{children}</a>;
  }
  return <span {...rest}>{children}</span>;
}

export default WorkflowLink;
