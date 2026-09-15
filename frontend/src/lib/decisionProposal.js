// ASK-33 Phase 3 — ONE counter for what a proposed decision creates.
//
// DecisionDialog (ASK-32 Phases 1 and 4) already says "Approving creates 2
// tasks, 1 workflow, 1 more item". The Desk's Dex well now says what a fresh
// capture came to — "Decision ready for Sunita · 2 tasks, 1 workflow" — and the
// two must never count one proposal two ways, so the counting and the wording
// live here and both read them. The people and approvals rules are the
// server's (services/voice.summarize_proposal — the execution_summary the Desk
// card is built from), so the three places agree.

/** Counts for a decision's proposal {tasks, workflows, meetings, reminders, memory_notes}. */
export function proposalCounts(proposal) {
  const p = proposal || {};
  const tasks = p.tasks || [];
  const people = new Set(
    tasks
      .map((t) => (t.assignee_id ? `u:${t.assignee_id}` : t.assignee_role ? `r:${t.assignee_role}` : null))
      .filter(Boolean)
  );
  const workflows = (p.workflows || []).length;
  const meetings = (p.meetings || []).length;
  const reminders = (p.reminders || []).length;
  const notes = (p.memory_notes || []).length;
  return {
    tasks: tasks.length,
    people: people.size,
    approvals: tasks.length ? 1 : 0,
    workflows,
    meetings,
    reminders,
    notes,
    // Everything that is not a task — DecisionDialog's "extras".
    extras: workflows + meetings + reminders + notes,
  };
}

/** The same shape from a stored execution_summary, for a decision that carries
 *  no proposal (one captured before ASK-32 Phase 1). The server counted it. */
export function executionSummaryCounts(summary) {
  const s = summary || {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const workflows = n(s.workflows);
  const meetings = n(s.meetings);
  const reminders = n(s.reminders);
  return {
    tasks: n(s.tasks),
    people: n(s.assignees),
    approvals: n(s.approvals),
    workflows,
    meetings,
    reminders,
    notes: 0,
    extras: workflows + meetings + reminders,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2 tasks, 1 workflow, 1 more item" — the words DecisionDialog prints after
 *  "Approving creates". */
export function proposalCreatesText({ tasks = 0, workflows = 0, extras = 0 } = {}) {
  return [
    tasks ? plural(tasks, "task") : null,
    workflows ? plural(workflows, "workflow") : null,
    extras - workflows > 0 ? plural(extras - workflows, "more item") : null,
  ].filter(Boolean).join(", ");
}
