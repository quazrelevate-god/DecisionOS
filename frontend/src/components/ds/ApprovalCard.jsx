import * as React from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { Button } from "./Button";
import { StatusBadge } from "./StatusBadge";
import { AssigneeChip } from "./AssigneeChip";

/**
 * The approval card — the centre of the Decision Desk.
 *
 * Shape follows the decision model: pending_approval → approved | rejected,
 * with /approve, /reject and /comment behind the three actions.
 *
 * Two deliberate asymmetries:
 *
 * 1. Approve is the only solid fill in the card. Reject is a destructive
 *    OUTLINE using danger-300 — the lightest usable red — so it reads as a
 *    quiet boundary rather than a red frame competing with the primary.
 *    Measured: Approve carries ~15x the coloured area.
 * 2. Without permission the action row is ABSENT, not disabled. Disabled
 *    buttons promise "try again later"; a user without decisions_approve
 *    never can, and saying so in words is more honest than greying it out.
 *
 * The left edge is indigo while pending — a decision waiting on you is not an
 * error, so it never gets the danger edge.
 *
 * @typedef {'pending'|'approved'|'rejected'} ApprovalState
 * @typedef {'approve'|'reject'|'discuss'} ApprovalAction
 */

/**
 * @typedef {object} ApprovalTask
 * @property {string} id
 * @property {string} title
 * @property {string} [assignee_name]
 * @property {string} [assignee_role]
 *
 * @typedef {object} ApprovalCardProps
 * @property {string} title
 * @property {ApprovalState} [state='pending']
 * @property {string} [kind] Decision type shown as the second badge, e.g. "Directive".
 * @property {string} [summary]
 * @property {string} [provenance] Pre-formatted, e.g. "Raised by Prasanna Narayanan · Voice".
 * @property {React.ReactNode} [provenanceIcon]
 * @property {string} [timeLabel] e.g. "2 hours ago".
 * @property {string} [resolutionLabel] Shown on the resolved strip, e.g. "Approved by X · just now".
 * @property {ApprovalTask[]} [tasks] Tasks this decision will unblock.
 * @property {(task: ApprovalTask) => void} [onReassign] Makes each assignee chip editable.
 * @property {boolean} [canAct=true] False renders the read-only note instead of the action row.
 * @property {string} [readOnlyNote='Only owners can approve this.']
 * @property {ApprovalAction|null} [pendingAction] Which action is in flight; spins it and disables the rest.
 * @property {string} [error] Danger helper line under the action row; actions stay enabled.
 * @property {() => void} [onApprove]
 * @property {() => void} [onReject]
 * @property {() => void} [onDiscuss]
 *
 * @example
 * <ApprovalCard
 *   title={d.title}
 *   kind={d.dtype}
 *   summary={d.summary}
 *   provenance={raisedByLabel(d)}
 *   provenanceIcon={<RaisedByIcon d={d} size={13} weight="bold" />}
 *   timeLabel={timeAgo(d.created_at)}
 *   tasks={d.tasks}
 *   canAct={hasPerm(user, "decisions_approve")}
 *   pendingAction={inFlight}
 *   onApprove={approve} onReject={reject} onDiscuss={openThread}
 * />
 */
export const ApprovalCard = React.forwardRef(
  (
    {
      className,
      title,
      state = "pending",
      kind,
      summary,
      provenance,
      provenanceIcon,
      timeLabel,
      resolutionLabel,
      tasks = [],
      onReassign,
      canAct = true,
      readOnlyNote = "Only owners can approve this.",
      pendingAction = null,
      error,
      onApprove,
      onReject,
      onDiscuss,
      ...props
    },
    ref
  ) => {
    /* ---- Resolved: collapse to a strip. Nothing is left to do, so the card
       stops taking up the room of something that needs a decision. ---- */
    if (state === "approved" || state === "rejected") {
      return (
        <Card ref={ref} urgency="later" padding="sm" className={className} {...props}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex min-w-0 items-center gap-3">
              {state === "approved" ? (
                <StatusBadge status="completed">Approved</StatusBadge>
              ) : (
                <StatusBadge status="rejected" />
              )}
              <span className="truncate text-body text-text">{title}</span>
            </div>
            {resolutionLabel && (
              <span className="whitespace-nowrap text-small text-text-tertiary">{resolutionLabel}</span>
            )}
          </div>
        </Card>
      );
    }

    const busy = Boolean(pendingAction);

    return (
      <Card ref={ref} urgency="today" className={cn("flex-col", className)} {...props}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="pending" />
            {kind && <StatusBadge status="directive">{kind}</StatusBadge>}
          </div>
          {timeLabel && <span className="whitespace-nowrap text-small text-text-tertiary">{timeLabel}</span>}
        </div>

        <p className="mt-3 text-h3 text-text">{title}</p>

        {provenance && (
          <p className="mt-1.5 flex items-center gap-1.5 text-small text-text-tertiary">
            {provenanceIcon}
            {provenance}
          </p>
        )}

        {summary && <p className="mt-3 text-body text-text-secondary">{summary}</p>}

        {tasks.length > 0 && (
          <div className="mt-4 border-t border-hairline pt-3">
            <p className="mb-1 text-label uppercase text-text-tertiary">
              {tasks.length === 1 ? "Task it will unblock" : "Tasks it will unblock"}
            </p>
            <ul>
              {tasks.map((t) => (
                <li
                  key={t.id || t.title}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-0"
                >
                  <span className="min-w-0 truncate text-body text-text">{t.title}</span>
                  <AssigneeChip
                    name={t.assignee_name}
                    role={t.assignee_role}
                    editable={Boolean(onReassign)}
                    disabled={busy}
                    onEdit={() => onReassign?.(t)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {canAct ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={onApprove} loading={pendingAction === "approve"} disabled={busy}>
                Approve
              </Button>
              <Button variant="destructive" onClick={onReject} loading={pendingAction === "reject"} disabled={busy}>
                Reject
              </Button>
              <Button variant="tertiary" onClick={onDiscuss} loading={pendingAction === "discuss"} disabled={busy}>
                Discuss
              </Button>
            </div>
            {error && (
              <p role="alert" className="mt-2 flex items-center gap-1.5 text-small text-destructive-text">
                <WarningCircle size={13} weight="bold" className="shrink-0" />
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-small text-text-tertiary">{readOnlyNote}</p>
        )}
      </Card>
    );
  }
);
ApprovalCard.displayName = "ApprovalCard";
