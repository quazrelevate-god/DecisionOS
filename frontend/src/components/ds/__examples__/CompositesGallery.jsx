import { useState } from "react";
import { Microphone, Tray, CurrencyInr, Warning, ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "../Button";
import { Card, StatCard, TaskCard } from "../Card";
import { ApprovalCard } from "../ApprovalCard";
import { AssigneeChip, AssigneeStack } from "../AssigneeChip";
import { ProgressQuarters } from "../ProgressQuarters";
import { ProgressSteps } from "../ProgressSteps";
import { ListRow } from "../ListRow";
import { GroupedFeed } from "../GroupedFeed";
import { EmptyState } from "../EmptyState";

/**
 * Phase 3 gallery + usage examples for the composites.
 *
 * The approval card is shown in every state it can reach, because the states
 * are where the semantics live: what disappears when a decision resolves, what
 * is absent rather than disabled without permission, and where red is allowed
 * to appear when an action fails.
 */

function Group({ title, intro, children }) {
  return (
    <div className="mb-10">
      <h3 className="text-h3 text-text">{title}</h3>
      {intro && <p className="text-body text-text-secondary mt-1 mb-4 max-w-3xl">{intro}</p>}
      {children}
    </div>
  );
}

function Case({ label, note, children }) {
  return (
    <div className="mb-5">
      <p className="text-label uppercase text-text-tertiary mb-1">{label}</p>
      {note && <p className="text-small text-text-tertiary mb-2 max-w-3xl">{note}</p>}
      {children}
    </div>
  );
}

const DECISION = {
  title: "Approve supplier payment timing",
  kind: "Directive",
  summary:
    "Move the ₹4,80,000 payment to Friday to preserve payroll headroom while maintaining the committed supplier window.",
  provenance: "Raised by Prasanna Narayanan · Voice",
  timeLabel: "2 hours ago",
  tasks: [
    { id: "t1", title: "Confirm dispatch schedule", assignee_name: "Prasanna Narayanan" },
    { id: "t2", title: "Reconcile packaging invoice" },
  ],
};

export function CompositesGallery() {
  const [pendingAction, setPendingAction] = useState(null);
  const [claimed, setClaimed] = useState(50);

  const fakeAct = (action) => {
    setPendingAction(action);
    setTimeout(() => setPendingAction(null), 1600);
  };

  return (
    <>
      <Group
        title="Approval card"
        intro="Approve is the only solid fill in the card, so it stays dominant beside a red-outlined Reject — the outline uses danger-300, the lightest usable red, so it reads as a quiet boundary rather than a red frame. The left edge is indigo: a decision waiting on you is not an error."
      >
        <Case label="Pending — the default" note="Press Approve or Reject to see the in-flight state.">
          <ApprovalCard
            {...DECISION}
            provenanceIcon={<Microphone size={13} weight="bold" />}
            pendingAction={pendingAction}
            onReassign={() => {}}
            onApprove={() => fakeAct("approve")}
            onReject={() => fakeAct("reject")}
            onDiscuss={() => fakeAct("discuss")}
          />
        </Case>

        <Case label="Resolved" note="The action row is gone, not disabled — there is nothing left to do, so the card stops taking the room of something that needs a decision.">
          <div className="flex flex-col gap-3">
            <ApprovalCard
              state="approved"
              title={DECISION.title}
              resolutionLabel="Approved by Prasanna Narayanan · just now"
            />
            <ApprovalCard
              state="rejected"
              title={DECISION.title}
              resolutionLabel="Rejected by Prasanna Narayanan · 1 hour ago"
            />
          </div>
        </Case>

        <Case
          label="Read-only"
          note="Without decisions_approve the action row is absent rather than disabled — disabled buttons promise 'try again later', and this user never can."
        >
          <ApprovalCard {...DECISION} canAct={false} />
        </Case>

        <Case label="Error" note="The card stays pending and the actions re-enable. Red is confined to one helper line; the card does not become an alarm.">
          <ApprovalCard
            {...DECISION}
            tasks={[]}
            error="Could not approve — the decision was already actioned. Refresh to see the latest."
            onApprove={() => {}}
            onReject={() => {}}
            onDiscuss={() => {}}
          />
        </Case>
      </Group>

      <Group
        title="Progress — claimed vs computed"
        intro="Segmented means a person claimed it in quarters; continuous with a count means the system computed it from steps. The shapes differ so the two can never be mistaken for each other. Indigo at every value — never red when behind, never green at 100."
      >
        <div className="rounded-lg border border-hairline bg-surface p-5 flex flex-col gap-4 max-w-xl">
          <Case label="ProgressQuarters — claimed" note="Interactive: click a segment. Ready for MyWork, deliberately not wired in on this branch.">
            <ProgressQuarters value={claimed} onValueChange={setClaimed} label="Confirm dispatch schedule" />
          </Case>
          <Case label="Every value">
            <div className="flex flex-col gap-2">
              {[0, 25, 50, 75, 100].map((v) => (
                <ProgressQuarters key={v} value={v} label={`Example ${v}`} />
              ))}
              <ProgressQuarters value={50} disabled label="Disabled" />
            </div>
          </Case>
          <Case label="ProgressSteps — computed" note="The count is the honest unit; the percentage is a rendering of it.">
            <div className="flex flex-col gap-2">
              <ProgressSteps done={0} total={6} label="Plan" />
              <ProgressSteps done={4} total={6} label="Plan" />
              <ProgressSteps done={6} total={6} label="Plan" />
            </div>
          </Case>
        </div>
      </Group>

      <Group title="Cards" intro="Depth from the hairline, not shadow. 12px radius. The urgency edge is the only place urgency appears.">
        <Case label="Stat cards" note="Tabular numbers so a row keeps its digits in column. The delta is never coloured by sign — rising overdue work is not good news.">
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard label="Awaiting approval" value={7} icon={<Tray />} delta="+3 since Monday" drillLabel="Review" onDrill={() => {}} />
            <StatCard label="Cash position" value="₹18,42,300" icon={<CurrencyInr />} />
            <StatCard label="Overdue" value={2} icon={<Warning />} delta="-1 since Monday" drillLabel="Open" onDrill={() => {}} />
          </div>
        </Case>

        <Case label="Task cards" note="Standalone, so the overdue badge stays — the 3px edge has no group header here to give it meaning.">
          <div className="grid sm:grid-cols-2 gap-4">
            <TaskCard
              title="Confirm dispatch schedule"
              status="directive"
              statusLabel="In progress"
              progress={75}
              dueLabel="Due Friday"
              assigneeName="Prasanna Narayanan"
              actions={<Button size="sm" variant="secondary">Open</Button>}
            />
            <TaskCard
              title="Reconcile packaging invoice"
              overdue
              priority="medium"
              steps={{ done: 4, total: 6 }}
              dueLabel="Due 2 days ago"
              assigneeRole="finance"
              actions={
                <>
                  <Button size="sm">Mark done</Button>
                  <Button size="sm" variant="tertiary" leadingIcon={<ArrowsClockwise />}>Reassign</Button>
                </>
              }
            />
          </div>
        </Case>

        <Case label="Assignee chips" note="Unassigned is a dashed invitation, not a person called 'Unassigned'.">
          <Card padding="sm">
            <div className="flex flex-wrap items-center gap-3">
              <AssigneeChip name="Prasanna Narayanan" />
              <AssigneeChip name="Ravi Kumar" editable onEdit={() => {}} />
              <AssigneeChip role="finance" />
              <AssigneeChip editable onEdit={() => {}} />
              <AssigneeChip name="Sneha Menon" disabled />
              <AssigneeStack
                people={[{ name: "Prasanna Narayanan" }, { name: "Ravi Kumar" }, { name: "Sneha Menon" }, { name: "Arun Das" }]}
              />
            </div>
          </Card>
        </Case>
      </Group>

      <Group
        title="Grouped feed"
        intro="Urgency is a left edge and nothing else. Inside a group the overdue badge is suppressed: under an 'Overdue' header, header + edge + badge would state the same fact three times, and that is where a feed stops informing and starts alarming. Headers stick, so the edge keeps its meaning while scrolling."
      >
        <GroupedFeed
          groups={{
            overdue: [
              { id: 1, title: "Reconcile packaging invoice", meta: "Due 2 days ago · Finance", assigneeRole: "finance" },
              { id: 2, title: "Chase Delhi retailer quote", meta: "Due 3 days ago", assigneeName: "Ravi Kumar" },
            ],
            today: [{ id: 3, title: "Approve dispatch schedule", meta: "Due today · Operations", assigneeName: "Prasanna Narayanan" }],
            week: [{ id: 4, title: "Supplier payment run", meta: "Due Friday", assigneeName: "Sneha Menon" }],
            later: [{ id: 5, title: "Review quarterly headcount", meta: "Next month" }],
          }}
          renderItem={(item, group) => (
            <ListRow
              key={item.id}
              inGroup
              urgency={group}
              title={item.title}
              meta={item.meta}
              assigneeName={item.assigneeName}
              assigneeRole={item.assigneeRole}
              onClick={() => {}}
              trailing={
                group === "overdue" ? undefined : <ProgressQuarters value={50} showLabel={false} className="w-24" label={item.title} />
              }
            />
          )}
        />

        <div className="mt-4">
          <Case label="Standalone row" note="Outside a group there is no header, so the overdue badge stays.">
            <div className="overflow-hidden rounded-lg border border-hairline">
              <ListRow
                title="Reconcile packaging invoice"
                meta="Due 2 days ago · Finance"
                urgency="overdue"
                assigneeRole="finance"
                onClick={() => {}}
              />
              <ListRow title="Disabled row" meta="Cannot be opened" urgency="later" disabled onClick={() => {}} />
            </div>
          </Case>
        </div>
      </Group>

      <Group
        title="Empty state"
        intro="No data is not a failure, so nothing here is red, dashed or warning-shaped. The copy names the first thing to create and the primary action starts it."
      >
        <EmptyState
          icon={<Microphone />}
          title="Capture the first decision"
          description="Speak it, type it, or upload a file — the Company Brain writes it up and proposes the tasks and owners."
          actionLabel="Capture a decision"
          onAction={() => {}}
          secondaryAction={<Button variant="tertiary">See an example</Button>}
        />
      </Group>
    </>
  );
}
