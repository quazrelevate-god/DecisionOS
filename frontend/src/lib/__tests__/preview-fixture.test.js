/**
 * The preview fixture is the only dataset anyone rules on the Decision Desk
 * against, so its coverage is a contract, not a convenience.
 *
 * whatMatters.test.js proves the ranking is correct given input. This file
 * proves the input the reviewer actually sees still reaches every branch of
 * it. The two failures it exists to catch:
 *
 *   1. A tier quietly stops being represented — someone edits a due date, the
 *      escalation tier empties, and the Desk looks calm because the data went
 *      missing rather than because the morning is clear.
 *   2. The top-3 stops being a real choice — fewer than four candidates means
 *      "show three, hide the rest" is never exercised and the hidden count
 *      renders as zero in every screenshot.
 */
import { previewData } from "../../dev/previewMock";
import { whatMatters } from "../whatMatters";

const decisions = previewData("/decisions");
const tasks = previewData("/tasks");
const ranked = whatMatters({ decisions, tasks });

describe("preview fixture — shape", () => {
  test("serves six pending approvals, and a non-pending decision that must not qualify", () => {
    expect(decisions.filter((d) => d.status === "pending_approval")).toHaveLength(6);
    expect(decisions.filter((d) => d.status !== "pending_approval").length).toBeGreaterThan(0);
  });

  test("serves thirteen tasks", () => {
    expect(tasks).toHaveLength(13);
  });

  test("carries both an escalation and a handoff, which share a tier", () => {
    expect(tasks.filter((t) => t.source === "escalation")).toHaveLength(2);
    expect(tasks.filter((t) => t.source === "handoff")).toHaveLength(1);
  });
});

describe("preview fixture — exercises every tier", () => {
  test("all four tiers are populated", () => {
    expect(ranked.counts).toEqual({
      approval: 6,
      escalation: 3,
      overdue: 5,
      today: 3,
    });
  });

  test("there are more candidates than the top-3 shows, so the hidden count is real", () => {
    expect(ranked.items).toHaveLength(3);
    expect(ranked.hidden).toBe(14);
  });

  test("the shortlist spans tiers rather than being filled by approvals alone", () => {
    expect(ranked.items.map((i) => i.tier)).toEqual(["approval", "escalation", "overdue"]);
  });
});

describe("preview fixture — the rows that guard a regression", () => {
  test("a done task eight days past due never surfaces", () => {
    const terminal = tasks.find((t) => t.id === "tx1");
    expect(terminal.status).toBe("done");
    expect(new Date(terminal.due_date).getTime()).toBeLessThan(Date.now());

    const all = whatMatters({ decisions, tasks, limit: 99 });
    expect(all.items.some((i) => i.id === "tx1")).toBe(false);
  });

  test("an escalation that is also overdue still ranks as an escalation", () => {
    const all = whatMatters({ decisions, tasks, limit: 99 });
    const te2 = all.items.find((i) => i.id === "te2");
    expect(te2.tier).toBe("escalation");
    expect(te2.reason).toMatch(/escalated this to you/);
  });

  test("a task due in five days is not in the due-today tier", () => {
    const all = whatMatters({ decisions, tasks, limit: 99 });
    expect(all.items.some((i) => i.id === "tf1")).toBe(false);
  });

  test("the overdue tier carries four distinct day counts and one deliberate tie", () => {
    const all = whatMatters({ decisions, tasks, limit: 99 });
    const overdue = all.items.filter((i) => i.tier === "overdue");
    const reasons = overdue.map((i) => i.reason);
    expect(new Set(reasons).size).toBe(4);
    // to3a and to3b are both three days late — the pair the amount tie-break needs.
    expect(reasons.filter((r) => r === "3 days overdue")).toHaveLength(2);
  });
});
