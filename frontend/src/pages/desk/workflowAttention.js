/* ASK-52 · WHAT NEEDS ATTENTION ON THE WORKFLOW BOARDS, in one place.
 *
 * The Desk's Workflows tile reads a number off every board at once — "4 of 6
 * cards need attention" — and names the one to pick up next. The rules live
 * here, as a pure function over the cards the API already sends
 * (GET /workflows?with_tasks=true: each card's stages, its history of moves,
 * and the OPEN tasks at its current stage), so the Workflows page can show the
 * same number later without either of them drifting.
 *
 * THE THREE REASONS a card needs attention, as the founder defined them:
 *
 *   you    an open task at its current stage is yours, or the next move is the
 *          one only an owner may make (the board's approval stage — the engine
 *          refuses that move from anyone else, services/workflow_engine). The
 *          sign-off half counts only when the person looking IS an owner:
 *          nobody else can act on it.
 *   stuck  neither the stage nor its tasks have moved for the board's stuck
 *          days (Settings → Operations, else STUCK_WORKING_DAYS).
 *   late   an open task at its current stage is past its due date, OR the
 *          stage itself has run past the working days it should take, OR the
 *          card has passed its own target date (2026-09-22: stages have a
 *          duration and cards a target — services/workflow_timing, which
 *          sends `timing` on every card; this file reads it rather than
 *          working the same numbers out a second time).
 *
 * A card is counted ONCE. Where two reasons fit, the worse one wins — late,
 * then stuck, then you — so the three parts add up to the number above them
 * and the bar under it is a split of that number, not an overlapping tally.
 */

/* Working days idle before a card is stuck. A constant, and resolved per board
   (STUCK_WORKING_DAYS_BY_BOARD) so one board can be tuned later without
   touching the rest: procurement might deserve five, dispatch two. */
export const STUCK_WORKING_DAYS = 3;
export const STUCK_WORKING_DAYS_BY_BOARD = {};

/* Sunday is the day off; a card idle from Friday to Monday is two working days
   idle, not three. Six-day weeks are the norm in the businesses this is for —
   change this one line for a five-day week. */
const isWorkingDay = (d) => d.getDay() !== 0;

export const stuckDaysFor = (type, pipelines) =>
  STUCK_WORKING_DAYS_BY_BOARD[type]
  ?? (pipelines || []).find((p) => p.key === type)?.stuck_after_days
  ?? STUCK_WORKING_DAYS;

/** Working days between two instants, counting the days AFTER `from` up to
 *  and including `to`'s day. Same day → 0. */
export function workingDaysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const cur = day(a);
  const end = day(b);
  let n = 0;
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur)) n += 1;
  }
  return n;
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const latest = (...times) => times.filter(Boolean).sort().slice(-1)[0] || null;

/** The board a card belongs to, from the tenant's operating model. */
const pipelineOf = (pipelines, type) => (pipelines || []).find((p) => p.key === type) || null;

/** A stage's label, as the board writes it; falls back to the key. */
export function stageLabel(pipelines, type, key) {
  if (!key) return "";
  const stages = pipelineOf(pipelines, type)?.stages || [];
  const hit = stages.find((s) => (typeof s === "string" ? s : s.key) === key);
  const label = hit && typeof hit !== "string" ? hit.label : null;
  return label || String(key).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Every card read once: its next move, when it last did anything, and why it
 *  is (or is not) asking for attention. */
function readCard(w, { userId, isOwner, pipelines, now }) {
  const stages = w.stages || [];
  const idx = stages.indexOf(w.stage);
  const finalStage = stages[stages.length - 1];
  const active = !!w.stage && w.stage !== finalStage;
  const nextStage = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
  const approvalStage = pipelineOf(pipelines, w.type)?.approval_stage || null;
  const needsSignOff = !!nextStage && !!approvalStage && nextStage === approvalStage;

  const tasks = w.stage_tasks || [];
  const mine = tasks.some((t) => t.assignee_id && t.assignee_id === userId);
  const today = iso(now);
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today);

  const lastMove = latest(...(w.history || []).map((h) => h.at), w.created_at);
  const lastTask = latest(...tasks.map((t) => t.updated_at));
  const idleSince = latest(lastMove, lastTask);
  const idleDays = workingDaysBetween(idleSince, now);

  const tm = w.timing || null;
  const stageLateDays = (tm && tm.stage_late_days) || 0;
  const pastTarget = !!(tm && tm.past_target);
  const atRisk = active && !!(tm && tm.at_risk) && !pastTarget;
  const you = active && (mine || (needsSignOff && isOwner));
  // The server's stuck clock when it sent one (same rule, the board's own
  // threshold); the local count otherwise.
  const stuck = active && (tm ? !!tm.stuck : idleDays >= stuckDaysFor(w.type, pipelines));
  const late = active && (overdue.length > 0 || stageLateDays > 0 || pastTarget);
  // The worse reason wins, so the three parts of the bar add up to the number.
  const reason = late ? "late" : stuck ? "stuck" : you ? "you" : null;

  return {
    w, active, nextStage, needsSignOff, tasks, mine, overdue,
    idleSince, idleDays: tm ? tm.idle_days : idleDays, you, stuck, late, reason,
    stageLateDays, pastTarget, atRisk, timing: tm,
    // The earliest due date it has run past — "2 days late" reads off this.
    overdueBy: Math.max(
      overdue.length ? Math.max(...overdue.map((t) => Math.round((new Date(today) - new Date(t.due_date)) / 86400000))) : 0,
      stageLateDays,
    ),
  };
}

/**
 * @param {object[]} workflows  GET /workflows?with_tasks=true
 * @param {string}   userId     who is looking
 * @param {boolean}  isOwner
 * @param {object[]} pipelines  the tenant's operating model pipelines
 * @param {Date}     now
 * @returns {{needAttention:number,total:number,you:number,stuck:number,late:number,
 *            nextUp:object|null,advancedToday:number,cards:object[]}}
 */
export function workflowAttention({ workflows, userId, isOwner = false, pipelines = [], now = new Date() } = {}) {
  const read = (workflows || []).map((w) => readCard(w, { userId, isOwner, pipelines, now }));
  const active = read.filter((c) => c.active);
  const flagged = active.filter((c) => c.reason);

  /* The one to pick up: the card that has sat longest, then the one waiting on
     the person looking, then the furthest past its date. */
  const oldest = (list) => [...list].sort((a, b) => String(a.idleSince || "").localeCompare(String(b.idleSince || "")))[0] || null;
  const chosen = oldest(active.filter((c) => c.stuck))
    || oldest(active.filter((c) => c.you))
    || [...active.filter((c) => c.late)].sort((a, b) => b.overdueBy - a.overdueBy)[0]
    || null;

  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const advancedToday = read.filter((c) => {
    const moves = (c.w.history || []).filter((h) => h.at && h.at >= midnight);
    // The first history entry is the card being created, not a move.
    return moves.some((h) => (c.w.history || []).indexOf(h) > 0);
  }).length;

  return {
    needAttention: flagged.length,
    total: active.length,
    you: flagged.filter((c) => c.reason === "you").length,
    stuck: flagged.filter((c) => c.reason === "stuck").length,
    late: flagged.filter((c) => c.reason === "late").length,
    // Running on time today but forecast to miss the target date — not yet a
    // reason (nothing is late), said beside the number.
    atRisk: active.filter((c) => c.atRisk).length,
    advancedToday,
    nextUp: chosen ? nextUpOf(chosen, pipelines) : null,
    cards: read,
  };
}

/** The Next up half of the tile: what it says, and the move it offers. */
function nextUpOf(c, pipelines) {
  const w = c.w;
  const reasonLabel = c.stuck ? `Stuck ${c.idleDays}d`
    : c.you ? (c.mine ? "Needs you" : "Needs your sign-off")
    : c.late ? `${c.overdueBy} ${c.overdueBy === 1 ? "day" : "days"} late`
    : "";
  const note = c.tasks.length === 0 ? "no tasks at this stage"
    : c.pastTarget ? `past its target date`
    : c.stageLateDays ? `${c.stageLateDays} working day${c.stageLateDays === 1 ? "" : "s"} over at this stage`
    : c.overdue.length ? `${c.overdue.length} overdue task${c.overdue.length === 1 ? "" : "s"}`
    : `${c.tasks.length} open task${c.tasks.length === 1 ? "" : "s"}`;
  return {
    id: w.id,
    type: w.type,
    title: w.title,
    reason: c.reason,
    reasonLabel,
    stage: stageLabel(pipelines, w.type, w.stage),
    note,
    nextStage: c.nextStage,
    // The board's own button, in the board's own words: the move only an owner
    // may make reads as the approval it is.
    actionLabel: c.nextStage
      ? (c.needsSignOff ? `Approve ${stageLabel(pipelines, w.type, c.nextStage)}`
        : `Advance to ${stageLabel(pipelines, w.type, c.nextStage)}`)
      : null,
  };
}

export default workflowAttention;
